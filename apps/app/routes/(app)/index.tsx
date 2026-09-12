import { FeatureErrorBoundary } from "@/components/feature-error-boundary";
import { useTranslations } from "@/i18n/use-translations";
import { useSessionQuery } from "@/lib/queries/session";
import { Button, Card, CardContent } from "@repo/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Lock, Settings, User, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/(app)/")({
  component: Dashboard,
});

function Dashboard() {
  const { t } = useTranslations();
  const { data: session } = useSessionQuery();
  const userName = session?.user?.name ?? t.dashboard.userFallback;

  const quickActions = [
    {
      title: t.dashboard.quickActions.profile.title,
      description: t.dashboard.quickActions.profile.description,
      manage: t.dashboard.quickActions.profile.manage,
      icon: User,
      to: "/settings",
      search: { tab: "profile" as const },
    },
    {
      title: t.dashboard.quickActions.security.title,
      description: t.dashboard.quickActions.security.description,
      manage: t.dashboard.quickActions.security.manage,
      icon: Lock,
      to: "/settings",
      search: { tab: "security" as const },
    },
    {
      title: t.dashboard.quickActions.privacy.title,
      description: t.dashboard.quickActions.privacy.description,
      manage: t.dashboard.quickActions.privacy.manage,
      icon: ShieldCheck,
      to: "/settings",
      search: { tab: "privacy" as const },
    },
  ];

  return (
    <FeatureErrorBoundary>
      <div className="space-y-6 pb-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t.dashboard.greeting.replace("{name}", userName)}
          </h1>
          <p className="text-sm text-muted-foreground">{t.dashboard.welcome}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Card
                key={action.title}
                className="transition-colors hover:bg-muted/50"
              >
                <CardContent className="p-5">
                  <div className="space-y-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-sm font-medium text-foreground">
                        {action.title}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {action.description}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 px-0"
                      asChild
                    >
                      <Link to={action.to} search={action.search}>
                        {action.manage} <ArrowRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <Settings className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">
                  {t.dashboard.gettingStarted.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t.dashboard.gettingStarted.description}{" "}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {t.dashboard.gettingStarted.routesPath}
                  </code>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </FeatureErrorBoundary>
  );
}
