/**
 * OpenAPI confirmation integration tests with optimization: selectable-only
 * optimization, raw-source non-persistence, owner name precedence, document
 * drift rejection, immutable identity fields, and draft-only import.
 */
import {
  aiModelSelection,
  aiProviderConnection,
  aiToolOptimizationItem,
  aiToolOptimizationRun,
  mcpServer,
  mcpTool,
  schema,
  user,
} from "@repo/db";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  previewOpenApiImport,
  confirmOpenApiImport,
} from "./mcp-openapi-import-service.js";
import {
  preflightOpenApiOptimization,
  type AiOptimizerDeps,
} from "./ai-optimizer-service.js";
import { buildReviewForItem } from "./ai-optimizer-workflow.js";
import {
  buildCapabilitySnapshot,
  computeVerificationFingerprint,
} from "../lib/ai/verification.js";
import type { OptimizerToolSnapshotV1 } from "../lib/mcp-optimizer-contracts.js";
import { optimizerToolSnapshotSchema } from "../lib/mcp-optimizer-contracts.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const suite = {
  client: undefined as unknown as ReturnType<typeof postgres>,
  db: undefined as unknown as PostgresJsDatabase<Record<string, unknown>>,
};
const cleanup: string[] = [];
let seq = 0;

function deps(): AiOptimizerDeps {
  return {
    db: suite.db,
    // Readiness resolution only reads adapterVersion; nothing constructs a
    // model or reaches the network during preflight or confirmation.
    getAdapter: () =>
      ({
        kind: "openai",
        providerClass: "direct",
        adapterVersion: 1,
      }) as never,
  };
}

const DOCUMENT = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Users API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        summary: "List users",
        description: "Fetch all users.",
        responses: { "200": { description: "ok" } },
      },
    },
  },
});

