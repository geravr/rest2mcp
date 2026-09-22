import {
  AiOptimizeDialog,
  type AiOptimizationSelectionState,
} from "@/components/servers/ai-optimize-dialog";
import {
  AiSettingsCta,
  useAiFeatureReadiness,
} from "@/hooks/use-ai-readiness-guard";
import { useTranslations } from "@/i18n/use-translations";
import { getAppCode, resolveErrorMessage } from "@/lib/errors";
import { APP_ERROR_CODES } from "@repo/core";
import {
  buildOpenApiSelection,
  describeOpenApiSecurityRequirement,
  filterOpenApiOperations,
  findOpenApiNameIssue,
  groupOpenApiOperations,
  hasOpenApiRequestSummary,
  isHttpsDocumentUrl,
  planFirstTagGroups,
  projectOpenApiCapacity,
  nextOpenApiSelection,
  selectOpenApiKeysUpToCapacity,
  readOpenApiDocumentFile,
  resolveOpenApiIssueDescription,
  splitOpenApiIssues,
  summarizeOpenApiRequest,
  withOpenApiKeys,
  type OpenApiNameIssue,
  type OpenApiRequestSummary,
  type OpenApiSourceMode,
} from "@/lib/openapi-import";
import { api } from "@/lib/trpc";
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
  FieldHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@repo/ui";
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
import {
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  useConfirmOpenApiImport,
  useInvalidateMcp,
  useMcpToolGroups,
  usePreviewOpenApiImport,
} from "@/hooks/use-mcp";

/**
 * Types come from the tRPC options proxy so the dialog never restates the
 * preview/confirm payloads the API already owns.
 */
type OpenApiPreviewResult = inferOutput<typeof api.mcp.previewOpenApiImport>;
type OpenApiOperationCandidate = OpenApiPreviewResult["operations"][number];
type OpenApiSource = inferInput<typeof api.mcp.previewOpenApiImport>["source"];
type OpenApiConfirmInput = inferInput<typeof api.mcp.confirmOpenApiImport>;
type OpenApiGroupStrategy = OpenApiConfirmInput["groupStrategy"];
type OpenApiConfirmResult = inferOutput<typeof api.mcp.confirmOpenApiImport>;

const GROUP_STRATEGY_KINDS = [
  "ungrouped",
  "existing",
  "new",
  "firstTag",
] as const;

const FILE_ERROR_KEYS = {
  kind: "fileKindError",
  tooLarge: "fileTooLargeError",
  read: "fileReadError",
} as const;

function nameIssueMessage(
  issue: OpenApiNameIssue,
  copy: OpenApiImportCopy,
): string | null {
  if (issue === "invalid") return copy.nameInvalid;
  if (issue === "duplicate") return copy.nameDuplicate;
  if (issue === "conflict") return copy.nameConflict;
  return null;
}

type OpenApiImportCopy = ReturnType<
  typeof useTranslations
>["t"]["openApiImport"];

/** Diagnostics are localized by code; the raw API code is never rendered. */
function issueDescription(copy: OpenApiImportCopy, code: string): string {
  return resolveOpenApiIssueDescription(
    copy.issueDescriptions,
    code,
    copy.issueUnknown,
  );
}

function summaryCountPart(
  copy: OpenApiImportCopy,
  label: string,
  count: number,
): string {
  return copy.requestSummaryCount
    .replace("{label}", label)
    .replace("{count}", String(count));
}

function requestSummaryParts(
  copy: OpenApiImportCopy,
  summary: OpenApiRequestSummary,
): string[] {
  const parts = [
    summaryCountPart(copy, copy.requestSummaryPath, summary.pathParameters),
    summaryCountPart(copy, copy.requestSummaryQuery, summary.queryParameters),
    summaryCountPart(copy, copy.requestSummaryHeader, summary.headerParameters),
  ];
  if (summary.body !== "none") {
    parts.push(`${copy.requestSummaryBody} ${summary.body}`);
  }
  return parts;
}

