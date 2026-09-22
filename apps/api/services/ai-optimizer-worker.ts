/**
 * @file Durable optimizer worker and reconciler. The worker claims queued or
 * lease-expired runs with `FOR UPDATE SKIP LOCKED`, processes deterministic
 * batches with bounded concurrency and transient retries, checks cancellation
 * between batches, and persists per-item results idempotently. It never
 * touches MCP draft rows: application happens only through the owner's apply
 * command. The reconciler expires plans, fails exhausted leases, finalizes
 * cancellations, and deletes retention-expired history.
 */
import { APP_ERROR_CODES, type AiProviderKind } from "@repo/core";
import {
  aiToolOptimizationRun,
  mcpServer,
  mcpTool,
  type AiToolOptimizationRun,
} from "@repo/db";
import { eq } from "drizzle-orm";
import { AI_TOOL_OPTIMIZATION_LIMITS } from "../lib/mcp-optimizer-contracts.js";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
} from "../lib/mcp-telemetry.js";
import type { OptimizerItemReview } from "../lib/mcp-optimizer-contracts.js";
import type { OptimizerToolSnapshotV1 } from "../lib/mcp-optimizer-contracts.js";
import type { McpRequestDefinition } from "../lib/mcp-request-definition.js";
import { mcpRequestDefinitionSchema } from "../lib/mcp-request-definition.js";
import {
  analyzeBatch,
  assertRunModelCurrent,
  buildReviewForItem,
  loadCompileContext,
  OPTIMIZER_ITEM_FAILURE_CODES,
  packAnalysisBatches,
  type AiOptimizerWorkflowDeps,
  type OptimizerBatchItemResult,
} from "./ai-optimizer-workflow.js";
import type { OptimizerPolicyCompileContext } from "../lib/mcp-optimizer-policy.js";
import {
  claimQueuedOptimizerRun,
  getOptimizerProgress,
  finalizeCancelledOptimizerRun,
  finishOptimizerRun,
  heartbeatOptimizerLease,
  listOptimizerItems,
  markOptimizerItemsRunning,
  saveOptimizerItemResult,
} from "./ai-optimizer-repository.js";

export type OptimizerWorkerConfig = {
  pollIntervalMs: number;
  concurrency: number;
  maxBatchRetries: number;
  retentionDays: number;
};

export const DEFAULT_OPTIMIZER_WORKER_CONFIG: OptimizerWorkerConfig = {
  pollIntervalMs: AI_TOOL_OPTIMIZATION_LIMITS.workerPollIntervalMs,
  concurrency: AI_TOOL_OPTIMIZATION_LIMITS.workerConcurrency,
  maxBatchRetries: AI_TOOL_OPTIMIZATION_LIMITS.maxBatchRetries,
  retentionDays: AI_TOOL_OPTIMIZATION_LIMITS.retentionDays,
};

function retentionDate(now: Date, config: OptimizerWorkerConfig): Date {
  return new Date(now.getTime() + config.retentionDays * 86_400_000);
}

type WorkItem = {
  itemId: string;
  itemRef: string;
  snapshot: OptimizerToolSnapshotV1;
  source: "draft" | "openapi";
  toolId: string | null;
};

type ToolMeta = {
  name: string;
  compileStatus: string | null;
  requestDefinition: unknown;
};

/**
 * Processes one claimed run to a terminal state (or releases it back to
 * queued for another bounded attempt). Never applies MCP draft changes.
 */
