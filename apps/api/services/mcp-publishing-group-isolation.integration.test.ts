import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import {
  generateAuthId,
  mcpTool,
  mcpToolGroup,
  schema,
  user,
  type McpServer,
  type NewMcpTool,
} from "@repo/db";
import {
  parseOpenApiSourceProvenance,
  type McpOpenApiSourceProvenance,
} from "../lib/openapi-import-contracts.js";
import { loadExecutionSnapshot } from "./mcp-executor-service.js";
import {
  buildPublicationCandidate,
  loadDraftAggregate,
  previewPublish,
  publishServer,
  restoreRevisionToDraft,
  type PublishPreview,
  type PublishResult,
} from "./mcp-publishing-service.js";
import {
  assignToolsToGroup,
  createToolGroup,
  deleteToolGroup,
  renameToolGroup,
} from "./mcp-tool-group-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const CREDENTIAL_SECRET = "s".repeat(32);

function definitionFor(path: string, name: string): Record<string, unknown> {
  return {
    version: 1,
    pathSegments: [
      { id: `path_${name}`, value: { kind: "literal", value: path } },
    ],
    query: [],
    headers: [],
    body: { bodyType: "none" },
    agentInputs: [],
  };
}

const provenanceFixture: McpOpenApiSourceProvenance = {
  version: 1,
  batchId: "oai_isolation_batch",
  openApiVersion: "3.1",
  operationKey: "listContacts",
  documentFingerprint:
    "sha256:0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9",
  definitionHash:
    "sha256:f9e8d7c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a0",
  tags: ["Contacts", "Read"],
  sourceLabel: "https://docs.example.com/openapi.json",
};

type Db = Parameters<typeof previewPublish>[0];

type TxWrites = Array<{
  op: "insert" | "update" | "delete";
  table: unknown;
}>;

function trackedTx(tx: object, writes: TxWrites): object {
  return new Proxy(tx, {
    get(object, property, receiver) {
      if (
        property === "insert" ||
        property === "update" ||
        property === "delete"
      ) {
        const operation = Reflect.get(object, property, receiver) as (
          table: unknown,
        ) => unknown;
        return (table: unknown) => {
          writes.push({ op: property, table });
          return operation.call(object, table);
        };
      }
      return Reflect.get(object, property, receiver);
    },
  });
}

/** Records every insert/update/delete issued inside top-level transactions. */
function trackTransactionWrites(target: Db, writes: TxWrites): Db {
  return new Proxy(target, {
    get(object, property, receiver) {
      if (property === "transaction") {
        const transaction = Reflect.get(object, property, receiver) as (
          callback: (tx: object) => unknown,
          options?: unknown,
        ) => unknown;
        return (callback: (tx: object) => unknown, options?: unknown) =>
          transaction.call(
            object,
            (tx: object) => callback(trackedTx(tx, writes)),
            options,
          );
      }
      return Reflect.get(object, property, receiver);
    },
  });
}

