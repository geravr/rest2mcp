import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL_PROTOCOLS, type AiModelRoute } from "@repo/core";
import { AiProviderRequestError } from "../provider-http.js";
import type { AiResolvedRoute } from "../provider-adapter.js";
import { anthropicAdapter } from "./anthropic.js";

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

describe("anthropicAdapter", () => {
  it("discovers models from /models?limit=1000 with the anthropic auth headers", async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        data: [
          {
            id: "claude-sonnet-4-5",
            type: "model",
            display_name: "Claude Sonnet 4.5",
            created_at: "2025-01-01T00:00:00Z",
          },
        ],
        has_more: false,
      }),
    );

    const candidates = await anthropicAdapter.discoverModels({
      credentials: CREDENTIAL,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.anthropic.com/v1/models?limit=1000");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-api-key")).toBe("test-credential");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      modelId: "claude-sonnet-4-5",
      displayName: "Claude Sonnet 4.5",
      route: {
        status: "resolved",
        protocol: AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
        origin: "https://api.anthropic.com",
      },
      confidence: "provider",
    });
    expect(candidates[0]?.inputModalities).toBeUndefined();
    expect(candidates[0]?.outputModalities).toBeUndefined();
  });

  it("skips entries whose type is present and not model, and entries without an id", async () => {
    stubFetch(() =>
      jsonResponse({
        data: [
          { id: "claude-real", type: "model", display_name: "Claude Real" },
          {
            id: "claude-deleted",
            type: "model_deletion",
            display_name: "Gone",
          },
          { id: "claude-missing-type", display_name: "No Type" },
          { type: "model", display_name: "No Id" },
          "not-an-object",
        ],
      }),
    );

    const candidates = await anthropicAdapter.discoverModels({
      credentials: CREDENTIAL,
    });

    expect(candidates.map((candidate) => candidate.modelId)).toEqual([
      "claude-real",
      "claude-missing-type",
    ]);
  });

  it("maps a 401 to a non-retryable unauthorized error", async () => {
    stubFetch(() => jsonResponse({ error: { message: "invalid key" } }, 401));

    const attempt = anthropicAdapter.verifyCredential({
      credentials: CREDENTIAL,
    });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "unauthorized",
      retryable: false,
    });
  });

  it("maps a 429 to a retryable rate_limited error with retry-after", async () => {
    stubFetch(() =>
      jsonResponse({ error: { message: "slow down" } }, 429, {
        "retry-after": "7",
      }),
    );

    const attempt = anthropicAdapter.discoverModels({
      credentials: CREDENTIAL,
    });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
      retryAfterSeconds: 7,
    });
  });

  it("maps a 500 to a retryable transient error", async () => {
    stubFetch(() => jsonResponse({ error: { message: "boom" } }, 500));

    const attempt = anthropicAdapter.discoverModels({
      credentials: CREDENTIAL,
    });
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

    const attempt = anthropicAdapter.verifyCredential({
      credentials: CREDENTIAL,
    });
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
          headers: {
            location: "https://api.anthropic.com/v1/models?limit=1000",
          },
        }),
    );

    const attempt = anthropicAdapter.verifyCredential({
      credentials: CREDENTIAL,
    });
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

    const attempt = anthropicAdapter.discoverModels({
      credentials: CREDENTIAL,
    });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "malformed_response",
      retryable: false,
    });
  });

  it("rejects a catalog payload without a data array", async () => {
    stubFetch(() => jsonResponse({ has_more: false }));

    const attempt = anthropicAdapter.discoverModels({
      credentials: CREDENTIAL,
    });
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "malformed_response",
      retryable: false,
    });
  });

  it("resolves the fixed messages route regardless of enrichment", () => {
    expect(
      anthropicAdapter.resolveRoute({ modelId: "claude-sonnet-4-5" }),
    ).toEqual({
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
      origin: "https://api.anthropic.com",
    });
    expect(
      anthropicAdapter.resolveRoute({
        modelId: "claude-sonnet-4-5",
        enrichment: {
          displayName: "Enriched",
          gatewayNpm: "@ai-sdk/anthropic",
        },
      }),
    ).toEqual({
      status: "resolved",
      protocol: AI_MODEL_PROTOCOLS.ANTHROPIC_MESSAGES,
      origin: "https://api.anthropic.com",
    });
  });

  it("constructs a messages model without reading process env", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const model = await anthropicAdapter.constructModel({
      credentials: CREDENTIAL,
      modelId: "claude-sonnet-4-5",
      route: resolvedRouteOf(
        anthropicAdapter.resolveRoute({ modelId: "claude-sonnet-4-5" }),
      ),
    });

    expect(model.modelId).toBe("claude-sonnet-4-5");
    expect(model.provider).toBe("anthropic.messages");
  });
});
