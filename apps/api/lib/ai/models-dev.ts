/**
 * Client for the Models.dev public registry, used as optional catalog
 * enrichment.
 *
 * SAFETY INVARIANT: enrichment only annotates entries the authenticated
 * provider catalog already returned. The service layer intersects this
 * metadata with provider descriptors by model id, so the registry can never
 * add account-inaccessible models or make unresolved gateway routes
 * selectable. This module only ever returns metadata keyed by model id.
 *
 * The full registry document is fetched once per process refresh through the
 * bounded provider HTTP client and cached in memory for one hour. The
 * response cap is larger than the single-provider catalog cap because the
 * registry document covers every provider at once. Parsing is defensive:
 * malformed providers and models are skipped, optional fields are omitted
 * rather than nulled, and output is bounded per provider slug. Fetch failures
 * propagate as AiProviderRequestError with the provider-http retryable
 * mapping intact.
 */
import {
  AI_CATALOG_BOUNDS,
  AI_MODALITIES,
  AI_PROVIDER_KINDS,
  isStrictRecord,
  type AiModality,
  type AiProviderKind,
} from "@repo/core";
import type { AiModelEnrichment } from "./provider-adapter.js";
import { aiProviderFetchJson, type AiHttpPolicy } from "./provider-http.js";

const MODELS_DEV_URL = "https://models.dev/api.json";
const MODELS_DEV_CACHE_TTL_MS = 3_600_000;
const MODELS_DEV_MAX_ENRICHMENT_ENTRIES = 5000;

const MODELS_DEV_POLICY: AiHttpPolicy = {
  allowedOrigins: ["https://models.dev"],
  deadlineMs: 15_000,
  maxResponseBytes: 10_000_000,
  maxRedirects: 2,
};

/** Models.dev provider slug for every supported provider kind. */
export const MODELS_DEV_PROVIDER_SLUGS: Record<AiProviderKind, string> = {
  [AI_PROVIDER_KINDS.OPENAI]: "openai",
  [AI_PROVIDER_KINDS.ANTHROPIC]: "anthropic",
  [AI_PROVIDER_KINDS.XAI]: "xai",
  [AI_PROVIDER_KINDS.META]: "meta",
  [AI_PROVIDER_KINDS.OPENROUTER]: "openrouter",
  [AI_PROVIDER_KINDS.OPENCODE_ZEN]: "opencode",
  [AI_PROVIDER_KINDS.OPENCODE_GO]: "opencode-go",
};

const KNOWN_MODALITIES: ReadonlyMap<string, AiModality> = new Map(
  Object.values(AI_MODALITIES).map((modality) => [modality, modality]),
);

type ModelsDevDocument = Record<string, unknown>;

type ModelsDevDocumentCache = {
  document: ModelsDevDocument;
  cachedAt: number;
};

let documentCache: ModelsDevDocumentCache | null = null;

/** Clears the in-memory registry document cache. Test-only. */
export function resetModelsDevCacheForTests(): void {
  documentCache = null;
}

export type FetchModelsDevEnrichmentOptions = {
  /** Injectable clock for TTL determinism; defaults to Date.now. */
  now?: () => number;
};

/**
 * Returns Models.dev enrichment for one provider slug, keyed by model id.
 * Enrichment is advisory metadata only; callers must intersect it with an
 * authenticated provider catalog by model id before use.
 */
export async function fetchModelsDevEnrichment(
  kind: AiProviderKind,
  options: FetchModelsDevEnrichmentOptions = {},
): Promise<Map<string, AiModelEnrichment>> {
  const now = options.now ?? Date.now;
  const document = await loadModelsDevDocument(now);
  return parseProviderEnrichment(document, MODELS_DEV_PROVIDER_SLUGS[kind]);
}

async function loadModelsDevDocument(
  now: () => number,
): Promise<ModelsDevDocument> {
  const cached = documentCache;
  if (cached && now() - cached.cachedAt < MODELS_DEV_CACHE_TTL_MS) {
    return cached.document;
  }
  const { json } = await aiProviderFetchJson({
    url: MODELS_DEV_URL,
    headers: {},
    policy: MODELS_DEV_POLICY,
  });
  const document: ModelsDevDocument = isStrictRecord(json) ? json : {};
  documentCache = { document, cachedAt: now() };
  return document;
}

