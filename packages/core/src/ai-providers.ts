/**
 * Shared AI provider contracts: provider kinds, model protocols, capability
 * profiles, bounded catalog schemas, and non-secret connection/readiness
 * projections. Imported by the API (services, tRPC) and the SPA (typing +
 * i18n). Provider display names, endpoints, and protocol behavior stay in the
 * server-side adapter registry; this module never carries provider origins.
 */
import { z } from "zod";

/** Provider kinds supported by the server-side adapter registry. */
export const AI_PROVIDER_KINDS = {
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  XAI: "xai",
  META: "meta",
  OPENROUTER: "openrouter",
  OPENCODE_ZEN: "opencode_zen",
  OPENCODE_GO: "opencode_go",
} as const;

export type AiProviderKind =
  (typeof AI_PROVIDER_KINDS)[keyof typeof AI_PROVIDER_KINDS];

export const aiProviderKindSchema = z.enum([
  AI_PROVIDER_KINDS.OPENAI,
  AI_PROVIDER_KINDS.ANTHROPIC,
  AI_PROVIDER_KINDS.XAI,
  AI_PROVIDER_KINDS.META,
  AI_PROVIDER_KINDS.OPENROUTER,
  AI_PROVIDER_KINDS.OPENCODE_ZEN,
  AI_PROVIDER_KINDS.OPENCODE_GO,
]);

/**
 * Gateways resell third-party models and require per-model route metadata;
 * direct providers expose their own first-party models.
 */
export const AI_PROVIDER_CLASSES = {
  DIRECT: "direct",
  GATEWAY: "gateway",
} as const;

export type AiProviderClass =
  (typeof AI_PROVIDER_CLASSES)[keyof typeof AI_PROVIDER_CLASSES];

/** Wire protocols the runtime can construct. Fail closed on anything else. */
export const AI_MODEL_PROTOCOLS = {
  OPENAI_RESPONSES: "openai-responses",
  OPENAI_CHAT_COMPLETIONS: "openai-chat-completions",
  ANTHROPIC_MESSAGES: "anthropic-messages",
} as const;

export type AiModelProtocol =
  (typeof AI_MODEL_PROTOCOLS)[keyof typeof AI_MODEL_PROTOCOLS];

export const aiModelProtocolSchema = z.enum([
  AI_MODEL_PROTOCOLS.OPENAI_RESPONSES,
  AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
  AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
]);

/**
 * Route/protocol identity resolved per model. Gateway entries whose route
 * cannot be resolved from current metadata stay `unresolved` and are never
 * guessed.
 */
export const aiModelRouteSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("resolved"),
    protocol: aiModelProtocolSchema,
    origin: z.string().max(200),
  }),
  z.object({
    status: z.literal("unresolved"),
    reason: z.enum(["route_metadata_missing", "protocol_unsupported"]),
  }),
]);

export type AiModelRoute = z.infer<typeof aiModelRouteSchema>;

export const AI_MODALITIES = {
  TEXT: "text",
  IMAGE: "image",
  AUDIO: "audio",
  VIDEO: "video",
  PDF: "pdf",
} as const;

export type AiModality = (typeof AI_MODALITIES)[keyof typeof AI_MODALITIES];

export const aiModalitySchema = z.enum([
  AI_MODALITIES.TEXT,
  AI_MODALITIES.IMAGE,
  AI_MODALITIES.AUDIO,
  AI_MODALITIES.VIDEO,
  AI_MODALITIES.PDF,
]);

/** Normalization bounds for provider catalog entries. */
export const AI_CATALOG_BOUNDS = {
  MODEL_ID_MAX_LENGTH: 256,
  MODEL_NAME_MAX_LENGTH: 200,
  MAX_ENTRIES: 1000,
  MAX_MODALITY_ENTRIES: 8,
  MAX_RESPONSE_BYTES: 2_000_000,
  CONTEXT_TOKENS_MAX: 100_000_000,
} as const;

