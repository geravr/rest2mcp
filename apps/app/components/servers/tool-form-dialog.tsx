import { PathPartsEditor } from "@/components/servers/path-parts-editor";
import { SourceRowEditor } from "@/components/servers/source-row-editor";
import { TemplateValueInput } from "@/components/servers/template-value-input";
import {
  useCreateMcpTool,
  usePreviewToolCompile,
  useUpdateMcpTool,
  type McpToolGroupSummary,
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
  isFlatJsonText,
  jsonTextToSourceRows,
  sourceRowsToJsonText,
  type ClientRequestDefinition,
} from "@/lib/request-definition";
import {
  joinPath,
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

/** Radix Select cannot use an empty value for the ungrouped choice. */
const UNGROUPED_GROUP = "ungrouped";

/**
 * A ToolFormTool group is only selectable while it is still listed for the
 * server, so a deleted or not-yet-loaded group starts the selector ungrouped.
 */
function resolveGroupSelection(
  candidate: string | null | undefined,
  groups: McpToolGroupSummary[],
): string {
  return candidate && groups.some((group) => group.id === candidate)
    ? candidate
    : UNGROUPED_GROUP;
}

function defaultDestructiveHint(method: string): boolean {
  return method === "DELETE";
}

function defaultIdempotentHint(method: string): boolean {
  return (
    method === "GET" ||
    method === "HEAD" ||
    method === "PUT" ||
    method === "DELETE"
  );
}

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
    format: source.format,
    enum: source.enum,
    examples: source.examples,
    allowEmpty: source.allowEmpty,
  };
}

type BodyType = "none" | "json" | "form" | "raw";

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
  title?: string | null;
  description: string | null;
  method: string;
  /** Canonical versioned definition; authoritative when present. */
  requestDefinition?: Record<string, unknown> | null;
  allowMutation: boolean;
  enabled: boolean;
  /** Studio group membership; absent means unknown and is treated as ungrouped. */
  groupId?: string | null;
  compileStatus?: string | null;
  compileIssues?: ToolCompileIssue[] | null;
};

export type ToolFormServerValue = {
  id: string;
  name: string;
  kind: "config" | "secret";
};

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

function asCompiledPlanPreview(plan: unknown): CompiledPlanPreview | null {
  if (!plan) return null;
  return plan as unknown as CompiledPlanPreview;
}

type CompiledContractAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

type CompiledContractPreview = {
  name: string;
  title: string;
  description: string;
  method: string;
  contractVersion: number;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: CompiledContractAnnotations;
  metadata: Record<string, unknown>;
  fingerprint: string;
};

function asCompiledContractPreview(
  contract: unknown,
): CompiledContractPreview | null {
  if (!contract || typeof contract !== "object") return null;
  return contract as CompiledContractPreview;
}

type JsonSchemaProperty = {
  type?: unknown;
  format?: unknown;
  description?: unknown;
  pattern?: unknown;
  enum?: unknown;
  examples?: unknown;
  writeOnly?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
};

function describePropertyConstraints(property: JsonSchemaProperty): string[] {
  const parts: string[] = [];
  if (typeof property.format === "string") parts.push(property.format);
  if (typeof property.minLength === "number")
    parts.push(`min ${property.minLength}`);
  if (typeof property.maxLength === "number")
    parts.push(`max ${property.maxLength}`);
  if (typeof property.minimum === "number") parts.push(`≥ ${property.minimum}`);
  if (typeof property.maximum === "number") parts.push(`≤ ${property.maximum}`);
  if (typeof property.pattern === "string") parts.push(`/${property.pattern}/`);
  if (Array.isArray(property.enum)) {
    parts.push(
      `enum: ${property.enum.map((value) => String(value)).join(", ")}`,
    );
  }
  if (Array.isArray(property.examples) && property.examples.length > 0) {
    parts.push(
      `e.g. ${property.examples.map((value) => String(value)).join(", ")}`,
    );
  }
  if (property.writeOnly === true) parts.push("write-only");
  return parts;
}

