/**
 * Integration tests for atomic draft application of optimizer
 * recommendations: foreign runs, stale tools/revisions, changed policy,
 * duplicate names, invalid operations, atomic rollback, idempotency, and
 * proof that review/apply never triggers provider calls.
 */
import {
  aiToolOptimizationItem,
  aiToolOptimizationRun,
  mcpServer,
  mcpTool,
  schema,
  user,
} from "@repo/db";
import { and, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MCP_REQUEST_DEFINITION_VERSION } from "../lib/mcp-policy.js";
import { mcpRequestDefinitionSchema } from "../lib/mcp-request-definition.js";
import { buildItemReview } from "../lib/mcp-optimizer-policy.js";
import { computeOptimizerFingerprint } from "../lib/mcp-optimizer-sanitize.js";
import type { OptimizerToolSnapshotV1 } from "../lib/mcp-optimizer-contracts.js";
const telemetryMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/mcp-telemetry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/mcp-telemetry.js")>()),
  captureMcpTelemetry: telemetryMock,
}));

import { applyOptimizationToDraft } from "./ai-optimizer-service.js";
import {
  insertOptimizerItems,
  insertOptimizerRun,
} from "./ai-optimizer-repository.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const suite = {
  client: undefined as unknown as ReturnType<typeof postgres>,
  db: undefined as unknown as PostgresJsDatabase<Record<string, unknown>>,
};
const cleanup: string[] = [];
let seq = 0;

function deps() {
  return {
    db: suite.db,
    getAdapter: () => {
      throw new Error("no provider adapter is expected during apply");
    },
  };
}

function definition() {
  return mcpRequestDefinitionSchema.parse({
    version: MCP_REQUEST_DEFINITION_VERSION,
    pathSegments: [],
    query: [
      {
        id: "q1",
        name: "limit",
        value: { kind: "agentInput", agentInputId: "ain_limit" },
      },
    ],
    headers: [],
    body: { bodyType: "none" },
    agentInputs: [
      {
        id: "ain_limit",
        name: "limit",
        required: false,
        sensitive: false,
        type: "integer",
      },
    ],
  });
}

function snapshotFor(toolId: string, name: string): OptimizerToolSnapshotV1 {
  return {
    snapshotVersion: 1,
    source: "draft",
    toolId,
    name,
    title: "Get users",
    method: "GET",
    pathShape: [],
    inputs: [
      {
        sensitivity: "normal",
        id: "ain_limit",
        name: "limit",
        type: "integer",
        required: false,
      },
    ],
    query: [
      {
        id: "q1",
        name: "limit",
        binding: "agentInput",
        agentInputId: "ain_limit",
      },
    ],
    headerPresence: { names: [] },
    body: { bodyType: "none" },
    issues: [],
  };
}

