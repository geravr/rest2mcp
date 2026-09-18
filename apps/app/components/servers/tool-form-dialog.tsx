import { PathPartsEditor } from "@/components/servers/path-parts-editor";
import {
  AgentLeftoverFields,
  SourceRowEditor,
} from "@/components/servers/source-row-editor";
import { TemplateValueInput } from "@/components/servers/template-value-input";
import {
  useCreateMcpTool,
  useMcpToolEditorState,
  usePreviewToolCompile,
  useUpdateMcpTool,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
  buildServerValueLookup,
  createDefinitionId,
  definitionAgentInputs,
  definitionToBodyState,
  definitionToPathParts,
  definitionToSourceRows,
  formStateToDefinition,
  isClientRequestDefinition,
  type ClientJsonNode,
  type ClientRequestDefinition,
} from "@/lib/request-definition";
import {
  compileFormBody,
  compileStructuredJson,
  defaultAgentMeta,
  detectPlaceholderNames,
  inferFormRows,
  inferJsonRows,
  inferMapRows,
  isFlatJsonTemplate,
  joinPath,
  paramsByName,
  splitPath,
  type AgentMeta,
  type PathPart,
  type SourceRow,
} from "@/lib/value-origin";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@repo/ui";
import { ChevronDown, ChevronRight, LoaderCircle, Wand2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Keeps only agent metadata fields so propagation never clobbers row keys/ids. */
function pickAgentMeta(source: AgentMeta): AgentMeta {
  return {
    name: source.name,
    description: source.description,
    type: source.type,
    inputType: source.inputType,
    required: source.required,
    sensitive: source.sensitive,
    minimum: source.minimum,
    maximum: source.maximum,
    minLength: source.minLength,
    maxLength: source.maxLength,
    pattern: source.pattern,
    enum: source.enum,
    examples: source.examples,
    allowEmpty: source.allowEmpty,
  };
}

type BodyType = "none" | "json" | "form" | "raw";

export type ToolParamDraft = AgentMeta;

export type ToolCompileIssue = {
  path: string;
  /** Stable definition-local id of the affected node, when known. */
  id?: string;
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type ToolFormTool = {
  id: string;
  name: string;
  description: string | null;
  method: string;
  pathTemplate: string;
  requestTemplate: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string | null;
    bodyType?: "json" | "form" | "raw";
  } | null;
  params: ToolParamDraft[] | null;
  /** Canonical versioned definition; authoritative when present. */
  requestDefinition?: Record<string, unknown> | null;
  allowMutation: boolean;
  enabled: boolean;
  compileStatus?: string | null;
  compileIssues?: ToolCompileIssue[] | null;
};

export type ToolFormServerValue = {
  id: string;
  name: string;
  kind: "config" | "secret";
};

function initialBodyState(
  tool: ToolFormTool | undefined,
  variableNames: string[],
  paramMap: Map<string, AgentMeta>,
): {
  bodyType: BodyType;
  formRows: SourceRow[];
  jsonRows: SourceRow[];
  jsonAdvanced: boolean;
  advancedBody: string;
} {
  const storedType = tool?.requestTemplate?.bodyType;
  const storedBody = tool?.requestTemplate?.body ?? "";
  const bodyType: BodyType = storedType ?? (storedBody ? "raw" : "none");
  if (bodyType === "form") {
    return {
      bodyType,
      formRows: inferFormRows(storedBody, variableNames, paramMap),
      jsonRows: [],
      jsonAdvanced: false,
      advancedBody: "",
    };
  }
  if (bodyType === "json") {
    const rows = inferJsonRows(storedBody, variableNames, paramMap);
    return {
      bodyType,
      formRows: [],
      jsonRows: rows ?? [],
      jsonAdvanced: rows === null,
      advancedBody: storedBody,
    };
  }
  return {
    bodyType,
    formRows: [],
    jsonRows: [],
    jsonAdvanced: bodyType === "raw",
    advancedBody: storedBody,
  };
}

function bodyTabCount(
  bodyType: BodyType,
  formRows: SourceRow[],
  jsonRows: SourceRow[],
  jsonAdvanced: boolean,
  advancedBody: string,
): number {
  if (bodyType === "none") return 0;
  if (bodyType === "form") return formRows.length;
  if (bodyType === "json" && !jsonAdvanced) return jsonRows.length;
  return advancedBody.trim().length > 0 ? 1 : 0;
}

function hasOverlayMenuOpen(): boolean {
  return Boolean(
    document.querySelector('[role="menu"]') ??
    document.querySelector('[role="listbox"]'),
  );
}

type PreviewBinding =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "serverValue"; serverValueId: string }
  | { kind: "agentInput"; agentInputId: string };

