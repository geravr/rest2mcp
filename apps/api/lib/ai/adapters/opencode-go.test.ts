import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL_PROTOCOLS, type AiModelRoute } from "@repo/core";
import { resetModelsDevCacheForTests } from "../models-dev.js";
import { opencodeGoAdapter } from "./opencode-go.js";
import type { AiResolvedRoute } from "../provider-adapter.js";
import { AiProviderRequestError } from "../provider-http.js";

const ADAPTER = opencodeGoAdapter;
const BASE_URL = "https://opencode.ai/zen/go/v1";
const ORIGIN = "https://opencode.ai";
const PROVIDER_NAME = "opencode_go";
const PROBE_MODEL_ID = "zai/glm-4.7";

const CREDENTIAL = { plaintext: "test-credential" };
const MODELS_DEV_URL = "https://models.dev/api.json";

function modelsDevDocument(
  models: Record<string, unknown>,
  npm = "@ai-sdk/openai-compatible",
): Response {
  return jsonResponse({ "opencode-go": { npm, models } });
}

function resolvedRouteOf(route: AiModelRoute): AiResolvedRoute {
  if (route.status !== "resolved") throw new Error("expected a resolved route");
  return route;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function stubFetchByPath(
  handler: (url: string, init?: RequestInit) => Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetModelsDevCacheForTests();
});

afterEach(() => {
  resetModelsDevCacheForTests();
  vi.unstubAllGlobals();
});

