import { FeatureErrorBoundary } from "@/components/feature-error-boundary";
import { AdminListPagination } from "@/components/admin-list";
import { ServerCardsSkeleton } from "@/components/loading";
import { ServerFavicon } from "@/components/servers/server-favicon";
import { TrafficLightBadge } from "@/components/servers/traffic-light";
import {
  useCreateMcpServer,
  useMcpServers,
  useTestMcpConnection,
  useUpdateMcpServer,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { getApiOriginUrl } from "@/lib/api-url";
import { resolveErrorMessage } from "@/lib/errors";
import {
  omitPaginationDefaults,
  resolvePaginationSearch,
} from "@/lib/list-search";
import { formatRelativeTime } from "@/lib/relative-time";
import { serversSearchSchema } from "@/lib/servers-search";
import { isAppErrorCode } from "@repo/core";
import {
  Alert,
  AlertDescription,
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
} from "@repo/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Copy, LoaderCircle, Pause, Play, Plus, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/(app)/servers/")({
  validateSearch: serversSearchSchema,
  component: ServersPage,
});

type CreatedServer = { id: string; name: string };

function ServersPage() {
  const { t, locale } = useTranslations();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { page, pageSize } = resolvePaginationSearch(search);
  const { data, isLoading, isError, error } = useMcpServers({
    page,
    pageSize,
  });
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();
  const testConnection = useTestMcpConnection();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [description, setDescription] = useState("");
  const [created, setCreated] = useState<CreatedServer | null>(null);

  const resetDialog = () => {
    setName("");
    setBaseUrl("");
    setDescription("");
    setCreated(null);
    testConnection.reset();
  };

  const copyMcpUrl = async (serverId: string) => {
    try {
      await navigator.clipboard.writeText(
        `${getApiOriginUrl()}/mcp/${serverId}`,
      );
      toast.success(t.toasts.servers.copied);
    } catch {
      toast.error(t.errors.unexpected);
    }
  };

  const testResult = testConnection.data;
  const testPhrasing = (() => {
    if (!testResult) return null;
    if (testResult.ok && testResult.httpStatus !== null) {
      const status = String(testResult.httpStatus);
      if (testResult.httpStatus === 401 || testResult.httpStatus === 403) {
        return {
          tone: "warning" as const,
          text: t.servers.connectionAuthFailing.replace("{status}", status),
        };
      }
      return {
        tone: "success" as const,
        text: t.servers.connectionReachable.replace("{status}", status),
      };
    }
    const detail =
      testResult.appCode && isAppErrorCode(testResult.appCode)
        ? t.errors.codes[testResult.appCode]
        : t.errors.unexpected;
    return {
      tone: "destructive" as const,
      text: t.servers.connectionUnreachable.replace("{detail}", detail),
    };
  })();

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

        {isLoading && !data ? (
          <ServerCardsSkeleton />
        ) : isError ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-sm text-destructive">
                {resolveErrorMessage(error, t)}
              </p>
            </CardContent>
          </Card>
        ) : !data || data.items.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <h2 className="text-sm font-medium">{t.servers.emptyTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.servers.emptyDescription}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.items.map((server) => (
              <Card key={server.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <ServerFavicon
                      baseUrl={server.baseUrl}
                      name={server.name}
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        to="/servers/$serverId"
                        params={{ serverId: server.id }}
                        className="block truncate font-medium hover:underline"
                      >
                        {server.name}
                      </Link>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {server.baseUrl}
                      </p>
                    </div>
                    <TrafficLightBadge value={server.trafficLight} />
                  </div>
                  <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {server.enabledToolCount === 1
                        ? t.servers.toolCountOne
                        : t.servers.toolCount.replace(
                            "{count}",
                            String(server.enabledToolCount),
                          )}
                    </span>
                    <span>
                      {server.lastCallAt
                        ? formatRelativeTime(
                            new Date(server.lastCallAt),
                            locale,
                          )
                        : t.servers.neverCalled}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 border-t border-border pt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title={t.servers.copyMcpUrl}
                      aria-label={t.servers.copyMcpUrl}
                      onClick={() => void copyMcpUrl(server.id)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title={
                        server.status === "paused"
                          ? t.servers.resume
                          : t.servers.pause
                      }
                      aria-label={
                        server.status === "paused"
                          ? t.servers.resume
                          : t.servers.pause
                      }
                      disabled={updateServer.isPending}
                      onClick={() =>
                        updateServer.mutate({
                          serverId: server.id,
                          status:
                            server.status === "paused" ? "live" : "paused",
                        })
                      }
                    >
                      {server.status === "paused" ? (
                        <Play className="h-4 w-4" />
                      ) : (
                        <Pause className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {data && data.total > 0 ? (
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

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetDialog();
        }}
      >
        <DialogContent>
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>{created.name}</DialogTitle>
                <DialogDescription>
                  {t.servers.createdNextStep}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {testConnection.isPending ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    {t.servers.testingConnection}
                  </p>
                ) : testPhrasing ? (
                  <Alert
                    variant={
                      testPhrasing.tone === "destructive"
                        ? "destructive"
                        : "default"
                    }
                  >
                    <AlertDescription>{testPhrasing.text}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  {t.servers.cancel}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void navigate({
                      to: "/servers/$serverId",
                      params: { serverId: created.id },
                      search: { tab: "tools" },
                    });
                  }}
                >
                  <Wrench className="h-4 w-4" />
                  {t.servers.addFirstTool}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t.servers.createTitle}</DialogTitle>
                <DialogDescription>
                  {t.servers.createDescription}
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  createServer.mutate(
                    {
                      name,
                      baseUrl,
                      ...(description.trim()
                        ? { description: description.trim() }
                        : {}),
                    },
                    {
                      onSuccess: (server) => {
                        setCreated({ id: server.id, name: server.name });
                        testConnection.mutate({ serverId: server.id });
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
                <div className="space-y-2">
                  <Label htmlFor="server-description">
                    {t.servers.descriptionLabel}
                  </Label>
                  <Input
                    id="server-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t.servers.optionalDescription}
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
                    {createServer.isPending
                      ? t.servers.creating
                      : t.servers.create}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </FeatureErrorBoundary>
  );
}
