/**
 * Direct adapter for the xAI API. Verifies credentials against the models
 * endpoint (an unauthenticated probe is rejected with 401), discovers the
 * live OpenAI-style catalog, and constructs models on the OpenAI Chat
 * Completions protocol. Credentials travel only in request-scoped headers
 * and never touch process state.
 */
import {
  AI_CATALOG_BOUNDS,
  AI_MODEL_PROTOCOLS,
  AI_PROVIDER_CLASSES,
  AI_PROVIDER_KINDS,
  isStrictRecord,
} from "@repo/core";
import {
  classifyOpenAiCompatibleModalities,
  type AiCatalogCandidate,
} from "../catalog-normalize.js";
import { constructXaiModel } from "../model-factory.js";
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

const ORIGIN = "https://api.x.ai";
const BASE_URL = "https://api.x.ai/v1";

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

async function fetchModelsJson(
  credential: AiCredentialSecret,
  policy: AiHttpPolicy,
  signal?: AbortSignal,
): Promise<unknown> {
  const { json } = await aiProviderFetchJson({
    url: `${BASE_URL}/models`,
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
  const modalities = classifyOpenAiCompatibleModalities(entry.id);
  return {
    modelId: entry.id,
    inputModalities: modalities.inputModalities,
    outputModalities: modalities.outputModalities,
    route: resolvedRoute(),
    confidence: "provider",
  };
}

export const xaiAdapter: AiProviderAdapter = {
  kind: AI_PROVIDER_KINDS.XAI,
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
    return constructXaiModel({
      apiKey: input.credentials.plaintext,
      baseURL: BASE_URL,
      modelId: input.modelId,
    });
  },
};