/**
 * Two-phase safe OpenAPI import: submit a document source, preview it without
 * writing, curate operations and groups, then confirm. Imported tools arrive
 * disabled with mutation off and only ever touch the mutable draft.
 */
export function OpenApiImportDialog({
  serverId,
  configRevision = 1,
  initialGroupId,
  existingToolNames = [],
  onClose,
  onReviewTools,
}: {
  serverId: string;
  configRevision?: number;
  initialGroupId?: string;
  /** Names already used by tools on this server, for client-side conflict hints. */
  existingToolNames?: readonly string[];
  onClose: () => void;
  onReviewTools?: () => void;
}) {
  const { t } = useTranslations();
  const copy = t.openApiImport;
  const invalidateMcp = useInvalidateMcp();
  const previewMutation = usePreviewOpenApiImport();
  const confirmMutation = useConfirmOpenApiImport();
  const groupsQuery = useMcpToolGroups(serverId);

  const [mode, setMode] = useState<OpenApiSourceMode>("file");
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<
    keyof typeof FILE_ERROR_KEYS | null
  >(null);
  const [pasteContent, setPasteContent] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [previewSource, setPreviewSource] = useState<OpenApiSource | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>(
    {},
  );
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [strategyKind, setStrategyKind] = useState<
    OpenApiGroupStrategy["kind"]
  >(initialGroupId ? "existing" : "ungrouped");
  const [groupId, setGroupId] = useState(initialGroupId ?? "");
  const [newGroupName, setNewGroupName] = useState("");
  const [result, setResult] = useState<OpenApiConfirmResult | null>(null);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [optimization, setOptimization] =
    useState<AiOptimizationSelectionState | null>(null);
  const aiReadiness = useAiFeatureReadiness("structured-text-v1");

  const preview = previewMutation.data ?? null;
  const operations = preview?.operations ?? [];
  const groups = groupsQuery.data ?? [];
  const confirmErrorCode = getAppCode(confirmMutation.error);
  const needsRepreview =
    confirmMutation.error !== null &&
    (confirmErrorCode === APP_ERROR_CODES.MCP_OPENAPI_STALE_PREVIEW ||
      confirmErrorCode === APP_ERROR_CODES.MCP_WRITE_CONFLICT);

  const visibleOperations = filterOpenApiOperations(operations, search);
  const operationGroups = groupOpenApiOperations(visibleOperations);
  const blockedCount = operations.filter(
    (operation) => !operation.selectable,
  ).length;
  const selectableCount = operations.length - blockedCount;
  const warningCount = operations.reduce(
    (total, operation) =>
      total + splitOpenApiIssues(operation.issues).warnings.length,
    0,
  );
  const selectedOperations = operations.filter((operation) =>
    selectedKeys.includes(operation.operationKey),
  );

  const nameFor = (operation: OpenApiOperationCandidate): string =>
    nameOverrides[operation.operationKey] ?? operation.suggestedName;

  const selectionDrafts = selectedOperations.map((operation) => ({
    operationKey: operation.operationKey,
    suggestedName: operation.suggestedName,
    name: nameFor(operation),
  }));
  const nameIssues = selectionDrafts.map((draft) => ({
    operationKey: draft.operationKey,
    issue: findOpenApiNameIssue({
      name: draft.name,
      otherSelectedNames: selectionDrafts
        .filter((other) => other.operationKey !== draft.operationKey)
        .map((other) => other.name.trim()),
      existingToolNames,
    }),
  }));
  const nameIssueByOperationKey = new Map(
    nameIssues.map((entry) => [entry.operationKey, entry.issue]),
  );
  const hasNameIssue = nameIssues.some((entry) => entry.issue !== null);
  const hasBlockedSelection = selectedOperations.some(
    (operation) => !operation.selectable,
  );

  const firstTagPlan = planFirstTagGroups({
    selectedOperations,
    suggestedGroups: preview?.suggestedGroups ?? [],
    existingGroups: groups,
  });
  const plannedGroups =
    strategyKind === "new"
      ? newGroupName.trim().length > 0
        ? 1
        : 0
      : strategyKind === "firstTag"
        ? firstTagPlan.creationCount
        : 0;
  const remainingSlots = preview
    ? Math.max(preview.capacity.toolLimit - preview.capacity.currentTools, 0)
    : 0;
  const atToolCapacity = selectedKeys.length >= remainingSlots;

  const capacity = preview
    ? projectOpenApiCapacity({
        capacity: preview.capacity,
        selectedCount: selectionDrafts.length,
        plannedGroups,
      })
    : null;

  const groupStrategy: OpenApiGroupStrategy | null =
    strategyKind === "ungrouped"
      ? { kind: "ungrouped" }
      : strategyKind === "existing"
        ? groupId.length > 0
          ? { kind: "existing", groupId }
          : null
        : strategyKind === "new"
          ? newGroupName.trim().length > 0
            ? { kind: "new", name: newGroupName.trim() }
            : null
          : { kind: "firstTag" };

  const confirmBlocked =
    selectionDrafts.length === 0 ||
    hasBlockedSelection ||
    hasNameIssue ||
    groupStrategy === null ||
    capacity === null ||
    capacity.toolsExceeded ||
    capacity.groupsExceeded;

  const activeContent =
    mode === "file" ? fileContent : mode === "paste" ? pasteContent : urlValue;
  const modeHasInput =
    mode === "url"
      ? isHttpsDocumentUrl(urlValue)
      : (activeContent ?? "").trim().length > 0;

  const buildSource = (): OpenApiSource | null => {
    if (mode === "file") {
      return fileContent === null || fileContent.length === 0
        ? null
        : { kind: "content", content: fileContent, label: "file" };
    }
    if (mode === "paste") {
      return pasteContent.trim().length === 0
        ? null
        : { kind: "content", content: pasteContent, label: "paste" };
    }
    return isHttpsDocumentUrl(urlValue)
      ? { kind: "url", url: urlValue.trim() }
      : null;
  };

  const invalidateAfterWrite = async () => {
    await invalidateMcp();
  };

  const runPreview = (source: OpenApiSource) => {
    setPreviewSource(source);
    confirmMutation.reset();
    setOptimization(null);
    setOptimizeOpen(false);
    previewMutation.mutate(
      { serverId, source },
      {
        onSuccess: (data) => {
          const selectableKeys = new Set(
            data.operations
              .filter((operation) => operation.selectable)
              .map((operation) => operation.operationKey),
          );
          setSelectedKeys((prev) =>
            prev.filter((key) => selectableKeys.has(key)),
          );
        },
      },
    );
  };

  const submitPreview = () => {
    const source = buildSource();
    if (source === null) return;
    runPreview(source);
  };

  const repreview = () => {
    if (previewSource === null) return;
    runPreview(previewSource);
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      setFileContent(null);
      setFileError(null);
      return;
    }
    const read = await readOpenApiDocumentFile(file);
    if (!read.ok) {
      setFileContent(null);
      setFileError(read.reason);
      return;
    }
    setFileError(null);
    setFileContent(read.content);
  };

  const toggleSelection = (operationKey: string, selected: boolean) => {
    setOptimization(null);
    setSelectedKeys((keys) =>
      nextOpenApiSelection(keys, operationKey, selected, remainingSlots),
    );
  };

  const toggleExpanded = (operationKey: string) => {
    setExpandedKeys((keys) =>
      keys.includes(operationKey)
        ? keys.filter((key) => key !== operationKey)
        : [...keys, operationKey],
    );
  };

  const selectAll = () => {
    setOptimization(null);
    setSelectedKeys(
      selectOpenApiKeysUpToCapacity(
        operations
          .filter((operation) => operation.selectable)
          .map((operation) => operation.operationKey),
        remainingSlots,
      ),
    );
  };

  const confirmImport = () => {
    if (preview === null || previewSource === null || groupStrategy === null) {
      return;
    }
    const selection = buildOpenApiSelection(selectionDrafts);
    if (selection.length === 0) return;
    const input: OpenApiConfirmInput = {
      serverId,
      expectedRevision: configRevision,
      source: previewSource,
      fingerprint: preview.document.fingerprint,
      selection,
      groupStrategy,
      ...(optimization ? { optimization } : {}),
    };
    confirmMutation.mutate(input, {
      onSuccess: (data) => {
        setResult(data);
        void invalidateAfterWrite();
      },
      onError: async (error) => {
        toast.error(resolveErrorMessage(error, t));
        const code = getAppCode(error);
        if (
          code === APP_ERROR_CODES.MCP_OPENAPI_STALE_PREVIEW ||
          code === APP_ERROR_CODES.MCP_WRITE_CONFLICT
        ) {
          await invalidateAfterWrite();
        }
      },
    });
  };

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="scrollbar-none min-h-0 flex-1 space-y-4 overflow-y-auto">
          {result !== null ? (
            <div className="space-y-3">
              <Alert>
                <AlertDescription className="space-y-1">
                  <p className="font-medium">{copy.resultTitle}</p>
                  <p>
                    {result.tools.length === 1
                      ? copy.resultToolsOne
                      : copy.resultTools.replace(
                          "{count}",
                          String(result.tools.length),
                        )}
                  </p>
                  {result.groups.some((group) => group.created) ? (
                    <p>
                      {result.groups.filter((group) => group.created).length ===
                      1
                        ? copy.resultGroupsOne
                        : copy.resultGroups.replace(
                            "{count}",
                            String(
                              result.groups.filter((group) => group.created)
                                .length,
                            ),
                          )}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground">{copy.resultHint}</p>
                </AlertDescription>
              </Alert>
              <ul className="space-y-1">
                {result.tools.slice(0, 8).map((tool) => (
                  <li
                    key={tool.id}
                    className="flex flex-wrap items-center gap-2 text-xs"
                  >
                    <Badge variant="secondary" className="font-mono text-xs">
                      {tool.method}
                    </Badge>
                    <code className="break-all font-mono text-xs">
                      {tool.path}
                    </code>
                    <span className="font-mono text-muted-foreground">
                      {tool.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : preview === null ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">{copy.sourceLegend}</p>
              <Tabs
                value={mode}
                onValueChange={(next) => setMode(next as OpenApiSourceMode)}
              >
                <TabsList
                  className="grid w-full grid-cols-3"
                  aria-label={copy.sourceLegend}
                >
                  <TabsTrigger value="file">{copy.sourceFile}</TabsTrigger>
                  <TabsTrigger value="paste">{copy.sourcePaste}</TabsTrigger>
                  <TabsTrigger value="url">{copy.sourceUrl}</TabsTrigger>
                </TabsList>
                <TabsContent value="file">
                  <Field>
                    <Label htmlFor="openapi-import-file">
                      {copy.fileLabel}
                    </Label>
                    <Input
                      id="openapi-import-file"
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) => {
                        void handleFileChange(event);
                      }}
                    />
                    <FieldHint>{copy.fileHint}</FieldHint>
                    {fileError !== null ? (
                      <p className="text-sm text-destructive">
                        {copy[FILE_ERROR_KEYS[fileError]]}
                      </p>
                    ) : null}
                  </Field>
                </TabsContent>
                <TabsContent value="paste">
                  <Field>
                    <Label htmlFor="openapi-import-paste">
                      {copy.pasteLabel}
                    </Label>
                    <Textarea
                      id="openapi-import-paste"
                      value={pasteContent}
                      onChange={(event) => setPasteContent(event.target.value)}
                      placeholder={copy.pastePlaceholder}
                      rows={6}
                      spellCheck={false}
                      className="font-mono text-xs"
                    />
                  </Field>
                </TabsContent>
                <TabsContent value="url">
                  <Field>
                    <Label htmlFor="openapi-import-url">{copy.urlLabel}</Label>
                    <Input
                      id="openapi-import-url"
                      type="url"
                      value={urlValue}
                      onChange={(event) => setUrlValue(event.target.value)}
                      placeholder="https://api.example.com/openapi.json"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <FieldHint>{copy.urlHint}</FieldHint>
                  </Field>
                </TabsContent>
              </Tabs>

              {previewMutation.error !== null ? (
                <Alert variant="destructive">
                  <AlertDescription className="space-y-1">
                    <p>{copy.previewUnavailable}</p>
                    <p className="text-xs">
                      {resolveErrorMessage(previewMutation.error, t)}
                    </p>
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {copy.version.replace(
                      "{version}",
                      preview.document.version,
                    )}
                  </Badge>
                  {preview.document.title ? (
                    <span className="text-sm font-medium">
                      {preview.document.title}
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {copy.operationCount.replace(
                    "{count}",
                    String(operations.length),
                  )}
                  {" · "}
                  {copy.selectableCount.replace(
                    "{count}",
                    String(selectableCount),
                  )}
                  {" · "}
                  {copy.blockedCount.replace("{count}", String(blockedCount))}
                  {" · "}
                  {copy.warningCount.replace("{count}", String(warningCount))}
                </p>
                <p className="text-xs text-muted-foreground">
                  {copy.selectedOfTotal
                    .replace("{selected}", String(selectionDrafts.length))
                    .replace("{total}", String(operations.length))}
                </p>
                {blockedCount > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {copy.blockersHint}
                  </p>
                ) : null}
              </div>

              {preview.documentIssues.length > 0 ? (
                <Alert variant="destructive">
                  <AlertDescription className="space-y-1">
                    <p className="font-medium">{copy.documentIssuesTitle}</p>
                    <p className="text-xs">{copy.documentIssuesHint}</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs">
                      {preview.documentIssues.map((issue) => (
                        <li
                          key={`${issue.code}:${issue.path ?? "document"}:${issue.message}`}
                        >
                          {issueDescription(copy, issue.code)}
                          {issue.path ? (
                            <span className="text-muted-foreground">
                              {" "}
                              ({issue.path})
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              {capacity !== null ? (
                <div className="space-y-1 rounded-md border border-border p-3">
                  <p className="text-sm font-medium">{copy.capacityTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {copy.capacityTools
                      .replace("{current}", String(capacity.currentTools))
                      .replace("{limit}", String(capacity.toolLimit))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {copy.capacityGroups
                      .replace("{current}", String(capacity.currentGroups))
                      .replace("{limit}", String(capacity.groupLimit))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {copy.capacityRemaining.replace(
                      "{remaining}",
                      String(capacity.remainingTools),
                    )}
                  </p>
                  {capacity.toolsExceeded ? (
                    <p className="text-xs text-destructive">
                      {copy.capacityToolExceeded
                        .replace("{selected}", String(capacity.selectedCount))
                        .replace("{limit}", String(capacity.toolLimit))
                        .replace("{current}", String(capacity.currentTools))}
                    </p>
                  ) : null}
                  {capacity.groupsExceeded ? (
                    <p className="text-xs text-destructive">
                      {copy.capacityGroupExceeded
                        .replace("{selected}", String(capacity.plannedGroups))
                        .replace(
                          "{available}",
                          String(capacity.remainingGroups),
                        )
                        .replace("{limit}", String(capacity.groupLimit))}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectableCount === 0}
                  onClick={selectAll}
                >
                  {copy.selectAll}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectionDrafts.length === 0}
                  onClick={() => {
                    setOptimization(null);
                    setSelectedKeys([]);
                  }}
                >
                  {copy.clearSelection}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={selectionDrafts.length === 0 || !aiReadiness.ready}
                  onClick={() => setOptimizeOpen(true)}
                >
                  <Sparkles className="h-4 w-4" />
                  {t.servers.aiOptimizer.action}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {copy.selectedCount.replace(
                    "{count}",
                    String(selectionDrafts.length),
                  )}
                </span>
              </div>
              {aiReadiness.ready || aiReadiness.isLoading ? null : (
                <AiSettingsCta capabilityProfile="structured-text-v1" />
              )}

              <Field>
                <Label htmlFor="openapi-import-search">
                  {copy.searchLabel}
                </Label>
                <Input
                  id="openapi-import-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>

              {operations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {copy.noOperations}
                </p>
              ) : visibleOperations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {copy.noSearchResults}
                </p>
              ) : (
                <div className="space-y-3">
                  {operationGroups.map((group) => (
                    <div key={group.tag ?? "untagged"} className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {group.tag ?? copy.ungroupedTag}
                      </p>
                      <ul className="space-y-2">
                        {group.operations.map((operation) => {
                          const { blockers, warnings } = splitOpenApiIssues(
                            operation.issues,
                          );
                          const isSelected = selectedKeys.includes(
                            operation.operationKey,
                          );
                          const isExpanded = expandedKeys.includes(
                            operation.operationKey,
                          );
                          const nameIssue = isSelected
                            ? (nameIssueByOperationKey.get(
                                operation.operationKey,
                              ) ?? null)
                            : null;
                          const requestSummary = summarizeOpenApiRequest(
                            operation.requestDefinition,
                          );
                          // Blocked candidates omit the definition their blockers
                          // describe, so an absent one is never an empty request.
                          const hasRequestDefinition =
                            operation.requestDefinition !== undefined;
                          return (
                            <li
                              key={operation.operationKey}
                              className="space-y-2 rounded-md border border-border p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-primary"
                                  checked={isSelected}
                                  disabled={
                                    !operation.selectable ||
                                    (!isSelected && atToolCapacity)
                                  }
                                  aria-label={`${operation.method} ${operation.path}`}
                                  onChange={(event) =>
                                    toggleSelection(
                                      operation.operationKey,
                                      event.target.checked,
                                    )
                                  }
                                />
                                <Badge
                                  variant="secondary"
                                  className="font-mono text-xs"
                                >
                                  {operation.method}
                                </Badge>
                                <code className="break-all font-mono text-xs">
                                  {operation.path}
                                </code>
                                {operation.deprecated ? (
                                  <Badge variant="outline">
                                    {copy.deprecated}
                                  </Badge>
                                ) : null}
                                {!operation.selectable ? (
                                  <Badge variant="destructive">
                                    {copy.blocked}
                                  </Badge>
                                ) : null}
                                {warnings.length > 0 ? (
                                  <Badge variant="outline">
                                    {copy.warningLabel} {warnings.length}
                                  </Badge>
                                ) : null}
                                <button
                                  type="button"
                                  className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"
                                  aria-expanded={isExpanded}
                                  onClick={() =>
                                    toggleExpanded(operation.operationKey)
                                  }
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                  {isExpanded
                                    ? copy.collapseOperation
                                    : copy.expandOperation}
                                </button>
                              </div>

                              {blockers.length > 0 ? (
                                <div className="space-y-1">
                                  <p className="text-xs font-medium">
                                    {copy.blockersTitle}
                                  </p>
                                  <ul className="space-y-0.5">
                                    {withOpenApiKeys(
                                      blockers,
                                      (issue) => issue.code,
                                    ).map(({ key, value: issue }) => (
                                      <li
                                        key={key}
                                        className="text-xs text-destructive"
                                      >
                                        {issueDescription(copy, issue.code)}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}

                              {isSelected && operation.selectable ? (
                                <Field>
                                  <Label>{copy.nameLabel}</Label>
                                  <Input
                                    value={nameFor(operation)}
                                    aria-label={copy.nameLabel}
                                    placeholder={copy.namePlaceholder}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="font-mono text-xs"
                                    onChange={(event) =>
                                      setNameOverrides((overrides) => ({
                                        ...overrides,
                                        [operation.operationKey]:
                                          event.target.value,
                                      }))
                                    }
                                  />
                                  {nameIssue !== null ? (
                                    <p className="text-xs text-destructive">
                                      {nameIssueMessage(nameIssue, copy)}
                                    </p>
                                  ) : null}
                                </Field>
                              ) : (
                                <p className="font-mono text-xs text-muted-foreground">
                                  {operation.suggestedName}
                                </p>
                              )}

                              {isExpanded ? (
                                <div className="space-y-2 border-t border-border pt-2">
                                  {operation.tags.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {operation.tags.map((tag) => (
                                        <Badge
                                          key={tag}
                                          variant="outline"
                                          className="text-xs"
                                        >
                                          {tag}
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : null}
                                  {operation.description ? (
                                    <p className="text-xs text-muted-foreground">
                                      {operation.description}
                                    </p>
                                  ) : null}
                                  <div className="space-y-1">
                                    <p className="text-xs font-medium">
                                      {copy.securityTitle}
                                    </p>
                                    {operation.security.length === 0 ? (
                                      <p className="text-xs text-muted-foreground">
                                        {copy.securityNone}
                                      </p>
                                    ) : (
                                      <>
                                        <ul className="space-y-0.5">
                                          {withOpenApiKeys(
                                            operation.security,
                                            (requirement) =>
                                              `${requirement.name}:${requirement.type}:${requirement.in ?? ""}:${requirement.scheme ?? ""}`,
                                          ).map(
                                            ({ key, value: requirement }) => (
                                              <li
                                                key={key}
                                                className="font-mono text-xs"
                                              >
                                                {describeOpenApiSecurityRequirement(
                                                  requirement,
                                                )}
                                              </li>
                                            ),
                                          )}
                                        </ul>
                                        <p className="text-xs text-muted-foreground">
                                          {copy.securityHint}
                                        </p>
                                      </>
                                    )}
                                  </div>
                                  {hasRequestDefinition ? (
                                    <div className="space-y-1">
                                      <p className="text-xs font-medium">
                                        {copy.requestSummary}
                                      </p>
                                      {hasOpenApiRequestSummary(
                                        requestSummary,
                                      ) ? (
                                        <p className="font-mono text-xs text-muted-foreground">
                                          {requestSummaryParts(
                                            copy,
                                            requestSummary,
                                          ).join(" · ")}
                                        </p>
                                      ) : (
                                        <p className="text-xs text-muted-foreground">
                                          {copy.requestSummaryNone}
                                        </p>
                                      )}
                                    </div>
                                  ) : null}
                                  {warnings.length > 0 ? (
                                    <div className="space-y-1">
                                      <p className="text-xs font-medium">
                                        {copy.warningsTitle}
                                      </p>
                                      <ul className="space-y-0.5">
                                        {withOpenApiKeys(
                                          warnings,
                                          (issue) => issue.code,
                                        ).map(({ key, value: issue }) => (
                                          <li
                                            key={key}
                                            className="text-xs text-muted-foreground"
                                          >
                                            {issueDescription(copy, issue.code)}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              <fieldset className="space-y-3 rounded-md border border-border p-3">
                <legend className="text-sm font-medium">
                  {copy.groupLegend}
                </legend>
                <div
                  role="radiogroup"
                  aria-label={copy.groupStrategyLabel}
                  className="space-y-2"
                >
                  {GROUP_STRATEGY_KINDS.map((kind) => (
                    <label
                      key={kind}
                      className="flex items-start gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="openapi-import-group-strategy"
                        className="mt-1 h-4 w-4 accent-primary"
                        checked={strategyKind === kind}
                        onChange={() => setStrategyKind(kind)}
                      />
                      <span>
                        {kind === "ungrouped"
                          ? copy.groupUngrouped
                          : kind === "existing"
                            ? copy.groupExisting
                            : kind === "new"
                              ? copy.groupNew
                              : copy.groupFirstTag}
                      </span>
                    </label>
                  ))}
                </div>

                {strategyKind === "existing" ? (
                  <Field>
                    <Label htmlFor="openapi-import-group">
                      {copy.groupSelectLabel}
                    </Label>
                    <Select
                      value={groupId.length > 0 ? groupId : undefined}
                      onValueChange={setGroupId}
                    >
                      <SelectTrigger
                        id="openapi-import-group"
                        aria-label={copy.groupSelectLabel}
                      >
                        <SelectValue
                          placeholder={copy.groupSelectPlaceholder}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {groups.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}

                {strategyKind === "new" ? (
                  <Field>
                    <Label htmlFor="openapi-import-group-name">
                      {copy.groupNewNameLabel}
                    </Label>
                    <Input
                      id="openapi-import-group-name"
                      value={newGroupName}
                      onChange={(event) => setNewGroupName(event.target.value)}
                      placeholder={copy.groupNewNamePlaceholder}
                      autoComplete="off"
                    />
                  </Field>
                ) : null}

                {strategyKind === "firstTag" ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {copy.groupFirstTagHint}
                    </p>
                    {firstTagPlan.reuse.length === 0 &&
                    firstTagPlan.create.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {copy.groupNoCreations}
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {firstTagPlan.reuse.map((entry) => (
                          <li key={`reuse-${entry.tag}`} className="text-xs">
                            {copy.groupReuse.replace("{name}", entry.name)}
                          </li>
                        ))}
                        {firstTagPlan.create.map((entry) => (
                          <li key={`create-${entry.tag}`} className="text-xs">
                            {copy.groupWillCreate.replace("{name}", entry.name)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </fieldset>

              {needsRepreview ? (
                <div
                  className="rounded-md border border-destructive/40 bg-muted/40 p-4"
                  role="region"
                  aria-label={copy.staleTitle}
                >
                  <p className="text-sm font-medium">{copy.staleTitle}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {copy.staleDescription}
                  </p>
                  <div className="mt-3 flex flex-row justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="border-border bg-background"
                      disabled={previewMutation.isPending}
                      onClick={repreview}
                    >
                      {copy.repreview}
                    </Button>
                  </div>
                </div>
              ) : selectionDrafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {copy.emptySelection}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 shrink-0 flex-row justify-end gap-2">
          {result !== null ? (
            <>
              {onReviewTools ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-border bg-background"
                  onClick={() => {
                    onReviewTools();
                    onClose();
                  }}
                >
                  {copy.resultReview}
                </Button>
              ) : null}
              <Button type="button" onClick={onClose}>
                {copy.resultClose}
              </Button>
            </>
          ) : preview === null ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="border-border bg-background"
                onClick={onClose}
              >
                {copy.cancel}
              </Button>
              <Button
                type="button"
                disabled={previewMutation.isPending || !modeHasInput}
                onClick={submitPreview}
              >
                {previewMutation.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {previewMutation.isPending ? copy.previewing : copy.preview}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                className="border-border bg-background"
                disabled={confirmMutation.isPending}
                onClick={onClose}
              >
                {copy.cancel}
              </Button>
              <Button
                type="button"
                disabled={confirmMutation.isPending || confirmBlocked}
                onClick={confirmImport}
              >
                {confirmMutation.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {confirmMutation.isPending
                  ? copy.confirming
                  : selectionDrafts.length === 1
                    ? copy.confirmOne
                    : copy.confirm.replace(
                        "{count}",
                        String(selectionDrafts.length),
                      )}
              </Button>
            </>
          )}
        </DialogFooter>
        {optimizeOpen && preview !== null && previewSource !== null ? (
          <AiOptimizeDialog
            serverId={serverId}
            serverState={{ configRevision }}
            scope={{
              kind: "openapi",
              operationKeys: selectedOperations
                .filter((operation) => operation.selectable)
                .map((operation) => operation.operationKey),
            }}
            openapi={{
              source: previewSource,
              fingerprint: preview.document.fingerprint,
            }}
            onOptimizationChange={setOptimization}
            onOpenChange={(next) => {
              if (!next) setOptimizeOpen(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