export async function processClaimedRun(
  deps: AiOptimizerWorkflowDeps,
  run: AiToolOptimizationRun,
  config: OptimizerWorkerConfig,
  signal?: AbortSignal,
): Promise<"completed" | "completed_with_errors" | "failed" | "queued"> {
  const now = () => new Date();

  if (!run.modelId || !run.providerKind || !run.readinessFingerprint) {
    return "failed" as const;
  }

  const items = await listOptimizerItems(deps.db, { runId: run.id });
  const resumable: WorkItem[] = items
    .filter((item) => item.state === "queued" || item.state === "running")
    .map((item) => ({
      itemId: item.id,
      itemRef:
        item.refKind === "draft_tool"
          ? (item.toolId ?? item.id)
          : (item.operationKey ?? item.id),
      snapshot: item.snapshot as unknown as OptimizerToolSnapshotV1,
      source: item.refKind === "draft_tool" ? "draft" : "openapi",
      toolId: item.toolId,
    }));
  const finished = items.filter(
    (item) => item.state !== "queued" && item.state !== "running",
  );

  const toolRows = await deps.db
    .select()
    .from(mcpTool)
    .where(eq(mcpTool.serverId, run.serverId));
  const toolsById = new Map<string, ToolMeta>(
    toolRows.map((tool) => [
      tool.id,
      {
        name: tool.name,
        compileStatus: tool.compileStatus,
        requestDefinition: tool.requestDefinition,
      },
    ]),
  );
  const existingToolNames = toolRows.map((tool) => tool.name);
  const [server] = await deps.db
    .select()
    .from(mcpServer)
    .where(eq(mcpServer.id, run.serverId))
    .limit(1);
  if (!server) return "failed" as const;
  const compile = await loadCompileContext(deps.db, server);

  let abortInFlightBatch: (() => void) | null = null;
  const heartbeat = setInterval(() => {
    void deps.db
      .transaction(async (tx) =>
        heartbeatOptimizerLease(tx, {
          runId: run.id,
          workerId: run.workerId ?? "worker",
          leaseExpiresAt: new Date(
            Date.now() + AI_TOOL_OPTIMIZATION_LIMITS.leaseTtlMs,
          ),
        }),
      )
      .then(async (alive) => {
        if (!alive) return;
        // Best-effort cancellation: abort an in-flight provider batch as soon
        // as the owner's request becomes visible between heartbeats.
        const [row] = await deps.db
          .select({
            cancelRequestedAt: aiToolOptimizationRun.cancelRequestedAt,
          })
          .from(aiToolOptimizationRun)
          .where(eq(aiToolOptimizationRun.id, run.id))
          .limit(1);
        if (row?.cancelRequestedAt) abortInFlightBatch?.();
      })
      .catch(() => undefined);
  }, AI_TOOL_OPTIMIZATION_LIMITS.heartbeatIntervalMs);

  try {
    // Fail closed on model drift and use the verified context window so the
    // conservative packing budget matches the authorized model.
    const selection = await assertRunModelCurrent(deps, {
      userId: run.userId,
      expectedReadinessFingerprint: run.readinessFingerprint,
      expectedModelId: run.modelId,
    });
    // Deterministic packing by item count and context budget.
    const batches = packAnalysisBatches({
      items: resumable.map((item) => ({
        itemRef: item.itemRef,
        snapshot: item.snapshot,
      })),
      contextWindowTokens: selection.snapshot.contextWindowTokens,
    });
    let anyFailed = finished.some((item) => item.state === "failed");
    let totalTokens = 0;
    let batchCount = 0;

    for (const batch of batches) {
      // Cancellation between batches: no new batch starts after a request.
      const [runState] = await deps.db
        .select({
          state: aiToolOptimizationRun.state,
          cancelRequestedAt: aiToolOptimizationRun.cancelRequestedAt,
        })
        .from(aiToolOptimizationRun)
        .where(eq(aiToolOptimizationRun.id, run.id))
        .limit(1);
      if (
        runState?.cancelRequestedAt ||
        runState?.state === "cancel_requested"
      ) {
        const finalized = await deps.db.transaction(async (tx) =>
          finalizeCancelledOptimizerRun(tx, {
            runId: run.id,
            now: now(),
            retentionExpiresAt: retentionDate(now(), config),
            cancelRequestedAt: runState?.cancelRequestedAt ?? new Date(0),
          }),
        );
        if (finalized) return "completed" as const;
        continue;
      }

      await deps.db.transaction(async (tx) =>
        markOptimizerItemsRunning(tx, {
          runId: run.id,
          itemIds: batch.map(
            (entry) =>
              resumable.find((item) => item.itemRef === entry.itemRef)!.itemId,
          ),
          now: now(),
        }),
      );

      // Best-effort abort of the in-flight provider call on shutdown.
      const batchController = new AbortController();
      const onOuterAbort = () => batchController.abort();
      signal?.addEventListener("abort", onOuterAbort, { once: true });
      abortInFlightBatch = () => batchController.abort();

      let analysis: Awaited<ReturnType<typeof analyzeBatch>>;
      let attempts = 0;
      for (;;) {
        analysis = await analyzeBatch(deps, {
          userId: run.userId,
          providerKind: run.providerKind as AiProviderKind,
          batch,
          expectedReadinessFingerprint: run.readinessFingerprint,
          expectedModelId: run.modelId,
          signal: batchController.signal,
        });
        attempts += 1;
        totalTokens += analysis.usage.totalTokens ?? 0;
        batchCount += analysis.usage.batchCount;
        const transientFailure = [...analysis.results.values()].some(
          (result) =>
            !result.ok &&
            (result.failureCode ===
              OPTIMIZER_ITEM_FAILURE_CODES.PROVIDER_TRANSIENT ||
              result.failureCode === OPTIMIZER_ITEM_FAILURE_CODES.NO_RESULT),
        );
        if (!transientFailure || attempts > config.maxBatchRetries) break;
        // Read-only retry with the same model, scope, prompt, and authority.
      }

      signal?.removeEventListener("abort", onOuterAbort);
      abortInFlightBatch = null;

      const batchRefToItem = new Map(
        resumable.map((item) => [item.itemRef, item]),
      );
      for (const entry of batch) {
        const item = batchRefToItem.get(entry.itemRef);
        if (!item) continue;
        const result = analysis.results.get(entry.itemRef);
        if (!result) continue;
        if (!result.ok) {
          if (result.failureCode === OPTIMIZER_ITEM_FAILURE_CODES.CANCELLED) {
            continue;
          }
          const saved = await deps.db.transaction(async (tx) =>
            saveOptimizerItemResult(tx, {
              runId: run.id,
              itemId: item.itemId,
              state: "failed",
              review: null,
              failureCode: result.failureCode,
              now: now(),
            }),
          );
          if (saved) anyFailed = true;
          continue;
        }
        const review = buildReview(
          item,
          result,
          toolsById,
          existingToolNames,
          compile,
        );
        const saved = await deps.db.transaction(async (tx) =>
          saveOptimizerItemResult(tx, {
            runId: run.id,
            itemId: item.itemId,
            state:
              review.operations.length > 0 || review.advisories.length > 0
                ? "recommended"
                : "no_change",
            review: review as unknown as Record<string, unknown>,
            failureCode: null,
            now: now(),
          }),
        );
        if (
          saved &&
          (review.operations.length > 0 || review.advisories.length > 0)
        ) {
          void saved;
        }
      }
    }

    const finalState = anyFailed
      ? ("completed_with_errors" as const)
      : ("completed" as const);
    const counts = await getOptimizerProgress(deps.db, { runId: run.id });
    await deps.db.transaction(async (tx) =>
      finishOptimizerRun(tx, {
        runId: run.id,
        workerId: run.workerId ?? "worker",
        state: finalState,
        errorCode: null,
        usage: { totalTokens, batchCount },
        now: now(),
        retentionExpiresAt: retentionDate(now(), config),
      }),
    );
    captureMcpTelemetry(MCP_TELEMETRY_EVENTS.optimizerRunCompleted, {
      db: deps.db,
      userId: run.userId,
      properties: {
        sourceKind: run.source,
        scopeKind: run.scopeKind,
        outcome: finalState,
        policyVersion: run.policyVersion,
        promptVersion: run.promptVersion,
        providerKind: run.providerKind,
        modelId: run.modelId,
        itemCount: run.eligibleCount,
        recommendedCount: counts.recommended ?? 0,
        failedCount: counts.failed ?? 0,
        batchCount,
        totalTokens,
      },
    });
    return finalState;
  } catch {
    // Fail closed: honor a pending cancellation, fail an exhausted run, or
    // release the run for one more bounded attempt.
    try {
      const current = await deps.db
        .select({
          cancelRequestedAt: aiToolOptimizationRun.cancelRequestedAt,
          attempts: aiToolOptimizationRun.attempts,
        })
        .from(aiToolOptimizationRun)
        .where(eq(aiToolOptimizationRun.id, run.id))
        .limit(1);
      const cancelAt = current[0]?.cancelRequestedAt;
      if (cancelAt) {
        const finalized = await deps.db.transaction(async (tx) =>
          finalizeCancelledOptimizerRun(tx, {
            runId: run.id,
            now: now(),
            retentionExpiresAt: retentionDate(now(), config),
            cancelRequestedAt: cancelAt,
          }),
        );
        if (finalized) return "completed" as const;
        return "queued" as const;
      }
      const exhausted =
        (current[0]?.attempts ?? 0) >=
        AI_TOOL_OPTIMIZATION_LIMITS.maxRunAttempts;
      await deps.db.transaction(async (tx) =>
        finishOptimizerRun(tx, {
          runId: run.id,
          workerId: run.workerId ?? "worker",
          state: exhausted ? "failed" : "queued",
          errorCode: exhausted
            ? APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE
            : null,
          usage: null,
          now: now(),
          retentionExpiresAt: exhausted ? retentionDate(now(), config) : null,
        }),
      );
      return exhausted ? ("failed" as const) : ("queued" as const);
    } catch {
      return "failed" as const;
    }
  } finally {
    clearInterval(heartbeat);
  }
}