function parseProviderEnrichment(
  document: ModelsDevDocument,
  slug: string,
): Map<string, AiModelEnrichment> {
  const enrichmentByModelId = new Map<string, AiModelEnrichment>();
  const provider = document[slug];
  if (!isStrictRecord(provider)) return enrichmentByModelId;
  const models = provider["models"];
  if (!isStrictRecord(models)) return enrichmentByModelId;

  const defaultGatewayNpm = parseNpm(provider["npm"]);

  for (const [modelId, rawModel] of Object.entries(models)) {
    if (enrichmentByModelId.size >= MODELS_DEV_MAX_ENRICHMENT_ENTRIES) break;
    if (
      modelId.length === 0 ||
      modelId.length > AI_CATALOG_BOUNDS.MODEL_ID_MAX_LENGTH
    ) {
      continue;
    }
    const enrichment = parseEnrichment(rawModel) ?? {};
    if (!enrichment.gatewayNpm && defaultGatewayNpm) {
      enrichment.gatewayNpm = defaultGatewayNpm;
    }
    if (Object.keys(enrichment).length === 0) continue;
    enrichmentByModelId.set(modelId, enrichment);
  }
  return enrichmentByModelId;
}

function parseNpm(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const npm = raw.trim();
  return npm.length > 0 ? npm : undefined;
}

function parseEnrichment(raw: unknown): AiModelEnrichment | null {
  if (!isStrictRecord(raw)) return null;
  const enrichment: AiModelEnrichment = {};

  const displayName = parseDisplayName(raw["name"]);
  if (displayName !== null) {
    enrichment.displayName = displayName;
  }

  const limit = raw["limit"];
  if (isStrictRecord(limit)) {
    const contextWindowTokens = parseTokenLimit(limit["context"]);
    if (contextWindowTokens !== null) {
      enrichment.contextWindowTokens = contextWindowTokens;
    }
    const maxOutputTokens = parseTokenLimit(limit["output"]);
    if (maxOutputTokens !== null) {
      enrichment.maxOutputTokens = maxOutputTokens;
    }
  }

  const modalities = raw["modalities"];
  if (isStrictRecord(modalities)) {
    const inputModalities = parseModalityList(modalities["input"]);
    if (inputModalities !== null) {
      enrichment.inputModalities = inputModalities;
    }
    const outputModalities = parseModalityList(modalities["output"]);
    if (outputModalities !== null) {
      enrichment.outputModalities = outputModalities;
    }
  }

  const supportsToolCalls = raw["tool_call"];
  if (typeof supportsToolCalls === "boolean") {
    enrichment.supportsToolCalls = supportsToolCalls;
  }
  const supportsStructuredOutput = raw["structured_output"];
  if (typeof supportsStructuredOutput === "boolean") {
    enrichment.supportsStructuredOutput = supportsStructuredOutput;
  }

  const deprecated = raw["deprecated"];
  if (typeof deprecated === "boolean") {
    enrichment.deprecated = deprecated;
  }

  const providerHint = raw["provider"];
  if (isStrictRecord(providerHint)) {
    const gatewayNpm = parseNpm(providerHint["npm"]);
    if (gatewayNpm) enrichment.gatewayNpm = gatewayNpm;
  }

  return Object.keys(enrichment).length > 0 ? enrichment : null;
}

function parseDisplayName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, AI_CATALOG_BOUNDS.MODEL_NAME_MAX_LENGTH);
}

function parseTokenLimit(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const tokens = Math.floor(raw);
  if (tokens <= 0 || tokens > AI_CATALOG_BOUNDS.CONTEXT_TOKENS_MAX) return null;
  return tokens;
}

function parseModalityList(raw: unknown): AiModality[] | null {
  if (!Array.isArray(raw)) return null;
  const modalities: AiModality[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const modality = KNOWN_MODALITIES.get(value);
    if (modality && !modalities.includes(modality)) {
      modalities.push(modality);
    }
    if (modalities.length >= AI_CATALOG_BOUNDS.MAX_MODALITY_ENTRIES) break;
  }
  return modalities.length > 0 ? modalities : null;
}
