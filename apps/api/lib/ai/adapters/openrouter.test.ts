import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL_PROTOCOLS, type AiModelRoute } from "@repo/core";
import { openRouterAdapter } from "./openrouter.js";
import type { AiResolvedRoute } from "../provider-adapter.js";
import { AiProviderRequestError } from "../provider-http.js";

const CREDENTIAL = { plaintext: "test-credential" };

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

function stubFetch(impl: () => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => impl());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openRouterAdapter", () => {
  it("exposes gateway metadata", () => {
    expect(openRouterAdapter.kind).toBe("openrouter");
    expect(openRouterAdapter.providerClass).toBe("gateway");
    expect(openRouterAdapter.adapterVersion).toBe(1);
  });

  it("discovers models and maps the catalog payload", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: "openai/gpt-5.2",
            name: "OpenAI: GPT-5.2",
            context_length: 128000,
            architecture: {
              input_modalities: ["text", "image"],
              output_modalities: ["text"],
            },
            supported_parameters: [
              "tools",
              "structured_outputs",
              "temperature",
            ],
          },
          {
            id: "broken/vendor-model",
            name: "Broken: Vendor Model",
          },
        ],
      }),
    );

    const candidates = await openRouterAdapter.discoverModels({
      credentials: CREDENTIAL,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/models");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-credential",
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      modelId: "openai/gpt-5.2",
      displayName: "OpenAI: GPT-5.2",
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      contextWindowTokens: 128000,
      supportsStructuredOutput: true,
      supportsToolCalls: true,
      route: {
        status: "resolved",
        protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
        origin: "https://openrouter.ai",
      },
      confidence: "provider",
    });
    expect(candidates[1]).toMatchObject({
      modelId: "broken/vendor-model",
      supportsStructuredOutput: null,
      supportsToolCalls: null,
    });
  });

  it("verifies the credential against the key metadata endpoint", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        data: { label: "test-key", usage: 0, limit: null, is_free_tier: false },
      }),
    );

    await expect(
      openRouterAdapter.verifyCredential({ credentials: CREDENTIAL }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://openrouter.ai/api/v1/auth/key");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-credential",
    );
  });

  it("maps a rejected key on the key metadata endpoint to unauthorized", async () => {
    stubFetch(() => jsonResponse({ error: { message: "invalid key" } }, 401));

    const attempt = openRouterAdapter.verifyCredential({
      credentials: CREDENTIAL,
    });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "unauthorized",
      retryable: false,
    });
  });

  it("resolves the fixed chat-completions route regardless of enrichment", () => {
    const expected = {
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
      origin: "https://openrouter.ai",
    };
    expect(
      openRouterAdapter.resolveRoute({ modelId: "openai/gpt-5.2" }),
    ).toEqual(expected);
    expect(
      openRouterAdapter.resolveRoute({
        modelId: "openai/gpt-5.2",
        enrichment: { gatewayNpm: "@ai-sdk/anthropic" },
      }),
    ).toEqual(expected);
  });

  it("constructs a chat-completions model without reading process env", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENCODE_API_KEY;

    const model = await openRouterAdapter.constructModel({
      credentials: CREDENTIAL,
      modelId: "openai/gpt-5.2",
      route: resolvedRouteOf(
        openRouterAdapter.resolveRoute({ modelId: "openai/gpt-5.2" }),
      ),
    });

    expect(model.modelId).toBe("openai/gpt-5.2");
    expect(model.provider).toContain("openrouter");
  });
});
