import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drainAuditQueue,
  enqueueCallLog,
  getAuditQueueStats,
  resetAuditQueueState,
} from "./mcp-audit-queue.js";
import { MCP_AUDIT_QUEUE_CAPACITY } from "./mcp-policy.js";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `mcl_${Math.random()}`,
    serverId: "mcs_1",
    toolId: "mct_1",
    userId: "usr_1",
    source: "agent",
    status: "success",
    httpStatus: 200,
    durationMs: 10,
    appCode: null,
    phase: "complete",
    outcome: "success",
    requestSummary: null,
    responseSummary: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDb(
  insertImpl: (row: unknown) => Promise<unknown> = () => Promise.resolve([]),
) {
  return {
    insert: vi.fn(() => ({
      values: (row: unknown) => insertImpl(row),
    })),
  };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  resetAuditQueueState();
  vi.clearAllMocks();
});

describe("enqueueCallLog", () => {
  it("never throws to the caller", () => {
    const db = makeDb();
    expect(() => enqueueCallLog(db as never, makeRow())).not.toThrow();
  });

  it("persists the row through db.insert", async () => {
    const inserted: unknown[] = [];
    const db = makeDb((row) => {
      inserted.push(row);
      return Promise.resolve([]);
    });

    enqueueCallLog(db as never, makeRow({ id: "mcl_persisted" }));
    await flushMicrotasks();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ id: "mcl_persisted" });
    expect(getAuditQueueStats().persisted).toBe(1);
  });

  it("drops rows and counts them once the queue is at capacity", () => {
    // The head row is dequeued into an in-flight (never-settling) insert
    // immediately, so capacity + 1 enqueues succeed before drops begin.
    const db = makeDb(() => new Promise(() => {})); // never resolves: keeps rows queued
    const fillCount = MCP_AUDIT_QUEUE_CAPACITY + 1;
    for (let i = 0; i < fillCount; i += 1) {
      enqueueCallLog(db as never, makeRow({ id: `mcl_${i}` }));
    }
    const beforeOverflow = getAuditQueueStats();
    expect(beforeOverflow.dropped).toBe(0);

    enqueueCallLog(db as never, makeRow({ id: "mcl_overflow" }));
    enqueueCallLog(db as never, makeRow({ id: "mcl_overflow_2" }));
    const afterOverflow = getAuditQueueStats();
    expect(afterOverflow.dropped).toBe(2);
  });

  it("counts a failed insert without throwing and continues draining", async () => {
    let call = 0;
    const db = makeDb(() => {
      call += 1;
      if (call === 1) return Promise.reject(new Error("db unavailable"));
      return Promise.resolve([]);
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    enqueueCallLog(db as never, makeRow({ id: "mcl_fail" }));
    enqueueCallLog(db as never, makeRow({ id: "mcl_ok" }));
    await flushMicrotasks();
    await flushMicrotasks();

    const stats = getAuditQueueStats();
    expect(stats.failed).toBe(1);
    expect(stats.persisted).toBe(1);
    consoleErrorSpy.mockRestore();
  });
});

describe("drainAuditQueue", () => {
  it("resolves once all queued rows have been attempted", async () => {
    const inserted: unknown[] = [];
    const db = makeDb((row) => {
      inserted.push(row);
      return Promise.resolve([]);
    });

    enqueueCallLog(db as never, makeRow({ id: "mcl_a" }));
    enqueueCallLog(db as never, makeRow({ id: "mcl_b" }));
    await drainAuditQueue(db as never);

    expect(inserted).toHaveLength(2);
    expect(getAuditQueueStats().size).toBe(0);
  });
});

describe("getAuditQueueStats / resetAuditQueueState", () => {
  it("resets counters and pending rows", async () => {
    const db = makeDb(() => new Promise(() => {}));
    enqueueCallLog(db as never, makeRow());
    resetAuditQueueState();
    const stats = getAuditQueueStats();
    expect(stats).toMatchObject({
      size: 0,
      enqueued: 0,
      dropped: 0,
      persisted: 0,
      failed: 0,
    });
  });
});
