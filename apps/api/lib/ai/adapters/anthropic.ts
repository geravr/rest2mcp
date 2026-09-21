/**
 * Direct adapter for the Anthropic API. Verifies credentials against the
 * models endpoint, discovers the live catalog, and constructs models on the
 * Anthropic Messages protocol. Credentials travel only in request-scoped
 * headers and never touch process state.
 */
import {
  AI_CATALOG_BOUNDS,
  AI_MODEL_PROTOCOLS,
  AI_PROVIDER_CLASSES,
  AI_PROVIDER_KINDS,
  isStrictRecord,
} from "@repo/core";
import type { AiCatalogCandidate } from "../catalog-normalize.js";
import { constructAnthropicModel } from "../model-factory.js";
import type {
  AiAdapterCallInput,
  AiConstructedModel,
  AiCredentialSecret,
  AiProviderAdapter,
  AiResolvedRoute,
} from "../provider-adapter.js";
import {
  AiProviderRequestError,
  aiProviderFetchJson,
  type AiHttpPolicy,
} from "../provider-http.js";

const ORIGIN = "https://api.anthropic.com";
const BASE_URL = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";

const VERIFY_POLICY: AiHttpPolicy = {
  allowedOrigins: [ORIGIN],
  deadlineMs: 15_000,
  maxResponseBytes: AI_CATALOG_BOUNDS.MAX_RESPONSE_BYTES,
  maxRedirects: 3,
};

const CATALOG_POLICY: AiHttpPolicy = {
  allowedOrigins: [ORIGIN],
  deadlineMs: 20_000,
  maxResponseBytes: AI_CATALOG_BOUNDS.MAX_RESPONSE_BYTES,
  maxRedirects: 3,
};

function authHeaders(credential: AiCredentialSecret): Record<string, string> {
  return {
    "x-api-key": credential.plaintext,
    "anthropic-version": API_VERSION,
  };
}

function resolvedRoute(): AiResolvedRoute {
  return {
    status: "resolved",
    protocol: AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
    origin: ORIGIN,
  };
}

async function fetchModelsJson(
  credential: AiCredentialSecret,
  policy: AiHttpPolicy,
  signal?: AbortSignal,
): Promise<unknown> {
  const { json } = await aiProviderFetchJson({
    url: `${BASE_URL}/models?limit=1000`,
    method: "GET",
    headers: authHeaders(credential),
    policy,
    signal,
  });
  return json;
}

function readCatalogData(json: unknown): unknown[] {
  const data = isStrictRecord(json) ? json.data : undefined;
  if (!Array.isArray(data)) {
    throw new AiProviderRequestError({
      code: "malformed_response",
      message: "Provider catalog response did not contain a data array.",
      retryable: false,
    });
  }
  return data;
}

function toCandidate(entry: unknown): AiCatalogCandidate | null {
  if (!isStrictRecord(entry) || typeof entry.id !== "string") return null;
  if (entry.type !== undefined && entry.type !== "model") return null;
  return {
    modelId: entry.id,
    displayName: entry.display_name,
    route: resolvedRoute(),
    confidence: "provider",
  };
}

export const anthropicAdapter: AiProviderAdapter = {
  kind: AI_PROVIDER_KINDS.ANTHROPIC,
  providerClass: AI_PROVIDER_CLASSES.DIRECT,
  adapterVersion: 1,

  async verifyCredential(input: AiAdapterCallInput): Promise<void> {
    await fetchModelsJson(input.credentials, VERIFY_POLICY, input.signal);
  },

  async discoverModels(
    input: AiAdapterCallInput,
  ): Promise<AiCatalogCandidate[]> {
    const json = await fetchModelsJson(
      input.credentials,
      CATALOG_POLICY,
      input.signal,
    );
    return readCatalogData(json).flatMap((entry) => {
      const candidate = toCandidate(entry);
      return candidate ? [candidate] : [];
    });
  },

  resolveRoute(): AiResolvedRoute {
    return resolvedRoute();
  },

  constructModel(input: {
    credentials: AiCredentialSecret;
    modelId: string;
    route: AiResolvedRoute;
  }): AiConstructedModel {
    return constructAnthropicModel({
      apiKey: input.credentials.plaintext,
      baseURL: BASE_URL,
      modelId: input.modelId,
    });
  },
};
