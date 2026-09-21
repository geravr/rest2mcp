/**
 * Gateway adapter for OpenRouter. Verifies credentials against the key
 * metadata endpoint, discovers the live catalog with architecture metadata,
 * and routes every model over the OpenAI Chat
 * Completions protocol, which OpenRouter fixes for its entire catalog.
 */
import {
  AI_CATALOG_BOUNDS,
  AI_MODEL_PROTOCOLS,
  AI_PROVIDER_CLASSES,
  AI_PROVIDER_KINDS,
  isStrictRecord,
} from "@repo/core";
import type { AiCatalogCandidate } from "../catalog-normalize.js";
import { constructOpenAiCompatibleChatModel } from "../model-factory.js";
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

const ORIGIN = "https://openrouter.ai";
const BASE_URL = "https://openrouter.ai/api/v1";
const PROVIDER_NAME = "openrouter";

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
  return { authorization: `Bearer ${credential.plaintext}` };
}

function resolvedRoute(): AiResolvedRoute {
  return {
    status: "resolved",
    protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
    origin: ORIGIN,
  };
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

function readArchitectureModalities(entry: Record<string, unknown>): {
  input: unknown;
  output: unknown;
} {
  const architecture = isStrictRecord(entry.architecture)
    ? entry.architecture
    : undefined;
  return {
    input: architecture?.input_modalities,
    output: architecture?.output_modalities,
  };
}

function toCandidate(entry: unknown): AiCatalogCandidate | null {
  if (!isStrictRecord(entry) || typeof entry.id !== "string") return null;

  const supportedParameters = Array.isArray(entry.supported_parameters)
    ? entry.supported_parameters
    : [];
  const modalities = readArchitectureModalities(entry);

  return {
    modelId: entry.id,
    displayName: entry.name,
    inputModalities: modalities.input,
    outputModalities: modalities.output,
    contextWindowTokens: entry.context_length,
    supportsStructuredOutput: supportedParameters.includes("structured_outputs")
      ? true
      : null,
    supportsToolCalls: supportedParameters.includes("tools") ? true : null,
    route: resolvedRoute(),
    confidence: "provider",
  };
}

export const openRouterAdapter: AiProviderAdapter = {
  kind: AI_PROVIDER_KINDS.OPENROUTER,
  providerClass: AI_PROVIDER_CLASSES.GATEWAY,
  adapterVersion: 1,

  async verifyCredential(input: AiAdapterCallInput): Promise<void> {
    await aiProviderFetchJson({
      url: `${BASE_URL}/auth/key`,
      method: "GET",
      headers: authHeaders(input.credentials),
      policy: VERIFY_POLICY,
      signal: input.signal,
    });
  },

  async discoverModels(
    input: AiAdapterCallInput,
  ): Promise<AiCatalogCandidate[]> {
    const { json } = await aiProviderFetchJson({
      url: `${BASE_URL}/models`,
      method: "GET",
      headers: authHeaders(input.credentials),
      policy: CATALOG_POLICY,
      signal: input.signal,
    });
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
    return constructOpenAiCompatibleChatModel({
      providerName: PROVIDER_NAME,
      apiKey: input.credentials.plaintext,
      baseURL: BASE_URL,
      modelId: input.modelId,
    });
  },
};
