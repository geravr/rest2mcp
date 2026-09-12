import type {
  ObservabilitySettings,
  UpdateObservabilitySettingsInput,
} from "@repo/core";
import { userConfig } from "@repo/db";
import type { TRPCContext } from "../lib/context.js";
import { getObservabilitySettingsForUser } from "../lib/observability-settings.js";

export async function getUserObservabilitySettings(
  ctx: Pick<TRPCContext, "db">,
  userId: string,
): Promise<ObservabilitySettings> {
  return getObservabilitySettingsForUser(ctx.db, userId);
}

export async function updateUserObservabilitySettings(
  ctx: Pick<TRPCContext, "db" | "dbDirect">,
  userId: string,
  input: UpdateObservabilitySettingsInput,
): Promise<ObservabilitySettings> {
  const current = await getObservabilitySettingsForUser(ctx.db, userId);

  const nextConsentStatus = input.consentStatus ?? current.consentStatus;
  const nextSessionReplayEnabled =
    input.sessionReplayEnabled ?? current.sessionReplayEnabled;
  const nextErrorTrackingEnabled =
    input.errorTrackingEnabled ?? current.errorTrackingEnabled;
  const nextConsentUpdatedAt =
    input.consentStatus !== undefined
      ? new Date()
      : current.consentUpdatedAt
        ? new Date(current.consentUpdatedAt)
        : null;

  await ctx.dbDirect
    .insert(userConfig)
    .values({
      userId,
      telemetryConsentStatus: nextConsentStatus,
      telemetrySessionReplayEnabled: nextSessionReplayEnabled,
      telemetryErrorTrackingEnabled: nextErrorTrackingEnabled,
      telemetryConsentUpdatedAt: nextConsentUpdatedAt,
    })
    .onConflictDoUpdate({
      target: userConfig.userId,
      set: {
        telemetryConsentStatus: nextConsentStatus,
        telemetrySessionReplayEnabled: nextSessionReplayEnabled,
        telemetryErrorTrackingEnabled: nextErrorTrackingEnabled,
        telemetryConsentUpdatedAt: nextConsentUpdatedAt,
      },
    });

  return {
    consentStatus: nextConsentStatus,
    sessionReplayEnabled: nextSessionReplayEnabled,
    errorTrackingEnabled: nextErrorTrackingEnabled,
    consentUpdatedAt: nextConsentUpdatedAt?.toISOString() ?? null,
  };
}
