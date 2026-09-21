/**
 * Server-only contract for AI provider adapters. Adapters own everything
 * provider-specific: fixed origins, credential verification, live model
 * discovery, gateway route resolution, and AI SDK model construction. Nothing
 * here may read process state; credentials arrive as request-scoped values
 * and are never stored, logged, or returned.
 */
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type {
  AiModality,
  AiModelRoute,
  AiProviderClass,
  AiProviderKind,
} from "@repo/core";

/** Request-scoped plaintext credential. Never persisted, logged, or returned. */
export type AiCredentialSecret = {
  readonly plaintext: string;
};

/** The AI SDK language model instance supplied to the Mastra runtime. */
export type AiConstructedModel = LanguageModelV4;

/**
 * Optional public-registry metadata (Models.dev) used to enrich sparse
 * provider catalogs and resolve gateway routes. Enrichment can never make a
 * model selectable on its own — it only annotates entries the provider's
 * authenticated catalog already returned.
 */
export type AiModelEnrichment = {
  displayName?: string;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  inputModalities?: AiModality[];
  outputModalities?: AiModality[];
  supportsToolCalls?: boolean;
  supportsStructuredOutput?: boolean;
  deprecated?: boolean;
  /** Models.dev `provider.npm` hint used by gateways for protocol resolution. */
  gatewayNpm?: string;
};

export type AiAdapterCallInput = {
  credentials: AiCredentialSecret;
  signal?: AbortSignal;
};

export type AiResolvedRoute = Extract<AiModelRoute, { status: "resolved" }>;

export interface AiProviderAdapter {
  readonly kind: AiProviderKind;
  readonly providerClass: AiProviderClass;
  /**
   * Bumped when discovery or route behavior changes; part of the verification
   * fingerprint so stored selections invalidate when adapter logic drifts.
   */
  readonly adapterVersion: number;
  /** Verifies the credential with the cheapest authenticated provider call. */
  verifyCredential(input: AiAdapterCallInput): Promise<void>;
  /**
   * Fetches the provider's live model catalog as bounded normalization
   * candidates. Implementations send the credential on every call and
   * normalize failures into AiProviderRequestError.
   */
  discoverModels(
    input: AiAdapterCallInput,
  ): Promise<import("./catalog-normalize.js").AiCatalogCandidate[]>;
  /**
   * Resolves the route/protocol for one model. Gateways resolve from current
   * metadata only; when metadata is insufficient the route stays unresolved
   * and the model must not be guessed onto any transport.
   */
  resolveRoute(input: {
    modelId: string;
    enrichment?: AiModelEnrichment | null;
  }): AiModelRoute;
  /**
   * Constructs the AI SDK model for a resolved route. Called at execution
   * time with freshly decrypted credentials; must throw rather than guess
   * when the route is not resolved.
   */
  constructModel(input: {
    credentials: AiCredentialSecret;
    modelId: string;
    route: AiResolvedRoute;
  }): AiConstructedModel | Promise<AiConstructedModel>;
}
