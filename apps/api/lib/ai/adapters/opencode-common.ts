/**
 * Shared gateway adapter factory for the OpenCode model gateways. These
 * gateways expose an OpenAI-style catalog without modality or route metadata,
 * so candidates stay route-unresolved until registry enrichment (`gatewayNpm`,
 * including the provider-level default) resolves the wire protocol.
 * Verification uses one minimal completion on that resolved protocol because
 * no key-info endpoint exists. OpenCode Go also requires `x-opencode-session`
 * on inference requests.
 */
import {
  AI_CATALOG_BOUNDS,
  AI_MODEL_PROTOCOLS,
  AI_PROVIDER_CLASSES,
  isStrictRecord,
  type AiModelRoute,
  type AiProviderKind,
} from "@repo/core";
import {
  classifyOpenAiCompatibleModalities,
  type AiCatalogCandidate,
} from "../catalog-normalize.js";
import {
  constructAnthropicModel,
  constructOpenAiCompatibleChatModel,
  constructOpenAiModel,
} from "../model-factory.js";
import { fetchModelsDevEnrichment } from "../models-dev.js";
import type {
  AiAdapterCallInput,
  AiConstructedModel,
  AiCredentialSecret,
  AiModelEnrichment,
  AiProviderAdapter,
  AiResolvedRoute,
} from "../provider-adapter.js";
import {
  AiProviderRequestError,
  aiProviderFetchJson,
  type AiHttpPolicy,
} from "../provider-http.js";

export type AiOpencodeGatewayConfig = {
  kind: AiProviderKind;
  origin: string;
  baseURL: string;
  providerName: string;
  /**
   * OpenCode Go rejects inference calls that omit this header. Zen does not
   * require it.
   */
  sessionHeader?: boolean;
};

const ANTHROPIC_VERSION = "2023-06-01";
const SESSION_HEADER = "x-opencode-session";

function authHeaders(credential: AiCredentialSecret): Record<string, string> {
  return { authorization: `Bearer ${credential.plaintext}` };
}

function sessionHeaders(enabled: boolean): Record<string, string> {
  if (!enabled) return {};
  return { [SESSION_HEADER]: crypto.randomUUID() };
}

function policies(origin: string): {
  verify: AiHttpPolicy;
  catalog: AiHttpPolicy;
} {
  const shared = {
    allowedOrigins: [origin],
    maxResponseBytes: AI_CATALOG_BOUNDS.MAX_RESPONSE_BYTES,
    maxRedirects: 3,
  };
  return {
    verify: { ...shared, deadlineMs: 15_000 },
    catalog: { ...shared, deadlineMs: 20_000 },
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

function toCandidate(entry: unknown): AiCatalogCandidate | null {
  if (!isStrictRecord(entry) || typeof entry.id !== "string") return null;
  const modalities = classifyOpenAiCompatibleModalities(entry.id);
  return {
    modelId: entry.id,
    inputModalities: modalities.inputModalities,
    outputModalities: modalities.outputModalities,
    route: { status: "unresolved", reason: "route_metadata_missing" },
    confidence: "provider",
  };
}

function resolveGatewayRoute(
  npm: string | undefined,
  origin: string,
): AiModelRoute {
  if (npm === "@ai-sdk/anthropic") {
    return {
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
      origin,
    };
  }
  if (npm === "@ai-sdk/openai-compatible") {
    return {
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
      origin,
    };
  }
  if (npm === "@ai-sdk/openai") {
    return {
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_RESPONSES,
      origin,
    };
  }
  if (npm === "@ai-sdk/google") {
    return { status: "unresolved", reason: "protocol_unsupported" };
  }
  return { status: "unresolved", reason: "route_metadata_missing" };
}

type ProbeTarget = {
  modelId: string;
  protocol: (typeof AI_MODEL_PROTOCOLS)[keyof typeof AI_MODEL_PROTOCOLS];
};

function probeRequest(input: {
  baseURL: string;
  credential: AiCredentialSecret;
  target: ProbeTarget;
  sessionHeader: boolean;
}): { url: string; headers: Record<string, string>; body: string } {
  const session = sessionHeaders(input.sessionHeader);
  if (input.target.protocol === AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES) {
    return {
      url: `${input.baseURL}/messages`,
      headers: {
        ...session,
        "x-api-key": input.credential.plaintext,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.target.modelId,
        max_tokens: 1,
        messages: [{ role: "user", content: "verify" }],
      }),
    };
  }
  if (input.target.protocol === AI_MODEL_PROTOCOLS.OPENAI_RESPONSES) {
    return {
      url: `${input.baseURL}/responses`,
      headers: {
        ...session,
        ...authHeaders(input.credential),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.target.modelId,
        input: "verify",
        max_output_tokens: 16,
      }),
    };
  }
  return {
    url: `${input.baseURL}/chat/completions`,
    headers: {
      ...session,
      ...authHeaders(input.credential),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.target.modelId,
      messages: [{ role: "user", content: "verify" }],
      max_tokens: 1,
    }),
  };
}

