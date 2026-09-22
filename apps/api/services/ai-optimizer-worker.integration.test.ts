/**
 * Worker integration tests: competing claims under SKIP LOCKED, lease expiry
 * and crash recovery, duplicate inference persistence, cancellation races,
 * partial failure completion, and proof the worker never touches draft rows.
 */
import {
  aiToolOptimizationItem,
  aiToolOptimizationRun,
  mcpServer,
  mcpTool,
  schema,
  user,
} from "@repo/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const analyzeBatchMock = vi.fn();
const telemetryMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/mcp-telemetry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/mcp-telemetry.js")>()),
  captureMcpTelemetry: telemetryMock,
}));

vi.mock("./ai-optimizer-workflow.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./ai-optimizer-workflow.js")>();
  return {
    ...actual,
    analyzeBatch: (...args: unknown[]) => analyzeBatchMock(...args),
    // Readiness rows are out of scope for lease/processing tests; the drift
    // fail-closed path is covered by the adversarial and service suites.
    assertRunModelCurrent: vi.fn(async () => ({
      snapshot: { contextWindowTokens: 128_000 },
    })),
  };
});

import {
  processClaimedRun,
  DEFAULT_OPTIMIZER_WORKER_CONFIG,
  type OptimizerWorkerConfig,
} from "./ai-optimizer-worker.js";
import {
  authorizeOptimizerRun,
  claimQueuedOptimizerRun,
  finalizeCancelledOptimizerRun,
  insertOptimizerItems,
  insertOptimizerRun,
  requestOptimizerCancel,
  saveOptimizerItemResult,
} from "./ai-optimizer-repository.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const suite = {
  client: undefined as unknown as ReturnType<typeof postgres>,
  db: undefined as unknown as PostgresJsDatabase<Record<string, unknown>>,
};

const cleanup: string[] = [];
let seq = 0;

const CONFIG: OptimizerWorkerConfig = {
  ...DEFAULT_OPTIMIZER_WORKER_CONFIG,
  retentionDays: 30,
};

function deps() {
  return {
    db: suite.db,
    getAdapter: (() => ({})) as never,
    aiCredentialSecret: "secret",
  };
}

function snapshotFor(name: string) {
  return {
    snapshotVersion: 1,
    source: "draft",
    toolId: name,
    name,
    method: "GET",
    pathShape: [],
    inputs: [],
    query: [],
    headerPresence: { names: [] },
    body: { bodyType: "none" },
    issues: [],
  };
}

