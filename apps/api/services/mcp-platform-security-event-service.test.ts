import { beforeEach, describe, expect, it, vi } from "vitest";
import { MCP_PLATFORM_SECURITY_EVENT_RETENTION_DAYS } from "@repo/core";

const tables = vi.hoisted(() => {
  const column = (field: string) => ({ field });
  return {
    mcpPlatformSecurityEvent: {
      id: column("id"),
      userId: column("userId"),
      tokenId: column("tokenId"),
      tokenPrefix: column("tokenPrefix"),
      eventType: column("eventType"),
      outcome: column("outcome"),
      scopes: column("scopes"),
      serverId: column("serverId"),
      metadata: column("metadata"),
      createdAt: column("createdAt"),
    },
  };
});

const drizzleFns = vi.hoisted(() => ({
  count: vi.fn(() => ({ kind: "count" })),
  desc: vi.fn((value: unknown) => ({ kind: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
  lt: vi.fn((left: unknown, right: unknown) => ({ kind: "lt", left, right })),
}));

const telemetry = vi.hoisted(() => ({
  captureMcpTelemetry: vi.fn(),
  MCP_TELEMETRY_EVENTS: {
    securityEventPersistFailed: "mcp_platform_security_event_persist_failed",
  },
}));

vi.mock("@repo/db", () => tables);
vi.mock("drizzle-orm", () => drizzleFns);
vi.mock("../lib/mcp-telemetry.js", () => telemetry);

import {
  cleanupExpiredPlatformSecurityEvents,
  ForbiddenSecurityEventMetadataError,
  listPlatformSecurityEvents,
  recordPlatformSecurityEvent,
  recordPlatformSecurityEventBestEffort,
  sanitizePlatformSecurityEventMetadata,
} from "./mcp-platform-security-event-service.js";

type SecurityRow = {
  id: string;
  userId: string;
  eventType: string;
  outcome: string;
  scopes: string[] | null;
  serverId: string | null;
  tokenPrefix: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

type DrizzleCall = { method: string; args: unknown[] };

/**
 * Minimal in-memory Drizzle stand-in. It actually evaluates the `where`
 * predicate against a dataset so owner isolation, pagination totals, and
 * retention cutoffs are exercised rather than just asserted by call shape.
 */
function makeDb(
  dataset: SecurityRow[] = [],
  options: { insertError?: Error } = {},
) {
  const calls: DrizzleCall[] = [];

  function matches(row: Record<string, unknown>, predicate: unknown): boolean {
    if (!predicate || typeof predicate !== "object") return true;
    const p = predicate as {
      kind?: string;
      left?: { field?: string };
      right?: unknown;
    };
    const field = p.left?.field;
    if (!field) return true;
    if (p.kind === "eq") return row[field] === p.right;
    if (p.kind === "lt") {
      const left = row[field];
      return (
        left instanceof Date &&
        p.right instanceof Date &&
        left.getTime() < p.right.getTime()
      );
    }
    return true;
  }

  function select(shape: Record<string, unknown>) {
    let predicate: unknown = null;
    let order: { kind?: string; value?: { field?: string } } | null = null;
    let limit: number | undefined;
    let offset = 0;
    const isCount = "count" in shape;

    const evaluate = (): unknown[] => {
      let items = dataset.filter((row) =>
        matches(row as unknown as Record<string, unknown>, predicate),
      );
      if (order?.kind === "desc" && order.value?.field) {
        const field = order.value.field;
        items = [...items].sort(
          (a, b) =>
            (b as unknown as Record<string, Date>)[field]!.getTime() -
            (a as unknown as Record<string, Date>)[field]!.getTime(),
        );
      }
      if (isCount) return [{ count: items.length }];
      const end = limit === undefined ? undefined : offset + limit;
      return items.slice(offset, end);
    };

    const chain = {
      from: () => chain,
      where: (p: unknown) => {
        calls.push({ method: "where", args: [p] });
        predicate = p;
        return chain;
      },
      orderBy: (o: unknown) => {
        calls.push({ method: "orderBy", args: [o] });
        order = o as typeof order;
        return chain;
      },
      limit: (n: number) => {
        calls.push({ method: "limit", args: [n] });
        limit = n;
        return chain;
      },
      offset: (n: number) => {
        calls.push({ method: "offset", args: [n] });
        offset = n;
        return chain;
      },
      then: (
        resolve: (value: unknown) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(evaluate()).then(resolve, reject),
      catch: (fn: (reason: unknown) => unknown) =>
        Promise.resolve(evaluate()).catch(fn),
      finally: (fn: () => void) => Promise.resolve(evaluate()).finally(fn),
    };
    return chain;
  }

  const db = {
    select: vi.fn((shape: Record<string, unknown>) => select(shape)),
    insert: vi.fn(() => {
      const chain = {
        values: (row: Record<string, unknown>) => {
          calls.push({ method: "values", args: [row] });
          if (options.insertError) return Promise.reject(options.insertError);
          return Promise.resolve(row);
        },
      };
      return chain;
    }),
    delete: vi.fn(() => {
      let predicate: unknown = null;
      const chain = {
        where: (p: unknown) => {
          calls.push({ method: "where", args: [p] });
          predicate = p;
          return chain;
        },
        returning: (shape: Record<string, unknown>) => {
          calls.push({ method: "returning", args: [shape] });
          const removed = dataset.filter((row) =>
            matches(row as unknown as Record<string, unknown>, predicate),
          );
          const ids = removed.map((row) => ({ id: row.id }));
          for (const row of removed) {
            const index = dataset.indexOf(row);
            if (index >= 0) dataset.splice(index, 1);
          }
          return Promise.resolve(ids);
        },
      };
      return chain;
    }),
    calls,
  };
  return db;
}

type ServiceDb = Parameters<typeof listPlatformSecurityEvents>[0];

function asDb(db: ReturnType<typeof makeDb>): ServiceDb {
  return db as unknown as ServiceDb;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function makeEvent(id: string, userId: string, createdAt: Date): SecurityRow {
  return {
    id,
    userId,
    eventType: "token_issued",
    outcome: "success",
    scopes: null,
    serverId: null,
    tokenPrefix: null,
    metadata: null,
    createdAt,
  };
}

const baseInput = {
  userId: "usr_a",
  eventType: "token_issued" as const,
  outcome: "success" as const,
};

describe("sanitizePlatformSecurityEventMetadata", () => {
  it("keeps bounded allowlisted scalar metadata", () => {
    expect(
      sanitizePlatformSecurityEventMetadata({
        operation: "create",
        count: 2,
        resource_mode: "selected",
        outcome_code: "ok",
      }),
    ).toEqual({
      operation: "create",
      count: 2,
      resource_mode: "selected",
      outcome_code: "ok",
    });
  });

  it("drops non-allowlisted but harmless keys", () => {
    expect(
      sanitizePlatformSecurityEventMetadata({ unrelated: "x" }),
    ).toBeNull();
  });

  it("rejects token, secret, body, argument, value, and header keys", () => {
    for (const key of [
      "token",
      "token_hash",
      "token_prefix",
      "access_token",
      "secret",
      "client_secret",
      "secret_metadata",
      "body",
      "request_body",
      "arguments",
      "arguments_json",
      "value",
      "server_value",
      "server_value_id",
      "header",
      "headers",
      "authorization_header",
      "ciphertext",
      "decrypted_value",
      "credential",
      "prefix",
      "resource",
    ]) {
      expect(
        () => sanitizePlatformSecurityEventMetadata({ [key]: "x" }),
        `expected key "${key}" to be rejected`,
      ).toThrow(ForbiddenSecurityEventMetadataError);
    }
  });

  it("rejects over-long string values instead of persisting them", () => {
    expect(() =>
      sanitizePlatformSecurityEventMetadata({ operation: "x".repeat(200) }),
    ).toThrow(ForbiddenSecurityEventMetadataError);
    expect(() =>
      sanitizePlatformSecurityEventMetadata({
        scope: "x".repeat(121),
      }),
    ).toThrow(ForbiddenSecurityEventMetadataError);
    expect(() =>
      sanitizePlatformSecurityEventMetadata({
        reason: "x".repeat(121),
      }),
    ).toThrow(ForbiddenSecurityEventMetadataError);
  });

  it("keeps a string of exactly the maximum bounded length", () => {
    const boundary = "x".repeat(120);
    expect(
      sanitizePlatformSecurityEventMetadata({ operation: boundary }),
    ).toEqual({ operation: boundary });
  });

  it("drops nested objects and arrays instead of serializing them", () => {
    expect(
      sanitizePlatformSecurityEventMetadata({ scope: { token: "x" } }),
    ).toBeNull();
    expect(
      sanitizePlatformSecurityEventMetadata({ scope: ["a", "b"] }),
    ).toBeNull();
  });

  it("keeps allowlisted non-sensitive scalar metadata", () => {
    expect(
      sanitizePlatformSecurityEventMetadata({
        method: "POST",
        upstream_status: 200,
        count: 3,
        outcome_code: true,
        resource_type: "server",
      }),
    ).toEqual({
      method: "POST",
      upstream_status: 200,
      count: 3,
      outcome_code: true,
      resource_type: "server",
    });
  });

  it("drops non-finite numbers", () => {
    expect(
      sanitizePlatformSecurityEventMetadata({ count: Number.NaN }),
    ).toBeNull();
    expect(
      sanitizePlatformSecurityEventMetadata({
        count: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull();
  });

  it("returns null for empty or scalar-free input", () => {
    expect(sanitizePlatformSecurityEventMetadata(null)).toBeNull();
    expect(sanitizePlatformSecurityEventMetadata({})).toBeNull();
    expect(sanitizePlatformSecurityEventMetadata({ count: null })).toBeNull();
  });
});

describe("listPlatformSecurityEvents owner isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never returns another owner's rows", async () => {
    const dataset = [
      makeEvent("pse_a1", "usr_a", new Date("2026-01-02T00:00:00.000Z")),
      makeEvent("pse_a2", "usr_a", new Date("2026-01-01T00:00:00.000Z")),
      makeEvent("pse_b1", "usr_b", new Date("2026-01-03T00:00:00.000Z")),
    ];
    const db = makeDb(dataset);

    const result = await listPlatformSecurityEvents(asDb(db), "usr_a", {
      page: 1,
      pageSize: 10,
    });

    expect(result.items.map((item) => item.id)).toEqual(["pse_a1", "pse_a2"]);
    expect(result.total).toBe(2);
    expect(result.items.some((item) => item.id === "pse_b1")).toBe(false);
  });

  it("applies the same owner predicate to items and total", async () => {
    const dataset = [
      makeEvent("pse_a1", "usr_a", new Date("2026-01-01T00:00:00.000Z")),
      makeEvent("pse_b1", "usr_b", new Date("2026-01-02T00:00:00.000Z")),
      makeEvent("pse_b2", "usr_b", new Date("2026-01-03T00:00:00.000Z")),
    ];
    const db = makeDb(dataset);

    const result = await listPlatformSecurityEvents(asDb(db), "usr_a", {
      page: 1,
      pageSize: 10,
    });

    expect(result.total).toBe(1);

    expect(drizzleFns.eq).toHaveBeenCalledWith(
      tables.mcpPlatformSecurityEvent.userId,
      "usr_a",
    );
    const whereCalls = db.calls.filter((call) => call.method === "where");
    expect(whereCalls).toHaveLength(2);
    expect(whereCalls[0]!.args[0]).toBe(whereCalls[1]!.args[0]);
    expect(whereCalls[0]!.args[0]).toEqual({
      kind: "eq",
      left: tables.mcpPlatformSecurityEvent.userId,
      right: "usr_a",
    });
  });
});

describe("listPlatformSecurityEvents pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dataset = [
    ...Array.from({ length: 12 }, (_, index) =>
      makeEvent(
        `pse_a${String(index + 1).padStart(2, "0")}`,
        "usr_a",
        new Date(Date.UTC(2026, 0, index + 1)),
      ),
    ),
    makeEvent("pse_b1", "usr_b", new Date("2026-02-01T00:00:00.000Z")),
  ];

  it("returns a stable envelope and scopes the total to the owner", async () => {
    const db = makeDb([...dataset]);

    const result = await listPlatformSecurityEvents(asDb(db), "usr_a", {
      page: 1,
      pageSize: 10,
    });

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.total).toBe(12);
    expect(result.items.map((item) => item.id)).toEqual([
      "pse_a12",
      "pse_a11",
      "pse_a10",
      "pse_a09",
      "pse_a08",
      "pse_a07",
      "pse_a06",
      "pse_a05",
      "pse_a04",
      "pse_a03",
    ]);
    expect(result.items.some((item) => item.id === "pse_b1")).toBe(false);
  });

  it("computes offset for later pages from the requested page", async () => {
    const db = makeDb([...dataset]);

    const result = await listPlatformSecurityEvents(asDb(db), "usr_a", {
      page: 2,
      pageSize: 10,
    });

    expect(result.items.map((item) => item.id)).toEqual(["pse_a02", "pse_a01"]);
    expect(result.total).toBe(12);
    const offsetCall = db.calls.find((call) => call.method === "offset");
    const limitCall = db.calls.find((call) => call.method === "limit");
    expect(offsetCall?.args[0]).toBe(10);
    expect(limitCall?.args[0]).toBe(10);
  });

  it("keeps an out-of-range page empty without rewriting page or total", async () => {
    const db = makeDb([...dataset]);

    await expect(
      listPlatformSecurityEvents(asDb(db), "usr_a", { page: 5, pageSize: 10 }),
    ).resolves.toEqual({
      items: [],
      page: 5,
      pageSize: 10,
      total: 12,
    });
  });
});

describe("cleanupExpiredPlatformSecurityEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes rows older than the cutoff and keeps newer rows", async () => {
    const now = Date.now();
    const dataset = [
      makeEvent("pse_old_1", "usr_a", new Date(now - 45 * DAY_MS)),
      makeEvent("pse_old_2", "usr_b", new Date(now - 40 * DAY_MS)),
      makeEvent("pse_fresh", "usr_a", new Date(now - 1 * DAY_MS)),
    ];
    const db = makeDb(dataset);

    const deleted = await cleanupExpiredPlatformSecurityEvents(asDb(db), 30);

    expect(deleted).toBe(2);
    expect(dataset.map((row) => row.id)).toEqual(["pse_fresh"]);
    expect(drizzleFns.lt).toHaveBeenCalledWith(
      tables.mcpPlatformSecurityEvent.createdAt,
      expect.any(Date),
    );
    const cutoff = drizzleFns.lt.mock.calls[0]![1] as Date;
    expect(Math.abs(cutoff.getTime() - (now - 30 * DAY_MS))).toBeLessThan(
      5_000,
    );
  });

  it("uses the shared retention window by default", async () => {
    const now = Date.now();
    const dataset = [
      makeEvent(
        "pse_expired",
        "usr_a",
        new Date(
          now - (MCP_PLATFORM_SECURITY_EVENT_RETENTION_DAYS + 10) * DAY_MS,
        ),
      ),
      makeEvent("pse_retained", "usr_a", new Date(now - 1 * DAY_MS)),
    ];
    const db = makeDb(dataset);

    const deleted = await cleanupExpiredPlatformSecurityEvents(asDb(db));

    expect(deleted).toBe(1);
    expect(dataset.map((row) => row.id)).toEqual(["pse_retained"]);
    const cutoff = drizzleFns.lt.mock.calls[0]![1] as Date;
    expect(
      Math.abs(
        cutoff.getTime() -
          (now - MCP_PLATFORM_SECURITY_EVENT_RETENTION_DAYS * DAY_MS),
      ),
    ).toBeLessThan(5_000);
  });
});

describe("recordPlatformSecurityEvent lifecycle rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates insert failures so the caller's transaction rolls back", async () => {
    const failure = new Error("security event insert failed");
    const db = makeDb([], { insertError: failure });

    await expect(
      recordPlatformSecurityEvent(asDb(db), baseInput),
    ).rejects.toThrow(failure);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(telemetry.captureMcpTelemetry).not.toHaveBeenCalled();
  });

  it("persists the sanitized row on success", async () => {
    const db = makeDb();

    await expect(
      recordPlatformSecurityEvent(asDb(db), {
        ...baseInput,
        metadata: { operation: "rotate", ignored: "drop-me" },
      }),
    ).resolves.toBeUndefined();

    const values = db.calls.find((call) => call.method === "values");
    expect(values?.args[0]).toMatchObject({
      userId: "usr_a",
      eventType: "token_issued",
      outcome: "success",
      metadata: { operation: "rotate" },
    });
  });
});

describe("recordPlatformSecurityEventBestEffort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never throws when the insert fails and reports secret-safe telemetry", async () => {
    const failure = new Error("database unavailable");
    const db = makeDb([], { insertError: failure });

    await expect(
      recordPlatformSecurityEventBestEffort(asDb(db), baseInput),
    ).resolves.toBeUndefined();

    expect(telemetry.captureMcpTelemetry).toHaveBeenCalledTimes(1);
    expect(telemetry.captureMcpTelemetry).toHaveBeenCalledWith(
      telemetry.MCP_TELEMETRY_EVENTS.securityEventPersistFailed,
      expect.objectContaining({
        userId: "usr_a",
        properties: {
          eventType: "token_issued",
          outcome: "success",
        },
      }),
    );
  });

  it("does not emit failure telemetry when the insert succeeds", async () => {
    const db = makeDb();

    await expect(
      recordPlatformSecurityEventBestEffort(asDb(db), baseInput),
    ).resolves.toBeUndefined();

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(telemetry.captureMcpTelemetry).not.toHaveBeenCalled();
  });
});
