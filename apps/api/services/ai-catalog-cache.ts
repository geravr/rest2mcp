import { AiCatalogCache } from "../lib/ai/catalog-cache.js";

/**
 * Per-process catalog cache shared by the provider services. Cross-instance
 * duplication is accepted by design; correctness relies on live provider
 * data and persisted selection fingerprints, not cache coherence.
 */
export const aiCatalogCache = new AiCatalogCache();
