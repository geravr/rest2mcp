import { describe, expect, it } from "vitest";
import {
  AI_CAPABILITY_PROFILES,
  AI_MODEL_PROTOCOLS,
  AI_PROVIDER_KINDS,
} from "@repo/core";
import {
  buildCapabilitySnapshot,
  computeVerificationFingerprint,
  parseCapabilitySnapshot,
  type AiFingerprintInput,
} from "./verification.js";

const BASE_INPUT: AiFingerprintInput = {
  providerKind: AI_PROVIDER_KINDS.OPENAI,
  credentialRevision: 3,
  adapterVersion: 5,
  modelId: "model-a",
  protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
  routeOrigin: "https://api.example.com",
  profileId: AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.id,
  profileVersion: AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.version,
};

describe("computeVerificationFingerprint", () => {
  it("is deterministic and 64 hex characters long", () => {
    const first = computeVerificationFingerprint(BASE_INPUT);
    const second = computeVerificationFingerprint(BASE_INPUT);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of property order", () => {
    const reordered: AiFingerprintInput = {
      profileVersion: BASE_INPUT.profileVersion,
      profileId: BASE_INPUT.profileId,
      routeOrigin: BASE_INPUT.routeOrigin,
      protocol: BASE_INPUT.protocol,
      modelId: BASE_INPUT.modelId,
      adapterVersion: BASE_INPUT.adapterVersion,
      credentialRevision: BASE_INPUT.credentialRevision,
      providerKind: BASE_INPUT.providerKind,
    };
    expect(computeVerificationFingerprint(reordered)).toBe(
      computeVerificationFingerprint(BASE_INPUT),
    );
  });

  const mutations: Array<[string, AiFingerprintInput]> = [
    [
      "providerKind",
      { ...BASE_INPUT, providerKind: AI_PROVIDER_KINDS.ANTHROPIC },
    ],
    ["credentialRevision", { ...BASE_INPUT, credentialRevision: 4 }],
    ["adapterVersion", { ...BASE_INPUT, adapterVersion: 6 }],
    ["modelId", { ...BASE_INPUT, modelId: "model-b" }],
    [
      "protocol",
      { ...BASE_INPUT, protocol: AI_MODEL_PROTOCOLS.OPENAI_RESPONSES },
    ],
    [
      "routeOrigin",
      { ...BASE_INPUT, routeOrigin: "https://other.example.com" },
    ],
    ["profileId", { ...BASE_INPUT, profileId: "structured-text-v2" }],
    ["profileVersion", { ...BASE_INPUT, profileVersion: 2 }],
  ];

  it.each(mutations)(
    "changes the digest when %s changes",
    (_field, mutated) => {
      expect(computeVerificationFingerprint(mutated)).not.toBe(
        computeVerificationFingerprint(BASE_INPUT),
      );
    },
  );
});

describe("buildCapabilitySnapshot and parseCapabilitySnapshot", () => {
  it("round-trips a snapshot through JSON", () => {
    const snapshot = buildCapabilitySnapshot({
      contextWindowTokens: 128_000,
      fingerprintInput: BASE_INPUT,
    });
    const parsed = parseCapabilitySnapshot(
      JSON.parse(JSON.stringify(snapshot)),
    );
    expect(parsed).toEqual(snapshot);
  });

  it("round-trips a null context window through JSON", () => {
    const snapshot = buildCapabilitySnapshot({
      contextWindowTokens: null,
      fingerprintInput: BASE_INPUT,
    });
    const parsed = parseCapabilitySnapshot(
      JSON.parse(JSON.stringify(snapshot)),
    );
    expect(parsed).toEqual(snapshot);
    expect(parsed?.contextWindowTokens).toBeNull();
  });
});

describe("parseCapabilitySnapshot", () => {
  it("returns null for null input", () => {
    expect(parseCapabilitySnapshot(null)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseCapabilitySnapshot("snapshot")).toBeNull();
  });

  it("returns null when the fingerprint input is missing", () => {
    expect(parseCapabilitySnapshot({ contextWindowTokens: 1 })).toBeNull();
  });

  it("returns null when fingerprint fields are missing", () => {
    expect(
      parseCapabilitySnapshot({
        contextWindowTokens: 1,
        fingerprintInput: { providerKind: AI_PROVIDER_KINDS.OPENAI },
      }),
    ).toBeNull();
  });

  it("returns null when fingerprint fields have wrong types", () => {
    expect(
      parseCapabilitySnapshot({
        contextWindowTokens: 1,
        fingerprintInput: { ...BASE_INPUT, credentialRevision: "3" },
      }),
    ).toBeNull();
  });

  it("coerces a non-numeric context window to null", () => {
    expect(
      parseCapabilitySnapshot({
        contextWindowTokens: "128000",
        fingerprintInput: BASE_INPUT,
      }),
    ).toEqual({ contextWindowTokens: null, fingerprintInput: BASE_INPUT });
  });

  it("coerces non-finite context windows to null", () => {
    for (const contextWindowTokens of [Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(
        parseCapabilitySnapshot({
          contextWindowTokens,
          fingerprintInput: BASE_INPUT,
        }),
      ).toMatchObject({ contextWindowTokens: null });
    }
  });
});
