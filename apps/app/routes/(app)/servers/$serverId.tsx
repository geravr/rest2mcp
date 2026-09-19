import { FeatureErrorBoundary } from "@/components/feature-error-boundary";
import { SettingsFormSkeleton } from "@/components/loading";
import { ServerConnectionTab } from "@/components/servers/connection-tab";
import { ServerLogsTab } from "@/components/servers/logs-tab";
import { ServerPlaygroundTab } from "@/components/servers/playground-tab";
import { ServerIcon } from "@/components/servers/server-icon";
import { ServerSettingsTab } from "@/components/servers/settings-tab";
import { TrafficLightBadge } from "@/components/servers/traffic-light";
import { ServerToolsTab } from "@/components/servers/tools-tab";
import { useMcpServer, useUpdateMcpServer } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import {
  omitPaginationDefaults,
  resolvePaginationSearch,
} from "@/lib/list-search";
import {
  serverDetailSearchSchema,
  serverDetailTabValues,
} from "@/lib/servers-search";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";

export const Route = createFileRoute("/(app)/servers/$serverId")({
  validateSearch: serverDetailSearchSchema,
  component: ServerDetailPage,
});

function ServerDetailPage() {
  const { t } = useTranslations();
  const { serverId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { page, pageSize } = resolvePaginationSearch(search);
  const activeTab = search.tab ?? "tools";
  const { data, isLoading, isError, error } = useMcpServer(serverId);
  const updateServer = useUpdateMcpServer();

  const setTab = (tab: string) => {
    const valid = serverDetailTabValues.includes(
      tab as (typeof serverDetailTabValues)[number],
    )
      ? (tab as (typeof serverDetailTabValues)[number])
      : "tools";
    void navigate({
      search: (prev) =>
        omitPaginationDefaults({
          ...prev,
          tab: valid === "tools" ? undefined : valid,
          page: undefined,
        }),
      replace: true,
    });
  };

  return (
    <FeatureErrorBoundary>
      <div className="space-y-6">
        <div>
          <Link
            to="/servers"
            className="text-sm text-muted-foreground hover:underline"
          >
            {t.servers.backToList}
          </Link>
        </div>

        {isLoading && !data ? (
          <SettingsFormSkeleton cards={1} fields={2} />
        ) : isError ? (
          <p className="text-sm text-destructive">
            {resolveErrorMessage(error, t)}
          </p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">{t.servers.notFound}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <ServerIcon
                  serverId={data.id}
                  iconUrl={data.iconUrl}
                  size="lg"
                />
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight">
                      {data.name}
                    </h1>
                    <TrafficLightBadge value={data.trafficLight} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {data.baseUrl}
                  </p>
                  {data.description ? (
                    <p className="text-sm text-muted-foreground">
                      {data.description}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled={updateServer.isPending}
                  onClick={() =>
                    updateServer.mutate({
                      serverId,
                      expectedRevision: data.configRevision,
                      status: data.status === "paused" ? "live" : "paused",
                    })
                  }
                >
                  {updateServer.isPending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : null}
                  {data.status === "paused"
                    ? t.servers.resume
                    : t.servers.pause}
                </Button>
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={setTab}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <TabsList aria-label={t.servers.tabsWork}>
                  <TabsTrigger value="tools">{t.servers.tools}</TabsTrigger>
                  <TabsTrigger value="playground">
                    {t.servers.playground}
                  </TabsTrigger>
                  <TabsTrigger value="logs">{t.servers.logs}</TabsTrigger>
                </TabsList>
                <TabsList aria-label={t.servers.tabsSetup}>
                  <TabsTrigger value="connection">
                    {t.servers.connection}
                  </TabsTrigger>
                  <TabsTrigger value="settings">
                    {t.servers.settings}
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="tools">
                <ServerToolsTab
                  serverId={serverId}
                  configRevision={data.configRevision}
                  page={page}
                  pageSize={pageSize}
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
                        omitPaginationDefaults({
                          ...prev,
                          pageSize: next,
                          page: 1,
                        }),
                      replace: true,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value="playground">
                <ServerPlaygroundTab
                  serverId={serverId}
                  serverStatus={data.status as "draft" | "live" | "paused"}
                />
              </TabsContent>
              <TabsContent value="logs">
                <ServerLogsTab
                  serverId={serverId}
                  page={page}
                  pageSize={pageSize}
                  selectedLogId={search.log}
                  onClearSelectedLog={() =>
                    void navigate({
                      search: (prev) =>
                        omitPaginationDefaults({ ...prev, log: undefined }),
                      replace: true,
                    })
                  }
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
                        omitPaginationDefaults({
                          ...prev,
                          pageSize: next,
                          page: 1,
                        }),
                      replace: true,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value="connection">
                <ServerConnectionTab
                  key={serverId}
                  serverId={serverId}
                  configRevision={data.configRevision}
                />
              </TabsContent>
              <TabsContent value="settings">
                <ServerSettingsTab
                  key={serverId}
                  server={data}
                  defaultHeaders={data.defaultHeaders}
                  defaultQuery={data.defaultQuery}
                  auth={data.auth}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </FeatureErrorBoundary>
  );
}
