import { FeatureErrorBoundary } from "@/components/feature-error-boundary";
import { AdminListPagination } from "@/components/admin-list";
import { TableRowsSkeleton } from "@/components/loading";
import { TrafficLightBadge } from "@/components/servers/traffic-light";
import { useCreateMcpServer, useMcpServers } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import {
  omitPaginationDefaults,
  resolvePaginationSearch,
} from "@/lib/list-search";
import { serversSearchSchema } from "@/lib/servers-search";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/(app)/servers/")({
  validateSearch: serversSearchSchema,
  component: ServersPage,
});

function ServersPage() {
  const { t } = useTranslations();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { page, pageSize } = resolvePaginationSearch(search);
  const { data, isLoading, isError, error } = useMcpServers({
    page,
    pageSize,
  });
  const createServer = useCreateMcpServer();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  return (
    <FeatureErrorBoundary>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t.servers.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.servers.description}
            </p>
          </div>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t.servers.create}
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading && !data ? (
              <div className="p-4">
                <TableRowsSkeleton />
              </div>
            ) : isError ? (
              <div className="p-8 text-center">
                <p className="text-sm text-destructive">
                  {resolveErrorMessage(error, t)}
                </p>
              </div>
            ) : !data || data.items.length === 0 ? (
              <div className="p-8 text-center">
                <h2 className="text-sm font-medium">{t.servers.emptyTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t.servers.emptyDescription}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.servers.name}</TableHead>
                    <TableHead>{t.servers.baseUrl}</TableHead>
                    <TableHead>{t.servers.traffic}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((server) => (
                    <TableRow key={server.id}>
                      <TableCell>
                        <Link
                          to="/servers/$serverId"
                          params={{ serverId: server.id }}
                          className="font-medium hover:underline"
                        >
                          {server.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {server.baseUrl}
                      </TableCell>
                      <TableCell>
                        <TrafficLightBadge value={server.trafficLight} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {data ? (
          <AdminListPagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            itemCount={data.items.length}
            onPageChange={(next) =>
              void navigate({
                search: (prev) =>
                  omitPaginationDefaults({ ...prev, page: next }),
                replace: true,
              })
            }
            onPageSizeChange={(next) =>
              void navigate({
                search: (prev) =>
                  omitPaginationDefaults({ ...prev, pageSize: next, page: 1 }),
                replace: true,
              })
            }
          />
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.servers.createTitle}</DialogTitle>
            <DialogDescription>{t.servers.createDescription}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createServer.mutate(
                { name, baseUrl },
                {
                  onSuccess: (server) => {
                    setOpen(false);
                    setName("");
                    setBaseUrl("");
                    void navigate({
                      to: "/servers/$serverId",
                      params: { serverId: server.id },
                    });
                  },
                },
              );
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="server-name">{t.servers.name}</Label>
              <Input
                id="server-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.servers.namePlaceholder}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-base">{t.servers.baseUrl}</Label>
              <Input
                id="server-base"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={t.servers.baseUrlPlaceholder}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t.servers.cancel}
              </Button>
              <Button type="submit" disabled={createServer.isPending}>
                {createServer.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {createServer.isPending ? t.servers.creating : t.servers.create}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </FeatureErrorBoundary>
  );
}
