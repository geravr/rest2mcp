/**
 * @file Bounded, best-effort audit queue for MCP call logs.
 * Enqueue never throws and never delays the caller's result; overflow and
 * persistence failures are dropped with telemetry counters instead of
 * propagating to the invocation result (see mcp-observability spec).
 */
import type { NewMcpCallLog } from "@repo/db";
import { mcpCallLog } from "@repo/db";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { MCP_AUDIT_QUEUE_CAPACITY } from "./mcp-policy.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type AuditQueueRow = NewMcpCallLog;

type AuditQueueStats = {
  size: number;
  enqueued: number;
  dropped: number;
  persisted: number;
  failed: number;
};

const stats: AuditQueueStats = {
  size: 0,
  enqueued: 0,
  dropped: 0,
  persisted: 0,
  failed: 0,
};

const queue: AuditQueueRow[] = [];
let drainPromise: Promise<void> | null = null;

async function runDrain(db: DB): Promise<void> {
  while (queue.length > 0) {
    const row = queue.shift();
    if (!row) continue;
    stats.size = queue.length;
    try {
      await db.insert(mcpCallLog).values(row);
      stats.persisted += 1;
    } catch (error) {
      stats.failed += 1;
      // Best-effort: a persistence failure must never affect the caller's
      // already-returned invocation result.
      console.error("[mcp-audit-queue] failed to persist call log", error);
    }
  }
}

async function drain(db: DB): Promise<void> {
  if (drainPromise) {
    await drainPromise;
    if (queue.length > 0) {
      await drain(db);
    }
    return;
  }

  drainPromise = runDrain(db);
  try {
    await drainPromise;
  } finally {
    drainPromise = null;
  }
  if (queue.length > 0) {
    await drain(db);
  }
}

/**
 * Enqueues a call-log row for best-effort persistence. Never throws: at
 * capacity the row is dropped and a telemetry counter is incremented.
 */
export function enqueueCallLog(db: DB, row: AuditQueueRow): void {
  if (queue.length >= MCP_AUDIT_QUEUE_CAPACITY) {
    stats.dropped += 1;
    return;
  }
  queue.push(row);
  stats.size = queue.length;
  stats.enqueued += 1;
  void drain(db).catch((error: unknown) => {
    console.error("[mcp-audit-queue] unexpected drain failure", error);
  });
}

/** Awaits full queue drain, e.g. during graceful shutdown. */
export async function drainAuditQueue(db: DB): Promise<void> {
  await drain(db);
}

/** Test-only: read current counters without mutating them. */
export function getAuditQueueStats(): Readonly<AuditQueueStats> {
  return { ...stats, size: queue.length };
}

/** Test-only: reset queue and counters between cases. */
export function resetAuditQueueState(): void {
  queue.length = 0;
  drainPromise = null;
  stats.size = 0;
  stats.enqueued = 0;
  stats.dropped = 0;
  stats.persisted = 0;
  stats.failed = 0;
}
