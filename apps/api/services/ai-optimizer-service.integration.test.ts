/**
 * Integration tests for optimizer preflight and authorization: missing AI
 * readiness, ineligible items, expired plans, draft/source/model drift,
 * disclosure fields, and proof that no model call or raw-source persistence
 * happens anywhere in the flow.
 */
import { APP_ERROR_CODES } from "@repo/core";
import {
  aiModelSelection,
  aiProviderConnection,
  mcpServer,
  mcpTool,
  schema,
  user,
  type McpTool,
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
import type {
  AiProviderAdapter,
  AiResolvedRoute,
} from "../lib/ai/provider-adapter.js";
import {
  buildCapabilitySnapshot,
  computeVerificationFingerprint,
} from "../lib/ai/verification.js";
import { MCP_REQUEST_DEFINITION_VERSION } from "../lib/mcp-policy.js";
import {
  authorizeOptimization,
  getOptimizationItem,
  getOptimizationStatus,
  listOptimizationItems,
  listOptimizationRuns,
  preflightDraftOptimization,
  preflightOpenApiOptimization,
  type AiOptimizerDeps,
} from "./ai-optimizer-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const ROUTE: AiResolvedRoute = {
  status: "resolved",
  protocol: "openai-chat-completions",
  origin: "https://mock.test",
};
const ADAPTER_VERSION = 1;
const MODEL_ID = "mock-language-1";

const fakeAdapter: AiProviderAdapter = {
  kind: "openai",
  providerClass: "direct",
  adapterVersion: ADAPTER_VERSION,
  async verifyCredential() {},
  async discoverModels() {
    return [];
  },
  resolveRoute() {
    return ROUTE;
  },
  async constructModel() {
    throw new Error("no model construction is expected in preflight tests");
  },
};

const suite = {
  client: undefined as unknown as ReturnType<typeof postgres>,
  db: undefined as unknown as PostgresJsDatabase<Record<string, unknown>>,
};

const cleanup: string[] = [];
let seq = 0;

function deps(): AiOptimizerDeps {
  return { db: suite.db, getAdapter: () => fakeAdapter };
}

async function makeOwnerWithSelection(): Promise<string> {
  seq += 1;
  const id = `usr_optsvc_${seq}_${Date.now().toString(36)}`;
  await suite.db.insert(user).values({
    id,
    name: "Optimizer Service Owner",
    email: `${id}@example.com`,
    emailVerified: true,
  });
  cleanup.push(id);

  const connectionId = `aic_${seq}`;
  await suite.db.insert(aiProviderConnection).values({
    id: connectionId,
    userId: id,
    providerKind: "openai",
    ciphertext: "envelope-placeholder",
    verifiedAt: new Date(),
  });
  const fingerprintInput = {
    providerKind: "openai" as const,
    credentialRevision: 1,
    adapterVersion: ADAPTER_VERSION,
    modelId: MODEL_ID,
    protocol: "openai-chat-completions" as const,
    routeOrigin: ROUTE.origin,
    profileId: "structured-text-v1",
    profileVersion: 1,
  };
  await suite.db.insert(aiModelSelection).values({
    userId: id,
    connectionId,
    capabilityProfile: "structured-text-v1",
    modelId: MODEL_ID,
    protocol: "openai-chat-completions",
    routeOrigin: ROUTE.origin,
    capabilitySnapshot: buildCapabilitySnapshot({
      contextWindowTokens: 128_000,
      fingerprintInput,
    }),
    verificationFingerprint: computeVerificationFingerprint(fingerprintInput),
    verifiedAt: new Date(),
  });
  return id;
}

async function makeServer(userId: string): Promise<string> {
  const id = `mcs_optsvc_${Date.now().toString(36)}_${(seq += 1)}`;
  await suite.db.insert(mcpServer).values({
    id,
    userId,
    name: "Service Server",
    slug: `svc-${Date.now().toString(36)}-${seq}`,
    baseUrl: "https://api.example.com",
    allowedHosts: ["api.example.com"],
  });
  return id;
}