/**
 * A bounded, normalized catalog entry. Every field is derived from the
 * provider catalog response plus optional public registry enrichment; the
 * descriptor itself contains no credentials and no provider request IDs.
 */
export const aiModelDescriptorSchema = z.object({
  modelId: z.string().min(1).max(AI_CATALOG_BOUNDS.MODEL_ID_MAX_LENGTH),
  displayName: z.string().min(1).max(AI_CATALOG_BOUNDS.MODEL_NAME_MAX_LENGTH),
  inputModalities: z
    .array(aiModalitySchema)
    .max(AI_CATALOG_BOUNDS.MAX_MODALITY_ENTRIES),
  outputModalities: z
    .array(aiModalitySchema)
    .max(AI_CATALOG_BOUNDS.MAX_MODALITY_ENTRIES),
  contextWindowTokens: z
    .number()
    .int()
    .positive()
    .max(AI_CATALOG_BOUNDS.CONTEXT_TOKENS_MAX)
    .nullable(),
  maxOutputTokens: z
    .number()
    .int()
    .positive()
    .max(AI_CATALOG_BOUNDS.CONTEXT_TOKENS_MAX)
    .nullable(),
  supportsToolCalls: z.boolean().nullable(),
  supportsStructuredOutput: z.boolean().nullable(),
  route: aiModelRouteSchema,
  /** `provider` = provider catalog only; `provider_enriched` = merged public registry metadata. */
  confidence: z.enum(["provider", "provider_enriched"]),
  deprecated: z.boolean(),
});

export type AiModelDescriptor = z.infer<typeof aiModelDescriptorSchema>;

/** Capability profile identifiers and versions. Code-defined, not data. */
export const AI_CAPABILITY_PROFILES = {
  STRUCTURED_TEXT_V1: {
    id: "structured-text-v1",
    version: 1,
    minContextTokens: 16_384,
  },
} as const;

export type AiCapabilityProfileId =
  (typeof AI_CAPABILITY_PROFILES)[keyof typeof AI_CAPABILITY_PROFILES]["id"];

export const aiCapabilityProfileIdSchema = z.enum([
  AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.id,
]);

/**
 * Why a catalog entry does not satisfy a capability profile. Present only when
 * the entry is not provider-compatible; `context_window_unknown` covers
 * providers that omit limit metadata.
 */
export const AI_UNSUPPORTED_REASONS = {
  MODALITY: "modality",
  CONTEXT_WINDOW_TOO_SMALL: "context_window_too_small",
  CONTEXT_WINDOW_UNKNOWN: "context_window_unknown",
  STRUCTURED_OUTPUT_UNSUPPORTED: "structured_output_unsupported",
  ROUTE_UNRESOLVED: "route_unresolved",
  DEPRECATED: "deprecated",
  MISSING_IDENTITY: "missing_identity",
} as const;

export type AiUnsupportedReason =
  (typeof AI_UNSUPPORTED_REASONS)[keyof typeof AI_UNSUPPORTED_REASONS];

export const aiUnsupportedReasonSchema = z.enum([
  AI_UNSUPPORTED_REASONS.MODALITY,
  AI_UNSUPPORTED_REASONS.CONTEXT_WINDOW_TOO_SMALL,
  AI_UNSUPPORTED_REASONS.CONTEXT_WINDOW_UNKNOWN,
  AI_UNSUPPORTED_REASONS.STRUCTURED_OUTPUT_UNSUPPORTED,
  AI_UNSUPPORTED_REASONS.ROUTE_UNRESOLVED,
  AI_UNSUPPORTED_REASONS.DEPRECATED,
  AI_UNSUPPORTED_REASONS.MISSING_IDENTITY,
]);

/**
 * Qualification of one catalog entry against one capability profile.
 * `provider_compatible` is advertised compatibility from live metadata;
 * `verified` additionally requires a successful bounded smoke test.
 */
export const aiModelQualificationSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("provider_compatible"),
    direct: z.boolean(),
  }),
  z.object({
    state: z.literal("verified"),
    direct: z.boolean(),
  }),
  z.object({
    state: z.literal("unsupported"),
    reason: aiUnsupportedReasonSchema,
  }),
]);

