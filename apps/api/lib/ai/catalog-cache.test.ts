import { describe, expect, it } from "vitest";
import {
  AiCatalogCache,
  buildCatalogCacheKey,
  type AiCatalogCacheEntry,
} from "./catalog-cache.js";

function makeEntry(
  overrides: Partial<AiCatalogCacheEntry> = {},
): AiCatalogCacheEntry {
  return {
    descriptors: [],
    retrievedAt: new Date(1_000_000),
    credentialRevision: 1,
    adapterVersion: 3,
    ...overrides,
  };
}

function keyFor(
  connectionId: string,
  credentialRevision: number,
  adapterVersion: number,
): string {
  return buildCatalogCacheKey({
    connectionId,
    credentialRevision,
    adapterVersion,
  });
}

describe("buildCatalogCacheKey", () => {
  it("joins the key parts deterministically", () => {
    const key = keyFor("conn-1", 7, 2);
    expect(key).toBe("conn-1:7:2");
    expect(keyFor("conn-1", 7, 2)).toBe(key);
  });

  it("differs across connections, revisions, and adapter versions", () => {
    expect(keyFor("conn-2", 7, 2)).not.toBe(keyFor("conn-1", 7, 2));
    expect(keyFor("conn-1", 8, 2)).not.toBe(keyFor("conn-1", 7, 2));
    expect(keyFor("conn-1", 7, 3)).not.toBe(keyFor("conn-1", 7, 2));
  });
});