async function makeScenario() {
  seq += 1;
  const userId = `usr_oapi_${seq}_${Date.now().toString(36)}`;
  await suite.db.insert(user).values({
    id: userId,
    name: "OpenAPI Opt Owner",
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  cleanup.push(userId);
  const serverId = `mcs_oapi_${seq}_${Date.now().toString(36)}`;
  await suite.db.insert(mcpServer).values({
    id: serverId,
    userId,
    name: "OpenAPI Opt Server",
    slug: `oapi-${seq}-${Date.now().toString(36)}`,
    baseUrl: "https://api.example.com",
    allowedHosts: ["api.example.com"],
  });
  const connectionId = `aic_oapi_${seq}`;
  await suite.db.insert(aiProviderConnection).values({
    id: connectionId,
    userId,
    providerKind: "openai",
    ciphertext: "envelope-placeholder",
    verifiedAt: new Date(),
  });
  const fingerprintInput = {
    providerKind: "openai" as const,
    credentialRevision: 1,
    adapterVersion: 1,
    modelId: "mock-language-1",
    protocol: "openai-chat-completions" as const,
    routeOrigin: "https://mock.test",
    profileId: "structured-text-v1",
    profileVersion: 1,
  };
  await suite.db.insert(aiModelSelection).values({
    userId,
    connectionId,
    capabilityProfile: "structured-text-v1",
    modelId: "mock-language-1",
    protocol: "openai-chat-completions",
    routeOrigin: "https://mock.test",
    capabilitySnapshot: buildCapabilitySnapshot({
      contextWindowTokens: 128_000,
      fingerprintInput,
    }),
    verificationFingerprint: computeVerificationFingerprint(fingerprintInput),
    verifiedAt: new Date(),
  });
  return { userId, serverId };
}

const COMPILE = {
  common: { headers: [], query: [] },
  auth: null,
  serverValues: [],
  basePath: "/",
  allowMutation: false,
};

async function createOptimizedRun(input: { userId: string; serverId: string }) {
  const source = {
    kind: "content" as const,
    content: DOCUMENT,
    label: "paste" as const,
  };
  const preview = await previewOpenApiImport(
    suite.db,
    input.userId,
    input.serverId,
    { source },
  );
  const plan = await preflightOpenApiOptimization(deps(), input.userId, {
    serverId: input.serverId,
    source,
    fingerprint: preview.document.fingerprint,
    operationKeys: ["listUsers"],
    expectedConfigRevision: 1,
  });
  const [item] = await suite.db
    .select()
    .from(aiToolOptimizationItem)
    .where(eq(aiToolOptimizationItem.runId, plan.runId))
    .limit(1);
  const snapshot = optimizerToolSnapshotSchema.parse(item!.snapshot);
  const review = buildReviewForItem({
    snapshot,
    definition: null,
    operations: [
      {
        kind: "set_tool_title",
        operationId: "op_title",
        value: "List user records",
        rationale: "Clearer title.",
      },
      {
        kind: "set_tool_name",
        operationId: "op_name",
        value: "fetch_users",
        rationale: "More specific.",
      },
    ],
    preRejected: [],
    advisories: [],
    compile: COMPILE,
    existingToolNames: [],
  });
  await suite.db
    .update(aiToolOptimizationItem)
    .set({
      state: "recommended",
      review: review as unknown as Record<string, unknown>,
    })
    .where(eq(aiToolOptimizationItem.id, item!.id));
  await suite.db
    .update(aiToolOptimizationRun)
    .set({
      state: "completed",
      completedAt: new Date(),
      retentionExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    })
    .where(eq(aiToolOptimizationRun.id, plan.runId));
  return { runId: plan.runId, snapshot: snapshot as OptimizerToolSnapshotV1 };
}

describeIntegration("OpenAPI confirmation with optimization", () => {
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

  it("applies accepted operations inside the atomic import and stays draft-only", async () => {
    const { userId, serverId } = await makeScenario();
    const { runId } = await createOptimizedRun({ userId, serverId });

    const result = await confirmOpenApiImport(suite.db, userId, serverId, {
      expectedRevision: 1,
      source: { kind: "content", content: DOCUMENT, label: "paste" },
      fingerprint: (
        await previewOpenApiImport(suite.db, userId, serverId, {
          source: { kind: "content", content: DOCUMENT, label: "paste" },
        })
      ).document.fingerprint,
      selection: [{ operationKey: "listUsers" }],
      groupStrategy: { kind: "ungrouped" },
      optimization: {
        runId,
        operations: [
          { operationKey: "listUsers", operationIds: ["op_title", "op_name"] },
        ],
      },
    });

    expect(result.tools).toHaveLength(1);
    // The AI name operation applied: no owner override was supplied.
    expect(result.tools[0]!.name).toBe("fetch_users");
    const [tool] = await suite.db
      .select()
      .from(mcpTool)
      .where(eq(mcpTool.id, result.tools[0]!.id))
      .limit(1);
    expect(tool!.title).toBe("List user records");
    expect(tool!.source).toBe("openapi");
    expect(tool!.compileStatus).toBe("valid");

    const [server] = await suite.db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.id, serverId))
      .limit(1);
    expect(server!.configRevision).toBe(2);
    expect(server!.draftRevision).toBe(2);
    // Draft-only: nothing was published.
    expect(server!.publishedRevisionId).toBeNull();

    const [run] = await suite.db
      .select()
      .from(aiToolOptimizationRun)
      .where(eq(aiToolOptimizationRun.id, runId))
      .limit(1);
    expect(run!.applyKey).toBe(`oib:${result.batchId}`);
    const [item] = await suite.db
      .select()
      .from(aiToolOptimizationItem)
      .where(eq(aiToolOptimizationItem.runId, runId))
      .limit(1);
    expect(item!.state).toBe("applied");
    expect(item!.appliedToolId).toBe(result.tools[0]!.id);
  });

  it("lets the explicit owner final name win over an AI name operation", async () => {
    const { userId, serverId } = await makeScenario();
    const { runId } = await createOptimizedRun({ userId, serverId });
    const fingerprint = (
      await previewOpenApiImport(suite.db, userId, serverId, {
        source: { kind: "content", content: DOCUMENT, label: "paste" },
      })
    ).document.fingerprint;

    const result = await confirmOpenApiImport(suite.db, userId, serverId, {
      expectedRevision: 1,
      source: { kind: "content", content: DOCUMENT, label: "paste" },
      fingerprint,
      selection: [{ operationKey: "listUsers", name: "list_all_users" }],
      groupStrategy: { kind: "ungrouped" },
      optimization: {
        runId,
        operations: [
          { operationKey: "listUsers", operationIds: ["op_title", "op_name"] },
        ],
      },
    });
    expect(result.tools[0]!.name).toBe("list_all_users");
  });

  it("rejects the import when the document drifted after optimization", async () => {
    const { userId, serverId } = await makeScenario();
    const { runId } = await createOptimizedRun({ userId, serverId });
    const drifted = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Users API", version: "1.0.1" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/users": {
          get: {
            operationId: "listUsers",
            summary: "List users",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    });
    await expect(
      confirmOpenApiImport(suite.db, userId, serverId, {
        expectedRevision: 1,
        source: { kind: "content", content: drifted, label: "paste" },
        fingerprint: (
          await previewOpenApiImport(suite.db, userId, serverId, {
            source: { kind: "content", content: drifted, label: "paste" },
          })
        ).document.fingerprint,
        selection: [{ operationKey: "listUsers" }],
        groupStrategy: { kind: "ungrouped" },
        optimization: {
          runId,
          operations: [
            { operationKey: "listUsers", operationIds: ["op_title"] },
          ],
        },
      }),
    ).rejects.toSatisfy(
      (error: { appCode?: string }) =>
        error.appCode === "AI_OPTIMIZATION_SOURCE_STALE",
    );
    const tools = await suite.db
      .select()
      .from(mcpTool)
      .where(eq(mcpTool.serverId, serverId));
    expect(tools).toHaveLength(0);
  });

  it("keeps raw source text out of optimizer rows", async () => {
    const { userId, serverId } = await makeScenario();
    const { runId } = await createOptimizedRun({ userId, serverId });
    const [run] = await suite.db
      .select()
      .from(aiToolOptimizationRun)
      .where(eq(aiToolOptimizationRun.id, runId))
      .limit(1);
    expect(JSON.stringify(run)).not.toContain("3.0.0");
    expect(JSON.stringify(run)).not.toContain("api.example.com");
    const [item] = await suite.db
      .select()
      .from(aiToolOptimizationItem)
      .where(eq(aiToolOptimizationItem.runId, runId))
      .limit(1);
    expect(JSON.stringify(item)).not.toContain("3.0.0");
  });

  it("rejects an already-applied optimization run", async () => {
    const { userId, serverId } = await makeScenario();
    const { runId } = await createOptimizedRun({ userId, serverId });
    await suite.db
      .update(aiToolOptimizationRun)
      .set({ applyKey: "oib:already" })
      .where(eq(aiToolOptimizationRun.id, runId));
    const fingerprint = (
      await previewOpenApiImport(suite.db, userId, serverId, {
        source: { kind: "content", content: DOCUMENT, label: "paste" },
      })
    ).document.fingerprint;
    await expect(
      confirmOpenApiImport(suite.db, userId, serverId, {
        expectedRevision: 1,
        source: { kind: "content", content: DOCUMENT, label: "paste" },
        fingerprint,
        selection: [{ operationKey: "listUsers" }],
        groupStrategy: { kind: "ungrouped" },
        optimization: {
          runId,
          operations: [
            { operationKey: "listUsers", operationIds: ["op_title"] },
          ],
        },
      }),
    ).rejects.toSatisfy(
      (error: { appCode?: string }) =>
        error.appCode === "AI_OPTIMIZATION_STATE_INVALID",
    );
  });
});
