/**
 * Database-backed invariant tests for the AI tool-optimization schema and
 * repository: state checks, owner scoping, apply-key uniqueness, cascades,
 * lease/claim behavior, retention indexes, and structural proof that raw
 * prompts, raw model output, raw OpenAPI sources, credentials, and secret ids
 * have no column to live in.
 */
import {
  aiToolOptimizationItem,
  aiToolOptimizationRun,
  mcpServer,
  schema,
  user,
} from "@repo/db";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorizeOptimizerRun,
  claimQueuedOptimizerRun,
  deleteRetentionExpiredOptimizerRuns,
  findOptimizerApplyCommitted,
  getOptimizerRunForOwner,
  insertOptimizerItems,
  insertOptimizerRun,
  listRetentionExpiredOptimizerRuns,
  saveOptimizerItemResult,
} from "./ai-optimizer-repository.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const suite = {
  client: undefined as unknown as ReturnType<typeof postgres>,
  db: undefined as unknown as PostgresJsDatabase<Record<string, unknown>>,
};

const createdUserIds: string[] = [];
const createdServerIds: string[] = [];

let userSeq = 0;

async function makeUser(): Promise<string> {
  userSeq += 1;
  const id = `usr_opt_it_${userSeq}_${Date.now().toString(36)}`;
  await suite.db.insert(user).values({
    id,
    name: "Optimizer Integration Owner",
    email: `${id}@example.com`,
    emailVerified: true,
  });
  createdUserIds.push(id);
  return id;
}

async function makeServer(userId: string): Promise<string> {
  const id = `mcs_opt_it_${Date.now().toString(36)}_${createdServerIds.length}`;
  await suite.db.insert(mcpServer).values({
    id,
    userId,
    name: "Optimizer Server",
    slug: `optimizer-${createdServerIds.length}-${Date.now().toString(36)}`,
    baseUrl: "https://api.example.com",
    allowedHosts: ["api.example.com"],
  });
  createdServerIds.push(id);
  return id;
}

type RunFixture = {
  userId: string;
  serverId: string;
  runId: string;
};

const SANITIZED_SNAPSHOT = {
  snapshotVersion: 1,
  source: "draft",
  toolId: "mct_1",
  name: "list_items",
  method: "GET",
  pathShape: [{ kind: "literal", text: "users" }],
  inputs: [
    {
      sensitivity: "normal",
      id: "ain_1",
      name: "limit",
      type: "number",
      required: false,
    },
  ],
  query: [],
  headerPresence: { names: [] },
  body: { bodyType: "none" },
  issues: [],
};

async function makeRun(input?: {
  userId?: string;
  serverId?: string;
  state?: string;
}): Promise<RunFixture> {
  const userId = input?.userId ?? (await makeUser());
  const serverId = input?.serverId ?? (await makeServer(userId));
  const run = await suite.db.transaction(async (tx) =>
    insertOptimizerRun(tx, {
      userId,
      serverId,
      source: "draft",
      scopeKind: "single",
      scope: { kind: "single", toolIds: ["mct_1"] },
      state: input?.state ?? "planned",
      policyVersion: 1,
      promptVersion: 1,
      serverConfigRevision: 1,
      serverDraftRevision: 1,
      plannedExpiresAt: new Date(Date.now() + 15 * 60_000),
    }),
  );
  return { userId, serverId, runId: run.id };
}

async function makeItem(runId: string, ordinal = 0) {
  const items = await suite.db.transaction(async (tx) =>
    insertOptimizerItems(tx, [
      {
        runId,
        refKind: "draft_tool",
        toolId: "mct_1",
        name: "list_items",
        fingerprint: "fp_test",
        state: "queued",
        snapshot: SANITIZED_SNAPSHOT,
        ordinal,
      },
    ]),
  );
  return items[0]!;
}

