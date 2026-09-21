import type { AiCapabilityProfileId, AiReadiness } from "@repo/core";
import { Link } from "@tanstack/react-router";
import { useAiReadiness } from "@/hooks/use-ai";
import { useTranslations } from "@/i18n/use-translations";

/**
 * Reusable readiness contract for AI features. Controls stay disabled until
 * the server reports a current verified selection for the capability profile.
 */
export function useAiFeatureReadiness(
  capabilityProfile: AiCapabilityProfileId,
): {
  ready: boolean;
  reason: AiReadiness["reason"];
  isLoading: boolean;
} {
  const readiness = useAiReadiness(capabilityProfile);
  return {
    ready: readiness.data?.ready ?? false,
    reason: readiness.data?.reason ?? null,
    isLoading: readiness.isLoading,
  };
}

/**
 * Muted call-to-action shown while the capability profile is not ready. Renders
 * nothing while loading or once the profile becomes ready. Pass `guidance` to
 * specialize the copy for a specific AI feature.
 */
export function AiSettingsCta({
  capabilityProfile,
  guidance,
}: {
  capabilityProfile: AiCapabilityProfileId;
  guidance?: string;
}) {
  const { t } = useTranslations();
  const { ready, isLoading } = useAiFeatureReadiness(capabilityProfile);

  if (isLoading || ready) return null;

  return (
    <div className="space-y-1 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
      <p>{guidance ?? t.settings.ai.cta.guidance}</p>
      <Link
        to="/settings"
        search={{ tab: "ai" }}
        className="text-foreground underline underline-offset-4"
      >
        {t.settings.ai.cta.link}
      </Link>
    </div>
  );
}
