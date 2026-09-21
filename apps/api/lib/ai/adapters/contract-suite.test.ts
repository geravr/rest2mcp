/**
 * Common adapter contract suite (task 4.8). Every supported adapter must
 * pass the same bounded-HTTP fixture scenarios: authentication failure,
 * transient failure, malformed catalog entries, unsafe redirects, oversized
 * responses, and unknown protocol metadata. Provider-specific unit tests
 * cover parsing details; this suite guarantees uniform failure semantics.
 */
import { AI_PROVIDER_KINDS } from "@repo/core";
import { describe, expect, it, vi } from "vitest";
import { AiProviderRequestError } from "../provider-http.js";
import type {
  AiModelEnrichment,
  AiProviderAdapter,
} from "../provider-adapter.js";
import { openAiAdapter } from "./openai.js";
import { anthropicAdapter } from "./anthropic.js";
import { xaiAdapter } from "./xai.js";
import { metaAdapter } from "./meta.js";
import { openRouterAdapter } from "./openrouter.js";
import { opencodeZenAdapter } from "./opencode-zen.js";
import { opencodeGoAdapter } from "./opencode-go.js";
import type { AiCatalogCandidate } from "../catalog-normalize.js";

const MAX_RESPONSE_BYTES = 2_000_000;

type AdapterContract = {
  name: string;
  adapter: AiProviderAdapter;
  /** A discovery payload with two valid entries and one malformed entry. */
  discoveryBody: unknown;
  validEntryCount: number;
  /**
   * True when the route resolves without per-model metadata: direct
   * adapters statically, and OpenRouter because the gateway itself fixes
   * the transport for every model. Model-dependent gateways (OpenCode)
   * must fail closed instead.
   */
  routeResolvesWithoutModelMetadata: boolean;
};

const simpleEntry = (id: string) => ({ id });

const contracts: AdapterContract[] = [
  {
    name: "openai",
    adapter: openAiAdapter,
    discoveryBody: {
      data: [simpleEntry("model-a"), { broken: true }, simpleEntry("model-b")],
    },
    validEntryCount: 2,
    routeResolvesWithoutModelMetadata: true,
  },
  {
    name: "anthropic",
    adapter: anthropicAdapter,
    discoveryBody: {
      data: [
        { id: "model-a", display_name: "Model A", type: "model" },
        { broken: true },
        { id: "model-b", display_name: "Model B", type: "model" },
      ],
    },
    validEntryCount: 2,
    routeResolvesWithoutModelMetadata: true,
  },
  {
    name: "xai",
    adapter: xaiAdapter,
    discoveryBody: {
      data: [simpleEntry("model-a"), { broken: true }, simpleEntry("model-b")],
    },
    validEntryCount: 2,
    routeResolvesWithoutModelMetadata: true,
  },
  {
    name: "meta",
    adapter: metaAdapter,
    discoveryBody: {
      data: [simpleEntry("model-a"), { broken: true }, simpleEntry("model-b")],
    },
    validEntryCount: 2,
    routeResolvesWithoutModelMetadata: true,
  },
  {
    name: "openrouter",
    adapter: openRouterAdapter,
    discoveryBody: {
      data: [
        {
          id: "model-a",
          name: "Model A",
          context_length: 32_768,
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          supported_parameters: ["structured_outputs"],
        },
        { broken: true },
      ],
    },
    validEntryCount: 1,
    routeResolvesWithoutModelMetadata: true,
  },
  {
    name: "opencode_zen",
    adapter: opencodeZenAdapter,
    discoveryBody: {
      data: [simpleEntry("model-a"), { broken: true }, simpleEntry("model-b")],
    },
    validEntryCount: 2,
    routeResolvesWithoutModelMetadata: false,
  },
  {
    name: "opencode_go",
    adapter: opencodeGoAdapter,
    discoveryBody: {
      data: [simpleEntry("model-a"), { broken: true }, simpleEntry("model-b")],
    },
    validEntryCount: 2,
    routeResolvesWithoutModelMetadata: false,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function stubFetchSequence(responses: Array<Response | Error>): {
  calls: Array<{ url: string }>;
} {
  const calls: Array<{ url: string }> = [];
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push({ url: String(input) });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next;
    }),
  );
  return { calls };
}

