import { AdminListPagination } from "@/components/admin-list";
import { TableRowsSkeleton } from "@/components/loading";
import {
  useCreateMcpTool,
  useCreateMcpToolFromCurl,
  useMcpTools,
  useUpdateMcpTool,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { MCP_MAX_TOOLS } from "@/lib/mcp-limits";
import type { PageSize } from "@repo/core";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

export function ServerToolsTab({
  serverId,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  serverId: string;
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
  const createTool = useCreateMcpTool();
  const importCurl = useCreateMcpToolFromCurl();
  const updateTool = useUpdateMcpTool();
  const [name, setName] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("GET");
  const [pathTemplate, setPathTemplate] = useState("");
  const [description, setDescription] = useState("");
  const [curl, setCurl] = useState("");
  const atCap = (data?.total ?? 0) >= MCP_MAX_TOOLS;

  return (
    <div className="space-y-6">
      {atCap ? (
        <Alert>
          <AlertDescription>{t.servers.toolCap}</AlertDescription>
        </Alert>
      ) : null}

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          createTool.mutate(
            { serverId, name, method, pathTemplate, description },
            {
              onSuccess: () => {
                setName("");
                setPathTemplate("");
                setDescription("");
              },
            },
          );
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="tool-name">{t.servers.toolName}</Label>
          <Input
            id="tool-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.servers.toolNamePlaceholder}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tool-method">{t.servers.method}</Label>
          <select
            id="tool-method"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={method}
            onChange={(event) =>
              setMethod(event.target.value as (typeof METHODS)[number])
            }
          >
            {METHODS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="tool-path">{t.servers.pathTemplate}</Label>
          <Input
            id="tool-path"
            value={pathTemplate}
            onChange={(event) => setPathTemplate(event.target.value)}
            placeholder={t.servers.pathPlaceholder}
            required
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="tool-description">{t.servers.descriptionLabel}</Label>
          <Input
            id="tool-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t.servers.optionalDescription}
          />
        </div>
        <Button type="submit" disabled={createTool.isPending || atCap}>
          {createTool.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : null}
          {createTool.isPending ? t.servers.savingTool : t.servers.addTool}
        </Button>
      </form>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          importCurl.mutate(
            { serverId, curl },
            { onSuccess: () => setCurl("") },
          );
        }}
      >
        <Label htmlFor="tool-curl">{t.servers.curlLabel}</Label>
        <Textarea
          id="tool-curl"
          value={curl}
          onChange={(event) => setCurl(event.target.value)}
          placeholder={t.servers.curlPlaceholder}
          rows={4}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={importCurl.isPending || atCap}
        >
          {importCurl.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : null}
          {t.servers.importCurl}
        </Button>
      </form>

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
              <TableHead>{t.servers.pathTemplate}</TableHead>
              <TableHead>{t.servers.enabled}</TableHead>
              <TableHead>{t.servers.allowMutation}</TableHead>
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
                  {tool.pathTemplate}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={tool.enabled}
                    disabled={updateTool.isPending}
                    onCheckedChange={(enabled) =>
                      updateTool.mutate({
                        serverId,
                        toolId: tool.id,
                        enabled,
                        allowMutation: tool.allowMutation,
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Switch
                    checked={tool.allowMutation}
                    disabled={updateTool.isPending}
                    onCheckedChange={(allowMutation) =>
                      updateTool.mutate({
                        serverId,
                        toolId: tool.id,
                        allowMutation,
                        enabled: allowMutation ? tool.enabled : false,
                      })
                    }
                  />
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
  );
}