describe("AiCatalogCache", () => {
  it("round-trips entries by key and returns null for missing keys", () => {
    const cache = new AiCatalogCache();
    const key = keyFor("conn-1", 1, 3);
    const entry = makeEntry();

    cache.set(key, entry, new Date(0));

    expect(cache.get(key, new Date(1000))).toEqual(entry);
    expect(cache.get("missing", new Date(1000))).toBeNull();
  });

  it("overwrites an existing key", () => {
    const cache = new AiCatalogCache();
    const key = keyFor("conn-1", 1, 3);
    const first = makeEntry({ retrievedAt: new Date(0) });
    const second = makeEntry({ retrievedAt: new Date(5000) });

    cache.set(key, first, new Date(0));
    cache.set(key, second, new Date(5000));

    expect(cache.get(key, new Date(5000))).toEqual(second);
  });

  it("expires entries after the TTL and deletes them", () => {
    const cache = new AiCatalogCache();
    const key = keyFor("conn-1", 1, 3);

    cache.set(key, makeEntry({ retrievedAt: new Date(0) }), new Date(0));

    expect(cache.get(key, new Date(599_999))).not.toBeNull();
    expect(cache.get(key, new Date(600_000))).toBeNull();
    expect(cache.get(key, new Date(601_000))).toBeNull();
  });

  it("honors a custom TTL", () => {
    const cache = new AiCatalogCache({ ttlMs: 1000 });
    const key = keyFor("conn-1", 1, 3);

    cache.set(key, makeEntry({ retrievedAt: new Date(0) }), new Date(0));

    expect(cache.get(key, new Date(999))).not.toBeNull();
    expect(cache.get(key, new Date(1000))).toBeNull();
  });

  it("serves a same-revision entry as stale fallback even after expiry", () => {
    const cache = new AiCatalogCache({ ttlMs: 1000 });
    const key = keyFor("conn-1", 4, 3);
    const entry = makeEntry({
      retrievedAt: new Date(0),
      credentialRevision: 4,
    });

    cache.set(key, entry, new Date(0));

    const stale = cache.getStaleForConnection({
      connectionId: "conn-1",
      credentialRevision: 4,
      now: new Date(10_000),
    });
    expect(stale).toEqual(entry);
  });

  it("never serves a different revision or unknown connection as stale fallback", () => {
    const cache = new AiCatalogCache();
    cache.set(
      keyFor("conn-1", 4, 3),
      makeEntry({ credentialRevision: 4 }),
      new Date(0),
    );

    expect(
      cache.getStaleForConnection({
        connectionId: "conn-1",
        credentialRevision: 5,
        now: new Date(1000),
      }),
    ).toBeNull();
    expect(
      cache.getStaleForConnection({
        connectionId: "conn-2",
        credentialRevision: 4,
        now: new Date(1000),
      }),
    ).toBeNull();
  });

  it("prefers the most recently set stale entry across adapter versions", () => {
    const first = new AiCatalogCache();
    first.set(
      keyFor("conn-1", 4, 2),
      makeEntry({ credentialRevision: 4, adapterVersion: 2 }),
      new Date(0),
    );
    first.set(
      keyFor("conn-1", 4, 3),
      makeEntry({ credentialRevision: 4, adapterVersion: 3 }),
      new Date(1000),
    );
    expect(
      first.getStaleForConnection({
        connectionId: "conn-1",
        credentialRevision: 4,
        now: new Date(2000),
      })?.adapterVersion,
    ).toBe(3);

    const second = new AiCatalogCache();
    second.set(
      keyFor("conn-1", 4, 3),
      makeEntry({ credentialRevision: 4, adapterVersion: 3 }),
      new Date(0),
    );
    second.set(
      keyFor("conn-1", 4, 2),
      makeEntry({ credentialRevision: 4, adapterVersion: 2 }),
      new Date(1000),
    );
    expect(
      second.getStaleForConnection({
        connectionId: "conn-1",
        credentialRevision: 4,
        now: new Date(2000),
      })?.adapterVersion,
    ).toBe(2);
  });

  it("drops every revision of a connection on invalidation", () => {
    const cache = new AiCatalogCache();
    const rev1Key = keyFor("conn-1", 1, 3);
    const rev2Key = keyFor("conn-1", 2, 3);
    const otherKey = keyFor("conn-2", 1, 3);
    cache.set(rev1Key, makeEntry({ credentialRevision: 1 }), new Date(0));
    cache.set(rev2Key, makeEntry({ credentialRevision: 2 }), new Date(0));
    cache.set(otherKey, makeEntry({ credentialRevision: 1 }), new Date(0));

    cache.invalidateConnection("conn-1");

    expect(cache.get(rev1Key, new Date(1000))).toBeNull();
    expect(cache.get(rev2Key, new Date(1000))).toBeNull();
    expect(
      cache.getStaleForConnection({
        connectionId: "conn-1",
        credentialRevision: 1,
        now: new Date(1000),
      }),
    ).toBeNull();
    expect(
      cache.getStaleForConnection({
        connectionId: "conn-1",
        credentialRevision: 2,
        now: new Date(1000),
      }),
    ).toBeNull();
    expect(cache.get(otherKey, new Date(1000))).not.toBeNull();
  });

  it("evicts the least-recently-used entry beyond maxEntries", () => {
    const cache = new AiCatalogCache({ maxEntries: 2 });
    const keyA = keyFor("a", 1, 1);
    const keyB = keyFor("b", 1, 1);
    const keyC = keyFor("c", 1, 1);

    cache.set(keyA, makeEntry(), new Date(0));
    cache.set(keyB, makeEntry(), new Date(0));
    cache.get(keyA, new Date(1000));
    cache.set(keyC, makeEntry(), new Date(1000));

    expect(cache.get(keyA, new Date(1000))).not.toBeNull();
    expect(cache.get(keyC, new Date(1000))).not.toBeNull();
    expect(cache.get(keyB, new Date(1000))).toBeNull();
  });

  it("evicts the oldest entry when nothing was read", () => {
    const cache = new AiCatalogCache({ maxEntries: 2 });
    const keyA = keyFor("a", 1, 1);
    const keyB = keyFor("b", 1, 1);
    const keyC = keyFor("c", 1, 1);

    cache.set(keyA, makeEntry(), new Date(0));
    cache.set(keyB, makeEntry(), new Date(0));
    cache.set(keyC, makeEntry(), new Date(0));

    expect(cache.get(keyA, new Date(1000))).toBeNull();
    expect(cache.get(keyB, new Date(1000))).not.toBeNull();
    expect(cache.get(keyC, new Date(1000))).not.toBeNull();
  });
});