const CREDENTIALS = { plaintext: "sk-contract-suite" } as const;

describe.each(contracts)(
  "$name adapter contract",
  ({
    adapter,
    discoveryBody,
    validEntryCount,
    routeResolvesWithoutModelMetadata,
  }) => {
    it("discovers bounded entries and skips malformed ones", async () => {
      const { calls } = stubFetchSequence([jsonResponse(discoveryBody)]);
      try {
        const candidates = await adapter.discoverModels({
          credentials: CREDENTIALS,
        });
        expect(candidates.length).toBe(validEntryCount);
        for (const candidate of candidates as AiCatalogCandidate[]) {
          expect(typeof candidate.modelId).toBe("string");
          expect((candidate.modelId as string).length).toBeGreaterThan(0);
        }
        expect(calls.length).toBe(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("maps an authentication failure to a non-retryable unauthorized error", async () => {
      stubFetchSequence([jsonResponse({ error: "denied" }, 401)]);
      try {
        await expect(
          adapter.verifyCredential({ credentials: CREDENTIALS }),
        ).rejects.toMatchObject({ code: "unauthorized", retryable: false });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("maps transient failures to retryable errors", async () => {
      stubFetchSequence([jsonResponse({ error: "down" }, 500)]);
      try {
        await expect(
          adapter.discoverModels({ credentials: CREDENTIALS }),
        ).rejects.toMatchObject({ code: "transient", retryable: true });
      } finally {
        vi.unstubAllGlobals();
      }
      stubFetchSequence([jsonResponse({ error: "slow down" }, 429)]);
      try {
        await expect(
          adapter.discoverModels({ credentials: CREDENTIALS }),
        ).rejects.toMatchObject({ code: "rate_limited", retryable: true });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("blocks unsafe redirects without forwarding the credential a second time", async () => {
      const { calls } = stubFetchSequence([
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.com/v1/models" },
        }),
      ]);
      try {
        await expect(
          adapter.discoverModels({ credentials: CREDENTIALS }),
        ).rejects.toMatchObject({ code: "redirect_blocked", retryable: false });
        expect(calls).toHaveLength(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("aborts oversized responses with a size-bound error", async () => {
      stubFetchSequence([new Response("x".repeat(MAX_RESPONSE_BYTES + 1024))]);
      try {
        await expect(
          adapter.discoverModels({ credentials: CREDENTIALS }),
        ).rejects.toMatchObject({ code: "response_too_large" });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("maps a non-JSON body to a malformed_response error", async () => {
      stubFetchSequence([
        new Response("<html>not json</html>", { status: 200 }),
      ]);
      try {
        await expect(
          adapter.discoverModels({ credentials: CREDENTIALS }),
        ).rejects.toMatchObject({ code: "malformed_response" });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("fails closed on unknown protocol metadata", () => {
      const unknownEnrichment: AiModelEnrichment = {
        gatewayNpm: "not-a-known-sdk",
      };
      const route = adapter.resolveRoute({
        modelId: "model-a",
        enrichment: unknownEnrichment,
      });
      if (routeResolvesWithoutModelMetadata) {
        expect(route.status).toBe("resolved");
      } else {
        // Model-dependent gateways must never guess a transport from
        // unknown metadata.
        expect(route.status).toBe("unresolved");
      }
    });

    it("never exposes the credential or provider body in thrown errors", async () => {
      stubFetchSequence([
        jsonResponse({ error: `leak ${CREDENTIALS.plaintext}` }, 403),
      ]);
      try {
        const error = await adapter
          .verifyCredential({ credentials: CREDENTIALS })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(error).toBeInstanceOf(AiProviderRequestError);
        expect(JSON.stringify(error)).not.toContain(CREDENTIALS.plaintext);
        expect(JSON.stringify(error)).not.toContain("leak");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  },
);

it("registers exactly the seven supported provider kinds", () => {
  const kinds = contracts.map((contract) => contract.name).sort();
  expect(kinds).toEqual([...Object.values(AI_PROVIDER_KINDS)].sort());
});