/** Shape of the opaque compiled plan record returned by `previewToolCompile`. */
type CompiledPlanPreview = {
  annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  headers: Array<{ name: string; source: PreviewBinding }>;
  query: Array<{ name: string; source: PreviewBinding }>;
  agentInputs: Array<{ id: string; name: string }>;
};

function asCompiledPlanPreview(
  plan: Record<string, unknown> | null | undefined,
): CompiledPlanPreview | null {
  if (!plan) return null;
  return plan as unknown as CompiledPlanPreview;
}

function describeBinding(
  binding: PreviewBinding,
  ctx: {
    serverValueNameById: Record<string, string>;
    serverValueKindById: Record<string, "config" | "secret">;
    agentInputNameById: Record<string, string>;
    secretLabel: string;
    agentLabel: string;
  },
): string {
  if (binding.kind === "literal") {
    return typeof binding.value === "string"
      ? binding.value
      : JSON.stringify(binding.value);
  }
  if (binding.kind === "serverValue") {
    const name =
      ctx.serverValueNameById[binding.serverValueId] ?? binding.serverValueId;
    if (ctx.serverValueKindById[binding.serverValueId] === "secret") {
      return ctx.secretLabel;
    }
    return `{{${name}}}`;
  }
  const name =
    ctx.agentInputNameById[binding.agentInputId] ?? binding.agentInputId;
  return `{{${name}}} (${ctx.agentLabel})`;
}

/**
 * Shared create/edit/duplicate tool form. Mount conditionally so state
 * initializes from `tool`. When a save returns template warnings the dialog
 * stays open and switches to editing the just-saved tool, so a second submit
 * updates instead of duplicating.
 */
/**
 * Loads a legacy-only tool's backend conversion draft before rendering the
 * form, so unmigrated tools open as typed definitions when the analysis is
 * unambiguous and surface blocking diagnostics otherwise.
 */