function ContractPreview({ contract }: { contract: CompiledContractPreview }) {
  const { t } = useTranslations();
  const inputSchema = contract.inputSchema as {
    properties?: Record<string, JsonSchemaProperty>;
    required?: unknown;
  };
  const properties = Object.entries(inputSchema.properties ?? {});
  const required = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  const outputPresent =
    contract.outputSchema !== null &&
    typeof contract.outputSchema === "object" &&
    Object.keys(contract.outputSchema).length > 0;

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <p className="text-sm font-medium">{t.servers.previewContractHeading}</p>
      <dl className="grid gap-1 text-xs sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted-foreground">
          {t.servers.previewContractName}
        </dt>
        <dd className="font-mono">{contract.name}</dd>
        <dt className="text-muted-foreground">
          {t.servers.previewContractTitleLabel}
        </dt>
        <dd>{contract.title}</dd>
        <dt className="text-muted-foreground">
          {t.servers.previewContractDescription}
        </dt>
        <dd>{contract.description}</dd>
        <dt className="text-muted-foreground">
          {t.servers.previewContractVersion}
        </dt>
        <dd>{contract.contractVersion}</dd>
        <dt className="text-muted-foreground">
          {t.servers.previewContractFingerprint}
        </dt>
        <dd className="break-all font-mono">{contract.fingerprint}</dd>
      </dl>
      <div className="space-y-1">
        <p className="text-xs font-medium">
          {t.servers.previewContractInputSchema}
        </p>
        {properties.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t.servers.previewContractNoProperties}
          </p>
        ) : (
          <ul className="space-y-1">
            {properties.map(([name, property]) => {
              const constraints = describePropertyConstraints(property);
              return (
                <li key={name} className="text-xs">
                  <span className="font-mono">{name}</span>
                  {required.has(name) ? (
                    <Badge variant="outline" className="ml-1">
                      {t.servers.previewContractRequired}
                    </Badge>
                  ) : (
                    <span className="ml-1 text-muted-foreground">
                      {t.servers.previewContractOptional}
                    </span>
                  )}
                  {property.description ? (
                    <span className="ml-1 text-muted-foreground">
                      — {String(property.description)}
                    </span>
                  ) : null}
                  {constraints.length > 0 ? (
                    <span className="ml-1 font-mono text-muted-foreground">
                      ({constraints.join(", ")})
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium">
          {t.servers.previewContractOutputSchema}
        </p>
        <p className="text-xs text-muted-foreground">
          {outputPresent
            ? t.servers.previewContractOutputPresent
            : t.servers.previewContractOutputAbsent}
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium">
          {t.servers.previewContractAnnotations}
        </p>
        <div className="flex flex-wrap gap-1">
          {contract.annotations.readOnlyHint ? (
            <Badge variant="outline">{t.servers.annotationReadOnly}</Badge>
          ) : null}
          {contract.annotations.destructiveHint ? (
            <Badge variant="outline">{t.servers.annotationDestructive}</Badge>
          ) : null}
          {contract.annotations.idempotentHint ? (
            <Badge variant="outline">{t.servers.annotationIdempotent}</Badge>
          ) : null}
          {contract.annotations.openWorldHint ? (
            <Badge variant="outline">{t.servers.annotationOpenWorld}</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {contract.annotations.destructiveHint ||
          !contract.annotations.idempotentHint
            ? t.servers.contractRetryNotAutomatic
            : t.servers.contractRetryAllowsRetry}
        </p>
      </div>
    </div>
  );
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
 * initializes from `tool`. When a save returns compile errors the dialog
 * stays open and switches to editing the just-saved tool, so a second submit
 * updates instead of duplicating.
 */
export function ToolFormDialog(props: {
  serverId: string;
  configRevision?: number;
  variableNames: string[];
  variables?: ToolFormServerValue[];
  /** Server groups already fetched by the parent; this dialog never queries them. */
  groups?: McpToolGroupSummary[];
  /** Active Studio group filter, used only to preselect a new tool's group. */
  initialGroupId?: string | undefined;
  tool?: ToolFormTool;
  duplicate?: boolean;
  onClose: () => void;
}) {
  const isTyped = isClientRequestDefinition(props.tool?.requestDefinition);
  return (
    <ToolFormDialogForm
      key={`${props.tool?.id ?? "new"}-${isTyped ? "typed" : "empty"}`}
      {...props}
    />
  );
}

export function ToolFormDialogForm({
  serverId,
  configRevision = 1,
  variableNames,
  variables = [],
  groups = [],
  initialGroupId,
  tool,
  duplicate = false,
  onClose,
}: {
  serverId: string;
  configRevision?: number;
  variableNames: string[];
  variables?: ToolFormServerValue[];
  groups?: McpToolGroupSummary[];
  initialGroupId?: string | undefined;
  tool?: ToolFormTool;
  duplicate?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const createTool = useCreateMcpTool();
  const updateTool = useUpdateMcpTool();
  const previewCompile = usePreviewToolCompile();
  const isEdit = Boolean(tool) && !duplicate;
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
  const initialPathParts: PathPart[] = definition
    ? definitionToPathParts(definition, lookup)
    : [{ kind: "text", value: "" }];
  const initialTitle = tool?.title ?? "";
  const initialDescription = tool?.description ?? "";
  const initialQuery: SourceRow[] = definition
    ? definitionToSourceRows(definition.query, lookup, definitionAgentInputById)
    : [];
  const initialHeaders: SourceRow[] = definition
    ? definitionToSourceRows(
        definition.headers,
        lookup,
        definitionAgentInputById,
      )
    : [];
  const initialBody = definition
    ? definitionToBodyState(definition, lookup)
    : {
        bodyType: "none" as BodyType,
        formRows: [] as SourceRow[],
        jsonRows: [] as SourceRow[],
        jsonAdvanced: false,
        advancedBody: "",
      };
  const initialAllowMutation = tool?.allowMutation ?? false;
  const initialEnabled = tool?.enabled ?? true;
  const initialDestructiveHint =
    definition?.annotations?.destructiveHint ??
    defaultDestructiveHint(initialMethod);
  const initialIdempotentHint =
    definition?.annotations?.idempotentHint ??
    defaultIdempotentHint(initialMethod);
  // Editing and duplicating keep the tool's own group; a new tool follows the
  // active Studio group filter. The selector is never locked to that value.
  const initialGroupSelection =
    isEdit || duplicate
      ? resolveGroupSelection(tool?.groupId, groups)
      : (initialGroupId ?? UNGROUPED_GROUP);

  const [name, setName] = useState(initialName);
  const [title, setTitle] = useState(initialTitle);
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
  const [allowMutation, setAllowMutation] = useState(initialAllowMutation);
  const [destructiveHint, setDestructiveHint] = useState(
    initialDestructiveHint,
  );
  const [idempotentHint, setIdempotentHint] = useState(initialIdempotentHint);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [groupSelection, setGroupSelection] = useState(initialGroupSelection);
  const showGroupSelect = groups.length > 0 || initialGroupId !== undefined;
  const groupSelectionChanged = groupSelection !== initialGroupSelection;
  const [savedToolId, setSavedToolId] = useState<string | null>(
    isEdit && tool ? tool.id : null,
  );
  const [saveIssues, setSaveIssues] = useState<ToolCompileIssue[]>([]);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [mutationConfirmOpen, setMutationConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = previewCompile.data ?? null;
  const previewContract = asCompiledContractPreview(preview?.contract);
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
    ];
    for (const issue of all) {
      if (issue.id && !map[issue.id]) {
        map[issue.id] = { message: issue.message, severity: issue.severity };
      }
    }
    return map;
  }, [preview, tool?.compileIssues, saveIssues]);

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
  const buildAnnotations = (): ClientRequestDefinition["annotations"] =>
    isMutatingMethod
      ? {
          readOnlyHint: false,
          destructiveHint,
          idempotentHint,
          openWorldHint: true,
        }
      : {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        };
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
  const blockingIssues = advancedJsonInvalid;

  const isDirty = useMemo(() => {
    if (savedRef.current) return false;
    return (
      name !== initialName ||
      title !== initialTitle ||
      method !== initialMethod ||
      description !== initialDescription ||
      allowMutation !== initialAllowMutation ||
      destructiveHint !== initialDestructiveHint ||
      idempotentHint !== initialIdempotentHint ||
      enabled !== initialEnabled ||
      joinPath(pathParts) !== joinPath(initialPathParts) ||
      JSON.stringify(query) !== JSON.stringify(initialQuery) ||
      JSON.stringify(headers) !== JSON.stringify(initialHeaders) ||
      bodyType !== initialBody.bodyType ||
      JSON.stringify(formRows) !== JSON.stringify(initialBody.formRows) ||
      JSON.stringify(jsonRows) !== JSON.stringify(initialBody.jsonRows) ||
      jsonAdvanced !== initialBody.jsonAdvanced ||
      advancedBody !== initialBody.advancedBody ||
      groupSelection !== initialGroupSelection
    );
  }, [
    name,
    initialName,
    title,
    initialTitle,
    method,
    initialMethod,
    description,
    initialDescription,
    allowMutation,
    initialAllowMutation,
    destructiveHint,
    initialDestructiveHint,
    idempotentHint,
    initialIdempotentHint,
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
    groupSelection,
    initialGroupSelection,
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
      annotations: buildAnnotations(),
    });

  const runPreview = () => {
    setPreviewOpen(true);
    setSaveIssues([]);
    previewCompile.mutate({
      serverId,
      ...(name.trim() ? { name: name.trim() } : {}),
      title: title.trim() ? title.trim() : null,
      description: description.trim() ? description.trim() : null,
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
      expectedRevision: configRevision,
      name,
      title: title.trim() ? title.trim() : null,
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
      // Tri-state Studio contract: an omitted `groupId` leaves the stored
      // assignment untouched, so an unrelated edit must never send the key.
      const groupChange = groupSelectionChanged
        ? {
            groupId: groupSelection === UNGROUPED_GROUP ? null : groupSelection,
          }
        : {};
      updateTool.mutate(
        { ...base, ...groupChange, toolId: savedToolId },
        { onSuccess },
      );
    } else {
      createTool.mutate(
        {
          ...base,
          groupId: groupSelection === UNGROUPED_GROUP ? null : groupSelection,
        },
        { onSuccess },
      );
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
      const rows = jsonTextToSourceRows(
        advancedBody,
        lookup,
        definitionAgentInputById,
      );
      if (rows) {
        setJsonRows(rows);
        setJsonAdvanced(false);
      } else {
        setJsonAdvanced(true);
      }
    }
    if (next === "raw" && !advancedBody.trim()) {
      if (jsonRows.length > 0) {
        setAdvancedBody(sourceRowsToJsonText(jsonRows));
      }
    }
    setBodyType(next);
  };

  const switchJsonMode = (advanced: boolean) => {
    if (advanced) {
      setAdvancedBody(sourceRowsToJsonText(jsonRows));
      setJsonAdvanced(true);
      return;
    }
    if (!jsonAdvanced) return;
    const rows = jsonTextToSourceRows(
      advancedBody,
      lookup,
      definitionAgentInputById,
    );
    if (rows === null) return;
    setJsonRows(rows);
    setJsonAdvanced(false);
  };

  const changeMethod = (next: (typeof METHODS)[number]) => {
    setMethod(next);
    setDestructiveHint(defaultDestructiveHint(next));
    setIdempotentHint(defaultIdempotentHint(next));
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
              <Label htmlFor="tool-form-title">{t.servers.toolTitle}</Label>
              <Input
                id="tool-form-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t.servers.toolTitlePlaceholder}
                autoComplete="off"
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

            {showGroupSelect ? (
              <Field>
                <Label htmlFor="tool-form-group">
                  {t.servers.groups.moveTarget}
                </Label>
                <Select
                  value={groupSelection}
                  onValueChange={setGroupSelection}
                >
                  <SelectTrigger id="tool-form-group">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNGROUPED_GROUP}>
                      {t.servers.groups.ungrouped}
                    </SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            <div className="grid items-start gap-3 sm:grid-cols-[8rem_1fr]">
              <Field>
                <Label>{t.servers.method}</Label>
                <Select
                  value={method}
                  onValueChange={(value) =>
                    changeMethod(value as (typeof METHODS)[number])
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
                <Label htmlFor="tool-form-path">{t.servers.path}</Label>
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
                          !isFlatJsonText(advancedBody)
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
                  </div>
                ) : null}
              </TabsContent>
            </Tabs>

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
                      {previewContract ? (
                        <ContractPreview contract={previewContract} />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-3 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium">
                  {t.servers.annotationsTitle}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t.servers.annotationsHelp}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {!isMutatingMethod ? (
                  <Badge variant="outline">
                    {t.servers.annotationReadOnly}
                  </Badge>
                ) : null}
                <Badge variant="outline">{t.servers.annotationOpenWorld}</Badge>
              </div>
              {isMutatingMethod ? (
                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-4 text-sm">
                    <span>
                      <span className="font-medium">
                        {t.servers.annotationDestructive}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {t.servers.annotationDestructiveHelp}
                      </span>
                    </span>
                    <Switch
                      aria-label={t.servers.annotationDestructive}
                      checked={destructiveHint}
                      onCheckedChange={setDestructiveHint}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4 text-sm">
                    <span>
                      <span className="font-medium">
                        {t.servers.annotationIdempotent}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {t.servers.annotationIdempotentHelp}
                      </span>
                    </span>
                    <Switch
                      aria-label={t.servers.annotationIdempotent}
                      checked={idempotentHint}
                      onCheckedChange={setIdempotentHint}
                    />
                  </label>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t.servers.annotationReadOnlyHelp}
                </p>
              )}
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
