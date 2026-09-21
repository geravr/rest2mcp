/**
 * Versioned capability profiles. Profiles describe product requirements, not
 * vendor features, and are code-defined: a profile id/version change
 * invalidates every selection verified under the previous definition.
 */
import {
  AI_CAPABILITY_PROFILES,
  AI_MODALITIES,
  AI_UNSUPPORTED_REASONS,
  type AiCapabilityProfileId,
  type AiModelDescriptor,
  type AiModelQualification,
  type AiProviderClass,
} from "@repo/core";

export function getCapabilityProfile(
  id: AiCapabilityProfileId,
): (typeof AI_CAPABILITY_PROFILES)[keyof typeof AI_CAPABILITY_PROFILES] {
  const profile = Object.values(AI_CAPABILITY_PROFILES).find(
    (candidate) => candidate.id === id,
  );
  if (!profile) {
    throw new Error(`Unknown capability profile: ${id}`);
  }
  return profile;
}

/**
 * Evaluates one bounded descriptor against `structured-text-v1`. Direct
 * providers and gateways qualify through the same requirements; the `direct`
 * flag records the provider class so the UI can present candidate confidence.
 * The result is advertised compatibility only — `verified` requires the
 * bounded smoke test.
 */
export function qualifyModelForStructuredTextV1(input: {
  descriptor: AiModelDescriptor;
  providerClass: AiProviderClass;
}): AiModelQualification {
  const { descriptor, providerClass } = input;

  if (descriptor.route.status === "unresolved") {
    return {
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.ROUTE_UNRESOLVED,
    };
  }
  if (descriptor.deprecated) {
    return { state: "unsupported", reason: AI_UNSUPPORTED_REASONS.DEPRECATED };
  }
  if (
    !descriptor.inputModalities.includes(AI_MODALITIES.TEXT) ||
    !descriptor.outputModalities.includes(AI_MODALITIES.TEXT)
  ) {
    return { state: "unsupported", reason: AI_UNSUPPORTED_REASONS.MODALITY };
  }
  if (descriptor.contextWindowTokens === null) {
    return {
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.CONTEXT_WINDOW_UNKNOWN,
    };
  }
  const profile = getCapabilityProfile(
    AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.id,
  );
  if (descriptor.contextWindowTokens < profile.minContextTokens) {
    return {
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.CONTEXT_WINDOW_TOO_SMALL,
    };
  }
  if (descriptor.supportsStructuredOutput === false) {
    return {
      state: "unsupported",
      reason: AI_UNSUPPORTED_REASONS.STRUCTURED_OUTPUT_UNSUPPORTED,
    };
  }

  const direct = providerClass === "direct";
  return { state: "provider_compatible", direct };
}
