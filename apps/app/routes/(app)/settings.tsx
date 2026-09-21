import { FeatureErrorBoundary } from "@/components/feature-error-boundary";
import { AiSettingsTab } from "@/components/settings/ai-tab";
import { ObservabilitySettingsTab } from "@/components/settings/observability-tab";
import { PlatformTokenTab } from "@/components/settings/platform-token-tab";
import { ProfileSettingsTab } from "@/components/settings/profile-tab";
import { SecuritySettingsTab } from "@/components/settings/security-tab";
import { useTranslations } from "@/i18n/use-translations";
import { settingsSearchSchema, settingsTabValues } from "@/lib/settings-search";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/settings")({
  validateSearch: settingsSearchSchema,
  component: Settings,
});

function Settings() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useTranslations();
  const activeTab = search.tab ?? "profile";

  const handleTabChange = (tab: string) => {
    const validTab = settingsTabValues.includes(
      tab as (typeof settingsTabValues)[number],
    )
      ? (tab as (typeof settingsTabValues)[number])
      : "profile";
    navigate({
      to: "/settings",
      replace: true,
      search: validTab === "profile" ? {} : { tab: validTab },
    });
  };

  return (
    <FeatureErrorBoundary>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {t.settings.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.settings.description}
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="profile">{t.settings.tabProfile}</TabsTrigger>
            <TabsTrigger value="security">{t.settings.tabSecurity}</TabsTrigger>
            <TabsTrigger value="privacy">{t.settings.tabPrivacy}</TabsTrigger>
            <TabsTrigger value="platform">{t.settings.tabPlatform}</TabsTrigger>
            <TabsTrigger value="ai">{t.settings.tabAi}</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileSettingsTab />
          </TabsContent>
          <TabsContent value="security">
            <SecuritySettingsTab />
          </TabsContent>
          <TabsContent value="privacy">
            <ObservabilitySettingsTab />
          </TabsContent>
          <TabsContent value="platform">
            <PlatformTokenTab />
          </TabsContent>
          <TabsContent value="ai">
            <AiSettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </FeatureErrorBoundary>
  );
}