describe("opencodeGoAdapter", () => {
  it("exposes gateway metadata", () => {
    expect(ADAPTER.kind).toBe("opencode_go");
    expect(ADAPTER.providerClass).toBe("gateway");
    expect(ADAPTER.adapterVersion).toBe(2);
  });

  it("discovers candidates with unresolved routes", async () => {
    const fetchMock = stubFetchByPath((url) => {
      if (url === `${BASE_URL}/models`) {
        return jsonResponse({
          object: "list",
          data: [
            { id: PROBE_MODEL_ID, object: "model" },
            { object: "model" },
            { id: "qwen3-embedding" },
          ],
        });
      }
      return jsonResponse({});
    });

    const candidates = await ADAPTER.discoverModels({
      credentials: CREDENTIAL,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${BASE_URL}/models`);
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-credential",
    );

    expect(candidates).toEqual([
      {
        modelId: PROBE_MODEL_ID,
        inputModalities: ["text"],
        outputModalities: ["text"],
        route: { status: "unresolved", reason: "route_metadata_missing" },
        confidence: "provider",
      },
      {
        modelId: "qwen3-embedding",
        inputModalities: [],
        outputModalities: [],
        route: { status: "unresolved", reason: "route_metadata_missing" },
        confidence: "provider",
      },
    ]);
  });

  it("resolves routes from gatewayNpm metadata and fails closed otherwise", async () => {
    const modelId = PROBE_MODEL_ID;
    expect(
      ADAPTER.resolveRoute({
        modelId,
        enrichment: { gatewayNpm: "@ai-sdk/anthropic" },
      }),
    ).toEqual({
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
      origin: ORIGIN,
    });
    expect(
      ADAPTER.resolveRoute({
        modelId,
        enrichment: { gatewayNpm: "@ai-sdk/openai" },
      }),
    ).toEqual({
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_RESPONSES,
      origin: ORIGIN,
    });
    expect(
      ADAPTER.resolveRoute({
        modelId,
        enrichment: { gatewayNpm: "@ai-sdk/openai-compatible" },
      }),
    ).toEqual({
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
      origin: ORIGIN,
    });
    expect(
      ADAPTER.resolveRoute({
        modelId,
        enrichment: { gatewayNpm: "@ai-sdk/google" },
      }),
    ).toEqual({ status: "unresolved", reason: "protocol_unsupported" });
    expect(ADAPTER.resolveRoute({ modelId })).toEqual({
      status: "unresolved",
      reason: "route_metadata_missing",
    });
    expect(
      ADAPTER.resolveRoute({
        modelId,
        enrichment: { gatewayNpm: "@ai-sdk/mistral" },
      }),
    ).toEqual({ status: "unresolved", reason: "route_metadata_missing" });
  });

  it("verifies the credential with a chat-completions probe for a routable catalog model", async () => {
    const fetchMock = stubFetchByPath((url) => {
      if (url === MODELS_DEV_URL) {
        return modelsDevDocument({
          [PROBE_MODEL_ID]: { name: "Probe" },
        });
      }
      if (url === `${BASE_URL}/models`) {
        return jsonResponse({ object: "list", data: [{ id: PROBE_MODEL_ID }] });
      }
      return jsonResponse({
        id: "chatcmpl-1",
        choices: [{ message: { role: "assistant", content: "" } }],
      });
    });

    await expect(
      ADAPTER.verifyCredential({ credentials: CREDENTIAL }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const probeCall = fetchMock.mock.calls[2] ?? [];
    expect(String(probeCall[0])).toBe(`${BASE_URL}/chat/completions`);
    const init = probeCall[1];
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-credential");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-opencode-session")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: PROBE_MODEL_ID,
      max_tokens: 1,
      messages: [{ role: "user", content: "verify" }],
    });
  });

  it("probes Anthropic Messages when that is the first routable catalog model", async () => {
    const fetchMock = stubFetchByPath((url) => {
      if (url === MODELS_DEV_URL) {
        return modelsDevDocument({
          "minimax-m3": { provider: { npm: "@ai-sdk/anthropic" } },
          "kimi-k2.6": { name: "Kimi" },
        });
      }
      if (url === `${BASE_URL}/models`) {
        return jsonResponse({
          data: [{ id: "minimax-m3" }, { id: "kimi-k2.6" }],
        });
      }
      return jsonResponse({ id: "msg_1", type: "message" });
    });

    await ADAPTER.verifyCredential({ credentials: CREDENTIAL });

    const probeCall = fetchMock.mock.calls[2] ?? [];
    expect(String(probeCall[0])).toBe(`${BASE_URL}/messages`);
    const headers = new Headers(probeCall[1]?.headers);
    expect(headers.get("x-api-key")).toBe("test-credential");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("x-opencode-session")).toBeTruthy();
    expect(JSON.parse(String(probeCall[1]?.body))).toMatchObject({
      model: "minimax-m3",
      max_tokens: 1,
    });
  });

  it("probes the Responses API when registry metadata declares the OpenAI SDK", async () => {
    const fetchMock = stubFetchByPath((url) => {
      if (url === MODELS_DEV_URL) {
        return modelsDevDocument({
          "grok-4.6": { provider: { npm: "@ai-sdk/openai" } },
        });
      }
      if (url === `${BASE_URL}/models`) {
        return jsonResponse({ data: [{ id: "grok-4.6" }] });
      }
      return jsonResponse({ id: "resp_1" });
    });

    await ADAPTER.verifyCredential({ credentials: CREDENTIAL });

    const probeCall = fetchMock.mock.calls[2] ?? [];
    expect(String(probeCall[0])).toBe(`${BASE_URL}/responses`);
    const headers = new Headers(probeCall[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-credential");
    expect(headers.get("x-opencode-session")).toBeTruthy();
    expect(JSON.parse(String(probeCall[1]?.body))).toMatchObject({
      model: "grok-4.6",
      input: "verify",
      max_output_tokens: 16,
    });
  });

  it("maps a rejected probe to a non-retryable unauthorized error", async () => {
    stubFetchByPath((url) => {
      if (url === MODELS_DEV_URL) {
        return modelsDevDocument({ [PROBE_MODEL_ID]: { name: "Probe" } });
      }
      if (url === `${BASE_URL}/models`) {
        return jsonResponse({ data: [{ id: PROBE_MODEL_ID }] });
      }
      return jsonResponse({ error: { message: "invalid key" } }, 401);
    });

    const attempt = ADAPTER.verifyCredential({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "unauthorized",
      retryable: false,
    });
  });

  it("throws a retryable transient error when the catalog is empty", async () => {
    const fetchMock = stubFetchByPath((url) => {
      if (url === `${BASE_URL}/models`) return jsonResponse({ data: [] });
      return jsonResponse({});
    });

    const attempt = ADAPTER.verifyCredential({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "transient",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("constructs models per resolved route without reading process env", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENCODE_API_KEY;

    const anthropicModel = await ADAPTER.constructModel({
      credentials: CREDENTIAL,
      modelId: PROBE_MODEL_ID,
      route: resolvedRouteOf(
        ADAPTER.resolveRoute({
          modelId: PROBE_MODEL_ID,
          enrichment: { gatewayNpm: "@ai-sdk/anthropic" },
        }),
      ),
    });
    expect(anthropicModel.modelId).toBe(PROBE_MODEL_ID);
    expect(anthropicModel.provider).toContain("anthropic");

    const chatModel = await ADAPTER.constructModel({
      credentials: CREDENTIAL,
      modelId: PROBE_MODEL_ID,
      route: resolvedRouteOf(
        ADAPTER.resolveRoute({
          modelId: PROBE_MODEL_ID,
          enrichment: { gatewayNpm: "@ai-sdk/openai-compatible" },
        }),
      ),
    });
    expect(chatModel.modelId).toBe(PROBE_MODEL_ID);
    expect(chatModel.provider).toContain(PROVIDER_NAME);

    const responsesModel = await ADAPTER.constructModel({
      credentials: CREDENTIAL,
      modelId: PROBE_MODEL_ID,
      route: resolvedRouteOf(
        ADAPTER.resolveRoute({
          modelId: PROBE_MODEL_ID,
          enrichment: { gatewayNpm: "@ai-sdk/openai" },
        }),
      ),
    });
    expect(responsesModel.modelId).toBe(PROBE_MODEL_ID);
    expect(responsesModel.provider).toContain(PROVIDER_NAME);

    const chatHeaders = (
      chatModel as unknown as {
        config: { headers: () => Record<string, string | undefined> };
      }
    ).config.headers();
    expect(chatHeaders["x-opencode-session"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(chatHeaders.authorization).toBe("Bearer test-credential");
  });

  it("fails closed without probing when no catalog model has a routable protocol", async () => {
    const fetchMock = stubFetchByPath((url) => {
      if (url === MODELS_DEV_URL) {
        return modelsDevDocument(
          { "gemini-x": { provider: { npm: "@ai-sdk/google" } } },
          "@ai-sdk/google",
        );
      }
      if (url === `${BASE_URL}/models`) {
        return jsonResponse({ data: [{ id: "gemini-x" }] });
      }
      return jsonResponse({});
    });

    const attempt = ADAPTER.verifyCredential({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toMatchObject({
      code: "transient",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain(
      `${BASE_URL}/chat/completions`,
    );
  });

  it("maps a non-auth probe rejection to a non-retryable rejected error", async () => {
    stubFetchByPath((url) => {
      if (url === MODELS_DEV_URL) {
        return modelsDevDocument({ [PROBE_MODEL_ID]: { name: "Probe" } });
      }
      if (url === `${BASE_URL}/models`) {
        return jsonResponse({ data: [{ id: PROBE_MODEL_ID }] });
      }
      return jsonResponse({ error: { type: "MissingSessionID" } }, 400);
    });

    const attempt = ADAPTER.verifyCredential({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "rejected",
      retryable: false,
      httpStatus: 400,
    });
  });
});