/**
 * Creates the gateway adapter for one OpenCode endpoint. The base URL must
 * end in `/v1` so the Anthropic SDK appends `/messages` correctly.
 */
export function createOpencodeGatewayAdapter(
  config: AiOpencodeGatewayConfig,
): AiProviderAdapter {
  const { verify: verifyPolicy, catalog: catalogPolicy } = policies(
    config.origin,
  );

  async function fetchCatalogJson(
    credential: AiCredentialSecret,
    policy: AiHttpPolicy,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const { json } = await aiProviderFetchJson({
      url: `${config.baseURL}/models`,
      method: "GET",
      headers: authHeaders(credential),
      policy,
      signal,
    });
    return json;
  }

  function catalogModelIds(json: unknown): string[] {
    const ids: string[] = [];
    for (const entry of readCatalogData(json)) {
      if (
        isStrictRecord(entry) &&
        typeof entry.id === "string" &&
        entry.id.trim().length > 0
      ) {
        ids.push(entry.id);
      }
    }
    return ids;
  }

  async function selectProbeTarget(
    modelIds: readonly string[],
  ): Promise<ProbeTarget> {
    const enrichment = await fetchModelsDevEnrichment(config.kind);
    for (const modelId of modelIds) {
      const route = resolveGatewayRoute(
        enrichment.get(modelId)?.gatewayNpm,
        config.origin,
      );
      if (route.status === "resolved") {
        return { modelId, protocol: route.protocol };
      }
    }
    throw new AiProviderRequestError({
      code: "transient",
      message: "Provider catalog did not contain a routable model to probe.",
      retryable: true,
    });
  }

  return {
    kind: config.kind,
    providerClass: AI_PROVIDER_CLASSES.GATEWAY,
    adapterVersion: 2,

    async verifyCredential(input: AiAdapterCallInput): Promise<void> {
      const json = await fetchCatalogJson(
        input.credentials,
        verifyPolicy,
        input.signal,
      );
      const modelIds = catalogModelIds(json);
      if (modelIds.length === 0) {
        throw new AiProviderRequestError({
          code: "transient",
          message: "Provider catalog did not contain a model to probe.",
          retryable: true,
        });
      }
      const target = await selectProbeTarget(modelIds);
      const probe = probeRequest({
        baseURL: config.baseURL,
        credential: input.credentials,
        target,
        sessionHeader: config.sessionHeader === true,
      });
      await aiProviderFetchJson({
        url: probe.url,
        method: "POST",
        headers: probe.headers,
        body: probe.body,
        policy: verifyPolicy,
        signal: input.signal,
      });
    },

    async discoverModels(
      input: AiAdapterCallInput,
    ): Promise<AiCatalogCandidate[]> {
      const json = await fetchCatalogJson(
        input.credentials,
        catalogPolicy,
        input.signal,
      );
      return readCatalogData(json).flatMap((entry) => {
        const candidate = toCandidate(entry);
        return candidate ? [candidate] : [];
      });
    },

    resolveRoute(input: {
      modelId: string;
      enrichment?: AiModelEnrichment | null;
    }): AiModelRoute {
      return resolveGatewayRoute(input.enrichment?.gatewayNpm, config.origin);
    },

    constructModel(input: {
      credentials: AiCredentialSecret;
      modelId: string;
      route: AiResolvedRoute;
    }): AiConstructedModel {
      const headers = sessionHeaders(config.sessionHeader === true);
      const factoryInput = {
        apiKey: input.credentials.plaintext,
        baseURL: config.baseURL,
        modelId: input.modelId,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      };
      if (input.route.protocol === AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES) {
        return constructAnthropicModel(factoryInput);
      }
      if (input.route.protocol === AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS) {
        return constructOpenAiCompatibleChatModel({
          ...factoryInput,
          providerName: config.providerName,
        });
      }
      if (input.route.protocol === AI_MODEL_PROTOCOLS.OPENAI_RESPONSES) {
        return constructOpenAiModel(
          { ...factoryInput, providerName: config.providerName },
          AI_MODEL_PROTOCOLS.OPENAI_RESPONSES,
        );
      }
      throw new AiProviderRequestError({
        code: "rejected",
        message: "Resolved protocol is not supported by this gateway.",
        retryable: false,
      });
    },
  };
}