describeIntegration("mcp publishing group and provenance isolation", () => {
  const userId = generateAuthId("user");
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let asDb: Db;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 6 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "Group Isolation Integration",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
    asDb = db as unknown as Db;
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  function serverIdFor(label: string): string {
    return `mcs_giso_${label}_${userId}`;
  }

  async function seedServer(serverId: string): Promise<void> {
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: `Isolation ${serverId}`,
      slug: serverId,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
  }

  async function insertTool(
    serverId: string,
    values: Partial<NewMcpTool> & { id: string },
  ) {
    await db.insert(schema.mcpTool).values({
      name: "list_contacts",
      title: "List contacts",
      description: "List contacts.",
      method: "GET",
      requestDefinition: definitionFor("/contacts", "contacts"),
      allowMutation: false,
      enabled: true,
      source: "manual",
      ...values,
      serverId,
    });
  }

  async function readServer(serverId: string): Promise<McpServer> {
    const [server] = await db
      .select()
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    if (!server) throw new Error(`server ${serverId} missing`);
    return server;
  }

  async function readRevisionRows(revisionId: string) {
    const [revision] = await db
      .select()
      .from(schema.mcpServerRevision)
      .where(eq(schema.mcpServerRevision.id, revisionId));
    const tools = await db
      .select()
      .from(schema.mcpServerRevisionTool)
      .where(eq(schema.mcpServerRevisionTool.revisionId, revisionId))
      .orderBy(asc(schema.mcpServerRevisionTool.toolOrder));
    return { revision, tools };
  }

  async function publishOnce(
    serverId: string,
    requestId: string,
  ): Promise<{ preview: PublishPreview; result: PublishResult }> {
    const preview = await previewPublish(asDb, userId, serverId);
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

  /** Runtime-visible tool projection; excludes the mutable draft rows. */
  async function snapshotToolList(serverId: string) {
    const snapshot = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    return {
      publishedRevisionId: snapshot?.publishedRevisionId ?? null,
      revisionNumber: snapshot?.revisionNumber ?? null,
      tools: (snapshot?.tools ?? []).map((entry) => ({
        id: entry.tool.id,
        name: entry.tool.name,
        title: entry.tool.title,
        description: entry.tool.description,
        method: entry.tool.method,
        enabled: entry.tool.enabled,
        allowMutation: entry.tool.allowMutation,
        contractFingerprint: entry.contractFingerprint,
        definitionHash: entry.plan?.definitionHash ?? null,
        groupId: entry.tool.groupId,
        sourceProvenance: entry.tool.sourceProvenance,
      })),
    };
  }

  it("keeps draft revision, preview identity, and the active pointer stable on a group-only change", async () => {
    const serverId = serverIdFor("assign");
    const toolId = `${serverId}_tool`;
    await seedServer(serverId);
    await insertTool(serverId, { id: toolId });
    const { result } = await publishOnce(serverId, `${serverId}_req_1`);
    const baseline = await previewPublish(asDb, userId, serverId);

    const serverBefore = await readServer(serverId);
    const revisionBefore = await readRevisionRows(result.revisionId);
    const snapshotBefore = await snapshotToolList(serverId);

    const created = await createToolGroup(asDb, userId, serverId, {
      expectedRevision: serverBefore.configRevision,
      name: "Customers",
    });
    expect(created.revision).toBe(serverBefore.configRevision + 1);
    expect(created.draftRevision).toBe(serverBefore.draftRevision);

    const assigned = await assignToolsToGroup(asDb, userId, serverId, {
      expectedRevision: created.revision,
      toolIds: [toolId],
      groupId: created.group.id,
    });
    expect(assigned.revision).toBe(created.revision + 1);
    expect(assigned.draftRevision).toBe(created.draftRevision);

    const serverAfter = await readServer(serverId);
    expect(serverAfter.configRevision).toBe(serverBefore.configRevision + 2);
    expect(serverAfter.draftRevision).toBe(serverBefore.draftRevision);
    expect(serverAfter.publishedRevisionId).toBe(result.revisionId);

    const after = await previewPublish(asDb, userId, serverId);
    expect(after.candidateFingerprint).toBe(baseline.candidateFingerprint);
    expect(after.contractFingerprint).toBe(baseline.contractFingerprint);
    expect(after.ready).toBe(baseline.ready);
    expect(after.dirty).toBe(false);
    expect(after.diff).toEqual(baseline.diff);
    expect(after.publishedRevisionId).toBe(result.revisionId);

    const revisionAfter = await readRevisionRows(result.revisionId);
    expect(revisionAfter).toEqual(revisionBefore);
    const revisionPayload = JSON.stringify(revisionAfter);
    expect(revisionPayload).not.toContain(created.group.id);
    expect(revisionPayload).not.toContain("Customers");

    // The assignment is real on the draft row, yet invisible to the candidate.
    const [toolRow] = await db
      .select({ groupId: mcpTool.groupId })
      .from(mcpTool)
      .where(eq(mcpTool.id, toolId));
    expect(toolRow?.groupId).toBe(created.group.id);

    const aggregate = await loadDraftAggregate(asDb, { userId, serverId });
    expect(aggregate.tools[0]?.groupId).toBe(created.group.id);
    const serialized = JSON.stringify(buildPublicationCandidate(aggregate));
    expect(serialized).not.toContain(created.group.id);
    expect(serialized).not.toContain("Customers");

    const snapshotAfter = await snapshotToolList(serverId);
    expect(snapshotAfter).toEqual(snapshotBefore);

    // Runtime discovery/execution exposes no group surface at all.
    const runtimeSnapshot = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    const runtimeTools = runtimeSnapshot?.tools ?? [];
    expect(runtimeTools.length).toBeGreaterThan(0);
    for (const entry of runtimeTools) {
      expect(entry.tool.groupId).toBeNull();
      expect(entry.tool.sourceProvenance).toBeNull();
    }
    expect(JSON.stringify(runtimeTools)).not.toContain(created.group.id);
    expect(JSON.stringify(runtimeTools)).not.toContain("Customers");
  });

  it("produces a byte-identical preview across create, rename, assign, and delete", async () => {
    const serverId = serverIdFor("lifecycle");
    const toolId = `${serverId}_tool`;
    await seedServer(serverId);
    await insertTool(serverId, { id: toolId });
    await publishOnce(serverId, `${serverId}_req_1`);

    const baseline = await previewPublish(asDb, userId, serverId);
    const serializedBaseline = JSON.stringify(baseline);
    const serverBefore = await readServer(serverId);

    const created = await createToolGroup(asDb, userId, serverId, {
      expectedRevision: serverBefore.configRevision,
      name: "Group A",
    });
    const renamed = await renameToolGroup(asDb, userId, serverId, {
      expectedRevision: created.revision,
      groupId: created.group.id,
      name: "Group B",
    });
    const assigned = await assignToolsToGroup(asDb, userId, serverId, {
      expectedRevision: renamed.revision,
      toolIds: [toolId],
      groupId: created.group.id,
    });
    expect(JSON.stringify(await previewPublish(asDb, userId, serverId))).toBe(
      serializedBaseline,
    );

    const deleted = await deleteToolGroup(asDb, userId, serverId, {
      expectedRevision: assigned.revision,
      groupId: created.group.id,
    });
    expect(deleted.ungroupedToolCount).toBe(1);
    expect(JSON.stringify(await previewPublish(asDb, userId, serverId))).toBe(
      serializedBaseline,
    );

    const serverAfter = await readServer(serverId);
    expect(serverAfter.configRevision).toBe(serverBefore.configRevision + 4);
    expect(serverAfter.draftRevision).toBe(serverBefore.draftRevision);
    expect(serverAfter.publishedRevisionId).toBe(baseline.publishedRevisionId);
  });

  it("snapshots provenance without affecting fingerprints or the execution snapshot", async () => {
    const serverId = serverIdFor("provenance");
    const toolId = `${serverId}_tool`;
    await seedServer(serverId);
    await insertTool(serverId, {
      id: toolId,
      source: "openapi",
      sourceProvenance: provenanceFixture,
    });
    const { result } = await publishOnce(serverId, `${serverId}_req_1`);
    const publishedBaseline = await previewPublish(asDb, userId, serverId);

    const { tools: revisionTools } = await readRevisionRows(result.revisionId);
    const stored = revisionTools.find((tool) => tool.sourceToolId === toolId);
    expect(stored?.sourceProvenance).toEqual(provenanceFixture);
    expect(parseOpenApiSourceProvenance(stored?.sourceProvenance)).toEqual(
      provenanceFixture,
    );

    const aggregate = await loadDraftAggregate(asDb, { userId, serverId });
    const serialized = JSON.stringify(buildPublicationCandidate(aggregate));
    expect(serialized).not.toContain(provenanceFixture.batchId);
    expect(serialized).not.toContain(provenanceFixture.sourceLabel);
    expect(serialized).not.toContain(provenanceFixture.documentFingerprint);

    const snapshotBefore = await snapshotToolList(serverId);

    // The same tool without provenance must produce the same candidate.
    await db
      .update(mcpTool)
      .set({ sourceProvenance: null })
      .where(eq(mcpTool.id, toolId));
    const withoutProvenance = await previewPublish(asDb, userId, serverId);
    expect(withoutProvenance.candidateFingerprint).toBe(
      publishedBaseline.candidateFingerprint,
    );
    expect(withoutProvenance.contractFingerprint).toBe(
      publishedBaseline.contractFingerprint,
    );
    expect(withoutProvenance.diff).toEqual(publishedBaseline.diff);
    expect(withoutProvenance.dirty).toBe(false);

    // An identical candidate cannot be published again: publication is a no-op.
    await expect(
      publishServer(asDb, {
        userId,
        serverId,
        expectedDraftRevision: withoutProvenance.draftRevision,
        expectedPublishedRevisionId: withoutProvenance.publishedRevisionId,
        publishRequestId: `${serverId}_req_noop`,
        candidateFingerprint: withoutProvenance.candidateFingerprint,
        acknowledgedWarningCodes: withoutProvenance.warningCodes,
        actorSource: "studio",
        note: null,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_PUBLISH_NO_CHANGES,
    });

    expect(await snapshotToolList(serverId)).toEqual(snapshotBefore);
  });

  it("preserves current grouping on restore and never writes group rows", async () => {
    const serverId = serverIdFor("restore");
    const toolAId = `${serverId}_tool_a`;
    const toolBId = `${serverId}_tool_b`;
    await seedServer(serverId);
    await insertTool(serverId, { id: toolAId, name: "list_a" });
    await insertTool(serverId, {
      id: toolBId,
      name: "list_b",
      requestDefinition: definitionFor("/companies", "companies"),
    });
    const { result } = await publishOnce(serverId, `${serverId}_req_1`);

    // Only the revision still knows about tool B.
    await db.delete(mcpTool).where(eq(mcpTool.id, toolBId));

    const beforeGrouping = await readServer(serverId);
    const created = await createToolGroup(asDb, userId, serverId, {
      expectedRevision: beforeGrouping.configRevision,
      name: "Keep",
    });
    const assigned = await assignToolsToGroup(asDb, userId, serverId, {
      expectedRevision: created.revision,
      toolIds: [toolAId],
      groupId: created.group.id,
    });

    const groupsBefore = await db
      .select()
      .from(mcpToolGroup)
      .where(eq(mcpToolGroup.serverId, serverId))
      .orderBy(asc(mcpToolGroup.id));
    const serverBeforeRestore = await readServer(serverId);
    expect(serverBeforeRestore.configRevision).toBe(assigned.revision);

    const writes: TxWrites = [];
    const trackedDb = trackTransactionWrites(asDb, writes);
    const restored = await restoreRevisionToDraft(trackedDb, {
      userId,
      serverId,
      revisionId: result.revisionId,
      expectedRevision: serverBeforeRestore.configRevision,
      expectedDraftRevision: serverBeforeRestore.draftRevision,
    });
    expect(restored.toolCount).toBe(2);

    const rows = await db
      .select({ id: mcpTool.id, groupId: mcpTool.groupId })
      .from(mcpTool)
      .where(eq(mcpTool.serverId, serverId));
    expect(rows.find((row) => row.id === toolAId)?.groupId).toBe(
      created.group.id,
    );
    expect(rows.find((row) => row.id === toolBId)?.groupId).toBeNull();

    const groupsAfter = await db
      .select()
      .from(mcpToolGroup)
      .where(eq(mcpToolGroup.serverId, serverId))
      .orderBy(asc(mcpToolGroup.id));
    expect(groupsAfter).toEqual(groupsBefore);
    expect(writes.some((write) => write.table === mcpToolGroup)).toBe(false);
    expect(writes.some((write) => write.table === mcpTool)).toBe(true);

    const serverAfterRestore = await readServer(serverId);
    expect(serverAfterRestore.draftRevision).toBe(
      serverBeforeRestore.draftRevision + 1,
    );
    expect(serverAfterRestore.configRevision).toBe(
      serverBeforeRestore.configRevision + 1,
    );
    expect(serverAfterRestore.publishedRevisionId).toBe(result.revisionId);
  });

  it("round-trips provenance through publish and restore", async () => {
    const serverId = serverIdFor("roundtrip");
    const toolId = `${serverId}_tool`;
    await seedServer(serverId);
    await insertTool(serverId, {
      id: toolId,
      source: "openapi",
      sourceProvenance: provenanceFixture,
    });
    const { result } = await publishOnce(serverId, `${serverId}_req_1`);

    await db
      .update(mcpTool)
      .set({
        description: "Changed after publication.",
        sourceProvenance: null,
      })
      .where(eq(mcpTool.id, toolId));

    const beforeRestore = await readServer(serverId);
    await restoreRevisionToDraft(asDb, {
      userId,
      serverId,
      revisionId: result.revisionId,
      expectedRevision: beforeRestore.configRevision,
      expectedDraftRevision: beforeRestore.draftRevision,
    });

    const [restoredTool] = await db
      .select()
      .from(mcpTool)
      .where(eq(mcpTool.id, toolId));
    expect(restoredTool?.description).toBe("List contacts.");
    expect(restoredTool?.sourceProvenance).toEqual(provenanceFixture);
    expect(
      parseOpenApiSourceProvenance(restoredTool?.sourceProvenance),
    ).toEqual(provenanceFixture);
  });

  it("persists null for a malformed stored provenance instead of failing publication", async () => {
    const serverId = serverIdFor("malformed");
    const toolId = `${serverId}_tool`;
    await seedServer(serverId);
    await insertTool(serverId, {
      id: toolId,
      source: "openapi",
      sourceProvenance: {
        ...provenanceFixture,
        version: 2,
      },
    });

    const { result } = await publishOnce(serverId, `${serverId}_req_1`);
    const { tools: revisionTools } = await readRevisionRows(result.revisionId);
    const stored = revisionTools.find((tool) => tool.sourceToolId === toolId);
    expect(stored?.sourceProvenance).toBeNull();

    // Simulate a corrupted immutable ledger entry: an invalid payload must not
    // be resurrected into the draft on restore.
    await db.execute(sql`
      update mcp_server_revision_tool
      set source_provenance = ${JSON.stringify({ version: 1, batchId: "broken" })}::jsonb
      where revision_id = ${result.revisionId} and source_tool_id = ${toolId}
    `);
    const beforeRestore = await readServer(serverId);
    await restoreRevisionToDraft(asDb, {
      userId,
      serverId,
      revisionId: result.revisionId,
      expectedRevision: beforeRestore.configRevision,
      expectedDraftRevision: beforeRestore.draftRevision,
    });

    const [restoredTool] = await db
      .select()
      .from(mcpTool)
      .where(eq(mcpTool.id, toolId));
    expect(restoredTool?.sourceProvenance).toBeNull();
    expect(
      parseOpenApiSourceProvenance(restoredTool?.sourceProvenance),
    ).toBeNull();
  });
});
