import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import { generateAuthId, schema, user } from "@repo/db";
import {
  resetAuditQueueState,
  drainAuditQueue,
} from "../lib/mcp-audit-queue.js";
import { encryptCredential } from "../lib/mcp-crypto.js";
import { authenticateServerToken } from "./mcp-agent-auth-service.js";
import {
  executeMappedTool,
  loadDraftExecutionSnapshot,
  loadExecutionSnapshot,
} from "./mcp-executor-service.js";
import { previewPublish, publishServer } from "./mcp-publishing-service.js";
import {
  attachTrafficLight,
  createServerToken,
  revokeServerToken,
  updateServer,
} from "./mcp-studio-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

const CREDENTIAL_SECRET = "s".repeat(32);
const SECRET_VALUE = "sup3r-secret-token";
const SENSITIVE_INPUT = "sensitive-query-value";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const readDefinition = {
  version: 1 as const,
  pathSegments: [
    { id: "path_1", value: { kind: "literal" as const, value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" as const },
  agentInputs: [],
};

function secureDefinition(secretId: string) {
  return {
    version: 1 as const,
    pathSegments: [
      { id: "path_1", value: { kind: "literal" as const, value: "/contacts" } },
    ],
    query: [
      {
        id: "query_q",
        name: "q",
        value: { kind: "agentInput" as const, agentInputId: "input_q" },
        omitWhenAbsent: true,
      },
    ],
    headers: [
      {
        id: "hdr_auth",
        name: "Authorization",
        value: {
          kind: "serverValue" as const,
          serverValueId: secretId,
          prefix: "Bearer ",
        },
      },
    ],
    body: { bodyType: "none" as const },
    agentInputs: [
      {
        id: "input_q",
        name: "q",
        description: "Sensitive query value.",
        required: false,
        sensitive: true,
        type: "string" as const,
      },
    ],
  };
}

describeIntegration("published boundary end to end", () => {
  const userId = generateAuthId("user");
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let asDb: Parameters<typeof previewPublish>[0];

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 6 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "Boundary Integration",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
    asDb = db as unknown as Parameters<typeof previewPublish>[0];
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetAuditQueueState();
  });

  async function seedServer(serverId: string, secretId: string) {
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: "Boundary",
      slug: serverId,
      description: "v1",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
    await db.insert(schema.mcpServerVariable).values({
      id: secretId,
      serverId,
      name: "api_token",
      kind: "secret",
      owner: "manual",
      ciphertext: encryptCredential(SECRET_VALUE, CREDENTIAL_SECRET),
    });
    await db.insert(schema.mcpTool).values({
      id: `${serverId}_tool`,
      serverId,
      name: "get_contact",
      title: "Get contact",
      description: "Fetch one contact.",
      method: "GET",
      requestDefinition: secureDefinition(secretId),
      allowMutation: false,
      enabled: true,
      source: "manual",
    });
  }

  async function publishOnce(serverId: string, requestId: string) {
    const preview = await previewPublish(asDb, userId, serverId);
    expect(preview.ready).toBe(true);
    const result = await publishServer(asDb, {
      userId,
      serverId,
      expectedDraftRevision: preview.draftRevision,
      expectedPublishedRevisionId: preview.publishedRevisionId,
      publishRequestId: requestId,
      candidateFingerprint: preview.candidateFingerprint,
      acknowledgedWarningCodes: preview.warningCodes,
      actorSource: "studio",
      note: null,
    });
    return { preview, result };
  }

  async function readServer(serverId: string) {
    const [server] = await db
      .select()
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    if (!server) throw new Error("server missing");
    return server;
  }

  it("isolates unpublished edits from discovery and execution until a full aggregate publish", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34" }]);
    const serverId = "mcs_boundary_atomic";
    const secretId = `${serverId}_secret`;
    await seedServer(serverId, secretId);

    // No active revision: discovery advertises nothing and execution is refused.
    const beforePublish = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(beforePublish?.publishedRevisionId).toBeNull();
    expect(beforePublish?.tools).toHaveLength(0);

    await expect(
      executeMappedTool(asDb, {
        serverId,
        toolId: `${serverId}_tool`,
        source: "agent",
        credentialSecret: CREDENTIAL_SECRET,
      }),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND });

    await publishOnce(serverId, "req_boundary_atomic_1");

    const published = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(published?.revisionNumber).toBe(1);
    expect(published?.tools.map((entry) => entry.tool.name)).toEqual([
      "get_contact",
    ]);
    expect(published?.tools[0]?.tool.description).toBe("Fetch one contact.");

    // Unpublished edit: change the tool and add a new enabled tool in the draft.
    await db
      .update(schema.mcpTool)
      .set({ description: "Fetch one contact (v2 draft)." })
      .where(eq(schema.mcpTool.id, `${serverId}_tool`));
    await db.insert(schema.mcpTool).values({
      id: `${serverId}_tool_added`,
      serverId,
      name: "list_contacts",
      title: "List contacts",
      description: "List contacts (draft).",
      method: "GET",
      requestDefinition: {
        ...readDefinition,
        pathSegments: [
          {
            id: "path_1",
            value: { kind: "literal", value: "/contacts/list" },
          },
        ],
      },
      allowMutation: false,
      enabled: true,
      source: "manual",
    });

    const stillPublished = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(stillPublished?.revisionNumber).toBe(1);
    expect(stillPublished?.tools.map((entry) => entry.tool.name)).toEqual([
      "get_contact",
    ]);
    expect(stillPublished?.tools[0]?.tool.description).toBe(
      "Fetch one contact.",
    );

    await expect(
      executeMappedTool(asDb, {
        serverId,
        toolId: `${serverId}_tool_added`,
        source: "agent",
        credentialSecret: CREDENTIAL_SECRET,
      }),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND });

    // Publication switches the whole aggregate in one revision.
    await publishOnce(serverId, "req_boundary_atomic_2");
    const afterSecond = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(afterSecond?.revisionNumber).toBe(2);
    expect(afterSecond?.tools.map((entry) => entry.tool.name).sort()).toEqual([
      "get_contact",
      "list_contacts",
    ]);
    expect(
      afterSecond?.tools.find((entry) => entry.tool.id === `${serverId}_tool`)
        ?.tool.description,
    ).toBe("Fetch one contact (v2 draft).");
  });

  it("keeps pause, resume, token revocation, and secret rotation immediate and draft-clean", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34" }]);
    const serverId = "mcs_boundary_operational";
    const secretId = `${serverId}_secret`;
    await seedServer(serverId, secretId);
    const { result } = await publishOnce(
      serverId,
      "req_boundary_operational_1",
    );

    const initial = await readServer(serverId);
    const activeRevisionId = result.revisionId;

    // Pause is operational: pointer and draft counters are unchanged.
    await updateServer(asDb, userId, serverId, {
      expectedRevision: initial.configRevision,
      status: "paused",
    });
    const paused = await readServer(serverId);
    expect(paused.status).toBe("paused");
    expect(paused.publishedRevisionId).toBe(activeRevisionId);
    expect(paused.draftRevision).toBe(initial.draftRevision);
    const pausedPreview = await previewPublish(asDb, userId, serverId);
    expect(pausedPreview.dirty).toBe(false);
    const pausedLight = await attachTrafficLight(asDb, [paused]);
    expect(pausedLight[0]?.trafficLight).toBe("paused");

    // Resume is operational too.
    await updateServer(asDb, userId, serverId, {
      expectedRevision: paused.configRevision,
      status: "live",
    });
    const resumed = await readServer(serverId);
    expect(resumed.status).toBe("live");
    expect(resumed.publishedRevisionId).toBe(activeRevisionId);
    expect(resumed.draftRevision).toBe(initial.draftRevision);
    expect((await previewPublish(asDb, userId, serverId)).dirty).toBe(false);

    // Token revocation is immediate and does not dirty the draft.
    const created = await createServerToken(
      asDb,
      userId,
      serverId,
      resumed.configRevision,
      "Boundary token",
    );
    await expect(
      authenticateServerToken(asDb, created.token, serverId),
    ).resolves.toMatchObject({ id: created.id });
    await revokeServerToken(
      asDb,
      userId,
      serverId,
      created.id,
      created.revision,
    );
    await expect(
      authenticateServerToken(asDb, created.token, serverId),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
    const afterRevoke = await readServer(serverId);
    expect(afterRevoke.draftRevision).toBe(initial.draftRevision);
    expect(afterRevoke.publishedRevisionId).toBe(activeRevisionId);

    // Secret rotation is immediate and preserves revision identity.
    await db
      .update(schema.mcpServerVariable)
      .set({
        ciphertext: encryptCredential("rotated-token", CREDENTIAL_SECRET),
      })
      .where(eq(schema.mcpServerVariable.id, secretId));
    const rotated = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(rotated?.publishedRevisionId).toBe(activeRevisionId);
    expect(rotated?.revisionNumber).toBe(1);
    expect(rotated?.serverValues.get(secretId)?.value).toBe("rotated-token");
    const rotatedPreview = await previewPublish(asDb, userId, serverId);
    expect(rotatedPreview.dirty).toBe(false);
  });

  it("attributes call logs to the pinned revision, isolates draft logs, and redacts secrets", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34" }]);
    const serverId = "mcs_boundary_calllog";
    const secretId = `${serverId}_secret`;
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: "Call log",
      slug: serverId,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
    await db.insert(schema.mcpServerVariable).values({
      id: secretId,
      serverId,
      name: "api_token",
      kind: "secret",
      owner: "manual",
      ciphertext: encryptCredential(SECRET_VALUE, CREDENTIAL_SECRET),
    });
    await db.insert(schema.mcpTool).values({
      id: `${serverId}_tool`,
      serverId,
      name: "get_contact",
      title: "Get contact",
      description: "Fetch one contact.",
      method: "GET",
      requestDefinition: secureDefinition(secretId),
      allowMutation: false,
      enabled: true,
      source: "manual",
    });
    const { result } = await publishOnce(serverId, "req_boundary_calllog_1");

    const publishedSnapshot = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    if (!publishedSnapshot) throw new Error("published snapshot missing");

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ echo: SECRET_VALUE, q: SENSITIVE_INPUT }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const publishedCall = await executeMappedTool(asDb, {
      serverId,
      toolId: `${serverId}_tool`,
      args: { q: SENSITIVE_INPUT },
      source: "agent",
      credentialSecret: CREDENTIAL_SECRET,
      snapshot: publishedSnapshot,
    });
    expect(publishedCall.ok).toBe(true);

    // Draft-preview call: execute the observed draft from the owner playground.
    const draftSnapshot = await loadDraftExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
      expectedDraftRevision: (await readServer(serverId)).draftRevision,
    });
    if (!draftSnapshot) throw new Error("draft snapshot missing");
    const draftFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "draft failure" }, 500));
    vi.stubGlobal("fetch", draftFetch);
    await executeMappedTool(asDb, {
      serverId,
      ownerUserId: userId,
      toolId: `${serverId}_tool`,
      args: { q: "draft-input" },
      source: "playground",
      credentialSecret: CREDENTIAL_SECRET,
      snapshot: draftSnapshot,
    });

    await drainAuditQueue(asDb);

    const [publishedLog] = await db
      .select()
      .from(schema.mcpCallLog)
      .where(
        and(
          eq(schema.mcpCallLog.serverId, serverId),
          eq(schema.mcpCallLog.source, "agent"),
        ),
      )
      .orderBy(desc(schema.mcpCallLog.createdAt))
      .limit(1);
    expect(publishedLog?.publishedRevisionId).toBe(result.revisionId);
    expect(publishedLog?.revisionNumber).toBe(1);
    expect(publishedLog?.aggregateFingerprint).toBeTruthy();
    expect(publishedLog?.toolFingerprint).toBeTruthy();
    expect(publishedLog?.revisionMode).toBe("published");
    expect(publishedLog?.draftRevision).toBeNull();

    const [draftLog] = await db
      .select()
      .from(schema.mcpCallLog)
      .where(
        and(
          eq(schema.mcpCallLog.serverId, serverId),
          eq(schema.mcpCallLog.source, "playground"),
        ),
      )
      .orderBy(desc(schema.mcpCallLog.createdAt))
      .limit(1);
    expect(draftLog?.revisionMode).toBe("draft");
    expect(draftLog?.publishedRevisionId).toBeNull();
    expect(draftLog?.revisionNumber).toBeNull();
    expect(draftLog?.draftRevision).toBe(1);

    // Secrets and sensitive inputs never reach the stored summaries.
    for (const summary of [
      publishedLog?.requestSummary,
      publishedLog?.responseSummary,
      ...(draftLog ? [draftLog.requestSummary, draftLog.responseSummary] : []),
    ]) {
      expect(summary ?? "").not.toContain(SECRET_VALUE);
      expect(summary ?? "").not.toContain(SENSITIVE_INPUT);
    }
    expect(publishedLog?.responseSummary).toContain("[REDACTED]");

    // Draft failures do not affect active-revision health.
    const [serverRow] = await db
      .select()
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    if (!serverRow) throw new Error("server missing");
    const [withHealth] = await attachTrafficLight(asDb, [serverRow]);
    expect(withHealth?.trafficLight).toBe("green");
  });
});
