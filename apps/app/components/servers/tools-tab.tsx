import { AdminListPagination } from "@/components/admin-list";
import { TableRowsSkeleton } from "@/components/loading";
import { CurlImportDialog } from "@/components/servers/curl-import-dialog";
import { DeleteToolDialog } from "@/components/servers/delete-tool-dialog";
import { OpenApiImportDialog } from "@/components/servers/openapi-import-dialog";
import {
  ToolFormDialog,
  type ToolFormTool,
} from "@/components/servers/tool-form-dialog";
import { ToolGroupDialog } from "@/components/servers/tool-group-dialog";
import { ToolGroupFilter } from "@/components/servers/tool-group-filter";
import { ToolGroupMoveDialog } from "@/components/servers/tool-group-move-dialog";
import {
  useMcpServer,
  useMcpToolGroups,
  useMcpTools,
  useMcpVariables,
  useUpdateMcpTool,
  type McpToolGroupSummary,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { MCP_MAX_TOOLS } from "@/lib/mcp-limits";
import {
  isClientRequestDefinition,
  summarizeDefinitionPath,
} from "@/lib/request-definition";
import { MCP_TOOL_GROUP_LIMITS, type PageSize } from "@repo/core";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  Trash2,
} from "lucide-react";
import { useState } from "react";

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

function GroupActionMenu({
  label,
  groups,
  destructive,
  onSelect,
}: {
  label: string;
  groups: McpToolGroupSummary[];
  destructive?: boolean;
  onSelect: (group: McpToolGroupSummary) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" disabled={groups.length === 0}>
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {groups.map((group) => (
          <DropdownMenuItem
            key={group.id}
            className={destructive ? "text-destructive" : undefined}
            onSelect={() => onSelect(group)}
          >
            {group.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ServerToolsTab({
  serverId,
  configRevision,
  toolCount,
  page,
  pageSize,
  group,
  onPageChange,
  onPageSizeChange,
  onGroupChange,
}: {
  serverId: string;
  configRevision: number;
  /** Server-wide tool total; the filtered page total cannot stand in for it. */
  toolCount: number;
  page: number;
  pageSize: PageSize;
  /** `undefined` and `"all"` are unfiltered, `"ungrouped"` is ungrouped, otherwise a group id. */
  group: string | undefined;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
  /** The parent owns the page reset that must accompany a filter change. */
  onGroupChange: (next: string | undefined) => void;
}) {
  const { t } = useTranslations();
  const { data, isLoading, isError, error } = useMcpTools(serverId, {
    page,
    pageSize,
    group,
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
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [curlOpen, setCurlOpen] = useState(false);
  const [openApiOpen, setOpenApiOpen] = useState(false);
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null);
  const [moveToolIds, setMoveToolIds] = useState<string[] | null>(null);

  // Selection belongs to one page/filter scope. A scope change clears it during
  // render so a selection from another page or filter can never be acted on.
  const scopeKey = `${page}:${pageSize}:${group ?? ALL_FILTER}`;
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

  const atCap = toolCount >= MCP_MAX_TOOLS;
  const atGroupLimit =
    groups.length >= MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer;
  const filterActive = group !== undefined && group !== ALL_FILTER;
  const filteredGroup = resolveFilteredGroup(group, groups);
  const groupTargets = filteredGroup ? [filteredGroup] : groups;
  const variableNames = (variables.data ?? []).map((variable) => variable.name);
  const serverValueNameById = Object.fromEntries(
    (variables.data ?? []).map((variable) => [variable.id, variable.name]),
  );
  const variableRefs = (variables.data ?? []).map((variable) => ({
    id: variable.id,
    name: variable.name,
    kind: variable.kind,
  }));
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

  return (
    <div className="space-y-6">
      {atCap ? (
        <Alert>
          <AlertDescription>{t.servers.toolCap}</AlertDescription>
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ToolGroupFilter
            groups={groups}
            value={group}
            onChange={onGroupChange}
            total={filterActive ? undefined : data?.total}
          />
          <Button
            type="button"
            variant="outline"
            disabled={atGroupLimit}
            onClick={() => setGroupDialog({ mode: "create" })}
          >
            {t.servers.groups.create}
          </Button>
          <GroupActionMenu
            label={t.servers.groups.rename}
            groups={groupTargets}
            onSelect={(target) =>
              setGroupDialog({ mode: "rename", group: target })
            }
          />
          <GroupActionMenu
            label={t.servers.groups.delete}
            groups={groupTargets}
            destructive
            onSelect={(target) =>
              setGroupDialog({ mode: "delete", group: target })
            }
          />
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {selectedCountLabel}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setMoveToolIds(selectedIds)}
          >
            <FolderInput className="h-4 w-4" />
            {t.servers.groups.moveTitle}
          </Button>
        </div>
      ) : null}

      {isLoading && !data ? (
        <TableRowsSkeleton />
      ) : isError ? (
        <p className="text-sm text-destructive">
          {resolveErrorMessage(error, t)}
        </p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.servers.noTools}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>{t.servers.toolName}</TableHead>
              <TableHead>{t.servers.method}</TableHead>
              <TableHead>{t.servers.toolPathSummary}</TableHead>
              <TableHead>{t.servers.enabled}</TableHead>
              <TableHead>{t.servers.allowMutation}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((tool) => (
              <TableRow key={tool.id}>
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
                  <Badge variant="outline">{tool.method}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {isClientRequestDefinition(tool.requestDefinition)
                    ? summarizeDefinitionPath(
                        tool.requestDefinition,
                        serverValueNameById,
                      )
                    : ""}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Switch
                      checked={tool.enabled}
                      disabled={
                        updateTool.isPending || tool.compileStatus === "invalid"
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
                  <Switch
                    checked={tool.allowMutation}
                    disabled={updateTool.isPending}
                    onCheckedChange={(allowMutation) => {
                      if (
                        !allowMutation &&
                        tool.allowMutation &&
                        tool.enabled &&
                        !window.confirm(t.servers.mutationConfirmDescription)
                      ) {
                        return;
                      }
                      updateTool.mutate({
                        serverId,
                        toolId: tool.id,
                        expectedRevision: configRevision,
                        allowMutation,
                        enabled: allowMutation ? tool.enabled : false,
                      });
                    }}
                  />
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
                        onSelect={() => setFormState({ kind: "edit", tool })}
                      >
                        <Pencil className="h-4 w-4" />
                        {t.servers.editTool}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          setFormState({ kind: "duplicate", tool })
                        }
                      >
                        <Copy className="h-4 w-4" />
                        {t.servers.duplicateTool}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => setMoveToolIds([tool.id])}
                      >
                        <FolderInput className="h-4 w-4" />
                        {t.servers.groups.moveTitle}
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
      {moveToolIds ? (
        <ToolGroupMoveDialog
          serverId={serverId}
          configRevision={configRevision}
          groups={groups}
          toolIds={moveToolIds}
          onClose={() => {
            setMoveToolIds(null);
            setScopedSelection([]);
          }}
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
    </div>
  );
}