async function makeScenario(input?: {
  toolName?: string;
  secondTool?: boolean;
}) {
  seq += 1;
  const userId = `usr_apply_${seq}_${Date.now().toString(36)}`;
  await suite.db.insert(user).values({
    id: userId,
    name: "Apply Owner",
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  cleanup.push(userId);
  const serverId = `mcs_apply_${seq}_${Date.now().toString(36)}`;
  await suite.db.insert(mcpServer).values({
    id: serverId,
    userId,
    name: "Apply Server",
    slug: `apply-${seq}-${Date.now().toString(36)}`,
    baseUrl: "https://api.example.com",
    allowedHosts: ["api.example.com"],
  });

  const toolName = input?.toolName ?? "get_users";
  const [tool] = await suite.db
    .insert(mcpTool)
    .values({
      serverId,
      name: toolName,
      title: "Get users",
      method: "GET",
      requestDefinition: definition(),
      compileStatus: "valid",
    })
    .returning();

  const otherToolNames: string[] = [];
  if (input?.secondTool) {
    await suite.db.insert(mcpTool).values({
      serverId,
      name: "get_orders",
      method: "GET",
      requestDefinition: definition(),
      compileStatus: "valid",
    });
    otherToolNames.push("get_orders");
  }

  const snapshot = snapshotFor(tool!.id, toolName);
  const review = buildItemReview({
    snapshot,
    definition: definition(),
    operations: [
      {
        kind: "set_tool_title",
        operationId: "op_title",
        value: "Get user records",
        rationale: "Clearer title.",
      },
      {
        kind: "set_query_entry_key",
        operationId: "op_key",
        entryId: "q1",
        value: "page_size",
        rationale: "Clearer query key.",
      },
    ],
    preRejected: [],
    advisories: [],
    compile: {
      common: { headers: [], query: [] },
      auth: null,
      serverValues: [],
      basePath: "/",
      allowMutation: false,
    },
    existingToolNames: otherToolNames,
  });
  expect(review.rejected).toEqual([]);

  const run = await suite.db.transaction(async (tx) =>
    insertOptimizerRun(tx, {
      userId,
      serverId,
      source: "draft",
      scopeKind: "single",
      scope: { kind: "single", toolIds: [tool!.id] },
      state: "completed",
      policyVersion: 1,
      promptVersion: 1,
      providerKind: "openai",
      modelId: "mock-language-1",
      readinessFingerprint: "fp_model",
      serverConfigRevision: 1,
      serverDraftRevision: 1,
      eligibleCount: 1,
      plannedExpiresAt: new Date(Date.now() + 15 * 60_000),
      completedAt: new Date(),
      retentionExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    }),
  );
  await suite.db.transaction(async (tx) =>
    insertOptimizerItems(tx, [
      {
        runId: run.id,
        refKind: "draft_tool",
        toolId: tool!.id,
        name: toolName,
        fingerprint: computeOptimizerFingerprint(snapshot),
        state: "recommended",
        snapshot: snapshot as unknown as Record<string, unknown>,
        review: review as unknown as Record<string, unknown>,
        ordinal: 0,
      },
    ]),
  );
  return { userId, serverId, runId: run.id, toolId: tool!.id, toolName };
}

function applyInput(input: {
  runId: string;
  applyKey?: string;
  expectedConfigRevision?: number;
  expectedDraftRevision?: number;
  operationIds?: string[];
}) {
  return {
    runId: input.runId,
    operationIds: input.operationIds ?? ["op_title", "op_key"],
    applyKey: input.applyKey ?? "apply-key-0001",
    expectedConfigRevision: input.expectedConfigRevision ?? 1,
    expectedDraftRevision: input.expectedDraftRevision ?? 1,
  };
}

/** Fixes the placeholder itemId to the real one from the fixture. */
function withItemId(
  input: ReturnType<typeof applyInput>,
  itemId: string,
): Parameters<typeof applyOptimizationToDraft>[2] {
  return {
    runId: input.runId,
    selections: [{ itemId, operationIds: input.operationIds }],
    expectedConfigRevision: input.expectedConfigRevision,
    expectedDraftRevision: input.expectedDraftRevision,
    applyKey: input.applyKey,
  };
}

async function getToolRow(toolId: string) {
  const [row] = await suite.db
    .select()
    .from(mcpTool)
    .where(eq(mcpTool.id, toolId))
    .limit(1);
  return row!;
}

async function getItemRow(runId: string) {
  const [row] = await suite.db
    .select()
    .from(aiToolOptimizationItem)
    .where(eq(aiToolOptimizationItem.runId, runId))
    .limit(1);
  return row!;
}

describeIntegration("optimizer draft application", () => {
  beforeAll(async () => {
    suite.client = postgres(connectionString!, { max: 4 });
    suite.db = drizzle(suite.client, { schema, casing: "snake_case" });
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("unexpected network request during apply tests");
      }),
    );
  });

  afterAll(async () => {
    for (const userId of cleanup) {
      await suite.db.delete(user).where(eq(user.id, userId));
    }
    await suite.client.end();
  });

  it("applies selected operations atomically with one revision increment", async () => {
    telemetryMock.mockClear();
    const scenario = await makeScenario();
    const item = await getItemRow(scenario.runId);
    const input = withItemId(applyInput({ runId: scenario.runId }), item.id);

    const result = await applyOptimizationToDraft(
      deps(),
      scenario.userId,
      input,
    );
    expect(result.applied).toEqual([
      { itemId: item.id, toolId: scenario.toolId, toolName: "get_users" },
    ]);
    expect(result.configRevision).toBe(2);
    expect(result.draftRevision).toBe(2);

    const tool = await getToolRow(scenario.toolId);
    expect(tool.title).toBe("Get user records");
    const requestDefinition = tool.requestDefinition as {
      query?: Array<{ name?: string }>;
    };
    expect(requestDefinition.query?.[0]?.name).toBe("page_size");
    expect(tool.compileStatus).toBe("valid");
    expect(tool.compiledPlan).not.toBeNull();

    const [server] = await suite.db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.id, scenario.serverId))
      .limit(1);
    expect(server!.configRevision).toBe(2);
    expect(server!.draftRevision).toBe(2);
    // Draft-only: no publication happened.
    expect(server!.publishedRevisionId).toBeNull();

    // Telemetry carries only allowed application metadata, never content.
    const appliedCall = telemetryMock.mock.calls.find(
      (call) => call[0] === "mcp_ai_optimizer_applied",
    );
    expect(appliedCall).toBeDefined();
    const properties = appliedCall![1].properties as Record<string, unknown>;
    expect(properties).toMatchObject({
      sourceKind: "draft",
      appliedCount: 1,
      configRevision: 2,
      draftRevision: 2,
    });
    expect(properties.safeOperationCount).toBeGreaterThanOrEqual(1);
    expect(properties.guardedOperationCount).toBeGreaterThanOrEqual(1);
    const serialized = JSON.stringify(properties);
    expect(serialized).not.toContain("Get user records");
    expect(serialized).not.toContain("page_size");
    expect(serialized).not.toContain("https://api.example.com");
  });

  it("returns the committed result for a repeated key without new revisions", async () => {
    const scenario = await makeScenario();
    const item = await getItemRow(scenario.runId);
    const input = withItemId(applyInput({ runId: scenario.runId }), item.id);
    const first = await applyOptimizationToDraft(
      deps(),
      scenario.userId,
      input,
    );
    const replay = await applyOptimizationToDraft(
      deps(),
      scenario.userId,
      input,
    );
    expect(replay).toEqual(first);
    const [server] = await suite.db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.id, scenario.serverId))
      .limit(1);
    expect(server!.configRevision).toBe(2);
  });

  it("fails closed when a committed key is reused with different operations", async () => {
    const scenario = await makeScenario();
    const item = await getItemRow(scenario.runId);
    const base = applyInput({ runId: scenario.runId });
    await applyOptimizationToDraft(
      deps(),
      scenario.userId,
      withItemId(base, item.id),
    );
    await expect(
      applyOptimizationToDraft(
        deps(),
        scenario.userId,
        withItemId({ ...base, operationIds: ["op_title"] }, item.id),
      ),
    ).rejects.toSatisfy(
      (error: { appCode?: string }) =>
        error.appCode === "AI_OPTIMIZATION_IDEMPOTENCY_CONFLICT",
    );
  });

  it("rejects foreign and missing runs", async () => {
    const scenario = await makeScenario();
    const outsider = await makeScenario();
    const item = await getItemRow(scenario.runId);
    await expect(
      applyOptimizationToDraft(
        deps(),
        outsider.userId,
        withItemId(applyInput({ runId: scenario.runId }), item.id),
      ),
    ).rejects.toSatisfy(
      (error: { appCode?: string }) =>
        error.appCode === "AI_OPTIMIZATION_RUN_NOT_FOUND",
    );
  });

  it("rejects application when the tool drifted after review", async () => {
    const scenario = await makeScenario();
    const item = await getItemRow(scenario.runId);
    await suite.db
      .update(mcpTool)
      .set({ description: "Drifted description." })
      .where(eq(mcpTool.id, scenario.toolId));
    await expect(
      applyOptimizationToDraft(
        deps(),
        scenario.userId,
        withItemId(applyInput({ runId: scenario.runId }), item.id),
      ),
    ).rejects.toSatisfy(
      (error: { appCode?: string }) =>
        error.appCode === "AI_OPTIMIZATION_APPLY_STALE",
    );
    const tool = await getToolRow(scenario.toolId);
    expect(tool.title).toBe("Get users");
  });

  it("rejects stale server revisions with no writes", async () => {
    const scenario = await makeScenario();
    const item = await getItemRow(scenario.runId);
    await expect(
      applyOptimizationToDraft(
        deps(),
        scenario.userId,
        withItemId(
          applyInput({ runId: scenario.runId, expectedConfigRevision: 7 }),
          item.id,
        ),
      ),
    ).rejects.toSatisfy(
      (error: { appCode?: string }) => error.appCode === "MCP_WRITE_CONFLICT",
    );
    const tool = await getToolRow(scenario.toolId);
    expect(tool.title).toBe("Get users");
  });

  it("rejects stale draft revisions with no writes", async () => {
    const scenario = await makeScenario();
    const item = await getItemRow(scenario.runId);
    await expect(
      applyOptimizationToDraft(
        deps(),
        scenario.userId,
        withItemId(
          applyInput({ runId: scenario.runId, expectedDraftRevision: 5 }),
          item.id,
        ),
      ),
    ).rejects.toSatisfy(
      (error: { appCode?: string }) =>
        error.appCode === "MCP_PUBLISH_STALE_DRAFT",
    );
  });

  it("rolls back everything when one selected operation fails current policy", async () => {
    const scenario = await makeScenario({ secondTool: true });
    const item = await getItemRow(scenario.runId);
    // op_key renames the query entry; inject an invalid extra op that the
    // current policy rejects (duplicate of an existing tool name).
    const [itemRow] = await suite.db
      .select()
      .from(aiToolOptimizationItem)
      .where(
        and(
          eq(aiToolOptimizationItem.runId, scenario.runId),
          eq(aiToolOptimizationItem.id, item.id),
        ),
      )
      .limit(1);
    const review = itemRow!.review as {
      sourceOperations?: Array<Record<string, unknown>>;
    };
    review.sourceOperations = [
      ...(review.sourceOperations ?? []),
      {
        kind: "set_tool_name",
        operationId: "op_name",
        value: "get_orders",
        rationale: "Conflicting name.",
      },
    ];
    await suite.db
      .update(aiToolOptimizationItem)
      .set({ review: review as unknown as Record<string, unknown> })
      .where(eq(aiToolOptimizationItem.id, itemRow!.id));

    await expect(
      applyOptimizationToDraft(
        deps(),
        scenario.userId,
        withItemId(
          applyInput({
            runId: scenario.runId,
            operationIds: ["op_title", "op_key", "op_name"],
          }),
          itemRow!.id,
        ),
      ),
    ).rejects.toSatisfy(
      (error: { appCode?: string }) =>
        error.appCode === "AI_OPTIMIZATION_APPLY_INVALID",
    );

    const tool = await getToolRow(scenario.toolId);
    expect(tool.title).toBe("Get users");
    const requestDefinition = tool.requestDefinition as {
      query?: Array<{ name?: string }>;
    };
    expect(requestDefinition.query?.[0]?.name).toBe("limit");
    const [server] = await suite.db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.id, scenario.serverId))
      .limit(1);
    expect(server!.configRevision).toBe(1);
    expect(server!.draftRevision).toBe(1);
  });

  it("rejects runs stored with a future policy version", async () => {
    const scenario = await makeScenario();
    const item = await getItemRow(scenario.runId);
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ policyVersion: 99 })
      .where(eq(aiToolOptimizationRun.id, scenario.runId));
    await expect(
      applyOptimizationToDraft(
        deps(),
        scenario.userId,
        withItemId(applyInput({ runId: scenario.runId }), item.id),
      ),
    ).rejects.toSatisfy(
      (error: { appCode?: string }) =>
        error.appCode === "AI_OPTIMIZATION_POLICY_UNSUPPORTED",
    );
  });

  it("preserves the active published revision after application", async () => {
    const scenario = await makeScenario();
    const item = await getItemRow(scenario.runId);
    await suite.db
      .update(mcpServer)
      .set({ publishedRevisionId: "rev-active" })
      .where(eq(mcpServer.id, scenario.serverId));
    await applyOptimizationToDraft(
      deps(),
      scenario.userId,
      withItemId(applyInput({ runId: scenario.runId }), item.id),
    );
    const [server] = await suite.db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.id, scenario.serverId))
      .limit(1);
    expect(server!.publishedRevisionId).toBe("rev-active");
  });
});
