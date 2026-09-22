/**
 * @file Owner-scoped repository for AI tool-optimization runs and items.
 * Every read and write is scoped by userId so cross-owner access resolves to
 * not-found. Stored payloads are limited to the bounded contracts in
 * `mcp-optimizer-contracts.ts`; raw prompts, raw model output, raw OpenAPI
 * sources, credentials, and secret identities have no column and no path here.
 */
import {
  aiToolOptimizationItem,
  aiToolOptimizationRun,
  type AiToolOptimizationItem,
  type AiToolOptimizationRun,
} from "@repo/db";

export type { AiToolOptimizationItem, AiToolOptimizationRun };
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type OptimizerWriteTx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type OptimizerDbExecutor = DB | OptimizerWriteTx;

export type OptimizerRunInsert = typeof aiToolOptimizationRun.$inferInsert;
export type OptimizerItemInsert = typeof aiToolOptimizationItem.$inferInsert;

export async function insertOptimizerRun(
  tx: OptimizerWriteTx,
  values: OptimizerRunInsert,
): Promise<AiToolOptimizationRun> {
  const [row] = await tx
    .insert(aiToolOptimizationRun)
    .values(values)
    .returning();
  return row;
}

export async function insertOptimizerItems(
  tx: OptimizerWriteTx,
  values: OptimizerItemInsert[],
): Promise<AiToolOptimizationItem[]> {
  return tx.insert(aiToolOptimizationItem).values(values).returning();
}

