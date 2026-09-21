import { describe, expect, it } from "vitest";
import {
  AI_CAPABILITY_PROFILES,
  AI_MODALITIES,
  AI_MODEL_PROTOCOLS,
  AI_PROVIDER_CLASSES,
  AI_UNSUPPORTED_REASONS,
  type AiModelDescriptor,
  type AiProviderClass,
} from "@repo/core";
import { qualifyModelForStructuredTextV1 } from "./capability-profile.js";

const MIN_CONTEXT = AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.minContextTokens;

function makeDescriptor(
  overrides: Partial<AiModelDescriptor> = {},
): AiModelDescriptor {
  return {
    modelId: "model-a",
    displayName: "Model A",
    inputModalities: [AI_MODALITIES.TEXT],
    outputModalities: [AI_MODALITIES.TEXT],
    contextWindowTokens: MIN_CONTEXT,
    maxOutputTokens: 4_096,
    supportsToolCalls: true,
    supportsStructuredOutput: true,
    route: {
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
      origin: "https://api.example.com",
    },
    confidence: "provider",
    deprecated: false,
    ...overrides,
  };
}

function qualify(
  descriptor: AiModelDescriptor,
  providerClass: AiProviderClass = AI_PROVIDER_CLASSES.DIRECT,
) {
  return qualifyModelForStructuredTextV1({ descriptor, providerClass });
}

describe("qualifyModelForStructuredTextV1", () => {
  it("qualifies a direct provider as provider-compatible", () => {
    expect(qualify(makeDescriptor())).toEqual({
      state: "provider_compatible",
      direct: true,
    });
  });

  it("qualifies a gateway without the direct flag", () => {
    expect(qualify(makeDescriptor(), AI_PROVIDER_CLASSES.GATEWAY)).toEqual({
      state: "provider_compatible",
      direct: false,
    });
  });

  it("accepts a context window exactly at the profile minimum", () => {
    expect(
      qualify(makeDescriptor({ contextWindowTokens: MIN_CONTEXT })),
    ).toEqual({ state: "provider_compatible", direct: true });
  });

  it("rejects a context window one token below the minimum", () => {
    expect(
      qualify(makeDescriptor({ contextWindowTokens: MIN_CONTEXT - 1 })),
    ).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.CONTEXT_WINDOW_TOO_SMALL,
    });
  });

  it("reports an unknown context window instead of guessing", () => {
    expect(qualify(makeDescriptor({ contextWindowTokens: null }))).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.CONTEXT_WINDOW_UNKNOWN,
    });
  });

  it("rejects unresolved routes from missing metadata", () => {
    expect(
      qualify(
        makeDescriptor({
          route: { status: "unresolved", reason: "route_metadata_missing" },
        }),
      ),
    ).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.ROUTE_UNRESOLVED,
    });
  });

  it("rejects unresolved routes from unsupported protocols", () => {
    expect(
      qualify(
        makeDescriptor({
          route: { status: "unresolved", reason: "protocol_unsupported" },
        }),
      ),
    ).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.ROUTE_UNRESOLVED,
    });
  });

  it("rejects deprecated models", () => {
    expect(qualify(makeDescriptor({ deprecated: true }))).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.DEPRECATED,
    });
  });

  it("rejects image-only input", () => {
    expect(
      qualify(makeDescriptor({ inputModalities: [AI_MODALITIES.IMAGE] })),
    ).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.MODALITY,
    });
  });

  it("rejects audio-only output", () => {
    expect(
      qualify(makeDescriptor({ outputModalities: [AI_MODALITIES.AUDIO] })),
    ).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.MODALITY,
    });
  });

  it("rejects embeddings-style descriptors without text output", () => {
    expect(qualify(makeDescriptor({ outputModalities: [] }))).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.MODALITY,
    });
  });

  it("rejects descriptors with no modalities at all", () => {
    expect(
      qualify(makeDescriptor({ inputModalities: [], outputModalities: [] })),
    ).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.MODALITY,
    });
  });

  it("rejects descriptors without structured output support", () => {
    expect(
      qualify(makeDescriptor({ supportsStructuredOutput: false })),
    ).toEqual({
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.STRUCTURED_OUTPUT_UNSUPPORTED,
    });
  });

  it("treats unknown structured-output support as compatible", () => {
    expect(qualify(makeDescriptor({ supportsStructuredOutput: null }))).toEqual(
      { state: "provider_compatible", direct: true },
    );
  });
});
