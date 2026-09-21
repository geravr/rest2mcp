import { describe, expect, it } from "vitest";
import {
  AI_CAPABILITY_PROFILES,
  AI_MODEL_PROTOCOLS,
  AI_PROVIDER_KINDS,
  AI_SELECTION_STALE_REASONS,
  type AiCapabilityProfileId,
} from "@repo/core";
import {
  evaluateSelectionCurrentness,
  type AiCurrentSelectionState,
} from "./readiness.js";
import {
  buildCapabilitySnapshot,
  computeVerificationFingerprint,
  type AiCapabilitySnapshot,
  type AiFingerprintInput,
} from "./verification.js";

const BASE_FINGERPRINT_INPUT: AiFingerprintInput = {
  providerKind: AI_PROVIDER_KINDS.OPENAI,
  credentialRevision: 3,
  adapterVersion: 5,
  modelId: "model-a",
  protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
  routeOrigin: "https://api.example.com",
  profileId: AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.id,
  profileVersion: AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.version,
};

const BASE_SNAPSHOT = buildCapabilitySnapshot({
  contextWindowTokens: 16_384,
  fingerprintInput: BASE_FINGERPRINT_INPUT,
});

const BASE_FINGERPRINT = computeVerificationFingerprint(BASE_FINGERPRINT_INPUT);

const BASE_CURRENT: AiCurrentSelectionState = {
  providerKind: AI_PROVIDER_KINDS.OPENAI,
  credentialRevision: 3,
  adapterVersion: 5,
};

function evaluate(
  overrides: {
    snapshot?: AiCapabilitySnapshot | null;
    storedFingerprint?: string;
    profileId?: AiCapabilityProfileId;
    current?: Partial<AiCurrentSelectionState>;
  } = {},
) {
  return evaluateSelectionCurrentness({
    snapshot:
      overrides.snapshot !== undefined ? overrides.snapshot : BASE_SNAPSHOT,
    storedFingerprint: overrides.storedFingerprint ?? BASE_FINGERPRINT,
    profileId:
      overrides.profileId ?? AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.id,
    current: { ...BASE_CURRENT, ...overrides.current },
  });
}

describe("evaluateSelectionCurrentness", () => {
  it("keeps a selection current when snapshot and state agree", () => {
    expect(evaluate()).toEqual({ current: true });
  });

  it("reports credential rotation", () => {
    expect(evaluate({ current: { credentialRevision: 4 } })).toEqual({
      current: false,
      reason: AI_SELECTION_STALE_REASONS.CREDENTIAL_ROTATED,
    });
  });

  it("reports adapter changes", () => {
    expect(evaluate({ current: { adapterVersion: 6 } })).toEqual({
      current: false,
      reason: AI_SELECTION_STALE_REASONS.ADAPTER_CHANGED,
    });
  });

  it("reports capability profile version changes", () => {
    const staleInput = { ...BASE_FINGERPRINT_INPUT, profileVersion: 2 };
    expect(
      evaluate({
        snapshot: buildCapabilitySnapshot({
          contextWindowTokens: 16_384,
          fingerprintInput: staleInput,
        }),
        storedFingerprint: computeVerificationFingerprint(staleInput),
      }),
    ).toEqual({
      current: false,
      reason: AI_SELECTION_STALE_REASONS.PROFILE_CHANGED,
    });
  });

  it("reports an unknown capability profile", () => {
    const unknownProfileId = "structured-text-v2" as AiCapabilityProfileId;
    expect(evaluate({ profileId: unknownProfileId })).toEqual({
      current: false,
      reason: AI_SELECTION_STALE_REASONS.PROFILE_CHANGED,
    });
  });

  it("reports a live route protocol change", () => {
    expect(
      evaluate({
        current: {
          liveRoute: {
            protocol: AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
            origin: BASE_FINGERPRINT_INPUT.routeOrigin,
          },
        },
      }),
    ).toEqual({
      current: false,
      reason: AI_SELECTION_STALE_REASONS.ROUTE_CHANGED,
    });
  });

  it("reports a live route origin change", () => {
    expect(
      evaluate({
        current: {
          liveRoute: {
            protocol: BASE_FINGERPRINT_INPUT.protocol,
            origin: "https://other.example.com",
          },
        },
      }),
    ).toEqual({
      current: false,
      reason: AI_SELECTION_STALE_REASONS.ROUTE_CHANGED,
    });
  });

  it("keeps a selection current when no live route metadata exists", () => {
    expect(evaluate({ current: { liveRoute: null } })).toEqual({
      current: true,
    });
  });

  it("reports a removed model", () => {
    expect(evaluate({ current: { modelPresent: false } })).toEqual({
      current: false,
      reason: AI_SELECTION_STALE_REASONS.MODEL_REMOVED,
    });
  });

  it("keeps a selection current when model presence is unknown", () => {
    expect(evaluate({ current: { modelPresent: undefined } })).toEqual({
      current: true,
    });
  });

  it("reports a tampered stored fingerprint", () => {
    const tampered = `deadbeef${BASE_FINGERPRINT.slice(8)}`;
    expect(tampered).not.toBe(BASE_FINGERPRINT);
    expect(evaluate({ storedFingerprint: tampered })).toEqual({
      current: false,
      reason: AI_SELECTION_STALE_REASONS.CONFIG_CHANGED,
    });
  });

  it("reports a missing snapshot as a configuration change", () => {
    expect(evaluate({ snapshot: null })).toEqual({
      current: false,
      reason: AI_SELECTION_STALE_REASONS.CONFIG_CHANGED,
    });
  });
});
