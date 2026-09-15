import { PathPartsEditor } from "@/components/servers/path-parts-editor";
import {
  AgentLeftoverFields,
  SourceRowEditor,
} from "@/components/servers/source-row-editor";
import { TemplateValueInput } from "@/components/servers/template-value-input";
import { useCreateMcpTool, useUpdateMcpTool } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
  collectAgentParams,
  compileFormBody,
  compileMap,
  compileStructuredJson,
  defaultAgentMeta,
  detectPlaceholderNames,
  inferFormRows,
  inferJsonRows,
  inferMapRows,
  isFlatJsonTemplate,
  joinPath,
  originsFromPath,
  paramsByName,
  splitPath,
  type AgentMeta,
  type PathPart,
  type SourceRow,
} from "@/lib/value-origin";
import {
  Alert,
  AlertDescription,
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
import { LoaderCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

type BodyType = "none" | "json" | "form" | "raw";

export type ToolParamDraft = AgentMeta;

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
  allowMutation: boolean;
  enabled: boolean;
};

type TemplateWarning = {
  type: "placeholder_without_param" | "param_without_placeholder";
  name: string;
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

/**
 * Shared create/edit/duplicate tool form. Mount conditionally so state
 * initializes from `tool`. When a save returns template warnings the dialog
 * stays open and switches to editing the just-saved tool, so a second submit
 * updates instead of duplicating.
 */
export function ToolFormDialog({
  serverId,
  variableNames,
  tool,
  duplicate = false,
  onClose,
}: {
  serverId: string;
  variableNames: string[];
  tool?: ToolFormTool;
  duplicate?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const createTool = useCreateMcpTool();
  const updateTool = useUpdateMcpTool();
  const isEdit = Boolean(tool) && !duplicate;
  const paramMap = paramsByName(tool?.params);

  const initialName = tool ? (duplicate ? `${tool.name}_copy` : tool.name) : "";
  const initialMethod = (METHODS as readonly string[]).includes(
    tool?.method ?? "",
  )
    ? (tool?.method as (typeof METHODS)[number])
    : "GET";
  const initialPathParts = splitPath(
    tool?.pathTemplate ?? "",
    variableNames,
    paramMap,
  );
  const initialDescription = tool?.description ?? "";
  const initialQuery = inferMapRows(
    tool?.requestTemplate?.query,
    variableNames,
    paramMap,
  );
  const initialHeaders = inferMapRows(
    tool?.requestTemplate?.headers,
    variableNames,
    paramMap,
  );
  const initialBody = initialBodyState(tool, variableNames, paramMap);
  const initialLeftoverDrafts = Object.fromEntries(
    (tool?.params ?? []).map((param) => [param.name, param]),
  );
  const initialAllowMutation = tool?.allowMutation ?? false;
  const initialEnabled = tool?.enabled ?? true;

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
  const [warnings, setWarnings] = useState<TemplateWarning[]>([]);
  const [savedToolId, setSavedToolId] = useState<string | null>(
    isEdit && tool ? tool.id : null,
  );
  const [discardOpen, setDiscardOpen] = useState(false);
  const savedRef = useRef(false);

  const isPending = createTool.isPending || updateTool.isPending;
  const effectiveEdit = isEdit || savedToolId !== null;
  const showAdvanced =
    bodyType === "raw" || (bodyType === "json" && jsonAdvanced);

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

  const leftoverParams = useMemo(() => {
    if (!showAdvanced) return [];
    return detectPlaceholderNames([advancedBody], variableNames).map(
      (paramName) =>
        leftoverDrafts[paramName] ??
        defaultAgentMeta(paramName, paramMap.get(paramName)),
    );
  }, [showAdvanced, advancedBody, variableNames, leftoverDrafts, paramMap]);

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

  const submit = () => {
    const pathTemplate = joinPath(pathParts);
    let body: string | null = null;
    if (bodyType === "form") {
      body = compileFormBody(formRows);
    } else if (bodyType === "json") {
      body = jsonAdvanced ? advancedBody : compileStructuredJson(jsonRows);
    } else if (bodyType === "raw") {
      body = advancedBody;
    }

    const leftoverOrigins = leftoverParams.map((param) => ({
      origin: "agent" as const,
      ...param,
    }));
    const params = collectAgentParams([
      ...originsFromPath(pathParts),
      ...query,
      ...headers,
      ...(bodyType === "form" ? formRows : []),
      ...(bodyType === "json" && !jsonAdvanced ? jsonRows : []),
      ...leftoverOrigins,
    ]);

    const requestTemplate = {
      query: compileMap(query),
      headers: compileMap(headers),
      body,
      ...(bodyType === "none" ? {} : { bodyType }),
    };
    const payload = {
      serverId,
      name,
      description: description.trim() ? description.trim() : null,
      method,
      pathTemplate,
      requestTemplate,
      params,
      allowMutation,
      enabled,
    };
    const onSuccess = (result: {
      id: string;
      warnings?: TemplateWarning[];
    }) => {
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings);
        setSavedToolId(result.id);
        return;
      }
      savedRef.current = true;
      onClose();
    };
    if (savedToolId) {
      updateTool.mutate({ ...payload, toolId: savedToolId }, { onSuccess });
    } else {
      createTool.mutate(payload, { onSuccess });
    }
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
                  onChange={setPathParts}
                  variableNames={variableNames}
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
                  onChange={setQuery}
                  variableNames={variableNames}
                  emptyLabel={t.servers.emptyQueryRows}
                />
              </TabsContent>
              <TabsContent value="headers">
                <SourceRowEditor
                  rows={headers}
                  onChange={setHeaders}
                  variableNames={variableNames}
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
                    onChange={setFormRows}
                    variableNames={variableNames}
                    emptyLabel={t.servers.emptyFormRows}
                  />
                ) : null}
                {bodyType === "json" && !jsonAdvanced ? (
                  <SourceRowEditor
                    rows={jsonRows}
                    onChange={setJsonRows}
                    variableNames={variableNames}
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

            {warnings.length > 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {warnings.map((warning) => (
                    <p key={`${warning.type}-${warning.name}`}>
                      {warning.type === "placeholder_without_param"
                        ? t.servers.warningPlaceholderWithoutParam.replace(
                            "{{name}}",
                            `{{${warning.name}}}`,
                          )
                        : t.servers.warningParamWithoutPlaceholder.replace(
                            "{name}",
                            warning.name,
                          )}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-3 rounded-md border border-border p-3">
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">{t.servers.allowMutation}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t.servers.allowMutationHelp}
                  </span>
                </span>
                <Switch
                  checked={allowMutation}
                  onCheckedChange={setAllowMutation}
                />
              </label>
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">{t.servers.enabled}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t.servers.enabledHelp}
                  </span>
                </span>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </label>
            </div>
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
