/**
 * Bounded normalization of provider catalog entries into shared
 * `AiModelDescriptor` values. Every candidate is isolated: one malformed or
 * oversized entry is skipped without failing otherwise valid entries. Output
 * is deduplicated and sorted deterministically.
 */
import {
  AI_CATALOG_BOUNDS,
  AI_MODALITIES,
  type AiModality,
  type AiModelDescriptor,
  type AiModelRoute,
} from "@repo/core";

/**
 * Provider-agnostic weakly-typed candidate produced by an adapter. The
 * normalizer enforces every bound and type; adapters only extract raw
 * fields from their provider payload.
 */
export type AiCatalogCandidate = {
  modelId: unknown;
  displayName?: unknown;
  inputModalities?: unknown;
  outputModalities?: unknown;
  contextWindowTokens?: unknown;
  maxOutputTokens?: unknown;
  supportsToolCalls?: unknown;
  supportsStructuredOutput?: unknown;
  deprecated?: unknown;
  route: AiModelRoute;
  confidence: "provider" | "provider_enriched";
};

export type AiNormalizedCatalog = {
  entries: AiModelDescriptor[];
  skipped: number;
};

const KNOWN_MODALITIES: readonly string[] = Object.values(AI_MODALITIES);

function normalizeModalityList(raw: unknown): AiModality[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value === "string" && KNOWN_MODALITIES.includes(value)) {
      seen.add(value);
    }
    if (seen.size >= AI_CATALOG_BOUNDS.MAX_MODALITY_ENTRIES) break;
  }
  return [...seen] as AiModality[];
}

function normalizePositiveInt(raw: unknown, max: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const rounded = Math.floor(raw);
  if (rounded <= 0 || rounded > max) return null;
  return rounded;
}

function normalizeBoolean(raw: unknown): boolean | null {
  return typeof raw === "boolean" ? raw : null;
}

function normalizeString(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function normalizeDescriptor(
  candidate: AiCatalogCandidate,
): AiModelDescriptor | null {
  const modelId = normalizeString(
    candidate.modelId,
    AI_CATALOG_BOUNDS.MODEL_ID_MAX_LENGTH,
  );
  if (!modelId) return null;
  const displayName =
    normalizeString(
      candidate.displayName,
      AI_CATALOG_BOUNDS.MODEL_NAME_MAX_LENGTH,
    ) ?? modelId.slice(0, AI_CATALOG_BOUNDS.MODEL_NAME_MAX_LENGTH);

  return {
    modelId,
    displayName,
    inputModalities: normalizeModalityList(candidate.inputModalities),
    outputModalities: normalizeModalityList(candidate.outputModalities),
    contextWindowTokens: normalizePositiveInt(
      candidate.contextWindowTokens,
      AI_CATALOG_BOUNDS.CONTEXT_TOKENS_MAX,
    ),
    maxOutputTokens: normalizePositiveInt(
      candidate.maxOutputTokens,
      AI_CATALOG_BOUNDS.CONTEXT_TOKENS_MAX,
    ),
    supportsToolCalls: normalizeBoolean(candidate.supportsToolCalls),
    supportsStructuredOutput: normalizeBoolean(
      candidate.supportsStructuredOutput,
    ),
    route: candidate.route,
    confidence: candidate.confidence,
    deprecated: candidate.deprecated === true,
  };
}

function compareDescriptors(
  a: AiModelDescriptor,
  b: AiModelDescriptor,
): number {
  const byName = a.displayName.localeCompare(b.displayName);
  if (byName !== 0) return byName;
  return a.modelId.localeCompare(b.modelId);
}

/**
 * Normalizes raw catalog candidates. Malformed candidates are counted and
 * skipped; the result never exceeds the shared entry bound.
 */
export function normalizeCatalogCandidates(
  candidates: readonly AiCatalogCandidate[],
): AiNormalizedCatalog {
  const byModelId = new Map<string, AiModelDescriptor>();
  let skipped = 0;

  for (const candidate of candidates) {
    let descriptor: AiModelDescriptor | null = null;
    try {
      descriptor = normalizeDescriptor(candidate);
    } catch {
      descriptor = null;
    }
    if (!descriptor || byModelId.has(descriptor.modelId)) {
      skipped += 1;
      continue;
    }
    byModelId.set(descriptor.modelId, descriptor);
  }

  const entries = [...byModelId.values()].sort(compareDescriptors);
  const bounded = entries.slice(0, AI_CATALOG_BOUNDS.MAX_ENTRIES);
  skipped += entries.length - bounded.length;

  return { entries: bounded, skipped };
}

/**
 * Conservative id-pattern classification shared by OpenAI-compatible direct
 * providers whose catalog response carries no modality metadata. It is not a
 * selectable-model allowlist: it only marks obvious non-language families so
 * they are excluded from language profiles. Unrecognized ids are treated as
 * text-in/text-out candidates and remain gated by enrichment and the
 * verification smoke test.
 */
const NON_LANGUAGE_ID_PATTERN =
  /embed|whisper|tts|dall-e|moderation|image|video|audio|transcrib|realtime|sora|speech|voice|vision-enc|clip/i;

export function classifyOpenAiCompatibleModalities(modelId: string): {
  inputModalities: AiModality[];
  outputModalities: AiModality[];
} {
  if (NON_LANGUAGE_ID_PATTERN.test(modelId)) {
    return { inputModalities: [], outputModalities: [] };
  }
  return {
    inputModalities: [AI_MODALITIES.TEXT],
    outputModalities: [AI_MODALITIES.TEXT],
  };
}
