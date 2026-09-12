import type { ObservabilitySettings } from "@repo/core";
import type { DatabaseSchema } from "@repo/db";
import { userConfig } from "@repo/db";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type ObservabilitySettingsRecord = {
  telemetryConsentStatus: string;
  telemetrySessionReplayEnabled: boolean;
  telemetryErrorTrackingEnabled: boolean;
  telemetryConsentUpdatedAt: Date | null;
};

export const DEFAULT_OBSERVABILITY_SETTINGS: ObservabilitySettings = {
  consentStatus: "pending",
  sessionReplayEnabled: true,
  errorTrackingEnabled: true,
  consentUpdatedAt: null,
};

export function mapObservabilitySettingsRecord(
  config?: ObservabilitySettingsRecord | null,
): ObservabilitySettings {
  if (!config) {
    return DEFAULT_OBSERVABILITY_SETTINGS;
  }

  return {
    consentStatus:
      config.telemetryConsentStatus === "granted" ||
      config.telemetryConsentStatus === "denied"
        ? config.telemetryConsentStatus
        : "pending",
    sessionReplayEnabled: config.telemetrySessionReplayEnabled,
    errorTrackingEnabled: config.telemetryErrorTrackingEnabled,
    consentUpdatedAt: config.telemetryConsentUpdatedAt?.toISOString() ?? null,
  };
}

export async function getObservabilitySettingsForUser(
  db: PostgresJsDatabase<DatabaseSchema>,
  userId: string,
): Promise<ObservabilitySettings> {
  const [config] = await db
    .select({
      telemetryConsentStatus: userConfig.telemetryConsentStatus,
      telemetrySessionReplayEnabled: userConfig.telemetrySessionReplayEnabled,
      telemetryErrorTrackingEnabled: userConfig.telemetryErrorTrackingEnabled,
      telemetryConsentUpdatedAt: userConfig.telemetryConsentUpdatedAt,
    })
    .from(userConfig)
    .where(eq(userConfig.userId, userId))
    .limit(1);

  return mapObservabilitySettingsRecord(config ?? null);
}

export function isObservabilityConsentGranted(
  settings: ObservabilitySettings,
): boolean {
  return settings.consentStatus === "granted";
}

export function canCaptureUserErrorTracking(
  settings: ObservabilitySettings,
): boolean {
  return (
    isObservabilityConsentGranted(settings) && settings.errorTrackingEnabled
  );
}
