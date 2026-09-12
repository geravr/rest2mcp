import { SettingsFormSkeleton } from "@/components/loading";
import {
  useObservabilitySettingsQuery,
  useUpdateObservabilitySettings,
} from "@/hooks/use-observability";
import { useTranslations } from "@/i18n/use-translations";
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldHint,
  Label,
  Separator,
  Switch,
} from "@repo/ui";
import { resolveErrorMessage } from "@/lib/errors";
import { isPostHogEnabled } from "@/lib/posthog";
import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";

type PendingTarget =
  | "consent-denied"
  | "consent-granted"
  | "error-tracking"
  | "session-replay"
  | null;

function getConsentLabel(
  status: "denied" | "granted" | "pending",
  t: ReturnType<typeof useTranslations>["t"],
) {
  if (status === "granted") {
    return t.settings.privacy.allowed;
  }

  if (status === "denied") {
    return t.settings.privacy.disabled;
  }

  return t.settings.privacy.pending;
}

function getConsentDescription(
  status: "denied" | "granted" | "pending",
  t: ReturnType<typeof useTranslations>["t"],
) {
  if (status === "granted") {
    return t.settings.privacy.consentDescriptionAllowed;
  }

  if (status === "denied") {
    return t.settings.privacy.consentDescriptionDisabled;
  }

  return t.settings.privacy.consentDescriptionPending;
}

export function ObservabilitySettingsTab() {
  const { t, locale } = useTranslations();
  const { data, isLoading, isError, error } = useObservabilitySettingsQuery();
  const updateSettings = useUpdateObservabilitySettings();
  const [pendingTarget, setPendingTarget] = useState<PendingTarget>(null);

  const formattedUpdatedAt = useMemo(() => {
    if (!data?.consentUpdatedAt) {
      return null;
    }

    const timestamp = new Date(data.consentUpdatedAt);
    if (Number.isNaN(timestamp.getTime())) {
      return null;
    }

    return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(timestamp);
  }, [data?.consentUpdatedAt, locale]);

  async function handleUpdate(
    input: {
      consentStatus?: "denied" | "granted";
      errorTrackingEnabled?: boolean;
      sessionReplayEnabled?: boolean;
    },
    target: Exclude<PendingTarget, null>,
  ) {
    setPendingTarget(target);

    try {
      await updateSettings.mutateAsync(input);
    } finally {
      setPendingTarget(null);
    }
  }

  if (isLoading && !data) {
    return <SettingsFormSkeleton cards={1} fields={3} />;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {resolveErrorMessage(error, t) || t.settings.privacy.errorDescription}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            {t.settings.privacy.unavailableDescription}
          </p>
        </CardHeader>
      </Card>
    );
  }

  const consentGranted = data.consentStatus === "granted";
  const isPending = updateSettings.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.privacy.title}</CardTitle>
        <CardDescription>
          {t.settings.privacy.consentBannerDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 pr-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="observability-consent">
                {t.settings.privacy.consentStatus}
              </Label>
              {(pendingTarget === "consent-granted" ||
                pendingTarget === "consent-denied") && (
                <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {data.consentStatus === "pending" ? (
                <Badge variant="outline">
                  {getConsentLabel(data.consentStatus, t)}
                </Badge>
              ) : null}
            </div>
            <FieldHint>
              {getConsentDescription(data.consentStatus, t)}
            </FieldHint>
            {formattedUpdatedAt && (
              <p className="text-xs text-muted-foreground">
                {t.settings.privacy.lastUpdated.replace(
                  "{date}",
                  formattedUpdatedAt,
                )}
              </p>
            )}
          </div>
          <Switch
            id="observability-consent"
            checked={consentGranted}
            disabled={isPending}
            onCheckedChange={(checked) => {
              void handleUpdate(
                { consentStatus: checked ? "granted" : "denied" },
                checked ? "consent-granted" : "consent-denied",
              );
            }}
          />
        </div>

        {!isPostHogEnabled() && (
          <p className="text-sm text-muted-foreground">
            {t.settings.privacy.browserKeyMissing}
          </p>
        )}

        <Separator />

        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 pr-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="observability-error-tracking">
                  {t.settings.privacy.errorTracking}
                </Label>
                {pendingTarget === "error-tracking" && (
                  <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              <FieldHint>
                {t.settings.privacy.errorTrackingDescription}
              </FieldHint>
            </div>
            <Switch
              id="observability-error-tracking"
              checked={data.errorTrackingEnabled}
              disabled={!consentGranted || isPending}
              onCheckedChange={(checked) => {
                void handleUpdate(
                  { errorTrackingEnabled: checked },
                  "error-tracking",
                );
              }}
            />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 pr-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="observability-session-replay">
                  {t.settings.privacy.sessionReplay}
                </Label>
                {pendingTarget === "session-replay" && (
                  <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              <FieldHint>
                {t.settings.privacy.sessionReplayDescription}
              </FieldHint>
            </div>
            <Switch
              id="observability-session-replay"
              checked={data.sessionReplayEnabled}
              disabled={!consentGranted || isPending}
              onCheckedChange={(checked) => {
                void handleUpdate(
                  { sessionReplayEnabled: checked },
                  "session-replay",
                );
              }}
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {t.settings.privacy.privacyDefaults}{" "}
          </span>
          {t.settings.privacy.privacyDefaultsDescription}
        </p>
      </CardContent>
    </Card>
  );
}
