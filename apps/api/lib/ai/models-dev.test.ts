import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_PROVIDER_KINDS } from "@repo/core";
import { AiProviderRequestError } from "./provider-http.js";
import {
  fetchModelsDevEnrichment,
  MODELS_DEV_PROVIDER_SLUGS,
  resetModelsDevCacheForTests,
} from "./models-dev.js";

const REGISTRY_FIXTURE = {
  openai: {
    name: "OpenAI",
    models: {
      "gpt-test": {
        name: "GPT Test",
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 128_000, output: 16_384 },
        tool_call: true,
        structured_output: true,
      },
      "gpt-free": {
        name: "GPT Free",
        tool_call: false,
      },
      "gpt-bad-limits": {
        name: "GPT Bad Limits",
        limit: { context: -5, output: 200_000_000 },
      },
      "gpt-old": {
        name: "GPT Old",
        deprecated: true,
      },
      garbage: "not-an-object",
    },
  },
  anthropic: {
    name: "Anthropic",
    models: {
      "claude-test": {
        name: "Claude Test",
        modalities: { input: ["text", "telepathy"], output: ["text"] },
        limit: { context: 200_000, output: 8192 },
        tool_call: true,
      },
      "claude-npm": {
        name: "Claude NPM",
        limit: { context: 1_000_000 },
        provider: { npm: "@ai-sdk/anthropic" },
      },
      "claude-unknown-modality": {
        name: "Claude Unknown Modality",
        modalities: { input: ["telepathy"], output: ["hologram"] },
      },
      broken: 42,
    },
  },
  opencode: {
    name: "OpenCode Zen",
    models: {
      "zen-claude": {
        name: "Zen Claude",
        limit: { context: 200_000, output: 64_000 },
        provider: { npm: "@ai-sdk/anthropic" },
      },
    },
  },
  meta: { models: "nope" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(impl: () => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => impl());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetModelsDevCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MODELS_DEV_PROVIDER_SLUGS", () => {
  it("maps every provider kind to its Models.dev slug", () => {
    expect(MODELS_DEV_PROVIDER_SLUGS).toEqual({
      openai: "openai",
      anthropic: "anthropic",
      xai: "xai",
      meta: "meta",
      openrouter: "openrouter",
      opencode_zen: "opencode",
      opencode_go: "opencode-go",
    });
  });
});