function buildReview(
  item: WorkItem,
  result: Extract<OptimizerBatchItemResult, { ok: true }>,
  toolsById: Map<string, ToolMeta>,
  existingToolNames: string[],
  compile: OptimizerPolicyCompileContext,
): OptimizerItemReview {
  let definition: McpRequestDefinition | null = null;
  if (item.source === "draft" && item.toolId) {
    const tool = toolsById.get(item.toolId);
    if (tool && tool.compileStatus !== "invalid") {
      const parsed = mcpRequestDefinitionSchema.safeParse(
        tool.requestDefinition,
      );
      if (parsed.success) definition = parsed.data;
    }
  }
  return buildReviewForItem({
    snapshot: item.snapshot,
    definition,
    operations: result.operations,
    advisories: result.advisories,
    preRejected: result.rejected,
    compile,
    existingToolNames,
  });
}

/* ------------------------------------------------------------------------- *
 * Worker loop
 * ------------------------------------------------------------------------- */

export type OptimizerWorkerHandle = {
  stop: () => Promise<void>;
};

/**
 * Starts the bounded worker loop. Claims at most `concurrency` runs at a
 * time, polls on a fixed interval (no busy loop), and never lets a background
 * rejection escape. Runs are claimed with SKIP LOCKED so multiple API
 * instances cooperate safely.
 */
