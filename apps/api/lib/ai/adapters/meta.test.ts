import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL_PROTOCOLS, type AiModelRoute } from "@repo/core";
import { AiProviderRequestError } from "../provider-http.js";
import type { AiResolvedRoute } from "../provider-adapter.js";
import { metaAdapter } from "./meta.js";

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

describe("metaAdapter", () => {
  it("discovers models from the /models endpoint with the credential header", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        object: "list",
        data: [
          { id: "llama-4-maverick", object: "model", owned_by: "meta" },
          { id: "llama-embedding", object: "model" },
        ],
      }),
    );

    const candidates = await metaAdapter.discoverModels({
      credentials: CREDENTIAL,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.meta.ai/v1/models");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-credential",
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      modelId: "llama-4-maverick",
      inputModalities: ["text"],
      outputModalities: ["text"],
      route: {
        status: "resolved",
        protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
        origin: "https://api.meta.ai",
      },
      confidence: "provider",
    });
    expect(candidates[1]).toMatchObject({
      modelId: "llama-embedding",
      inputModalities: [],
      outputModalities: [],
    });
  });

  it("skips non-object entries and entries without an id", async () => {
    stubFetch(() =>
      jsonResponse({
        data: [
          "not-an-object",
          null,
          42,
          { object: "model" },
          { id: "llama-real" },
        ],
      }),
    );

    const candidates = await metaAdapter.discoverModels({
      credentials: CREDENTIAL,
    });

    expect(candidates.map((candidate) => candidate.modelId)).toEqual([
      "llama-real",
    ]);
  });

  it("maps a 401 to a non-retryable unauthorized error", async () => {
    stubFetch(() => jsonResponse({ error: { message: "invalid key" } }, 401));

    const attempt = metaAdapter.verifyCredential({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "unauthorized",
      retryable: false,
    });
  });

  it("maps a 429 to a retryable rate_limited error with retry-after", async () => {
    stubFetch(() =>
      jsonResponse({ error: { message: "slow down" } }, 429, {
        "retry-after": "5",
      }),
    );

    const attempt = metaAdapter.discoverModels({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfterSeconds: 5,
    });
  });

  it("maps a 500 to a retryable transient error", async () => {
    stubFetch(() => jsonResponse({ error: { message: "boom" } }, 500));

    const attempt = metaAdapter.discoverModels({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "transient",
      retryable: true,
    });
  });

  it("blocks cross-origin redirects and never re-issues the request", async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.com/v1/models" },
        }),
    );

    const attempt = metaAdapter.verifyCredential({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "redirect_blocked",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks same-origin redirect chains that exceed the hop limit", async () => {
    const fetchMock = stubFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://api.meta.ai/v1/models" },
        }),
    );

    const attempt = metaAdapter.verifyCredential({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "redirect_blocked",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("maps a non-JSON body to a non-retryable malformed_response error", async () => {
    stubFetch(
      () => new Response("<html>gateway error</html>", { status: 200 }),
    );

    const attempt = metaAdapter.discoverModels({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "malformed_response",
      retryable: false,
    });
  });

  it("rejects a catalog payload without a data array", async () => {
    stubFetch(() => jsonResponse({ object: "list" }));

    const attempt = metaAdapter.discoverModels({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "malformed_response",
      retryable: false,
    });
  });

  it("resolves the fixed chat-completions route regardless of enrichment", () => {
    expect(metaAdapter.resolveRoute({ modelId: "llama-4-maverick" })).toEqual({
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
      origin: "https://api.meta.ai",
    });
    expect(
      metaAdapter.resolveRoute({
        modelId: "llama-4-maverick",
        enrichment: {
          displayName: "Enriched",
          gatewayNpm: "@ai-sdk/openai-compatible",
        },
      }),
    ).toEqual({
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
      origin: "https://api.meta.ai",
    });
  });

  it("constructs a meta chat model without reading process env", async () => {
    delete process.env.LLAMA_API_KEY;
    delete process.env.META_MODEL_API_KEY;

    const model = await metaAdapter.constructModel({
      credentials: CREDENTIAL,
      modelId: "llama-4-maverick",
      route: resolvedRouteOf(
        metaAdapter.resolveRoute({ modelId: "llama-4-maverick" }),
      ),
    });

    expect(model.modelId).toBe("llama-4-maverick");
    expect(model.provider).toBe("meta.chat");
  });
});
