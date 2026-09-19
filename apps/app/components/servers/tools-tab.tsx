import { AdminListPagination } from "@/components/admin-list";
import { TableRowsSkeleton } from "@/components/loading";
import { CurlImportDialog } from "@/components/servers/curl-import-dialog";
import { DeleteToolDialog } from "@/components/servers/delete-tool-dialog";
import {
  ToolFormDialog,
  type ToolFormTool,
} from "@/components/servers/tool-form-dialog";
import {
  useMcpTools,
  useMcpVariables,
  useUpdateMcpTool,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { MCP_MAX_TOOLS } from "@/lib/mcp-limits";
import {
  isClientRequestDefinition,
  summarizeDefinitionPath,
} from "@/lib/request-definition";
import type { PageSize } from "@repo/core";
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
import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type FormState =
  | { kind: "create" }
  | { kind: "edit"; tool: ToolFormTool }
  | { kind: "duplicate"; tool: ToolFormTool }
  | null;

export function ServerToolsTab({
  serverId,
  configRevision,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  serverId: string;
  configRevision: number;
  page: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
}) {
  const { t } = useTranslations();
  const { data, isLoading, isError, error } = useMcpTools(serverId, {
    page,
    pageSize,
  });
  const variables = useMcpVariables(serverId);
  const updateTool = useUpdateMcpTool();
  const [formState, setFormState] = useState<FormState>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [curlOpen, setCurlOpen] = useState(false);
  const atCap = (data?.total ?? 0) >= MCP_MAX_TOOLS;
  const variableNames = (variables.data ?? []).map((variable) => variable.name);
  const serverValueNameById = Object.fromEntries(
    (variables.data ?? []).map((variable) => [variable.id, variable.name]),
  );
  const variableRefs = (variables.data ?? []).map((variable) => ({
    id: variable.id,
    name: variable.name,
    kind: variable.kind,
  }));

  return (
    <div className="space-y-6">
      {atCap ? (
        <Alert>
          <AlertDescription>{t.servers.toolCap}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
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
      </div>

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
          onClose={() => setCurlOpen(false)}
        />
      ) : null}
    </div>
  );
}