export async function getOptimizerRunForOwner(
  db: OptimizerDbExecutor,
  input: { userId: string; runId: string },
): Promise<AiToolOptimizationRun | null> {
  const [row] = await db
    .select()
    .from(aiToolOptimizationRun)
    .where(
      and(
        eq(aiToolOptimizationRun.id, input.runId),
        eq(aiToolOptimizationRun.userId, input.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listOptimizerRunsForOwner(
  db: OptimizerDbExecutor,
  input: { userId: string; serverId: string; page: number; pageSize: number },
): Promise<{ rows: AiToolOptimizationRun[]; total: number }> {
  const predicate = and(
    eq(aiToolOptimizationRun.userId, input.userId),
    eq(aiToolOptimizationRun.serverId, input.serverId),
  );
  const rows = await db
    .select()
    .from(aiToolOptimizationRun)
    .where(predicate)
    .orderBy(sql`${aiToolOptimizationRun.createdAt} desc`)
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(aiToolOptimizationRun)
    .where(predicate);
  return { rows, total: Number(total) };
}

/**
 * Authorizes the exact planned run only while its state and observed server
 * revisions are still current; returns null when any precondition moved.
 */
export async function authorizeOptimizerRun(
  tx: OptimizerWriteTx,
  input: {
    userId: string;
    runId: string;
    now: Date;
    plannedExpiresAt: Date;
    expectedConfigRevision: number;
    expectedDraftRevision: number | null;
    model: {
      providerKind: string;
      modelId: string;
      readinessFingerprint: string;
    };
  },
): Promise<AiToolOptimizationRun | null> {
  const [row] = await tx
    .update(aiToolOptimizationRun)
    .set({
      state: "queued",
      authorizedAt: input.now,
      queuedAt: input.now,
      providerKind: input.model.providerKind,
      modelId: input.model.modelId,
      readinessFingerprint: input.model.readinessFingerprint,
      serverConfigRevision: input.expectedConfigRevision,
      ...(input.expectedDraftRevision !== null
        ? { serverDraftRevision: input.expectedDraftRevision }
        : {}),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(aiToolOptimizationRun.id, input.runId),
        eq(aiToolOptimizationRun.userId, input.userId),
        eq(aiToolOptimizationRun.state, "planned"),
        eq(
          aiToolOptimizationRun.serverConfigRevision,
          input.expectedConfigRevision,
        ),
        input.expectedDraftRevision !== null
          ? eq(
              aiToolOptimizationRun.serverDraftRevision,
              input.expectedDraftRevision,
            )
          : undefined,
        eq(aiToolOptimizationRun.plannedExpiresAt, input.plannedExpiresAt),
      ),
    )
    .returning();
  return row ?? null;
}

/** Claims one queued (or lease-expired) run using SKIP LOCKED. */
export async function claimQueuedOptimizerRun(
  tx: OptimizerWriteTx,
  input: {
    workerId: string;
    now: Date;
    leaseExpiresAt: Date;
    maxAttempts: number;
  },
): Promise<AiToolOptimizationRun | null> {
  const candidates = await tx
    .select()
    .from(aiToolOptimizationRun)
    .where(
      and(
        or(
          and(
            eq(aiToolOptimizationRun.state, "queued"),
            sql`${aiToolOptimizationRun.attempts} < ${input.maxAttempts}`,
          ),
          and(
            eq(aiToolOptimizationRun.state, "running"),
            lte(aiToolOptimizationRun.leaseExpiresAt, input.now),
            sql`${aiToolOptimizationRun.attempts} < ${input.maxAttempts}`,
          ),
        ),
      ),
    )
    .orderBy(asc(aiToolOptimizationRun.createdAt))
    .limit(1)
    .for("update", { skipLocked: true });
  const candidate = candidates[0];
  if (!candidate) return null;
  const [row] = await tx
    .update(aiToolOptimizationRun)
    .set({
      state: "running",
      workerId: input.workerId,
      leaseExpiresAt: input.leaseExpiresAt,
      attempts: candidate.attempts + 1,
      ...(candidate.startedAt ? {} : { startedAt: input.now }),
      updatedAt: input.now,
    })
    .where(eq(aiToolOptimizationRun.id, candidate.id))
    .returning();
  return row ?? null;
}

export async function heartbeatOptimizerLease(
  tx: OptimizerWriteTx,
  input: { runId: string; workerId: string; leaseExpiresAt: Date },
): Promise<boolean> {
  const rows = await tx
    .update(aiToolOptimizationRun)
    .set({
      leaseExpiresAt: input.leaseExpiresAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiToolOptimizationRun.id, input.runId),
        eq(aiToolOptimizationRun.workerId, input.workerId),
        eq(aiToolOptimizationRun.state, "running"),
      ),
    )
    .returning({ id: aiToolOptimizationRun.id });
  return rows.length > 0;
}

/** Releases the lease and applies the terminal or yielding state transition. */
export async function finishOptimizerRun(
  tx: OptimizerWriteTx,
  input: {
    runId: string;
    workerId: string;
    state: "completed" | "completed_with_errors" | "failed" | "queued";
    errorCode: string | null;
    usage: Record<string, unknown> | null;
    now: Date;
    retentionExpiresAt: Date | null;
  },
): Promise<AiToolOptimizationRun | null> {
  const [row] = await tx
    .update(aiToolOptimizationRun)
    .set({
      state: input.state,
      workerId: null,
      leaseExpiresAt: null,
      errorCode: input.errorCode,
      ...(input.usage ? { usage: input.usage } : {}),
      ...(input.state === "completed" || input.state === "completed_with_errors"
        ? {
            completedAt: input.now,
            retentionExpiresAt: input.retentionExpiresAt,
          }
        : {}),
      updatedAt: input.now,
    })
    .where(
      and(
        eq(aiToolOptimizationRun.id, input.runId),
        eq(aiToolOptimizationRun.workerId, input.workerId),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listOptimizerItems(
  db: OptimizerDbExecutor,
  input: { runId: string },
): Promise<AiToolOptimizationItem[]> {
  return db
    .select()
    .from(aiToolOptimizationItem)
    .where(eq(aiToolOptimizationItem.runId, input.runId))
    .orderBy(asc(aiToolOptimizationItem.ordinal));
}

export async function listOptimizerItemsPage(
  db: OptimizerDbExecutor,
  input: {
    runId: string;
    page: number;
    pageSize: number;
    state?: string;
  },
): Promise<{ rows: AiToolOptimizationItem[]; total: number }> {
  const predicate = and(
    eq(aiToolOptimizationItem.runId, input.runId),
    input.state ? eq(aiToolOptimizationItem.state, input.state) : undefined,
  );
  const rows = await db
    .select()
    .from(aiToolOptimizationItem)
    .where(predicate)
    .orderBy(asc(aiToolOptimizationItem.ordinal))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(aiToolOptimizationItem)
    .where(predicate);
  return { rows, total: Number(total) };
}

export async function getOptimizerItemForOwner(
  db: OptimizerDbExecutor,
  input: {
    userId: string;
    runId: string;
    itemId: string;
  },
): Promise<AiToolOptimizationItem | null> {
  const [row] = await db
    .select({ item: aiToolOptimizationItem })
    .from(aiToolOptimizationItem)
    .innerJoin(
      aiToolOptimizationRun,
      eq(aiToolOptimizationItem.runId, aiToolOptimizationRun.id),
    )
    .where(
      and(
        eq(aiToolOptimizationItem.id, input.itemId),
        eq(aiToolOptimizationItem.runId, input.runId),
        eq(aiToolOptimizationRun.userId, input.userId),
      ),
    )
    .limit(1);
  return row?.item ?? null;
}

/** Finds one item inside a run by its stable ref (tool id or operation key). */
export async function findOptimizerItemByRef(
  db: OptimizerDbExecutor,
  input: {
    runId: string;
    toolId?: string;
    operationKey?: string;
  },
): Promise<AiToolOptimizationItem | null> {
  const [row] = await db
    .select()
    .from(aiToolOptimizationItem)
    .where(
      and(
        eq(aiToolOptimizationItem.runId, input.runId),
        input.toolId
          ? eq(aiToolOptimizationItem.toolId, input.toolId)
          : undefined,
        input.operationKey
          ? eq(aiToolOptimizationItem.operationKey, input.operationKey)
          : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Aggregated per-state item counts for progress projections. */
export async function getOptimizerProgress(
  db: OptimizerDbExecutor,
  input: { runId: string },
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      state: aiToolOptimizationItem.state,
      value: count(),
    })
    .from(aiToolOptimizationItem)
    .where(eq(aiToolOptimizationItem.runId, input.runId))
    .groupBy(aiToolOptimizationItem.state);
  const result: Record<string, number> = {};
  for (const row of rows) result[row.state] = Number(row.value);
  return result;
}

/**
 * Persists one analyzed item result. The state predicate makes the write
 * idempotent: a retried duplicate inference cannot overwrite an applied,
 * rejected, cancelled, or already-persisted recommendation.
 */
export async function saveOptimizerItemResult(
  tx: OptimizerWriteTx,
  input: {
    runId: string;
    itemId: string;
    state: "recommended" | "no_change" | "failed";
    review: Record<string, unknown> | null;
    failureCode: string | null;
    now: Date;
  },
): Promise<boolean> {
  const rows = await tx
    .update(aiToolOptimizationItem)
    .set({
      state: input.state,
      review: input.review,
      failureCode: input.failureCode,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(aiToolOptimizationItem.id, input.itemId),
        eq(aiToolOptimizationItem.runId, input.runId),
        inArray(aiToolOptimizationItem.state, ["queued", "running"]),
      ),
    )
    .returning({ id: aiToolOptimizationItem.id });
  return rows.length > 0;
}

/** Marks the claimed batch's items as running; harmless when already done. */
export async function markOptimizerItemsRunning(
  tx: OptimizerWriteTx,
  input: { runId: string; itemIds: string[]; now: Date },
): Promise<void> {
  if (input.itemIds.length === 0) return;
  await tx
    .update(aiToolOptimizationItem)
    .set({ state: "running", updatedAt: input.now })
    .where(
      and(
        eq(aiToolOptimizationItem.runId, input.runId),
        inArray(aiToolOptimizationItem.id, input.itemIds),
        eq(aiToolOptimizationItem.state, "queued"),
      ),
    );
}

/** Cancels every unfinished item; completed recommendations are preserved. */
export async function cancelUnfinishedOptimizerItems(
  tx: OptimizerWriteTx,
  input: { runId: string; now: Date },
): Promise<number> {
  const rows = await tx
    .update(aiToolOptimizationItem)
    .set({ state: "cancelled", updatedAt: input.now })
    .where(
      and(
        eq(aiToolOptimizationItem.runId, input.runId),
        inArray(aiToolOptimizationItem.state, ["queued", "running"]),
      ),
    )
    .returning({ id: aiToolOptimizationItem.id });
  return rows.length;
}

/**
 * Owner cancellation: planned runs cancel outright; queued/running runs move
 * to `cancel_requested` so the worker can stop between batches.
 */
export async function requestOptimizerCancel(
  tx: OptimizerWriteTx,
  input: {
    userId: string;
    runId: string;
    now: Date;
    retentionExpiresAt: Date;
  },
): Promise<AiToolOptimizationRun | null> {
  const [row] = await tx
    .update(aiToolOptimizationRun)
    .set({
      cancelRequestedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(aiToolOptimizationRun.id, input.runId),
        eq(aiToolOptimizationRun.userId, input.userId),
        inArray(aiToolOptimizationRun.state, [
          "planned",
          "queued",
          "running",
          "cancel_requested",
        ]),
      ),
    )
    .returning();
  if (!row) return null;
  if (row.state === "planned") {
    const [cancelled] = await tx
      .update(aiToolOptimizationRun)
      .set({
        state: "cancelled",
        retentionExpiresAt: input.retentionExpiresAt,
        updatedAt: input.now,
      })
      .where(eq(aiToolOptimizationRun.id, row.id))
      .returning();
    return cancelled ?? row;
  }
  if (row.state === "queued" || row.state === "running") {
    const [cancelled] = await tx
      .update(aiToolOptimizationRun)
      .set({ state: "cancel_requested", updatedAt: input.now })
      .where(eq(aiToolOptimizationRun.id, row.id))
      .returning();
    if (row.state === "queued") {
      await cancelUnfinishedOptimizerItems(tx, {
        runId: row.id,
        now: input.now,
      });
    }
    return cancelled ?? row;
  }
  return row;
}

/**
 * Finalizes a cancel-requested run whose worker is gone (or finished): the
 * remaining unfinished items become cancelled and the run closes.
 */
export async function finalizeCancelledOptimizerRun(
  tx: OptimizerWriteTx,
  input: {
    runId: string;
    now: Date;
    retentionExpiresAt: Date;
    /** Only the run still flagged with this exact cancellation request finalizes. */
    cancelRequestedAt: Date;
  },
): Promise<AiToolOptimizationRun | null> {
  await cancelUnfinishedOptimizerItems(tx, {
    runId: input.runId,
    now: input.now,
  });
  const [row] = await tx
    .update(aiToolOptimizationRun)
    .set({
      state: "cancelled",
      workerId: null,
      leaseExpiresAt: null,
      completedAt: input.now,
      retentionExpiresAt: input.retentionExpiresAt,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(aiToolOptimizationRun.id, input.runId),
        eq(aiToolOptimizationRun.cancelRequestedAt, input.cancelRequestedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/** Rejects review recommendations for one item; preserves applied history. */
export async function rejectOptimizerItem(
  tx: OptimizerWriteTx,
  input: { userId: string; runId: string; itemId: string; now: Date },
): Promise<boolean> {
  const run = await getOptimizerRunForOwner(tx, {
    userId: input.userId,
    runId: input.runId,
  });
  if (!run) return false;
  const rows = await tx
    .update(aiToolOptimizationItem)
    .set({ state: "rejected", rejectedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(aiToolOptimizationItem.id, input.itemId),
        eq(aiToolOptimizationItem.runId, input.runId),
        eq(aiToolOptimizationItem.state, "recommended"),
      ),
    )
    .returning({ id: aiToolOptimizationItem.id });
  return rows.length > 0;
}

/** Marks items applied and commits attribution in the draft transaction. */
export async function markOptimizerItemsApplied(
  tx: OptimizerWriteTx,
  input: {
    runId: string;
    now: Date;
    draftRevision: number;
    items: Array<{
      itemId: string;
      appliedToolId: string;
      appliedToolName: string;
    }>;
  },
): Promise<number> {
  let updated = 0;
  for (const item of input.items) {
    const rows = await tx
      .update(aiToolOptimizationItem)
      .set({
        state: "applied",
        appliedToolId: item.appliedToolId,
        appliedToolName: item.appliedToolName,
        appliedDraftRevision: input.draftRevision,
        appliedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(aiToolOptimizationItem.id, item.itemId),
          eq(aiToolOptimizationItem.runId, input.runId),
          eq(aiToolOptimizationItem.state, "recommended"),
        ),
      )
      .returning({ id: aiToolOptimizationItem.id });
    updated += rows.length;
  }
  return updated;
}

/**
 * Commits the application idempotency marker on the run row in the same
 * draft transaction as the tool writes.
 */
export async function commitOptimizerApplyMarker(
  tx: OptimizerWriteTx,
  input: {
    runId: string;
    applyKey: string;
    applyResult: Record<string, unknown>;
    configRevision: number;
    draftRevision: number;
    now: Date;
  },
): Promise<void> {
  await tx
    .update(aiToolOptimizationRun)
    .set({
      applyKey: input.applyKey,
      applyResult: input.applyResult,
      appliedConfigRevision: input.configRevision,
      appliedDraftRevision: input.draftRevision,
      updatedAt: input.now,
    })
    .where(eq(aiToolOptimizationRun.id, input.runId));
}

export async function findOptimizerApplyCommitted(
  db: OptimizerDbExecutor,
  input: { userId: string; runId: string; applyKey: string },
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ applyResult: aiToolOptimizationRun.applyResult })
    .from(aiToolOptimizationRun)
    .where(
      and(
        eq(aiToolOptimizationRun.id, input.runId),
        eq(aiToolOptimizationRun.userId, input.userId),
        eq(aiToolOptimizationRun.applyKey, input.applyKey),
      ),
    )
    .limit(1);
  return row?.applyResult ?? null;
}

/* ------------------------------------------------------------------------- *
 * Reconciler helpers
 * ------------------------------------------------------------------------- */

export async function listExpiredPlannedOptimizerRuns(
  db: OptimizerDbExecutor,
  input: { now: Date; limit: number },
): Promise<AiToolOptimizationRun[]> {
  return db
    .select()
    .from(aiToolOptimizationRun)
    .where(
      and(
        eq(aiToolOptimizationRun.state, "planned"),
        lte(aiToolOptimizationRun.plannedExpiresAt, input.now),
      ),
    )
    .limit(input.limit)
    .for("update", { skipLocked: true });
}

export async function expirePlannedOptimizerRun(
  tx: OptimizerWriteTx,
  input: { runId: string; now: Date; retentionExpiresAt: Date },
): Promise<void> {
  await tx
    .update(aiToolOptimizationRun)
    .set({
      state: "expired",
      retentionExpiresAt: input.retentionExpiresAt,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(aiToolOptimizationRun.id, input.runId),
        eq(aiToolOptimizationRun.state, "planned"),
      ),
    );
}

export async function listExhaustedOptimizerRuns(
  db: OptimizerDbExecutor,
  input: { now: Date; maxAttempts: number; limit: number },
): Promise<AiToolOptimizationRun[]> {
  return db
    .select()
    .from(aiToolOptimizationRun)
    .where(
      and(
        eq(aiToolOptimizationRun.state, "running"),
        lte(aiToolOptimizationRun.leaseExpiresAt, input.now),
        sql`${aiToolOptimizationRun.attempts} >= ${input.maxAttempts}`,
      ),
    )
    .limit(input.limit)
    .for("update", { skipLocked: true });
}

export async function failOptimizerRun(
  tx: OptimizerWriteTx,
  input: { runId: string; errorCode: string; now: Date },
): Promise<void> {
  await tx
    .update(aiToolOptimizationItem)
    .set({
      state: "failed",
      failureCode: input.errorCode,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(aiToolOptimizationItem.runId, input.runId),
        inArray(aiToolOptimizationItem.state, ["queued", "running"]),
      ),
    );
  await tx
    .update(aiToolOptimizationRun)
    .set({
      state: "failed",
      workerId: null,
      leaseExpiresAt: null,
      errorCode: input.errorCode,
      completedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(aiToolOptimizationRun.id, input.runId));
}

/** Orphaned cancel-requested runs whose lease expired are finalized. */
export async function listStaleCancelRequestedRuns(
  db: OptimizerDbExecutor,
  input: { now: Date; limit: number },
): Promise<AiToolOptimizationRun[]> {
  return db
    .select()
    .from(aiToolOptimizationRun)
    .where(
      and(
        eq(aiToolOptimizationRun.state, "cancel_requested"),
        or(
          isNull(aiToolOptimizationRun.leaseExpiresAt),
          lte(aiToolOptimizationRun.leaseExpiresAt, input.now),
        ),
      ),
    )
    .limit(input.limit)
    .for("update", { skipLocked: true });
}

export async function listRetentionExpiredOptimizerRuns(
  db: OptimizerDbExecutor,
  input: { now: Date; limit: number },
): Promise<Array<{ id: string }>> {
  return db
    .select({ id: aiToolOptimizationRun.id })
    .from(aiToolOptimizationRun)
    .where(
      and(
        lte(aiToolOptimizationRun.retentionExpiresAt, input.now),
        inArray(aiToolOptimizationRun.state, [
          "completed",
          "completed_with_errors",
          "failed",
          "cancelled",
          "expired",
        ]),
      ),
    )
    .limit(input.limit)
    .for("update", { skipLocked: true });
}

export async function deleteRetentionExpiredOptimizerRuns(
  tx: OptimizerWriteTx,
  input: { runIds: string[] },
): Promise<number> {
  if (input.runIds.length === 0) return 0;
  const rows = await tx
    .delete(aiToolOptimizationRun)
    .where(inArray(aiToolOptimizationRun.id, input.runIds))
    .returning({ id: aiToolOptimizationRun.id });
  return rows.length;
}
