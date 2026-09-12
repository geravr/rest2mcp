import { AdminListPagination } from "@/components/admin-list";
import { TableRowsSkeleton } from "@/components/loading";
import { CopyButton } from "@/components/servers/copy-button";
import { useMcpCallLogs } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import type { PageSize } from "@repo/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui";
import { useState } from "react";

function formatSummary(value: string | null): string {
  if (!value) return "—";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function ServerLogsTab({
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
  const { data, isLoading, isError, error } = useMcpCallLogs(serverId, {
    page,
    pageSize,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = data?.items.find((log) => log.id === selectedId) ?? null;

  if (isLoading && !data) {
    return <TableRowsSkeleton />;
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {resolveErrorMessage(error, t)}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!data || data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.servers.noLogs}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.servers.source}</TableHead>
              <TableHead>{t.servers.status}</TableHead>
              <TableHead>{t.servers.httpStatus}</TableHead>
              <TableHead>{t.servers.duration}</TableHead>
              <TableHead>{t.servers.created}</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">{t.servers.viewLog}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((log) => (
              <TableRow
                key={log.id}
                className="cursor-pointer"
                onClick={() => setSelectedId(log.id)}
              >
                <TableCell>{log.source}</TableCell>
                <TableCell>{log.status}</TableCell>
                <TableCell>{log.httpStatus ?? "—"}</TableCell>
                <TableCell>
                  {log.durationMs !== null ? `${log.durationMs}ms` : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(log.id);
                    }}
                  >
                    {t.servers.viewLog}
                  </Button>
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

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.servers.logDetail}</DialogTitle>
            <DialogDescription>
              {t.servers.logDetailDescription}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t.servers.source}</dt>
                  <dd>{selected.source}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t.servers.status}</dt>
                  <dd>{selected.status}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t.servers.httpStatus}
                  </dt>
                  <dd>{selected.httpStatus ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {t.servers.duration}
                  </dt>
                  <dd>
                    {selected.durationMs !== null
                      ? `${selected.durationMs}ms`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t.servers.created}</dt>
                  <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t.servers.appCode}</dt>
                  <dd>{selected.appCode ?? "—"}</dd>
                </div>
              </dl>
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{t.servers.request}</h3>
                  {selected.requestSummary ? (
                    <CopyButton
                      value={formatSummary(selected.requestSummary)}
                    />
                  ) : null}
                </div>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                  {formatSummary(selected.requestSummary)}
                </pre>
              </section>
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{t.servers.response}</h3>
                  {selected.responseSummary ? (
                    <CopyButton
                      value={formatSummary(selected.responseSummary)}
                    />
                  ) : null}
                </div>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
                  {formatSummary(selected.responseSummary)}
                </pre>
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