export type AiModelQualification = z.infer<typeof aiModelQualificationSchema>;

/** Non-secret projection of one owner connection. Never carries credential material. */
export const aiConnectionProjectionSchema = z.object({
  id: z.string().min(1),
  providerKind: aiProviderKindSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  configRevision: z.number().int().min(1),
  credentialRevision: z.number().int().min(1),
  verifiedAt: z.date().nullable(),
  /** Stable non-sensitive code of the most recent failed verification attempt, if any. */
  lastErrorCode: z.string().nullable(),
  lastAttemptAt: z.date().nullable(),
});

export type AiConnectionProjection = z.infer<
  typeof aiConnectionProjectionSchema
>;

/** Non-secret projection of one verified model selection. */
export const aiSelectionProjectionSchema = z.object({
  connectionId: z.string().min(1),
  providerKind: aiProviderKindSchema,
  capabilityProfile: aiCapabilityProfileIdSchema,
  modelId: z.string().min(1).max(AI_CATALOG_BOUNDS.MODEL_ID_MAX_LENGTH),
  protocol: aiModelProtocolSchema,
  verifiedAt: z.date(),
});

export type AiSelectionProjection = z.infer<typeof aiSelectionProjectionSchema>;

/**
 * Server-side availability of one capability profile for the owner. UIs use
 * `ready`/`reason` for disabled states; every AI API independently enforces
 * the same check.
 */
export const aiReadinessSchema = z.object({
  capabilityProfile: aiCapabilityProfileIdSchema,
  ready: z.boolean(),
  reason: z
    .enum([
      "no_connection",
      "connection_unverified",
      "no_selection",
      "selection_stale",
      "model_unavailable",
    ])
    .nullable(),
  selection: aiSelectionProjectionSchema.nullable(),
});

export type AiReadiness = z.infer<typeof aiReadinessSchema>;

/**
 * Why a stored selection no longer satisfies readiness. Transient provider
 * failures never produce these; they leave the selection intact.
 */
export const AI_SELECTION_STALE_REASONS = {
  CREDENTIAL_ROTATED: "credential_rotated",
  ROUTE_CHANGED: "route_changed",
  PROFILE_CHANGED: "profile_changed",
  ADAPTER_CHANGED: "adapter_changed",
  MODEL_REMOVED: "model_removed",
  CONFIG_CHANGED: "config_changed",
} as const;

export type AiSelectionStaleReason =
  (typeof AI_SELECTION_STALE_REASONS)[keyof typeof AI_SELECTION_STALE_REASONS];

/**
 * One compatible-model entry as returned by catalog discovery. Combines the
 * bounded descriptor with its qualification for the requested profile.
 */
export const aiCatalogEntrySchema = z.object({
  descriptor: aiModelDescriptorSchema,
  qualification: aiModelQualificationSchema,
});

export type AiCatalogEntry = z.infer<typeof aiCatalogEntrySchema>;

export const aiCatalogSnapshotSchema = z.object({
  providerKind: aiProviderKindSchema,
  capabilityProfile: aiCapabilityProfileIdSchema,
  /** When the underlying provider data was retrieved from the provider. */
  retrievedAt: z.date(),
  /** True when a live refresh failed and a same-revision cached snapshot was served. */
  stale: z.boolean(),
  entries: z.array(aiCatalogEntrySchema).max(AI_CATALOG_BOUNDS.MAX_ENTRIES),
});

export type AiCatalogSnapshot = z.infer<typeof aiCatalogSnapshotSchema>;

/** Deterministic catalog ordering: displayName, then modelId. */
export function compareAiCatalogEntries(
  a: AiCatalogEntry,
  b: AiCatalogEntry,
): number {
  const byName = a.descriptor.displayName.localeCompare(
    b.descriptor.displayName,
  );
  if (byName !== 0) return byName;
  return a.descriptor.modelId.localeCompare(b.descriptor.modelId);
}