export function ToolFormDialog(props: {
  serverId: string;
  variableNames: string[];
  variables?: ToolFormServerValue[];
  tool?: ToolFormTool;
  duplicate?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const isTyped = isClientRequestDefinition(props.tool?.requestDefinition);
  const needsConversion = Boolean(props.tool) && !isTyped && !props.duplicate;
  const editorState = useMcpToolEditorState(
    props.serverId,
    props.tool?.id ?? "",
    needsConversion,
  );
  const draft = editorState.data?.conversionDraft;
  const resolvedTool =
    props.tool && draft && isClientRequestDefinition(draft)
      ? {
          ...props.tool,
          requestDefinition: draft as unknown as Record<string, unknown>,
        }
      : props.tool;

  if (needsConversion && editorState.isLoading && !editorState.data) {
    return (
      <Dialog open onOpenChange={() => props.onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.servers.editToolTitle}</DialogTitle>
            <DialogDescription>
              {t.servers.loadingToolDefinition}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center py-6">
            <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (needsConversion && editorState.isError) {
    return (
      <Dialog open onOpenChange={() => props.onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.servers.editToolTitle}</DialogTitle>
            <DialogDescription>
              {t.servers.conversionLoadFailed}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => props.onClose()}>
              {t.servers.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <ToolFormDialogForm
      key={`${props.tool?.id ?? "new"}-${isTyped ? "typed" : draft ? "converted" : "legacy"}`}
      {...props}
      tool={resolvedTool}
      conversionIssues={editorState.data?.conversionIssues ?? []}
    />
  );
}

export function ToolFormDialogForm({
  serverId,
  variableNames,
  variables = [],
  tool,
  duplicate = false,
  onClose,
  conversionIssues = [],
}: {
  serverId: string;
  variableNames: string[];
  variables?: ToolFormServerValue[];
  tool?: ToolFormTool;
  duplicate?: boolean;
  onClose: () => void;
  conversionIssues?: ToolCompileIssue[];
}) {
  const { t } = useTranslations();
  const createTool = useCreateMcpTool();
  const updateTool = useUpdateMcpTool();
  const previewCompile = usePreviewToolCompile();
  const isEdit = Boolean(tool) && !duplicate;
  const paramMap = paramsByName(tool?.params);
  const definition = isClientRequestDefinition(tool?.requestDefinition)
    ? tool.requestDefinition
    : null;
  const lookup = useMemo(
    () =>
      buildServerValueLookup(
        variables.map((value) => ({ id: value.id, name: value.name })),
      ),
    [variables],
  );
  const definitionAgentInputById = useMemo(
    () => (definition ? definitionAgentInputs(definition) : new Map()),
    [definition],
  );
  const agentInputIdByNameRef = useRef<Map<string, string>>(
    new Map(
      (duplicate ? [] : (definition?.agentInputs ?? [])).map((input) => [
        input.name,
        input.id,
      ]),
    ),
  );
  const variableKinds = useMemo(
    () =>
      Object.fromEntries(variables.map((value) => [value.name, value.kind])),
    [variables],
  );
  const serverValueNameById = useMemo(
    () => Object.fromEntries(variables.map((value) => [value.id, value.name])),
    [variables],
  );
  const serverValueKindById = useMemo(
    () => Object.fromEntries(variables.map((value) => [value.id, value.kind])),
    [variables],
  );

  const resolveAgentInputId = (agentName: string): string => {
    const existing = agentInputIdByNameRef.current.get(agentName);
    if (existing) return existing;
    const id = createDefinitionId("ain");
    agentInputIdByNameRef.current.set(agentName, id);
    return id;
  };

  const initialName = tool ? (duplicate ? `${tool.name}_copy` : tool.name) : "";
  const initialMethod = (METHODS as readonly string[]).includes(
    tool?.method ?? "",
  )
    ? (tool?.method as (typeof METHODS)[number])
    : "GET";
  const initialPathParts = definition
    ? definitionToPathParts(definition, lookup)
    : splitPath(tool?.pathTemplate ?? "", variableNames, paramMap);
  const initialDescription = tool?.description ?? "";
  const initialQuery = definition
    ? definitionToSourceRows(definition.query, lookup, definitionAgentInputById)
    : inferMapRows(tool?.requestTemplate?.query, variableNames, paramMap);
  const initialHeaders = definition
    ? definitionToSourceRows(
        definition.headers,
        lookup,
        definitionAgentInputById,
      )
    : inferMapRows(tool?.requestTemplate?.headers, variableNames, paramMap);
  const initialBody = definition
    ? definitionToBodyState(definition, lookup)
    : initialBodyState(tool, variableNames, paramMap);
  const initialLeftoverDrafts = Object.fromEntries(
    (tool?.params ?? []).map((param) => [param.name, param]),
  );
  const initialAllowMutation = tool?.allowMutation ?? false;
  const conversionBlocks = conversionIssues.some(
    (issue) => issue.severity === "error",
  );
  const initialEnabled = conversionBlocks ? false : (tool?.enabled ?? true);

  const [name, setName] = useState(initialName);
  const [method, setMethod] = useState<(typeof METHODS)[number]>(initialMethod);
  const [pathParts, setPathParts] = useState<PathPart[]>(initialPathParts);
  const [description, setDescription] = useState(initialDescription);
  const [query, setQuery] = useState<SourceRow[]>(initialQuery);
  const [headers, setHeaders] = useState<SourceRow[]>(initialHeaders);
  const [bodyType, setBodyType] = useState<BodyType>(initialBody.bodyType);
  const [formRows, setFormRows] = useState<SourceRow[]>(initialBody.formRows);
  const [jsonRows, setJsonRows] = useState<SourceRow[]>(initialBody.jsonRows);
  const [jsonAdvanced, setJsonAdvanced] = useState(initialBody.jsonAdvanced);
  const [advancedBody, setAdvancedBody] = useState(initialBody.advancedBody);
  const [leftoverDrafts, setLeftoverDrafts] = useState<
    Record<string, AgentMeta>
  >(initialLeftoverDrafts);
  const [allowMutation, setAllowMutation] = useState(initialAllowMutation);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [savedToolId, setSavedToolId] = useState<string | null>(
    isEdit && tool ? tool.id : null,
  );
  const [saveIssues, setSaveIssues] = useState<ToolCompileIssue[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [mutationConfirmOpen, setMutationConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = previewCompile.data ?? null;
  const savedRef = useRef(false);
  const nodeIdRegistryRef = useRef(new Map<object, string>());
  const resolveNodeId = (source: object, prefix: string): string => {
    const registry = nodeIdRegistryRef.current;
    const existing = registry.get(source);
    if (existing) return existing;
    const id = createDefinitionId(prefix);
    registry.set(source, id);
    return id;
  };

  const issuesByNodeId = useMemo(() => {
    const map: Record<
      string,
      { message: string; severity: "error" | "warning" }
    > = {};
    const all = [
      ...(preview?.issues ?? []),
      ...(tool?.compileIssues ?? []),
      ...saveIssues,
      ...conversionIssues,
    ];
    for (const issue of all) {
      if (issue.id && !map[issue.id]) {
        map[issue.id] = { message: issue.message, severity: issue.severity };
      }
    }
    return map;
  }, [preview, tool?.compileIssues, saveIssues, conversionIssues]);

  const applyAgentMetaToRow = (
    row: SourceRow,
    meta: AgentMeta,
    identity: string,
  ) =>
    row.origin === "agent" &&
    ((row.id ?? row.name) === identity || row.name === meta.name)
      ? { ...row, ...meta }
      : row;

  const applyAgentMetaToPart = (
    part: PathPart,
    meta: AgentMeta,
    identity: string,
  ) =>
    part.kind === "agent" &&
    ((part.id ?? part.name) === identity || part.name === meta.name)
      ? { ...part, ...meta }
      : part;

  /**
   * Editing one registry entry updates every request location bound to the
   * same stable agent-input id (or legacy name) so metadata is stored once.
   */
  const propagateAgentMeta = (meta: AgentMeta, identity: string) => {
    setQuery((rows) =>
      rows.map((row) => applyAgentMetaToRow(row, meta, identity)),
    );
    setHeaders((rows) =>
      rows.map((row) => applyAgentMetaToRow(row, meta, identity)),
    );
    setFormRows((rows) =>
      rows.map((row) => applyAgentMetaToRow(row, meta, identity)),
    );
    setJsonRows((rows) =>
      rows.map((row) => applyAgentMetaToRow(row, meta, identity)),
    );
    setPathParts((parts) =>
      parts.map((part) => applyAgentMetaToPart(part, meta, identity)),
    );
  };

  const detectAgentMetaChange = (previous: SourceRow[], next: SourceRow[]) => {
    const before = new Map(
      previous
        .filter((row) => row.origin === "agent")
        .map((row) => [row.key, row]),
    );
    for (const [index, row] of next.entries()) {
      if (row.origin !== "agent") continue;
      const priorRow = previous[index];
      const prior =
        before.get(row.key) ??
        (priorRow?.origin === "agent" ? priorRow : undefined);
      if (!prior || prior.origin !== "agent") continue;
      const priorComparable = JSON.stringify({ ...prior, key: "" });
      const nextComparable = JSON.stringify({ ...row, key: "" });
      if (priorComparable !== nextComparable) {
        return { identity: prior.id ?? prior.name, meta: pickAgentMeta(row) };
      }
    }
    return null;
  };

  const changeRows = (
    setter: (rows: SourceRow[]) => void,
    current: SourceRow[],
  ) => {
    return (next: SourceRow[]) => {
      const change = detectAgentMetaChange(current, next);
      setter(next);
      if (change) propagateAgentMeta(change.meta, change.identity);
    };
  };

  const changePathParts = (next: PathPart[]) => {
    const previousByIdentity = new Map(
      pathParts
        .filter((part) => part.kind === "agent")
        .map((part) => [(part as { id?: string }).id ?? part.name, part]),
    );
    setPathParts(next);
    for (const [index, part] of next.entries()) {
      if (part.kind !== "agent") continue;
      const identity = (part as { id?: string }).id ?? part.name;
      const priorRow = pathParts[index];
      const prior =
        previousByIdentity.get(identity) ??
        (priorRow?.kind === "agent" ? priorRow : undefined);
      if (!prior || prior.kind !== "agent") continue;
      if (JSON.stringify(prior) !== JSON.stringify(part)) {
        propagateAgentMeta(
          pickAgentMeta(part),
          (prior as { id?: string }).id ?? prior.name,
        );
        break;
      }
    }
  };

  const isPending = createTool.isPending || updateTool.isPending;
  const effectiveEdit = isEdit || savedToolId !== null;
  const showAdvanced =
    bodyType === "raw" || (bodyType === "json" && jsonAdvanced);
  const isMutatingMethod = MUTATING_METHODS.has(method);
  const previewBlocksEnable = preview !== null && !preview.ok;
  const saveBlocks = saveIssues.some((issue) => issue.severity === "error");
  const advancedJsonInvalid = useMemo(() => {
    if (!(bodyType === "json" && jsonAdvanced)) return false;
    const text = advancedBody.trim();
    if (text.length === 0) return false;
    try {
      JSON.parse(text);
      return false;
    } catch {
      return true;
    }
  }, [bodyType, jsonAdvanced, advancedBody]);
  // Last-save issues inform the author but must not permanently lock the
  // dialog after they fix the definition; the backend re-validates on save.
  const blockingIssues = conversionBlocks || advancedJsonInvalid;

  const isDirty = useMemo(() => {
    if (savedRef.current) return false;
    return (
      name !== initialName ||
      method !== initialMethod ||
      description !== initialDescription ||
      allowMutation !== initialAllowMutation ||
      enabled !== initialEnabled ||
      joinPath(pathParts) !== joinPath(initialPathParts) ||
      JSON.stringify(query) !== JSON.stringify(initialQuery) ||
      JSON.stringify(headers) !== JSON.stringify(initialHeaders) ||
      bodyType !== initialBody.bodyType ||
      JSON.stringify(formRows) !== JSON.stringify(initialBody.formRows) ||
      JSON.stringify(jsonRows) !== JSON.stringify(initialBody.jsonRows) ||
      jsonAdvanced !== initialBody.jsonAdvanced ||
      advancedBody !== initialBody.advancedBody ||
      JSON.stringify(leftoverDrafts) !== JSON.stringify(initialLeftoverDrafts)
    );
  }, [
    name,
    initialName,
    method,
    initialMethod,
    description,
    initialDescription,
    allowMutation,
    initialAllowMutation,
    enabled,
    initialEnabled,
    pathParts,
    initialPathParts,
    query,
    initialQuery,
    headers,
    initialHeaders,
    bodyType,
    initialBody.bodyType,
    formRows,
    initialBody.formRows,
    jsonRows,
    initialBody.jsonRows,
    jsonAdvanced,
    initialBody.jsonAdvanced,
    advancedBody,
    initialBody.advancedBody,
    leftoverDrafts,
    initialLeftoverDrafts,
  ]);

  const rawBindingIds = useMemo(() => {
    const ids = new Set<string>();
    if (definition?.body.bodyType === "raw") {
      for (const binding of definition.body.bindings) {
        ids.add(binding.id);
      }
    }
    if (definition?.body.bodyType === "json") {
      const walk = (node: ClientJsonNode) => {
        if (node.kind === "binding") {
          const token =
            node.binding.kind === "serverValue"
              ? node.binding.serverValueId
              : node.binding.kind === "agentInput"
                ? node.binding.agentInputId
                : null;
          if (token) ids.add(token);
          return;
        }
        if (node.kind === "array") {
          node.items.forEach(walk);
          return;
        }
        if (node.kind === "object") {
          node.fields.forEach((field) => walk(field.value));
        }
      };
      walk(definition.body.root);
    }
    return ids;
  }, [definition]);

  const leftoverParams = useMemo(() => {
    if (!showAdvanced) return [];
    return detectPlaceholderNames([advancedBody], variableNames)
      .filter((paramName) => !rawBindingIds.has(paramName))
      .map(
        (paramName) =>
          leftoverDrafts[paramName] ??
          defaultAgentMeta(paramName, paramMap.get(paramName)),
      );
  }, [
    showAdvanced,
    advancedBody,
    variableNames,
    leftoverDrafts,
    paramMap,
    rawBindingIds,
  ]);

  const queryCount = query.length;
  const headersCount = headers.length;
  const bodyCount = bodyTabCount(
    bodyType,
    formRows,
    jsonRows,
    jsonAdvanced,
    advancedBody,
  );

  const requestClose = () => {
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const buildRequestDefinition = (): ClientRequestDefinition =>
    formStateToDefinition({
      pathParts,
      query,
      headers,
      bodyType,
      formRows,
      jsonRows,
      jsonAdvanced,
      advancedBody,
      serverValueIdByName: lookup.idByName,
      agentInputId: resolveAgentInputId,
      reuseNodeIds: !duplicate,
      resolveNodeId,
      ...(definition?.agentInputs
        ? { existingAgentInputs: definition.agentInputs }
        : {}),
      agentNames: new Set(
        (definition?.agentInputs ?? []).map((input) => input.name),
      ),
      ...(definition?.body.bodyType === "raw"
        ? {
            existingRawBindings: new Map(
              definition.body.bindings.map((binding) => [
                binding.id,
                binding.binding,
              ]),
            ),
            ...(definition.body.contentType
              ? { existingRawContentType: definition.body.contentType }
              : {}),
          }
        : {}),
      ...(definition?.body.bodyType === "json"
        ? { existingJsonRoot: definition.body.root }
        : {}),
      agentDrafts: leftoverDrafts,
      ...(definition?.annotations
        ? { annotations: definition.annotations }
        : {}),
    });

  const runPreview = () => {
    setPreviewOpen(true);
    setSaveIssues([]);
    previewCompile.mutate({
      serverId,
      method,
      requestDefinition: buildRequestDefinition(),
      allowMutation,
    });
  };

  const submit = () => {
    const requestDefinition = buildRequestDefinition();
    setSaveIssues([]);
    const base = {
      serverId,
      name,
      description: description.trim() ? description.trim() : null,
      method,
      requestDefinition,
      allowMutation,
      enabled: previewBlocksEnable || blockingIssues ? false : enabled,
    };
    const onSuccess = (result: {
      id: string;
      compileIssues?: ToolCompileIssue[] | null;
    }) => {
      const hasErrors = (result.compileIssues ?? []).some(
        (issue) => issue.severity === "error",
      );
      setSaveIssues(result.compileIssues ?? []);
      if (hasErrors) {
        setSavedToolId(result.id);
        return;
      }
      savedRef.current = true;
      onClose();
    };
    if (savedToolId) {
      updateTool.mutate({ ...base, toolId: savedToolId }, { onSuccess });
    } else {
      createTool.mutate(base, { onSuccess });
    }
  };

  const requestAllowMutationChange = (next: boolean) => {
    if (!next && allowMutation && enabled && isMutatingMethod) {
      setMutationConfirmOpen(true);
      return;
    }
    setAllowMutation(next);
  };

  const confirmMutationRevoke = () => {
    setAllowMutation(false);
    setEnabled(false);
    setMutationConfirmOpen(false);
  };

  const switchBodyType = (next: BodyType) => {
    if (next === "json") {
      const drafts = new Map(paramMap);
      for (const draft of Object.values(leftoverDrafts)) {
        drafts.set(draft.name, draft);
      }
      const rows = inferJsonRows(advancedBody, variableNames, drafts);
      if (rows) {
        setJsonRows(rows);
        setJsonAdvanced(false);
      } else {
        setJsonAdvanced(true);
      }
    }
    if (next === "form" && formRows.length === 0 && advancedBody.trim()) {
      setFormRows(inferFormRows(advancedBody, variableNames, paramMap));
    }
    if (next === "raw" && !advancedBody.trim()) {
      if (jsonRows.length > 0) {
        setAdvancedBody(compileStructuredJson(jsonRows));
      } else if (formRows.length > 0) {
        setAdvancedBody(compileFormBody(formRows));
      }
    }
    setBodyType(next);
  };

  const switchJsonMode = (advanced: boolean) => {
    if (advanced) {
      setAdvancedBody(compileStructuredJson(jsonRows));
      setJsonAdvanced(true);
      return;
    }
    if (!jsonAdvanced) return;
    const drafts = new Map(paramMap);
    for (const draft of Object.values(leftoverDrafts)) {
      drafts.set(draft.name, draft);
    }
    const rows = inferJsonRows(advancedBody, variableNames, drafts);
    if (rows === null) return;
    setJsonRows(rows);
    setJsonAdvanced(false);
  };

  return (
    <Dialog open onOpenChange={(next) => (!next ? requestClose() : undefined)}>
      <DialogContent
        className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl"
        onEscapeKeyDown={(event) => {
          if (hasOverlayMenuOpen()) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {effectiveEdit ? t.servers.editToolTitle : t.servers.addTool}
          </DialogTitle>
          <DialogDescription>
            {t.servers.toolDialogDescription}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="scrollbar-none min-h-0 flex-1 space-y-4 overflow-y-auto">
            <Field>
              <Label htmlFor="tool-form-name">{t.servers.toolName}</Label>
              <Input
                id="tool-form-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.servers.toolNamePlaceholder}
                autoComplete="off"
                required
              />
            </Field>

            <Field>
              <Label htmlFor="tool-form-description">
                {t.servers.toolDescription}
              </Label>
              <Textarea
                id="tool-form-description"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t.servers.toolDescriptionPlaceholder}
              />
            </Field>

            <div className="grid items-start gap-3 sm:grid-cols-[8rem_1fr]">
              <Field>
                <Label>{t.servers.method}</Label>
                <Select
                  value={method}
                  onValueChange={(value) =>
                    setMethod(value as (typeof METHODS)[number])
                  }
                >
                  <SelectTrigger aria-label={t.servers.method}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METHODS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <Label htmlFor="tool-form-path">{t.servers.pathTemplate}</Label>
                <PathPartsEditor
                  parts={pathParts}
                  onChange={changePathParts}
                  variableNames={variableNames}
                  variableKinds={variableKinds}
                  pathInputId="tool-form-path"
                />
              </Field>
            </div>

            <Tabs defaultValue="query">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="query">
                  {t.servers.requestPartQuery} {queryCount}
                </TabsTrigger>
                <TabsTrigger value="headers">
                  {t.servers.requestPartHeaders} {headersCount}
                </TabsTrigger>
                <TabsTrigger value="body">
                  {t.servers.requestPartBody} {bodyCount}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="query">
                <SourceRowEditor
                  rows={query}
                  onChange={changeRows(setQuery, query)}
                  issuesByNodeId={issuesByNodeId}
                  variableNames={variableNames}
                  variableKinds={variableKinds}
                  emptyLabel={t.servers.emptyQueryRows}
                />
              </TabsContent>
              <TabsContent value="headers">
                <SourceRowEditor
                  rows={headers}
                  onChange={changeRows(setHeaders, headers)}
                  issuesByNodeId={issuesByNodeId}
                  variableNames={variableNames}
                  variableKinds={variableKinds}
                  emptyLabel={t.servers.emptyHeaderRows}
                />
              </TabsContent>
              <TabsContent value="body" className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={bodyType}
                    onValueChange={(value) => switchBodyType(value as BodyType)}
                  >
                    <SelectTrigger
                      className="w-40"
                      aria-label={t.servers.bodyType}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["none", "json", "form", "raw"] as const).map(
                        (type) => (
                          <SelectItem key={type} value={type}>
                            {t.servers.bodyTypes[type]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                  {bodyType === "json" ? (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant={jsonAdvanced ? "outline" : "secondary"}
                        size="sm"
                        disabled={
                          jsonAdvanced &&
                          advancedBody.trim().length > 0 &&
                          !isFlatJsonTemplate(advancedBody)
                        }
                        onClick={() => switchJsonMode(false)}
                      >
                        {t.servers.bodyFields}
                      </Button>
                      <Button
                        type="button"
                        variant={jsonAdvanced ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => switchJsonMode(true)}
                      >
                        {t.servers.bodyAdvanced}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {bodyType === "none" ? (
                  <p className="text-sm text-muted-foreground">
                    {t.servers.bodyNoneMessage}
                  </p>
                ) : null}
                {bodyType === "form" ? (
                  <SourceRowEditor
                    rows={formRows}
                    onChange={changeRows(setFormRows, formRows)}
                    issuesByNodeId={issuesByNodeId}
                    variableNames={variableNames}
                    variableKinds={variableKinds}
                    emptyLabel={t.servers.emptyFormRows}
                  />
                ) : null}
                {bodyType === "json" && !jsonAdvanced ? (
                  <SourceRowEditor
                    rows={jsonRows}
                    onChange={changeRows(setJsonRows, jsonRows)}
                    issuesByNodeId={issuesByNodeId}
                    variableNames={variableNames}
                    variableKinds={variableKinds}
                    emptyLabel={t.servers.emptyFormRows}
                  />
                ) : null}
                {showAdvanced ? (
                  <div className="space-y-2">
                    <p
                      id="tool-form-advanced-hint"
                      className="text-xs text-muted-foreground"
                    >
                      {t.servers.bodyAdvancedHint}
                    </p>
                    <TemplateValueInput
                      multiline
                      showInsert
                      id="tool-form-advanced-body"
                      aria-label={t.servers.bodyAdvanced}
                      aria-describedby="tool-form-advanced-hint"
                      value={advancedBody}
                      onChange={setAdvancedBody}
                      variableNames={variableNames}
                      placeholder={
                        bodyType === "json"
                          ? t.servers.bodyJsonPlaceholder
                          : t.servers.bodyRawPlaceholder
                      }
                    />
                    <AgentLeftoverFields
                      params={leftoverParams}
                      onChange={(next) =>
                        setLeftoverDrafts((current) => ({
                          ...current,
                          ...Object.fromEntries(
                            next.map((param) => [param.name, param]),
                          ),
                        }))
                      }
                    />
                  </div>
                ) : null}
              </TabsContent>
            </Tabs>

            {conversionIssues.length > 0 ? (
              <Alert variant="destructive">
                <AlertDescription className="space-y-1">
                  <p>
                    {t.servers.conversionBlocked.replace(
                      "{count}",
                      String(conversionIssues.length),
                    )}
                  </p>
                  {conversionIssues.slice(0, 8).map((issue) => (
                    <p
                      key={`${issue.id ?? issue.path}-${issue.code}`}
                      className="font-mono text-xs"
                    >
                      {issue.path}: {issue.message}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            {advancedJsonInvalid ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {t.servers.advancedJsonInvalid}
                </AlertDescription>
              </Alert>
            ) : null}

            {saveIssues.length > 0 ? (
              <Alert variant={saveBlocks ? "destructive" : "default"}>
                <AlertDescription className="space-y-1">
                  {saveIssues.slice(0, 8).map((issue) => (
                    <p
                      key={`${issue.id ?? issue.path}-${issue.code}`}
                      className="font-mono text-xs"
                    >
                      {issue.path}: {issue.message}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            {tool?.compileStatus === "invalid" &&
            tool.compileIssues &&
            tool.compileIssues.length > 0 &&
            !preview ? (
              <Alert variant="destructive">
                <AlertDescription className="space-y-1">
                  <p>
                    {t.servers.previewSavedIssues.replace(
                      "{count}",
                      String(tool.compileIssues.length),
                    )}
                  </p>
                  {tool.compileIssues.slice(0, 8).map((issue) => (
                    <p
                      key={`${issue.path}-${issue.code}-${issue.message}`}
                      className="font-mono text-xs"
                    >
                      {issue.path}: {issue.message}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="rounded-md border border-border">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium"
                onClick={() => setPreviewOpen((open) => !open)}
              >
                <span className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-muted-foreground" />
                  {t.servers.previewTitle}
                </span>
                {previewOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {previewOpen ? (
                <div className="space-y-3 border-t border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t.servers.previewDescription}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={previewCompile.isPending}
                    onClick={runPreview}
                  >
                    {previewCompile.isPending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : null}
                    {previewCompile.isPending
                      ? t.servers.previewRunning
                      : t.servers.previewRun}
                  </Button>
                  {preview ? (
                    <div className="space-y-3">
                      {preview.issues.length > 0 ? (
                        <Alert
                          variant={
                            preview.issues.some(
                              (issue) => issue.severity === "error",
                            )
                              ? "destructive"
                              : "default"
                          }
                        >
                          <AlertDescription className="space-y-1">
                            {preview.issues.map((issue) => (
                              <p
                                key={`${issue.path}:${issue.code}:${issue.message}`}
                                className="font-mono text-xs"
                              >
                                {issue.path}: {issue.message}
                              </p>
                            ))}
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          {t.servers.previewValid}
                        </p>
                      )}
                      {preview.ok && preview.plan
                        ? (() => {
                            const plan = asCompiledPlanPreview(preview.plan);
                            if (!plan) return null;
                            const agentInputNameById = Object.fromEntries(
                              plan.agentInputs.map((input) => [
                                input.id,
                                input.name,
                              ]),
                            );
                            const bindingCtx = {
                              serverValueNameById,
                              serverValueKindById,
                              agentInputNameById,
                              secretLabel: t.servers.previewSecretValue,
                              agentLabel: t.servers.previewAgentInput,
                            };
                            return (
                              <div className="space-y-2">
                                <div className="flex flex-wrap gap-1">
                                  {plan.annotations.readOnlyHint ? (
                                    <Badge variant="outline">
                                      {t.servers.annotationReadOnly}
                                    </Badge>
                                  ) : null}
                                  {plan.annotations.destructiveHint ? (
                                    <Badge variant="outline">
                                      {t.servers.annotationDestructive}
                                    </Badge>
                                  ) : null}
                                  {plan.annotations.idempotentHint ? (
                                    <Badge variant="outline">
                                      {t.servers.annotationIdempotent}
                                    </Badge>
                                  ) : null}
                                </div>
                                {plan.headers.length > 0 ||
                                plan.query.length > 0 ? (
                                  <ul className="space-y-1 font-mono text-xs">
                                    {plan.headers.map((entry) => (
                                      <li key={`h-${entry.name}`}>
                                        {t.servers.requestPartHeaders}:{" "}
                                        {entry.name} ={" "}
                                        {describeBinding(
                                          entry.source,
                                          bindingCtx,
                                        )}
                                      </li>
                                    ))}
                                    {plan.query.map((entry) => (
                                      <li key={`q-${entry.name}`}>
                                        {t.servers.requestPartQuery}:{" "}
                                        {entry.name} ={" "}
                                        {describeBinding(
                                          entry.source,
                                          bindingCtx,
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            );
                          })()
                        : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {mutationConfirmOpen ? (
              <div
                className="rounded-md border border-destructive/40 bg-muted/40 p-4"
                role="region"
                aria-label={t.servers.mutationConfirmTitle}
              >
                <p className="text-sm font-medium">
                  {t.servers.mutationConfirmTitle}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t.servers.mutationConfirmDescription}
                </p>
                <div className="mt-3 flex flex-row justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-border bg-background"
                    onClick={() => setMutationConfirmOpen(false)}
                  >
                    {t.servers.cancel}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={confirmMutationRevoke}
                  >
                    {t.servers.mutationConfirmConfirm}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-md border border-border p-3">
                <label className="flex items-center justify-between gap-4 text-sm">
                  <span>
                    <span className="font-medium">
                      {t.servers.allowMutation}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t.servers.allowMutationHelp}
                    </span>
                  </span>
                  <Switch
                    aria-label={t.servers.allowMutation}
                    checked={allowMutation}
                    onCheckedChange={requestAllowMutationChange}
                  />
                </label>
                <label className="flex items-center justify-between gap-4 text-sm">
                  <span>
                    <span className="font-medium">{t.servers.enabled}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {previewBlocksEnable || blockingIssues
                        ? t.servers.enabledBlockedHelp
                        : t.servers.enabledHelp}
                    </span>
                  </span>
                  <Switch
                    aria-label={t.servers.enabled}
                    checked={enabled && !previewBlocksEnable && !blockingIssues}
                    disabled={previewBlocksEnable || blockingIssues}
                    onCheckedChange={setEnabled}
                  />
                </label>
              </div>
            )}
          </div>

          {discardOpen ? (
            <div
              className="mt-4 shrink-0 rounded-md border border-destructive/40 bg-muted/40 p-4"
              role="region"
              aria-label={t.servers.discardToolTitle}
            >
              <p className="text-sm font-medium">
                {t.servers.discardToolTitle}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.servers.discardToolDescription}
              </p>
              <div className="mt-3 flex flex-row justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-border bg-background"
                  onClick={() => setDiscardOpen(false)}
                >
                  {t.servers.cancel}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setDiscardOpen(false);
                    onClose();
                  }}
                >
                  {t.servers.discardToolConfirm}
                </Button>
              </div>
            </div>
          ) : (
            <DialogFooter className="mt-4 shrink-0 flex-row justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-border bg-background"
                onClick={requestClose}
              >
                {t.servers.cancel}
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {isPending ? t.servers.savingTool : t.servers.saveTool}
              </Button>
            </DialogFooter>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