async function makeScenario(toolCount: number) {
  seq += 1;
  const userId = `usr_wrk_${seq}_${Date.now().toString(36)}`;
  await suite.db.insert(user).values({
    id: userId,
    name: "Worker Owner",
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  cleanup.push(userId);
  const serverId = `mcs_wrk_${seq}_${Date.now().toString(36)}`;
  await suite.db.insert(mcpServer).values({
    id: serverId,
    userId,
    name: "Worker Server",
    slug: `wrk-${seq}-${Date.now().toString(36)}`,
    baseUrl: "https://api.example.com",
    allowedHosts: ["api.example.com"],
  });
  const toolIds: string[] = [];
  for (let i = 0; i < toolCount; i += 1) {
    const [tool] = await suite.db
      .insert(mcpTool)
      .values({
        serverId,
        name: `tool_${i}`,
        method: "GET",
        requestDefinition: {
          version: 2,
          pathSegments: [],
          query: [],
          headers: [],
          body: { bodyType: "none" },
          agentInputs: [],
        },
        compileStatus: "valid",
      })
      .returning();
    toolIds.push(tool!.id);
  }
  const run = await suite.db.transaction(async (tx) =>
    insertOptimizerRun(tx, {
      userId,
      serverId,
      source: "draft",
      scopeKind: "all_eligible",
      scope: { kind: "all_eligible" },
      state: "planned",
      policyVersion: 1,
      promptVersion: 1,
      providerKind: "openai",
      modelId: "mock-language-1",
      readinessFingerprint: "fp_model",
      serverConfigRevision: 1,
      serverDraftRevision: 1,
      eligibleCount: toolCount,
      plannedExpiresAt: new Date(Date.now() + 15 * 60_000),
    }),
  );
  const items = await suite.db.transaction(async (tx) =>
    insertOptimizerItems(
      tx,
      toolIds.map((toolId, index) => ({
        runId: run.id,
        refKind: "draft_tool",
        toolId,
        name: `tool_${index}`,
        fingerprint: `fp_${toolId}`,
        state: "queued",
        snapshot: snapshotFor(`tool_${index}`),
        ordinal: index,
      })),
    ),
  );
  return { userId, serverId, runId: run.id, items, toolIds };
}

function itemResultOk(operations: unknown[] = [], advisories: unknown[] = []) {
  return { ok: true, operations, advisories, rejected: [] } as const;
}

/** Claims queued runs until the targeted one wins; other suites leave queued
 * fixtures behind and SKIP LOCKED always picks the oldest eligible row. */
async function claimOwnRun(
  runId: string,
  options?: { expiredLease?: boolean; workerId?: string },
) {
  // Exhaust other suites' leftover runs so SKIP LOCKED can only win ours.
  await suite.db
    .update(aiToolOptimizationRun)
    .set({ attempts: 999 })
    .where(
      and(
        inArray(aiToolOptimizationRun.state, ["queued", "running"]),
        sql`${aiToolOptimizationRun.id} != ${runId}`,
      ),
    );
  return suite.db.transaction(async (tx) =>
    claimQueuedOptimizerRun(tx, {
      workerId: options?.workerId ?? "worker-a",
      now: new Date(),
      leaseExpiresAt: new Date(
        Date.now() + (options?.expiredLease ? -1_000 : 120_000),
      ),
      maxAttempts: 3,
    }),
  );
}

describeIntegration("optimizer worker", () => {
  beforeAll(async () => {
    suite.client = postgres(connectionString!, { max: 4 });
    suite.db = drizzle(suite.client, { schema, casing: "snake_case" });
  });

  afterAll(async () => {
    for (const userId of cleanup) {
      await suite.db.delete(user).where(eq(user.id, userId));
    }
    await suite.client.end();
  });

  it("lets only one of two competing workers claim the same run", async () => {
    const scenario = await makeScenario(1);
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ state: "queued" })
      .where(eq(aiToolOptimizationRun.id, scenario.runId));

    const results = await Promise.all([
      suite.db.transaction(async (tx) =>
        claimQueuedOptimizerRun(tx, {
          workerId: "worker-a",
          now: new Date(),
          leaseExpiresAt: new Date(Date.now() + 120_000),
          maxAttempts: 3,
        }),
      ),
      suite.db.transaction(async (tx) =>
        claimQueuedOptimizerRun(tx, {
          workerId: "worker-b",
          now: new Date(),
          leaseExpiresAt: new Date(Date.now() + 120_000),
          maxAttempts: 3,
        }),
      ),
    ]);
    const claims = results.filter((r) => r?.id === scenario.runId);
    expect(claims).toHaveLength(1);
  });

  it("recovers after a crash: another worker resumes unfinished items and preserves recommendations", async () => {
    const scenario = await makeScenario(3);
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ state: "queued" })
      .where(eq(aiToolOptimizationRun.id, scenario.runId));

    // First worker claims, persists one recommendation, then dies.
    const firstClaim = await claimOwnRun(scenario.runId, {
      expiredLease: true,
    });
    expect(firstClaim?.id).toBe(scenario.runId);
    await suite.db.transaction(async (tx) =>
      saveOptimizerItemResult(tx, {
        runId: scenario.runId,
        itemId: scenario.items[0]!.id,
        state: "recommended",
        review: { operations: [], advisories: [], rejected: [] },
        failureCode: null,
        now: new Date(),
      }),
    );

    // Duplicate uncertain inference cannot overwrite the persisted result.
    await suite.db.transaction(async (tx) =>
      saveOptimizerItemResult(tx, {
        runId: scenario.runId,
        itemId: scenario.items[0]!.id,
        state: "no_change",
        review: null,
        failureCode: null,
        now: new Date(),
      }),
    );

    // Replacement worker claims the expired lease and finishes the rest.
    const resumed = await claimOwnRun(scenario.runId, {
      workerId: "worker-b",
    });
    expect(resumed?.id).toBe(scenario.runId);
    expect(resumed?.workerId).toBe("worker-b");

    analyzeBatchMock.mockImplementation(
      (_deps: unknown, input: { batch: Array<{ itemRef: string }> }) =>
        Promise.resolve({
          usage: { totalTokens: 10, batchCount: 1, usedRepair: false },
          results: new Map(
            input.batch.map((entry) => [
              entry.itemRef,
              itemResultOk([
                {
                  kind: "set_tool_title",
                  operationId: `o-${entry.itemRef}`,
                  value: `Title ${entry.itemRef}`,
                  rationale: "r",
                },
              ]),
            ]),
          ),
        }),
    );

    const outcome = await processClaimedRun(deps(), resumed!, CONFIG);
    expect(outcome).toBe("completed");

    const items = await suite.db
      .select()
      .from(aiToolOptimizationItem)
      .where(eq(aiToolOptimizationItem.runId, scenario.runId));
    const byId = new Map(items.map((item) => [item.id, item]));
    // The crash survivor kept its original persisted state.
    expect(byId.get(scenario.items[0]!.id)!.state).toBe("recommended");
    // The remaining items were processed by the replacement worker.
    expect(byId.get(scenario.items[1]!.id)!.state).toBe("recommended");
    expect(byId.get(scenario.items[2]!.id)!.state).toBe("recommended");

    // The worker never mutates draft tools.
    const tools = await suite.db
      .select()
      .from(mcpTool)
      .where(eq(mcpTool.serverId, scenario.serverId));
    expect(tools.every((tool) => tool.title === null)).toBe(true);
  });

  it("finalizes a cancellation race preserving completed recommendations", async () => {
    const scenario = await makeScenario(2);
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ state: "running", workerId: "worker-a" })
      .where(eq(aiToolOptimizationRun.id, scenario.runId));
    await suite.db.transaction(async (tx) =>
      saveOptimizerItemResult(tx, {
        runId: scenario.runId,
        itemId: scenario.items[0]!.id,
        state: "recommended",
        review: { operations: [], advisories: [], rejected: [] },
        failureCode: null,
        now: new Date(),
      }),
    );
    const cancelAt = new Date();
    const cancelled = await suite.db.transaction(async (tx) =>
      requestOptimizerCancel(tx, {
        userId: scenario.userId,
        runId: scenario.runId,
        now: cancelAt,
        retentionExpiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    expect(cancelled?.state).toBe("cancel_requested");
    const finalized = await suite.db.transaction(async (tx) =>
      finalizeCancelledOptimizerRun(tx, {
        runId: scenario.runId,
        now: new Date(),
        retentionExpiresAt: new Date(Date.now() + 86_400_000),
        cancelRequestedAt: cancelAt,
      }),
    );
    expect(finalized?.state).toBe("cancelled");
    const items = await suite.db
      .select()
      .from(aiToolOptimizationItem)
      .where(eq(aiToolOptimizationItem.runId, scenario.runId));
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(scenario.items[0]!.id)!.state).toBe("recommended");
    expect(byId.get(scenario.items[1]!.id)!.state).toBe("cancelled");
  });

  it("completes with errors when some items fail while others succeed", async () => {
    telemetryMock.mockClear();
    const scenario = await makeScenario(2);
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ state: "queued" })
      .where(eq(aiToolOptimizationRun.id, scenario.runId));
    const claimed = await claimOwnRun(scenario.runId);
    expect(claimed?.id).toBe(scenario.runId);

    analyzeBatchMock.mockImplementation(
      (_deps: unknown, input: { batch: Array<{ itemRef: string }> }) =>
        Promise.resolve({
          usage: { totalTokens: 10, batchCount: 1, usedRepair: false },
          results: new Map(
            input.batch.map((entry, index) => [
              entry.itemRef,
              index === 0
                ? itemResultOk()
                : ({
                    ok: false,
                    failureCode: "provider_transient_failure",
                  } as const),
            ]),
          ),
        }),
    );

    const outcome = await processClaimedRun(deps(), claimed!, CONFIG);
    expect(outcome).toBe("completed_with_errors");

    // Usage metadata is recorded; telemetry carries only allowed fields.
    const runCall = telemetryMock.mock.calls.find(
      (call) => call[0] === "mcp_ai_optimizer_run_completed",
    );
    expect(runCall).toBeDefined();
    const properties = runCall![1].properties as Record<string, unknown>;
    expect(properties).toMatchObject({
      sourceKind: "draft",
      scopeKind: "all_eligible",
      outcome: "completed_with_errors",
      policyVersion: 1,
      promptVersion: 1,
      modelId: "mock-language-1",
    });
    expect(typeof properties.totalTokens).toBe("number");
    const serialized = JSON.stringify(properties);
    // Content-bearing fields never reach telemetry.
    expect(serialized).not.toContain("tool_0");
    expect(serialized).not.toContain("https://api.example.com");
    expect(serialized).not.toContain("description");
    expect(serialized).not.toContain("snapshot");
    for (const key of Object.keys(properties)) {
      expect([
        "sourceKind",
        "scopeKind",
        "outcome",
        "policyVersion",
        "promptVersion",
        "providerKind",
        "modelId",
        "itemCount",
        "recommendedCount",
        "failedCount",
        "batchCount",
        "totalTokens",
      ]).toContain(key);
    }
    const [run] = await suite.db
      .select()
      .from(aiToolOptimizationRun)
      .where(eq(aiToolOptimizationRun.id, scenario.runId))
      .limit(1);
    expect(run!.state).toBe("completed_with_errors");
    expect(run!.retentionExpiresAt).not.toBeNull();
    const items = await suite.db
      .select()
      .from(aiToolOptimizationItem)
      .where(
        and(
          eq(aiToolOptimizationItem.runId, scenario.runId),
          eq(aiToolOptimizationItem.state, "failed"),
        ),
      );
    expect(items).toHaveLength(1);
    expect(items[0]!.failureCode).toBe("provider_transient_failure");
  });

  it("expires abandoned planned runs through the reconciler path", async () => {
    const scenario = await makeScenario(1);
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ plannedExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(aiToolOptimizationRun.id, scenario.runId));
    const { runOptimizerReconciler } = await import("./ai-optimizer-worker.js");
    const summary = await runOptimizerReconciler(deps(), {
      limit: 100,
    });
    expect(summary.expiredPlans).toBeGreaterThanOrEqual(1);
    const [run] = await suite.db
      .select()
      .from(aiToolOptimizationRun)
      .where(eq(aiToolOptimizationRun.id, scenario.runId))
      .limit(1);
    expect(run!.state).toBe("expired");
  });

  it("authorization rechecks keep foreign runs unauthorizable", async () => {
    const scenario = await makeScenario(1);
    const outsider = await makeScenario(1);
    await expect(
      suite.db.transaction(async (tx) =>
        authorizeOptimizerRun(tx, {
          userId: outsider.userId,
          runId: scenario.runId,
          now: new Date(),
          plannedExpiresAt: new Date(Date.now() + 15 * 60_000),
          expectedConfigRevision: 1,
          expectedDraftRevision: 1,
          model: {
            providerKind: "openai",
            modelId: "mock-language-1",
            readinessFingerprint: "fp_model",
          },
        }),
      ),
    ).resolves.toBeNull();
  });
});