describe("fetchModelsDevEnrichment", () => {
  it("selects the provider slug per kind from one registry fetch", async () => {
    const fetchMock = stubFetch(() => jsonResponse(REGISTRY_FIXTURE));

    const openai = await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI);
    const zen = await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENCODE_ZEN);
    const go = await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENCODE_GO);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://models.dev/api.json");

    expect(openai.size).toBe(4);
    expect(openai.has("gpt-test")).toBe(true);
    expect(openai.has("zen-claude")).toBe(false);
    expect(zen.size).toBe(1);
    expect(zen.has("zen-claude")).toBe(true);
    expect(zen.has("gpt-test")).toBe(false);
    expect(go.size).toBe(0);
  });

  it("maps enrichment fields for well-formed models", async () => {
    stubFetch(() => jsonResponse(REGISTRY_FIXTURE));

    const openai = await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI);
    expect(openai.get("gpt-test")).toEqual({
      displayName: "GPT Test",
      contextWindowTokens: 128_000,
      maxOutputTokens: 16_384,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      supportsToolCalls: true,
      supportsStructuredOutput: true,
    });
    expect(openai.get("gpt-free")).toEqual({
      displayName: "GPT Free",
      supportsToolCalls: false,
    });
    expect(openai.get("gpt-old")).toEqual({
      displayName: "GPT Old",
      deprecated: true,
    });

    const anthropic = await fetchModelsDevEnrichment(
      AI_PROVIDER_KINDS.ANTHROPIC,
    );
    expect(anthropic.get("claude-test")).toEqual({
      displayName: "Claude Test",
      inputModalities: ["text"],
      outputModalities: ["text"],
      contextWindowTokens: 200_000,
      maxOutputTokens: 8192,
      supportsToolCalls: true,
    });
    expect(anthropic.get("claude-npm")).toEqual({
      displayName: "Claude NPM",
      contextWindowTokens: 1_000_000,
      gatewayNpm: "@ai-sdk/anthropic",
    });
    expect(anthropic.get("claude-unknown-modality")).toEqual({
      displayName: "Claude Unknown Modality",
    });

    const zen = await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENCODE_ZEN);
    expect(zen.get("zen-claude")).toEqual({
      displayName: "Zen Claude",
      contextWindowTokens: 200_000,
      maxOutputTokens: 64_000,
      gatewayNpm: "@ai-sdk/anthropic",
    });
  });

  it("omits fields outside the shared catalog bounds or of the wrong type", async () => {
    stubFetch(() => jsonResponse(REGISTRY_FIXTURE));
    const openai = await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI);

    expect(openai.get("gpt-bad-limits")).toEqual({
      displayName: "GPT Bad Limits",
    });
  });

  it("skips malformed models and providers", async () => {
    stubFetch(() => jsonResponse(REGISTRY_FIXTURE));

    const openai = await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI);
    expect(openai.has("garbage")).toBe(false);

    const anthropic = await fetchModelsDevEnrichment(
      AI_PROVIDER_KINDS.ANTHROPIC,
    );
    expect(anthropic.has("broken")).toBe(false);

    const meta = await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.META);
    expect(meta.size).toBe(0);
  });

  it("returns an empty map for malformed registry documents", async () => {
    stubFetch(() => jsonResponse(["not", "a", "record"]));
    expect(
      (await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI)).size,
    ).toBe(0);

    resetModelsDevCacheForTests();
    stubFetch(() => jsonResponse("not a registry"));
    expect(
      (await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI)).size,
    ).toBe(0);
  });

  it("caches the registry document within the TTL and refetches after expiry", async () => {
    const fetchMock = stubFetch(() => jsonResponse(REGISTRY_FIXTURE));
    let currentTime = 1_000_000;
    const now = () => currentTime;

    await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI, { now });
    currentTime += 60_000;
    await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.ANTHROPIC, { now });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    currentTime += 3_600_000;
    await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI, { now });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches after the test-only cache reset", async () => {
    const fetchMock = stubFetch(() => jsonResponse(REGISTRY_FIXTURE));

    await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI);
    await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resetModelsDevCacheForTests();
    await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("inherits the provider npm when a model does not declare its own", async () => {
    stubFetch(() =>
      jsonResponse({
        "opencode-go": {
          npm: "@ai-sdk/openai-compatible",
          models: {
            "kimi-k2.6": { name: "Kimi K2.6", limit: { context: 256_000 } },
            "minimax-m3": {
              name: "MiniMax M3",
              provider: { npm: "@ai-sdk/anthropic" },
            },
            "grok-4.6": {
              name: "Grok 4.6",
              provider: { npm: "@ai-sdk/openai" },
            },
          },
        },
      }),
    );

    const go = await fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENCODE_GO);
    expect(go.get("kimi-k2.6")?.gatewayNpm).toBe("@ai-sdk/openai-compatible");
    expect(go.get("minimax-m3")?.gatewayNpm).toBe("@ai-sdk/anthropic");
    expect(go.get("grok-4.6")?.gatewayNpm).toBe("@ai-sdk/openai");
  });

  it("propagates AiProviderRequestError from failed fetches", async () => {
    stubFetch(() => jsonResponse({ error: "boom" }, 500));

    const attempt = fetchModelsDevEnrichment(AI_PROVIDER_KINDS.OPENAI);
    await expect(attempt).rejects.toBeInstanceOf(AiProviderRequestError);
    await expect(attempt).rejects.toMatchObject({
      code: "transient",
      retryable: true,
    });
  });
});
