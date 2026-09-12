import {
  useObservabilitySettingsQuery,
  useUpdateObservabilitySettings,
} from "@/hooks/use-observability";
import { useTranslations } from "@/i18n/use-translations";
import { isPostHogConsentRequired, isPostHogEnabled } from "@/lib/posthog";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

export function ObservabilityConsentBanner() {
  const { t } = useTranslations();
  const { data, isLoading, isError } = useObservabilitySettingsQuery();
  const updateSettings = useUpdateObservabilitySettings();
  const [pendingDecision, setPendingDecision] = useState<
    "denied" | "granted" | null
  >(null);

  if (
    !isPostHogEnabled() ||
    !isPostHogConsentRequired() ||
    isLoading ||
    isError ||
    !data ||
    data.consentStatus !== "pending"
  ) {
    return null;
  }

  async function handleDecision(consentStatus: "denied" | "granted") {
    setPendingDecision(consentStatus);

    try {
      await updateSettings.mutateAsync({ consentStatus });
    } finally {
      setPendingDecision(null);
    }
  }

  const isPending = updateSettings.isPending;

  return (
    <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-50 md:bottom-4 md:left-auto md:w-full md:max-w-lg">
      <Card className="border-border bg-background/95 shadow-2xl backdrop-blur">
        <CardHeader>
          <CardTitle className="text-sm">
            {t.settings.privacy.consentBannerTitle}
          </CardTitle>
          <CardDescription>
            {t.settings.privacy.consentBannerDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="sm:flex-1"
            disabled={isPending}
            onClick={() => {
              void handleDecision("granted");
            }}
          >
            {pendingDecision === "granted" && (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            )}
            {t.settings.privacy.allowObservability}
          </Button>
          <Button
            variant="ghost"
            className="sm:flex-1"
            disabled={isPending}
            onClick={() => {
              void handleDecision("denied");
            }}
          >
            {pendingDecision === "denied" && (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            )}
            {t.settings.privacy.declineObservability}
          </Button>
          <Button variant="outline" className="sm:flex-1" asChild>
            <Link to="/settings" search={{ tab: "privacy" }}>
              {t.settings.privacy.goToSettings}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
