import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL_PROTOCOLS, type AiModelRoute } from "@repo/core";
import { AiProviderRequestError } from "../provider-http.js";
import type { AiResolvedRoute } from "../provider-adapter.js";
import { xaiAdapter } from "./xai.js";

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

describe("xaiAdapter", () => {
  it("discovers models from the /models endpoint with the credential header", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        object: "list",
        data: [
          { id: "grok-4", object: "model", created: 1700000000 },
          { id: "grok-embedding", object: "model" },
        ],
      }),
    );

    const candidates = await xaiAdapter.discoverModels({
      credentials: CREDENTIAL,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.x.ai/v1/models");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-credential",
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      modelId: "grok-4",
      inputModalities: ["text"],
      outputModalities: ["text"],
      route: {
        status: "resolved",
        protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
        origin: "https://api.x.ai",
      },
      confidence: "provider",
    });
    expect(candidates[1]).toMatchObject({
      modelId: "grok-embedding",
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
          { id: "grok-real" },
        ],
      }),
    );

    const candidates = await xaiAdapter.discoverModels({
      credentials: CREDENTIAL,
    });

    expect(candidates.map((candidate) => candidate.modelId)).toEqual([
      "grok-real",
    ]);
  });

  it("maps a 401 to a non-retryable unauthorized error", async () => {
    stubFetch(() => jsonResponse({ error: { message: "invalid key" } }, 401));

    const attempt = xaiAdapter.verifyCredential({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "unauthorized",
      retryable: false,
    });
  });

  it("maps a 429 to a retryable rate_limited error with retry-after", async () => {
    stubFetch(() =>
      jsonResponse({ error: { message: "slow down" } }, 429, {
        "retry-after": "2",
      }),
    );

    const attempt = xaiAdapter.discoverModels({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfterSeconds: 2,
    });
  });

  it("maps a 500 to a retryable transient error", async () => {
    stubFetch(() => jsonResponse({ error: { message: "boom" } }, 500));

    const attempt = xaiAdapter.discoverModels({ credentials: CREDENTIAL });
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

    const attempt = xaiAdapter.verifyCredential({ credentials: CREDENTIAL });
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
          headers: { location: "https://api.x.ai/v1/models" },
        }),
    );

    const attempt = xaiAdapter.verifyCredential({ credentials: CREDENTIAL });
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

    const attempt = xaiAdapter.discoverModels({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "malformed_response",
      retryable: false,
    });
  });

  it("rejects a catalog payload without a data array", async () => {
    stubFetch(() => jsonResponse({ object: "list" }));

    const attempt = xaiAdapter.discoverModels({ credentials: CREDENTIAL });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "malformed_response",
      retryable: false,
    });
  });

  it("resolves the fixed chat-completions route regardless of enrichment", () => {
    expect(xaiAdapter.resolveRoute({ modelId: "grok-4" })).toEqual({
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
      origin: "https://api.x.ai",
    });
    expect(
      xaiAdapter.resolveRoute({
        modelId: "grok-4",
        enrichment: { displayName: "Enriched", gatewayNpm: "@ai-sdk/xai" },
      }),
    ).toEqual({
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS,
      origin: "https://api.x.ai",
    });
  });

  it("constructs an xai model without reading process env", async () => {
    delete process.env.XAI_API_KEY;

    const model = await xaiAdapter.constructModel({
      credentials: CREDENTIAL,
      modelId: "grok-4",
      route: resolvedRouteOf(xaiAdapter.resolveRoute({ modelId: "grok-4" })),
    });

    expect(model.modelId).toBe("grok-4");
    expect(model.provider).toBe("xai.responses");
  });
});
