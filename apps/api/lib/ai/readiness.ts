/**
 * Readiness resolution for stored model selections. Compares the persisted
 * fingerprint snapshot against current server-side state (connection
 * credential revision, registry adapter version, capability-profile version,
 * and optionally the live resolved route). Transient provider failures never
 * reach this module: they cannot erase a valid selection.
 */
import {
  AI_CAPABILITY_PROFILES,
  AI_SELECTION_STALE_REASONS,
  type AiCapabilityProfileId,
  type AiProviderKind,
  type AiSelectionStaleReason,
} from "@repo/core";
import type { AiCapabilitySnapshot } from "./verification.js";
import { computeVerificationFingerprint } from "./verification.js";

export type AiCurrentSelectionState = {
  providerKind: AiProviderKind;
  credentialRevision: number;
  adapterVersion: number;
  liveRoute?: { protocol: string; origin: string } | null;
  modelPresent?: boolean;
};

export type AiSelectionCurrentness = {
  current: boolean;
  reason?: AiSelectionStaleReason;
};

/**
 * Decides whether a stored selection still satisfies readiness. `liveRoute`
 * is supplied only when fresh discovery metadata exists; `modelPresent` is
 * false when the provider authoritatively no longer lists the model.
 */
export function evaluateSelectionCurrentness(input: {
  snapshot: AiCapabilitySnapshot | null;
  storedFingerprint: string;
  profileId: AiCapabilityProfileId;
  current: AiCurrentSelectionState;
}): AiSelectionCurrentness {
  const snapshot = input.snapshot;
  if (!snapshot) {
    return {
      current: false,
      reason: AI_SELECTION_STALE_REASONS.CONFIG_CHANGED,
    };
  }
  const stored = snapshot.fingerprintInput;
  const profile = Object.values(AI_CAPABILITY_PROFILES).find(
    (candidate) => candidate.id === input.profileId,
  );
  if (!profile || stored.profileId !== input.profileId) {
    return {
      current: false,
      reason: AI_SELECTION_STALE_REASONS.PROFILE_CHANGED,
    };
  }
  if (stored.credentialRevision !== input.current.credentialRevision) {
    return {
      current: false,
      reason: AI_SELECTION_STALE_REASONS.CREDENTIAL_ROTATED,
    };
  }
  if (stored.adapterVersion !== input.current.adapterVersion) {
    return {
      current: false,
      reason: AI_SELECTION_STALE_REASONS.ADAPTER_CHANGED,
    };
  }
  if (stored.profileVersion !== profile.version) {
    return {
      current: false,
      reason: AI_SELECTION_STALE_REASONS.PROFILE_CHANGED,
    };
  }
  if (input.current.modelPresent === false) {
    return { current: false, reason: AI_SELECTION_STALE_REASONS.MODEL_REMOVED };
  }
  if (
    input.current.liveRoute &&
    (input.current.liveRoute.protocol !== stored.protocol ||
      input.current.liveRoute.origin !== stored.routeOrigin)
  ) {
    return { current: false, reason: AI_SELECTION_STALE_REASONS.ROUTE_CHANGED };
  }
  const recomputed = computeVerificationFingerprint({
    providerKind: stored.providerKind,
    credentialRevision: stored.credentialRevision,
    adapterVersion: stored.adapterVersion,
    modelId: stored.modelId,
    protocol: stored.protocol,
    routeOrigin: stored.routeOrigin,
    profileId: stored.profileId,
    profileVersion: stored.profileVersion,
  });
  if (recomputed !== input.storedFingerprint) {
    return {
      current: false,
      reason: AI_SELECTION_STALE_REASONS.CONFIG_CHANGED,
    };
  }
  return { current: true };
}