describeIntegration("ai optimizer schema and repository", () => {
  beforeAll(async () => {
    suite.client = postgres(connectionString!, { max: 4 });
    suite.db = drizzle(suite.client, { schema, casing: "snake_case" });
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await suite.db.delete(user).where(eq(user.id, userId));
    }
    await suite.client.end();
  });

  it("rejects invalid run and item states at the database level", async () => {
    const { userId, serverId } = await makeRun();
    await expect(
      suite.db.insert(aiToolOptimizationRun).values({
        userId,
        serverId,
        source: "draft",
        scopeKind: "single",
        scope: {},
        state: "teleported",
        policyVersion: 1,
        promptVersion: 1,
        serverConfigRevision: 1,
        serverDraftRevision: 1,
        plannedExpiresAt: new Date(),
      }),
    ).rejects.toThrow();
    const fixture = await makeRun();
    await expect(
      suite.db.insert(aiToolOptimizationItem).values({
        runId: fixture.runId,
        refKind: "draft_tool",
        name: "x",
        fingerprint: "fp",
        state: "teleported",
        snapshot: SANITIZED_SNAPSHOT,
        ordinal: 0,
      }),
    ).rejects.toThrow();
  });

  it("scopes every read and write by owner", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const serverId = await makeServer(owner);
    const fixture = await makeRun({ userId: owner, serverId });
    await makeItem(fixture.runId);

    expect(
      await getOptimizerRunForOwner(suite.db, {
        userId: owner,
        runId: fixture.runId,
      }),
    ).not.toBeNull();
    expect(
      await getOptimizerRunForOwner(suite.db, {
        userId: outsider,
        runId: fixture.runId,
      }),
    ).toBeNull();

    await makeRun({
      userId: outsider,
      serverId: await makeServer(outsider),
    });
    const authorized = await suite.db.transaction(async (tx) =>
      authorizeOptimizerRun(tx, {
        userId: outsider,
        runId: fixture.runId,
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
    );
    expect(authorized).toBeNull();
    const stillPlanned = await suite.db
      .select()
      .from(aiToolOptimizationRun)
      .where(eq(aiToolOptimizationRun.id, fixture.runId))
      .limit(1);
    expect(stillPlanned[0]!.state).toBe("planned");
  });

  it("enforces one committed apply key per owner", async () => {
    const fixture = await makeRun();
    const result = { ok: true };
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ applyKey: "key-12345678", applyResult: result })
      .where(eq(aiToolOptimizationRun.id, fixture.runId));

    const sameKeyDifferentRun = await makeRun({ userId: fixture.userId });
    await expect(
      suite.db
        .update(aiToolOptimizationRun)
        .set({ applyKey: "key-12345678", applyResult: result })
        .where(eq(aiToolOptimizationRun.id, sameKeyDifferentRun.runId)),
    ).rejects.toThrow();

    const sameKeyOtherOwner = await makeRun();
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ applyKey: "key-12345678", applyResult: result })
      .where(eq(aiToolOptimizationRun.id, sameKeyOtherOwner.runId));

    expect(
      await findOptimizerApplyCommitted(suite.db, {
        userId: fixture.userId,
        runId: fixture.runId,
        applyKey: "key-12345678",
      }),
    ).toEqual(result);
  });

  it("cascades run and item deletion from the owner and the server", async () => {
    const userId = await makeUser();
    const serverId = await makeServer(userId);
    const fixture = await makeRun({ userId, serverId });
    await makeItem(fixture.runId);

    await suite.db.delete(mcpServer).where(eq(mcpServer.id, serverId));
    expect(
      await suite.db
        .select()
        .from(aiToolOptimizationRun)
        .where(eq(aiToolOptimizationRun.id, fixture.runId)),
    ).toHaveLength(0);

    const other = await makeRun();
    await makeItem(other.runId);
    await suite.db.delete(user).where(eq(user.id, other.userId));
    expect(
      await suite.db
        .select()
        .from(aiToolOptimizationRun)
        .where(eq(aiToolOptimizationRun.id, other.runId)),
    ).toHaveLength(0);
  });

  it("claims queued runs with SKIP LOCKED and grants leases", async () => {
    const fixture = await makeRun({ state: "queued" });
    const claimed = await suite.db.transaction(async (tx) =>
      claimQueuedOptimizerRun(tx, {
        workerId: "worker-a",
        now: new Date(),
        leaseExpiresAt: new Date(Date.now() + 120_000),
        maxAttempts: 3,
      }),
    );
    expect(claimed).not.toBeNull();
    expect(claimed!.state).toBe("running");
    expect(claimed!.workerId).toBe("worker-a");
    expect(claimed!.attempts).toBe(1);

    // A second claimer cannot take a live lease.
    const second = await suite.db.transaction(async (tx) =>
      claimQueuedOptimizerRun(tx, {
        workerId: "worker-b",
        now: new Date(),
        leaseExpiresAt: new Date(Date.now() + 120_000),
        maxAttempts: 3,
      }),
    );
    if (second) expect(second.id).not.toBe(fixture.runId);
  });

  it("resumes a run after its lease expires and increments attempts", async () => {
    await makeRun({ state: "queued" });
    await suite.db.transaction(async (tx) =>
      claimQueuedOptimizerRun(tx, {
        workerId: "worker-a",
        now: new Date(),
        leaseExpiresAt: new Date(Date.now() - 1_000),
        maxAttempts: 3,
      }),
    );
    const resumed = await suite.db.transaction(async (tx) =>
      claimQueuedOptimizerRun(tx, {
        workerId: "worker-b",
        now: new Date(),
        leaseExpiresAt: new Date(Date.now() + 120_000),
        maxAttempts: 3,
      }),
    );
    expect(resumed).not.toBeNull();
    expect(resumed!.workerId).toBe("worker-b");
    expect(resumed!.attempts).toBe(2);
  });

  it("makes recommendation persistence idempotent against applied/rejected states", async () => {
    const fixture = await makeRun({ state: "running" });
    const item = await makeItem(fixture.runId);
    const saved = await suite.db.transaction(async (tx) =>
      saveOptimizerItemResult(tx, {
        runId: fixture.runId,
        itemId: item.id,
        state: "recommended",
        review: { operations: [], advisories: [], rejected: [] },
        failureCode: null,
        now: new Date(),
      }),
    );
    expect(saved).toBe(true);
    // A duplicate late write (uncertain crash retry) cannot overwrite.
    const duplicate = await suite.db.transaction(async (tx) =>
      saveOptimizerItemResult(tx, {
        runId: fixture.runId,
        itemId: item.id,
        state: "failed",
        review: null,
        failureCode: "AI_PROVIDER_TRANSIENT_FAILURE",
        now: new Date(),
      }),
    );
    expect(duplicate).toBe(false);
    const [row] = await suite.db
      .select()
      .from(aiToolOptimizationItem)
      .where(
        and(
          eq(aiToolOptimizationItem.id, item.id),
          eq(aiToolOptimizationItem.runId, fixture.runId),
        ),
      )
      .limit(1);
    expect(row!.state).toBe("recommended");
  });

  it("keeps lease/claim and retention query indexes present", async () => {
    const indexes = (await suite.db.execute(
      sql`select indexname from pg_indexes where tablename = 'ai_tool_optimization_run'`,
    )) as Array<{ indexname: string }>;
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain("ai_tool_optimization_run_claim_idx");
    expect(names).toContain("ai_tool_optimization_run_retention_idx");
    expect(names).toContain("ai_tool_optimization_run_state_idx");
  });

  it("offers no column that could store prompts, raw outputs, sources, credentials, or secret ids", async () => {
    const columns = (await suite.db.execute(
      sql`select table_name, column_name from information_schema.columns
          where table_name in ('ai_tool_optimization_run', 'ai_tool_optimization_item')`,
    )) as Array<{ table_name: string; column_name: string }>;
    const names = columns.map((row) => row.column_name);
    const forbidden = [
      "prompt",
      "raw_response",
      "raw_output",
      "raw_document",
      "credential",
      "ciphertext",
      "secret",
      "server_value_id",
      "base_url",
      "source_url",
      "template",
    ];
    for (const name of forbidden) {
      expect(names).not.toContain(name);
    }
    const itemColumns = columns
      .filter(
        (row: { table_name: string; column_name: string }) =>
          row.table_name === "ai_tool_optimization_item",
      )
      .map((row: { column_name: string }) => row.column_name);
    expect(itemColumns).toContain("snapshot");
    expect(itemColumns).toContain("review");
  });

  it("deletes only retention-expired terminal runs", async () => {
    const now = new Date();
    const expired = await makeRun({ state: "completed" });
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ retentionExpiresAt: new Date(now.getTime() - 1_000) })
      .where(eq(aiToolOptimizationRun.id, expired.runId));
    const fresh = await makeRun({ state: "completed" });
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ retentionExpiresAt: new Date(now.getTime() + 86_400_000) })
      .where(eq(aiToolOptimizationRun.id, fresh.runId));

    const candidates = await listRetentionExpiredOptimizerRuns(suite.db, {
      now,
      limit: 100,
    });
    const candidateIds = candidates.map((row) => row.id);
    expect(candidateIds).toContain(expired.runId);
    expect(candidateIds).not.toContain(fresh.runId);

    const deleted = await suite.db.transaction(async (tx) =>
      deleteRetentionExpiredOptimizerRuns(tx, {
        runIds: candidateIds,
      }),
    );
    expect(deleted).toBeGreaterThan(0);
    const gone = await suite.db
      .select()
      .from(aiToolOptimizationRun)
      .where(eq(aiToolOptimizationRun.id, expired.runId))
      .limit(1);
    expect(gone).toHaveLength(0);
  });
});