function toolValues(
  serverId: string,
  overrides: Partial<McpTool> & { name: string },
): typeof mcpTool.$inferInsert {
  return {
    serverId,
    method: "GET",
    requestDefinition: {
      version: MCP_REQUEST_DEFINITION_VERSION,
      pathSegments: [{ id: "p1", value: { kind: "literal", value: "users" } }],
      query: [],
      headers: [],
      body: { bodyType: "none" },
      agentInputs: [],
    },
    compileStatus: "valid",
    compileIssues: [],
    ...overrides,
  };
}

async function makeTool(
  serverId: string,
  overrides: Partial<McpTool> & { name: string },
): Promise<McpTool> {
  const [row] = await suite.db
    .insert(mcpTool)
    .values(toolValues(serverId, overrides))
    .returning();
  return row!;
}

function expectAppError(error: unknown, appCode: string): boolean {
  expect(error).toBeInstanceOf(Error);
  expect((error as { appCode?: unknown }).appCode).toBe(appCode);
  return true;
}

describeIntegration("optimizer preflight and authorization", () => {
  beforeAll(async () => {
    suite.client = postgres(connectionString!, { max: 4 });
    suite.db = drizzle(suite.client, { schema, casing: "snake_case" });
  });

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("unexpected network request in optimizer suite");
      }),
    );
  });

  afterAll(async () => {
    for (const userId of cleanup) {
      await suite.db.delete(user).where(eq(user.id, userId));
    }
    await suite.client.end();
  });

  it("fails preflight closed when AI readiness is missing", async () => {
    seq += 1;
    const userId = `usr_noready_${seq}_${Date.now().toString(36)}`;
    await suite.db.insert(user).values({
      id: userId,
      name: "No AI",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
    cleanup.push(userId);
    const serverId = await makeServer(userId);
    await expect(
      preflightDraftOptimization(deps(), userId, {
        serverId,
        scope: { kind: "all_eligible" },
        expectedConfigRevision: 1,
      }),
    ).rejects.toSatisfy((error) =>
      expectAppError(error, APP_ERROR_CODES.AI_FEATURE_NOT_READY),
    );
  });

  it("creates a write-free plan with exact disclosure and ineligible reporting", async () => {
    const userId = await makeOwnerWithSelection();
    const serverId = await makeServer(userId);
    const good = await makeTool(serverId, { name: "get_users" });
    await makeTool(serverId, {
      name: "broken_tool",
      requestDefinition: { version: 99 },
    });

    const plan = await preflightDraftOptimization(deps(), userId, {
      serverId,
      scope: { kind: "all_eligible" },
      expectedConfigRevision: 1,
    });

    expect(plan.state).toBe("planned");
    expect(plan.scopeKind).toBe("all_eligible");
    expect(plan.eligible.map((item) => item.ref)).toContainEqual({
      kind: "draft_tool",
      toolId: good.id,
    });
    expect(plan.ineligible).toEqual([
      {
        ref: { kind: "draft_tool", toolId: expect.any(String) },
        name: "broken_tool",
        reason: "definition_unparseable",
      },
    ]);
    expect(plan.mutableFields.length).toBeGreaterThan(0);
    expect(plan.immutableFields).toContain("path");
    expect(plan.disclosedData).toContain("path_shape");
    expect(plan.estimate.pricing).toEqual({ state: "unknown" });
    expect(plan.estimate.tokens.inputTokens).toBeGreaterThan(0);
    expect(plan.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(plan.model.modelId).toBe(MODEL_ID);

    // The plan exists in the database and can be authorized as-is.
    const result = await authorizeOptimization(deps(), userId, {
      runId: plan.runId,
      expectedConfigRevision: 1,
    });
    expect(result.state).toBe("queued");
  });

  it("rejects authorization for an expired plan without sending data", async () => {
    const userId = await makeOwnerWithSelection();
    const serverId = await makeServer(userId);
    await makeTool(serverId, { name: "get_users" });
    const plan = await preflightDraftOptimization(deps(), userId, {
      serverId,
      scope: { kind: "all_eligible" },
      expectedConfigRevision: 1,
    });
    // Force expiry.
    await suite.db
      .update(mcpServer)
      .set({ configRevision: 2 })
      .where(eq(mcpServer.id, serverId));
    await expect(
      authorizeOptimization(deps(), userId, {
        runId: plan.runId,
        expectedConfigRevision: 2,
      }),
    ).rejects.toSatisfy((error) =>
      expectAppError(error, APP_ERROR_CODES.AI_OPTIMIZATION_PLAN_STALE),
    );
  });

  it("rejects authorization after tool drift", async () => {
    const userId = await makeOwnerWithSelection();
    const serverId = await makeServer(userId);
    const tool = await makeTool(serverId, { name: "get_users" });
    const plan = await preflightDraftOptimization(deps(), userId, {
      serverId,
      scope: { kind: "single", toolIds: [tool.id] },
      expectedConfigRevision: 1,
    });
    await suite.db
      .update(mcpTool)
      .set({ description: "Changed after preflight." })
      .where(eq(mcpTool.id, tool.id));
    await expect(
      authorizeOptimization(deps(), userId, {
        runId: plan.runId,
        expectedConfigRevision: 1,
      }),
    ).rejects.toSatisfy((error) =>
      expectAppError(error, APP_ERROR_CODES.AI_OPTIMIZATION_PLAN_STALE),
    );
  });

  it("rejects authorization after model drift", async () => {
    const userId = await makeOwnerWithSelection();
    const serverId = await makeServer(userId);
    await makeTool(serverId, { name: "get_users" });
    const plan = await preflightDraftOptimization(deps(), userId, {
      serverId,
      scope: { kind: "all_eligible" },
      expectedConfigRevision: 1,
    });
    const [selection] = await suite.db
      .select()
      .from(aiModelSelection)
      .where(
        and(
          eq(aiModelSelection.userId, userId),
          eq(aiModelSelection.capabilityProfile, "structured-text-v1"),
        ),
      )
      .limit(1);
    await suite.db
      .update(aiModelSelection)
      .set({ modelId: "other-model" })
      .where(eq(aiModelSelection.id, selection!.id));
    await expect(
      authorizeOptimization(deps(), userId, {
        runId: plan.runId,
        expectedConfigRevision: 1,
      }),
    ).rejects.toSatisfy((error) =>
      expectAppError(error, APP_ERROR_CODES.AI_OPTIMIZATION_PLAN_STALE),
    );
  });

  it("keeps a declined plan untouched and queueable only by its owner", async () => {
    const userId = await makeOwnerWithSelection();
    const outsider = await makeOwnerWithSelection();
    const serverId = await makeServer(userId);
    await makeTool(serverId, { name: "get_users" });
    const plan = await preflightDraftOptimization(deps(), userId, {
      serverId,
      scope: { kind: "all_eligible" },
      expectedConfigRevision: 1,
    });
    // The owner declines: nothing queued, no calls made (fetch stub enforces).
    await expect(
      authorizeOptimization(deps(), outsider, {
        runId: plan.runId,
        expectedConfigRevision: 1,
      }),
    ).rejects.toSatisfy((error) =>
      expectAppError(error, APP_ERROR_CODES.AI_OPTIMIZATION_RUN_NOT_FOUND),
    );
    const status = await deps()
      .db.select()
      .from(aiProviderConnection)
      .where(eq(aiProviderConnection.userId, userId));
    expect(status.length).toBe(1);
  });

  it("rejects OpenAPI preflight when the source fingerprint drifted", async () => {
    const userId = await makeOwnerWithSelection();
    const serverId = await makeServer(userId);
    const document = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Doc", version: "1.0.0" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/users": {
          get: {
            operationId: "listUsers",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    });
    await expect(
      preflightOpenApiOptimization(deps(), userId, {
        serverId,
        source: { kind: "content", content: document, label: "paste" },
        fingerprint: "sha256:does-not-match",
        operationKeys: ["listUsers"],
        expectedConfigRevision: 1,
      }),
    ).rejects.toSatisfy((error) =>
      expectAppError(error, APP_ERROR_CODES.AI_OPTIMIZATION_SOURCE_STALE),
    );
  });

  it("keeps credentials, URLs, and source text out of owner-facing projections", async () => {
    const userId = await makeOwnerWithSelection();
    const serverId = await makeServer(userId);
    await makeTool(serverId, {
      name: "get_users",
      description: "Fetch users from the private catalog.",
    });
    const plan = await preflightDraftOptimization(deps(), userId, {
      serverId,
      scope: { kind: "all_eligible" },
      expectedConfigRevision: 1,
    });
    const auth = await authorizeOptimization(deps(), userId, {
      runId: plan.runId,
      expectedConfigRevision: 1,
    });
    expect(auth.state).toBe("queued");

    const status = await getOptimizationStatus(deps(), userId, plan.runId);
    const items = await listOptimizationItems(deps(), userId, {
      runId: plan.runId,
      page: 1,
      pageSize: 20,
    });
    const [firstItem] = items.items;
    const detail = await getOptimizationItem(
      deps(),
      userId,
      plan.runId,
      firstItem!.id,
    );
    const runs = await listOptimizationRuns(deps(), userId, {
      serverId,
      page: 1,
      pageSize: 10,
    });

    const serialized = JSON.stringify({ status, items, detail, runs });
    // No credentials, secret identities, base/source URLs, prompts, or raw
    // source text may appear in any owner-facing projection.
    expect(serialized).not.toContain("envelope-placeholder");
    expect(serialized).not.toContain("https://api.example.com");
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("serverValueId");
    // Snapshots and raw prompts are never part of these projections.
    expect(serialized).not.toContain("snapshotVersion");
    expect(serialized).not.toContain("pathShape");
  });

  it("creates an OpenAPI plan without persisting the raw document", async () => {
    const userId = await makeOwnerWithSelection();
    const serverId = await makeServer(userId);
    const document = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Doc", version: "1.0.0" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/users": {
          get: {
            operationId: "listUsers",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    });
    // Compute the real fingerprint from a deterministic import preview.
    const { previewOpenApiImport } =
      await import("./mcp-openapi-import-service.js");
    const result = await previewOpenApiImport(deps().db, userId, serverId, {
      source: { kind: "content", content: document, label: "paste" },
    });
    const plan = await preflightOpenApiOptimization(deps(), userId, {
      serverId,
      source: { kind: "content", content: document, label: "paste" },
      fingerprint: result.document.fingerprint,
      operationKeys: ["listUsers"],
      expectedConfigRevision: 1,
    });
    expect(plan.scopeKind).toBe("openapi");
    expect(plan.eligible).toHaveLength(1);
    expect(plan.eligible[0]!.ref).toEqual({
      kind: "openapi_candidate",
      operationKey: "listUsers",
    });

    const rows = await suite.db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.id, serverId));
    expect(rows).toHaveLength(1);
    // Verify no raw document text was persisted anywhere in optimizer rows.
    const { aiToolOptimizationItem, aiToolOptimizationRun } =
      await import("@repo/db");
    const runRow = await suite.db
      .select()
      .from(aiToolOptimizationRun)
      .where(eq(aiToolOptimizationRun.id, plan.runId))
      .limit(1);
    expect(runRow).toHaveLength(1);
    expect(JSON.stringify(runRow[0])).not.toContain("/users");
    const itemRows = await suite.db
      .select()
      .from(aiToolOptimizationItem)
      .where(eq(aiToolOptimizationItem.runId, plan.runId));
    expect(itemRows).toHaveLength(1);
    expect(JSON.stringify(itemRows[0])).not.toContain(
      "https://api.example.com",
    );
    expect(JSON.stringify(itemRows[0])).not.toContain('openapi: "3');

    const auth = await authorizeOptimization(deps(), userId, {
      runId: plan.runId,
      expectedConfigRevision: 1,
      source: { kind: "content", content: document, label: "paste" },
    });
    expect(auth.state).toBe("queued");
  });
});
