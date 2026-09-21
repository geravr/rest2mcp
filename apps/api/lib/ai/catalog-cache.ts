/**
 * Credential-revision-aware in-memory catalog cache for AI connections.
 *
 * Same-process only by design: duplicate refreshes across instances are
 * accepted, and correctness relies on live provider data and persisted
 * verification fingerprints, never on cache coherence.
 *
 * Core invalidation guarantee: a rotated credential revision never serves the
 * previous revision's catalog, not even as a visibly-stale fallback.
 */
import type { AiModelDescriptor } from "@repo/core";

export type AiCatalogCacheEntry = {
  descriptors: AiModelDescriptor[];
  retrievedAt: Date;
  credentialRevision: number;
  adapterVersion: number;
};

export type AiCatalogCacheKeyInput = {
  connectionId: string;
  credentialRevision: number;
  adapterVersion: number;
};

export type AiCatalogCacheStaleInput = {
  connectionId: string;
  credentialRevision: number;
  now?: Date;
};

const DEFAULT_TTL_MS = 600_000;
const DEFAULT_MAX_ENTRIES = 256;

type AiCatalogCacheRecord = {
  entry: AiCatalogCacheEntry;
  /** Write recency used by stale fallback; distinct from LRU read order. */
  setAt: number;
};

/** Deterministic cache key joining connectionId, credentialRevision, and adapterVersion. */
export function buildCatalogCacheKey(input: AiCatalogCacheKeyInput): string {
  return `${input.connectionId}:${input.credentialRevision}:${input.adapterVersion}`;
}

export class AiCatalogCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  /** Insertion order is the LRU order; hits and overwrites re-insert at the end. */
  private readonly records = new Map<string, AiCatalogCacheRecord>();

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /** Returns the cached entry, or null when missing or expired; expired entries are deleted. */
  get(key: string, now: Date = new Date()): AiCatalogCacheEntry | null {
    const record = this.records.get(key);
    if (!record) return null;
    if (now.getTime() - record.entry.retrievedAt.getTime() >= this.ttlMs) {
      this.records.delete(key);
      return null;
    }
    this.records.delete(key);
    this.records.set(key, record);
    return record.entry;
  }

  /** Inserts or overwrites an entry, evicting the least-recently-used beyond maxEntries. */
  set(key: string, entry: AiCatalogCacheEntry, now: Date = new Date()): void {
    this.records.delete(key);
    this.records.set(key, { entry, setAt: now.getTime() });
    while (this.records.size > this.maxEntries) {
      const oldest = this.records.keys().next();
      if (oldest.done) break;
      this.records.delete(oldest.value);
    }
  }

  /** Drops every entry whose key begins with `${connectionId}:`. */
  invalidateConnection(connectionId: string): void {
    const prefix = `${connectionId}:`;
    for (const key of this.records.keys()) {
      if (key.startsWith(prefix)) {
        this.records.delete(key);
      }
    }
  }

  /**
   * Returns the entry most recently set for the same connection and credential
   * revision, expired or not, for visibly-stale fallback. Returns null for a
   * different revision: a rotated credential never serves the old catalog.
   */
  getStaleForConnection(
    input: AiCatalogCacheStaleInput,
  ): AiCatalogCacheEntry | null {
    const prefix = `${input.connectionId}:`;
    let best: AiCatalogCacheRecord | null = null;
    for (const [key, record] of this.records) {
      if (!key.startsWith(prefix)) continue;
      if (record.entry.credentialRevision !== input.credentialRevision)
        continue;
      if (!best || record.setAt > best.setAt) {
        best = record;
      }
    }
    return best ? best.entry : null;
  }
}