export function startOptimizerWorker(
  deps: AiOptimizerWorkflowDeps,
  config: OptimizerWorkerConfig = DEFAULT_OPTIMIZER_WORKER_CONFIG,
): OptimizerWorkerHandle {
  let stopped = false;
  const inFlight = new Set<Promise<unknown>>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    while (!stopped && inFlight.size < config.concurrency) {
      const claimed = await deps.db.transaction(async (tx) =>
        claimQueuedOptimizerRun(tx, {
          workerId: `worker-${process.pid}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          now: new Date(),
          leaseExpiresAt: new Date(
            Date.now() + AI_TOOL_OPTIMIZATION_LIMITS.leaseTtlMs,
          ),
          maxAttempts: AI_TOOL_OPTIMIZATION_LIMITS.maxRunAttempts,
        }),
      );
      if (!claimed) break;
      const task = processClaimedRun(deps, claimed, config)
        .catch(() => undefined)
        .finally(() => inFlight.delete(task));
      inFlight.add(task);
    }
  };

  const loop = async () => {
    while (!stopped) {
      try {
        await tick();
      } catch {
        // Claiming failed transiently; keep polling without busy-looping.
      }
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, config.pollIntervalMs);
      });
    }
  };

  void loop();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await Promise.allSettled([...inFlight]);
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Reconciler
 * ------------------------------------------------------------------------- */

export type OptimizerReconcilerSummary = {
  expiredPlans: number;
  failedRuns: number;
  finalizedCancels: number;
  deletedRuns: number;
  dryRun: boolean;
};

/**
 * One bounded reconciler pass: expires abandoned plans, fails runs whose
 * leases expired with no attempts left, finalizes cancel requests whose
 * worker died, and deletes runs past their retention deadline.
 */
export async function runOptimizerReconciler(
  deps: AiOptimizerWorkflowDeps,
  input: { dryRun?: boolean; limit?: number; retentionDays?: number } = {},
): Promise<OptimizerReconcilerSummary> {
  const now = new Date();
  const limit = input.limit ?? 100;
  const retentionDays =
    input.retentionDays ?? AI_TOOL_OPTIMIZATION_LIMITS.retentionDays;
  const summary: OptimizerReconcilerSummary = {
    expiredPlans: 0,
    failedRuns: 0,
    finalizedCancels: 0,
    deletedRuns: 0,
    dryRun: input.dryRun ?? false,
  };

  const {
    listExpiredPlannedOptimizerRuns,
    expirePlannedOptimizerRun,
    listExhaustedOptimizerRuns,
    failOptimizerRun,
    listStaleCancelRequestedRuns,
    listRetentionExpiredOptimizerRuns,
    deleteRetentionExpiredOptimizerRuns,
  } = await import("./ai-optimizer-repository.js");

  const expiredPlans = await listExpiredPlannedOptimizerRuns(deps.db, {
    now,
    limit,
  });
  summary.expiredPlans = expiredPlans.length;
  if (!input.dryRun) {
    for (const run of expiredPlans) {
      await deps.db.transaction(async (tx) =>
        expirePlannedOptimizerRun(tx, {
          runId: run.id,
          now,
          retentionExpiresAt: new Date(
            now.getTime() + retentionDays * 86_400_000,
          ),
        }),
      );
    }
  }

  const exhausted = await listExhaustedOptimizerRuns(deps.db, {
    now,
    maxAttempts: AI_TOOL_OPTIMIZATION_LIMITS.maxRunAttempts,
    limit,
  });
  summary.failedRuns = exhausted.length;
  if (!input.dryRun) {
    for (const run of exhausted) {
      await deps.db.transaction(async (tx) =>
        failOptimizerRun(tx, {
          runId: run.id,
          errorCode: APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE,
          now,
        }),
      );
    }
  }

  const staleCancels = await listStaleCancelRequestedRuns(deps.db, {
    now,
    limit,
  });
  summary.finalizedCancels = staleCancels.length;
  if (!input.dryRun) {
    for (const run of staleCancels) {
      await deps.db.transaction(async (tx) =>
        finalizeCancelledOptimizerRun(tx, {
          runId: run.id,
          now,
          retentionExpiresAt: new Date(
            now.getTime() + retentionDays * 86_400_000,
          ),
          cancelRequestedAt: run.cancelRequestedAt ?? now,
        }),
      );
    }
  }

  const retentionExpired = await listRetentionExpiredOptimizerRuns(deps.db, {
    now,
    limit,
  });
  summary.deletedRuns = retentionExpired.length;
  if (!input.dryRun) {
    await deps.db.transaction(async (tx) =>
      deleteRetentionExpiredOptimizerRuns(tx, {
        runIds: retentionExpired.map((row) => row.id),
      }),
    );
  }

  return summary;
}

/** Starts the reconciler on a fixed interval with no busy loop. */
export function startOptimizerReconciler(
  deps: AiOptimizerWorkflowDeps,
  config: { intervalMs?: number } = {},
): OptimizerWorkerHandle {
  const intervalMs = config.intervalMs ?? 10 * 60_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const loop = async () => {
    while (!stopped) {
      await runOptimizerReconciler(deps).catch(() => undefined);
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, intervalMs);
      });
    }
  };

  void loop();

  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
