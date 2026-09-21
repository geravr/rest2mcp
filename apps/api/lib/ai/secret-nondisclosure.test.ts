/**
 * Security regression suite: credentials, ciphertext, prompts, generated
 * content, and raw provider responses must never surface in API payloads,
 * thrown errors, or telemetry. Every marker string below is synthetic.
 */
import { APP_ERROR_CODES, sanitizeTelemetryProperties } from "@repo/core";
import { describe, expect, it, vi } from "vitest";
import {
  AiProviderRequestError,
  aiProviderFetchJson,
} from "./provider-http.js";
import { mapAiProviderRequestError } from "./error-mapping.js";
import {
  normalizeCatalogCandidates,
  type AiCatalogCandidate,
} from "./catalog-normalize.js";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { runStructuredOutputSmokeTest } from "./ai-runtime.js";
import {
  toAiConnectionProjection,
  toAiSelectionProjection,
} from "../../services/ai-provider-repository.js";
import type { AiProviderConnectionSelect } from "@repo/db";

const CREDENTIAL_MARKER = "sk-supersecret-ai-credential-marker";
const PROVIDER_BODY_MARKER = "raw-provider-response-marker-7311";
const PROMPT_MARKER = "synthetic-prompt-marker-do-not-echo";

function expectNoMarkers(value: unknown, markers: string[]) {
  const serialized = JSON.stringify(value) ?? "";
  for (const marker of markers) {
    expect(serialized).not.toContain(marker);
  }
}

describe("AI secret non-disclosure", () => {
  it("omits provider response bodies and auth headers from request errors", async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          message: `denied ${PROVIDER_BODY_MARKER} ${CREDENTIAL_MARKER}`,
        },
      }),
      { status: 401 },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    try {
      const error = await aiProviderFetchJson({
        url: "https://api.openai.com/v1/models",
        headers: { Authorization: `Bearer ${CREDENTIAL_MARKER}` },
        policy: {
          allowedOrigins: ["https://api.openai.com"],
          deadlineMs: 5_000,
          maxResponseBytes: 10_000,
        },
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(AiProviderRequestError);
      expectNoMarkers(error, [CREDENTIAL_MARKER, PROVIDER_BODY_MARKER]);
      const mapped = mapAiProviderRequestError({
        error,
        operation: "verification",
        providerKind: "openai",
      });
      expect(mapped.appCode).toBe(
        APP_ERROR_CODES.AI_PROVIDER_CREDENTIAL_INVALID,
      );
      expectNoMarkers(mapped, [CREDENTIAL_MARKER, PROVIDER_BODY_MARKER]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps connection and selection projections secret-free", () => {
    const connection = {
      id: "aic_test",
      userId: "usr_test",
      providerKind: "openai",
      ciphertext: `v1.AAAAAAAA.BBBBBBBB.${CREDENTIAL_MARKER}`,
      credentialRevision: 1,
      configRevision: 1,
      verifiedAt: new Date(),
      lastErrorCode: null,
      lastAttemptAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as AiProviderConnectionSelect;
    const projection = toAiConnectionProjection(connection);
    expectNoMarkers(projection, [CREDENTIAL_MARKER, "v1."]);
    const selection = toAiSelectionProjection(
      {
        id: "ams_test",
        userId: "usr_test",
        connectionId: "aic_test",
        capabilityProfile: "structured-text-v1",
        modelId: "gpt-fixture",
        protocol: "openai-chat-completions",
        routeOrigin: "https://api.openai.com",
        capabilitySnapshot: { contextWindowTokens: 128_000 },
        verificationFingerprint: "a".repeat(64),
        verifiedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      "openai",
    );
    expectNoMarkers(selection, [CREDENTIAL_MARKER]);
  });

  it("normalizes away unknown provider payload fields (no passthrough of embedded secrets)", () => {
    const candidate = {
      modelId: "gpt-fixture",
      displayName: "GPT Fixture",
      inputModalities: ["text"],
      outputModalities: ["text"],
      contextWindowTokens: 32_768,
      route: {
        status: "resolved",
        protocol: "openai-responses",
        origin: "https://api.openai.com",
      },
      confidence: "provider",
    } as AiCatalogCandidate;
    const leaked = candidate as Record<string, unknown>;
    leaked.internalNote = CREDENTIAL_MARKER;
    const { entries } = normalizeCatalogCandidates([candidate]);
    expect(entries).toHaveLength(1);
    expectNoMarkers(entries, [CREDENTIAL_MARKER]);
  });

  it("never echoes generated content in smoke-test failures", async () => {
    const leakingModel = createMockModel({
      objectGenerationMode: "json",
      mockText: `{"confirmation":"nope","leak":"${CREDENTIAL_MARKER}","prompt":"${PROMPT_MARKER}"}`,
    }) as unknown as Parameters<
      typeof runStructuredOutputSmokeTest
    >[0]["model"];
    const error = await runStructuredOutputSmokeTest({
      model: leakingModel,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as { appCode?: unknown }).appCode).toBe(
      APP_ERROR_CODES.AI_MODEL_VERIFICATION_FAILED,
    );
    expectNoMarkers(error, [CREDENTIAL_MARKER, PROMPT_MARKER]);
  });

  it("redacts credential-shaped telemetry properties", () => {
    const sanitized = sanitizeTelemetryProperties({
      apiKey: CREDENTIAL_MARKER,
      authorization: `Bearer ${CREDENTIAL_MARKER}`,
    });
    expectNoMarkers(sanitized, [CREDENTIAL_MARKER]);
  });
});
