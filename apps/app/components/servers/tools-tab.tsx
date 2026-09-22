import { AdminListPagination } from "@/components/admin-list";
import {
  AiOptimizeDialog,
  type AiOptimizeScope,
} from "@/components/servers/ai-optimize-dialog";
import { TableRowsSkeleton } from "@/components/loading";
import { CurlImportDialog } from "@/components/servers/curl-import-dialog";
import { DeleteToolDialog } from "@/components/servers/delete-tool-dialog";
import { MethodBadge } from "@/components/servers/method-badge";
import { OpenApiImportDialog } from "@/components/servers/openapi-import-dialog";
import {
  ToolFormDialog,
  type ToolFormTool,
} from "@/components/servers/tool-form-dialog";
import { ToolGroupDialog } from "@/components/servers/tool-group-dialog";
import { ToolGroupFilter } from "@/components/servers/tool-group-filter";
import {
  TOOL_IDS_DRAG_TYPE,
  ToolGroupRail,
} from "@/components/servers/tool-group-rail";
import { ToolGroupMoveDialog } from "@/components/servers/tool-group-move-dialog";
import {
  useAssignMcpToolGroup,
  useMcpServer,
  useMcpToolGroups,
  useMcpTools,
  useMcpVariables,
  useUpdateMcpTool,
  type McpToolGroupSummary,
} from "@/hooks/use-mcp";
import {
  AiSettingsCta,
  useAiFeatureReadiness,
} from "@/hooks/use-ai-readiness-guard";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import {
  isClientRequestDefinition,
  summarizeDefinitionPath,
} from "@/lib/request-definition";
import { MCP_TOOL_GROUP_LIMITS, type PageSize } from "@repo/core";
import {
  Alert,
  AlertDescription,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui";
import {
  Copy,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";

/** Mirrors the API `toolGroupFilterSchema` sentinels. */
const ALL_FILTER = "all";
const UNGROUPED_FILTER = "ungrouped";

type FormState =
  | { kind: "create" }
  | { kind: "edit"; tool: ToolFormTool }
  | { kind: "duplicate"; tool: ToolFormTool }
  | null;

type GroupDialogState =
  | { mode: "create" }
  | { mode: "rename" | "delete"; group: McpToolGroupSummary }
  | null;

function resolveFilteredGroup(
  group: string | undefined,
  groups: McpToolGroupSummary[],
): McpToolGroupSummary | undefined {
  if (
    group === undefined ||
    group === ALL_FILTER ||
    group === UNGROUPED_FILTER
  ) {
    return undefined;
  }
  return groups.find((candidate) => candidate.id === group);
}

export function ServerToolsTab({
  serverId,
  configRevision,
  toolCount,
  toolLimit,
  page,
  pageSize,
  group,
  q,
  onPageChange,
  onPageSizeChange,
  onGroupChange,
  onSearchChange,
}: {
  serverId: string;
  configRevision: number;
  /** Server-wide tool total; the filtered page total cannot stand in for it. */
  toolCount: number;
  /** Per-server cap for this deployment, reported by the API. */
  toolLimit: number;
  page: number;
  pageSize: PageSize;
  /** `undefined` and `"all"` are unfiltered, `"ungrouped"` is ungrouped, otherwise a group id. */
  group: string | undefined;
  /** Optional trimmed tool-name search; `undefined` is unfiltered. */
  q: string | undefined;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
  /** The parent owns the page reset that must accompany a filter change. */
  onGroupChange: (next: string | undefined) => void;
  /** The parent owns the page reset that must accompany a search change. */
  onSearchChange: (next: string | undefined) => void;
}) {
  const { t } = useTranslations();
  const { data, isLoading, isError, error } = useMcpTools(serverId, {
    page,
    pageSize,
    group,
    q,
  });
  const groupsQuery = useMcpToolGroups(serverId);
  const groups = groupsQuery.data ?? [];
  // The same cached server detail the route loads for `toolCount`: reusing the
  // query adds no request and gives name-conflict hints the server-wide list
  // instead of only the current, filtered page.
  const serverQuery = useMcpServer(serverId);
  const serverToolNames = (serverQuery.data?.tools ?? []).map(
    (tool) => tool.name,
  );
  const variables = useMcpVariables(serverId);
  const updateTool = useUpdateMcpTool();
  const assignGroup = useAssignMcpToolGroup();
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [curlOpen, setCurlOpen] = useState(false);
  const [openApiOpen, setOpenApiOpen] = useState(false);
  const [optimizeScope, setOptimizeScope] = useState<AiOptimizeScope | null>(
    null,
  );
  const aiReadiness = useAiFeatureReadiness("structured-text-v1");
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null);
  const [moveToolId, setMoveToolId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(q ?? "");
  const [syncedQ, setSyncedQ] = useState(q);
  // The URL owns the committed query; the draft follows it when navigation
  // changes `q` from anywhere else (back button, filter resets, tests).
  if (syncedQ !== q) {
    setSyncedQ(q);
    setSearchDraft(q ?? "");
  }

  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  });

  // The draft is debounced; `q` is only compared to skip redundant commits.
  // The callback lives in a ref so parent re-renders cannot restart the timer.
  useEffect(() => {
    const current = q ?? "";
    const trimmed = searchDraft.trim();
    const next = trimmed || undefined;
    if (next === current) {
      return;
    }
    const timer = setTimeout(
      () => onSearchChangeRef.current(trimmed || undefined),
      300,
    );
    return () => clearTimeout(timer);
  }, [searchDraft, q]);

  // A group filter whose group was deleted resets to All instead of hiding
  // every tool behind a dead id. The ref prevents duplicate navigations while
  // the replace navigation is still in flight.
  const resettingGroupRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      group !== undefined &&
      group !== ALL_FILTER &&
      group !== UNGROUPED_FILTER &&
      groupsQuery.data &&
      !groups.some((candidate) => candidate.id === group)
    ) {
      if (resettingGroupRef.current !== group) {
        resettingGroupRef.current = group;
        onGroupChange(undefined);
      }
      return;
    }
    resettingGroupRef.current = null;
  }, [group, groups, groupsQuery.data, groupsQuery.isLoading, onGroupChange]);

  // Selection belongs to one page/filter/search scope. A scope change clears
  // it during render so a selection from another scope can never be acted on.
  const scopeKey = `${page}:${pageSize}:${group ?? ALL_FILTER}:${q ?? ""}`;
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({
    scope: scopeKey,
    ids: [],
  });
  if (selection.scope !== scopeKey) {
    setSelection({ scope: scopeKey, ids: [] });
  }
  const selectedIds =
    selection.scope === scopeKey && data
      ? selection.ids.filter((id) => data.items.some((tool) => tool.id === id))
      : [];

  const atCap = toolCount >= toolLimit;
  const atGroupLimit =
    groups.length >= MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer;
  const filterActive = group !== undefined && group !== ALL_FILTER;
  const filteredGroup = resolveFilteredGroup(group, groups);
  const variableNames = (variables.data ?? []).map((variable) => variable.name);
  const serverValueNameById = Object.fromEntries(
    (variables.data ?? []).map((variable) => [variable.id, variable.name]),
  );
  const variableRefs = (variables.data ?? []).map((variable) => ({
    id: variable.id,
    name: variable.name,
    kind: variable.kind,
  }));
  // A dead group id renders no header instead of guessing a wrong label.
  const headerGroupLabel =
    group === UNGROUPED_FILTER
      ? t.servers.groups.ungrouped
      : filteredGroup?.name;
  const searchActive = q !== undefined && q.length > 0;
  const toolsEmptyMessage = !data
    ? t.servers.noTools
    : searchActive
      ? t.servers.groups.searchEmpty.replace("{query}", q)
      : group === UNGROUPED_FILTER
        ? t.servers.groups.emptyUngrouped
        : filteredGroup
          ? t.servers.groups.emptyGroup
          : t.servers.noTools;
  const hasSelection = selectedIds.length > 0;
  const selectedCountLabel =
    selectedIds.length === 1
      ? t.servers.groups.toolCountOne
      : t.servers.groups.toolCount.replace(
          "{count}",
          String(selectedIds.length),
        );

  const setScopedSelection = (ids: string[]) =>
    setSelection({ scope: scopeKey, ids });

  const toggleToolSelected = (toolId: string, checked: boolean) =>
    setScopedSelection(
      checked
        ? [...selectedIds.filter((id) => id !== toolId), toolId]
        : selectedIds.filter((id) => id !== toolId),
    );

  const moveSelectionTo = (groupId: string | null) => {
    if (selectedIds.length === 0) {
      return;
    }
    assignGroup.mutate(
      {
        serverId,
        expectedRevision: configRevision,
        toolIds: selectedIds,
        groupId,
      },
      { onSuccess: () => setScopedSelection([]) },
    );
  };

  const handleDropTools = (groupId: string | null, toolIds: string[]) => {
    if (assignGroup.isPending || toolIds.length === 0) {
      return;
    }
    assignGroup.mutate({
      serverId,
      expectedRevision: configRevision,
      toolIds,
      groupId,
    });
  };

  const dragToolIdsFor = (toolId: string): string[] =>
    selectedIds.includes(toolId) && selectedIds.length > 0
      ? selectedIds
      : [toolId];

  return (
    <div className="space-y-6">
      {atCap ? (
        <Alert>
          <AlertDescription>
            {t.servers.toolCap
              .replace("{count}", String(toolCount))
              .replace("{limit}", String(toolLimit))}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => setFormState({ kind: "create" })}
          disabled={atCap}
        >
          <Plus className="h-4 w-4" />
          {t.servers.addTool}
        </Button>
        <Button
          variant="outline"
          onClick={() => setCurlOpen(true)}
          disabled={atCap}
        >
          {t.servers.importCurl}
        </Button>
        <Button
          variant="outline"
          onClick={() => setOpenApiOpen(true)}
          disabled={atCap}
        >
          {t.openApiImport.action}
        </Button>
        <div className="ml-auto md:hidden">
          <ToolGroupFilter
            groups={groups}
            value={group}
            onChange={onGroupChange}
            total={filterActive ? undefined : toolCount}
          />
        </div>
      </div>
      {aiReadiness.ready || aiReadiness.isLoading ? null : (
        <AiSettingsCta capabilityProfile="structured-text-v1" />
      )}

      <div className="grid items-start gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden md:block">
          <ToolGroupRail
            groups={groups}
            value={group === ALL_FILTER ? undefined : group}
            totalCount={toolCount}
            atGroupLimit={atGroupLimit}
            dropDisabled={assignGroup.isPending}
            onSelect={onGroupChange}
            onCreate={() => setGroupDialog({ mode: "create" })}
            onRename={(target) =>
              setGroupDialog({ mode: "rename", group: target })
            }
            onDelete={(target) =>
              setGroupDialog({ mode: "delete", group: target })
            }
            onDropTools={handleDropTools}
          />
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {headerGroupLabel ? (
                <h3 className="text-sm font-medium">
                  {t.servers.groups.inGroupHeader.replace(
                    "{group}",
                    headerGroupLabel,
                  )}
                </h3>
              ) : null}
              <div className="relative ml-auto w-full max-w-64">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={searchDraft}
                  placeholder={t.servers.groups.searchPlaceholder}
                  aria-label={t.servers.groups.searchLabel}
                  className="pl-8"
                  onChange={(event) => setSearchDraft(event.target.value)}
                />
              </div>
            </div>

            <div
              className={`grid transition-[grid-template-rows,margin-top] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                hasSelection ? "mt-4 grid-rows-[1fr]" : "mt-0 grid-rows-[0fr]"
              }`}
            >
              <div
                aria-hidden={hasSelection ? undefined : true}
                className={`min-h-0 overflow-hidden transition-[visibility] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
                  hasSelection ? "visible" : "invisible"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
                  <span className="text-sm text-muted-foreground">
                    {selectedCountLabel}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        disabled={assignGroup.isPending}
                      >
                        <FolderInput className="h-4 w-4" />
                        {t.servers.groups.moveTo}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => moveSelectionTo(null)}>
                        {t.servers.groups.ungrouped}
                      </DropdownMenuItem>
                      {groups.map((groupOption) => (
                        <DropdownMenuItem
                          key={groupOption.id}
                          onSelect={() => moveSelectionTo(groupOption.id)}
                        >
                          {groupOption.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!aiReadiness.ready}
                    onClick={() =>
                      setOptimizeScope({
                        kind: "selected",
                        toolIds: [...selectedIds],
                      })
                    }
                  >
                    <Sparkles className="h-4 w-4" />
                    {t.servers.aiOptimizer.actionSelected}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {isLoading && !data ? (
            <TableRowsSkeleton />
          ) : isError ? (
            <p className="text-sm text-destructive">
              {resolveErrorMessage(error, t)}
            </p>
          ) : !data || data.items.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {toolsEmptyMessage}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={
                        data.items.length > 0 &&
                        selectedIds.length === data.items.length
                      }
                      aria-label={t.servers.selectAllTools}
                      onChange={(event) =>
                        setScopedSelection(
                          event.target.checked
                            ? data.items.map((tool) => tool.id)
                            : [],
                        )
                      }
                    />
                  </TableHead>
                  <TableHead>{t.servers.toolName}</TableHead>
                  <TableHead>{t.servers.method}</TableHead>
                  <TableHead>{t.servers.toolPathSummary}</TableHead>
                  <TableHead>{t.servers.enabled}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((tool) => (
                  <TableRow
                    key={tool.id}
                    draggable
                    onDragStart={(event: DragEvent<HTMLTableRowElement>) => {
                      event.dataTransfer.setData(
                        TOOL_IDS_DRAG_TYPE,
                        JSON.stringify(dragToolIdsFor(tool.id)),
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={selectedIds.includes(tool.id)}
                        aria-label={tool.name}
                        onChange={(event) =>
                          toggleToolSelected(tool.id, event.target.checked)
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium">{tool.name}</TableCell>
                    <TableCell>
                      <MethodBadge method={tool.method} />
                    </TableCell>
                    <TableCell className="max-w-[26rem] font-mono text-xs">
                      <span className="block truncate">
                        {isClientRequestDefinition(tool.requestDefinition)
                          ? summarizeDefinitionPath(
                              tool.requestDefinition,
                              serverValueNameById,
                            )
                          : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Switch
                          checked={tool.enabled}
                          disabled={
                            updateTool.isPending ||
                            tool.compileStatus === "invalid"
                          }
                          onCheckedChange={(enabled) =>
                            updateTool.mutate({
                              serverId,
                              toolId: tool.id,
                              expectedRevision: configRevision,
                              enabled,
                              allowMutation: tool.allowMutation,
                            })
                          }
                        />
                        {tool.compileStatus === "invalid" ? (
                          <span className="text-xs text-destructive">
                            {t.servers.compileInvalidShort}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={tool.name}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              setFormState({ kind: "edit", tool })
                            }
                          >
                            <Pencil className="h-4 w-4" />
                            {t.servers.editTool}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={atCap}
                            onSelect={() =>
                              setFormState({ kind: "duplicate", tool })
                            }
                          >
                            <Copy className="h-4 w-4" />
                            {t.servers.duplicateTool}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setMoveToolId(tool.id)}
                          >
                            <FolderInput className="h-4 w-4" />
                            {t.servers.groups.moveTitle}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!aiReadiness.ready}
                            onSelect={() =>
                              setOptimizeScope({
                                kind: "single",
                                toolIds: [tool.id],
                              })
                            }
                          >
                            <Sparkles className="h-4 w-4" />
                            {t.servers.aiOptimizer.action}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onSelect={() =>
                              setDeleteTarget({ id: tool.id, name: tool.name })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                            {t.servers.deleteTool}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {data ? (
            <AdminListPagination
              page={page}
              pageSize={pageSize}
              total={data.total}
              itemCount={data.items.length}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          ) : null}
        </div>
      </div>

      {formState ? (
        <ToolFormDialog
          serverId={serverId}
          configRevision={configRevision}
          variableNames={variableNames}
          variables={variableRefs}
          groups={groups}
          initialGroupId={filteredGroup?.id}
          tool={formState.kind === "create" ? undefined : formState.tool}
          duplicate={formState.kind === "duplicate"}
          onClose={() => setFormState(null)}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteToolDialog
          serverId={serverId}
          configRevision={configRevision}
          tool={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
      {curlOpen ? (
        <CurlImportDialog
          serverId={serverId}
          configRevision={configRevision}
          groups={groups}
          initialGroupId={filteredGroup?.id}
          onClose={() => setCurlOpen(false)}
        />
      ) : null}
      {groupDialog ? (
        <ToolGroupDialog
          serverId={serverId}
          configRevision={configRevision}
          mode={groupDialog.mode}
          group={groupDialog.mode === "create" ? undefined : groupDialog.group}
          groupCount={groups.length}
          onClose={() => setGroupDialog(null)}
        />
      ) : null}
      {moveToolId ? (
        <ToolGroupMoveDialog
          serverId={serverId}
          configRevision={configRevision}
          groups={groups}
          toolId={moveToolId}
          onClose={() => setMoveToolId(null)}
        />
      ) : null}
      {openApiOpen ? (
        <OpenApiImportDialog
          serverId={serverId}
          configRevision={configRevision}
          initialGroupId={filteredGroup?.id}
          existingToolNames={serverToolNames}
          onClose={() => setOpenApiOpen(false)}
          onReviewTools={() => {
            setOpenApiOpen(false);
            onGroupChange(undefined);
          }}
        />
      ) : null}
      {optimizeScope ? (
        <AiOptimizeDialog
          serverId={serverId}
          serverState={
            serverQuery.data
              ? {
                  configRevision: serverQuery.data.configRevision,
                  draftRevision: serverQuery.data.draftRevision,
                }
              : null
          }
          scope={optimizeScope}
          onOpenChange={(open) => {
            if (!open) setOptimizeScope(null);
          }}
        />
      ) : null}
    </div>
  );
}
