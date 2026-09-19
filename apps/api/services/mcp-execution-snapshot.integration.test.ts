import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { generateAuthId, schema, user } from "@repo/db";
import { encryptCredential } from "../lib/mcp-crypto.js";
import { loadExecutionSnapshot } from "./mcp-executor-service.js";
import { previewPublish, publishServer } from "./mcp-publishing-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const CREDENTIAL_SECRET = "s".repeat(32);
const SECRET_VALUE_ID = "msv_snapshot_integration_secret";
const TOOL_ID = "mct_snapshot_integration";
const REVISION_2_ID = "msr_snapshot_integration_2";

const getContactDefinition = {
  version: 1 as const,
  pathSegments: [
    {
      id: "path_base",
      value: { kind: "literal" as const, value: "/contacts/" },
    },
    {
      id: "path_id",
      value: { kind: "agentInput" as const, agentInputId: "ain_id" },
    },
  ],
  query: [],
  headers: [
    {
      id: "hdr_auth",
      name: "Authorization",
      value: {
        kind: "serverValue" as const,
        serverValueId: SECRET_VALUE_ID,
        prefix: "Bearer ",
      },
    },
  ],
  body: { bodyType: "none" as const },
  agentInputs: [
    {
      id: "ain_id",
      name: "id",
      description: "Contact id.",
      required: true,
      sensitive: false,
      type: "string" as const,
    },
  ],
};

describeIntegration("execution snapshot isolation", () => {
  const userId = generateAuthId("user");
  const serverId = "mcs_snapshot_integration";
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 4 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "Snapshot Integration",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: "Snapshot Integration",
      slug: serverId,
      description: "v1",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
    await db.insert(schema.mcpServerVariable).values({
      id: SECRET_VALUE_ID,
      serverId,
      name: "api_token",
      kind: "secret",
      owner: "manual",
      ciphertext: encryptCredential("secret-v1", CREDENTIAL_SECRET),
    });
    await db.insert(schema.mcpTool).values({
      id: TOOL_ID,
      serverId,
      name: "get_contact",
      title: "Get contact",
      description: "Fetch one contact.",
      method: "GET",
      requestDefinition: getContactDefinition,
      allowMutation: false,
      enabled: true,
      source: "manual",
    });

    const asDb = db as unknown as Parameters<typeof previewPublish>[0];
    const preview = await previewPublish(asDb, userId, serverId);
    expect(preview.ready).toBe(true);
    await publishServer(asDb, {
      userId,
      serverId,
      expectedDraftRevision: preview.draftRevision,
      expectedPublishedRevisionId: preview.publishedRevisionId,
      publishRequestId: "req_snapshot_integration_1",
      candidateFingerprint: preview.candidateFingerprint,
      acknowledgedWarningCodes: preview.warningCodes,
      actorSource: "studio",
      note: null,
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  it("pins one complete committed revision and never mixes two revisions", async () => {
    const asDb = db as unknown as Parameters<typeof loadExecutionSnapshot>[0];

    const before = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(before?.server.description).toBe("v1");
    expect(before?.revisionNumber).toBe(1);
    expect(before?.publishedRevisionId).not.toBeNull();
    expect(before?.tools).toHaveLength(1);
    expect(before?.tools[0]?.tool.description).toBe("Fetch one contact.");
    expect(before?.tools[0]?.plan).not.toBeNull();

    // Hold an uncommitted publication on a separate connection. The active
    // pointer, revision row, and revision tools/values must move together.
    const writer = await client.reserve();
    try {
      await writer.unsafe("begin");
      await writer.unsafe(
        `insert into mcp_server_revision (
           id, server_id, revision_number, source_draft_revision,
           candidate_fingerprint, contract_fingerprint, schema_version,
           compiler_version, name, description, base_url, allowed_hosts,
           publish_request_id, actor_source, actor_user_id
         ) values ($1, $2, 2, 2, 'candidate_v2', 'contract_v2', 1, '1',
           'Snapshot Integration', 'v2', 'https://api.example.com',
           '["api.example.com"]'::jsonb, 'req_snapshot_integration_2',
           'studio', $3)`,
        [REVISION_2_ID, serverId, userId],
      );
      await writer.unsafe(
        `insert into mcp_server_revision_tool (
           id, revision_id, server_id, source_tool_id, name, title, description,
           method, request_definition, compiled_plan,
           compile_status, compile_issues, annotations, allow_mutation, enabled,
           source, contract_fingerprint, definition_hash, tool_order
         )
         select 'mrt_snapshot_integration_2', $1, server_id, source_tool_id,
           name, title, 'Fetch one contact (v2).', method,
           request_definition, compiled_plan, compile_status, compile_issues,
           annotations, allow_mutation, enabled, source, contract_fingerprint,
           definition_hash, tool_order
         from mcp_server_revision_tool
         where revision_id = (
           select published_revision_id from mcp_server where id = $2
         )`,
        [REVISION_2_ID, serverId],
      );
      await writer.unsafe(
        `insert into mcp_server_revision_config (
           id, revision_id, server_id, source_value_id, name, kind, owner,
           description, value
         )
         select 'mrc_snapshot_integration_2', $1, server_id, source_value_id,
           name, kind, owner, description, value
         from mcp_server_revision_config
         where revision_id = (
           select published_revision_id from mcp_server where id = $2
         )`,
        [REVISION_2_ID, serverId],
      );
      await writer.unsafe(
        `update mcp_server
           set published_revision_id = $1,
               description = 'v2',
               draft_revision = 2,
               config_revision = config_revision + 1
         where id = $2`,
        [REVISION_2_ID, serverId],
      );

      const during = await loadExecutionSnapshot(asDb, {
        serverId,
        credentialSecret: CREDENTIAL_SECRET,
      });
      expect(during?.server.description).toBe("v1");
      expect(during?.revisionNumber).toBe(1);
      expect(during?.publishedRevisionId).toBe(before?.publishedRevisionId);
      expect(during?.tools).toHaveLength(1);
      expect(during?.tools[0]?.tool.description).toBe("Fetch one contact.");

      await writer.unsafe("commit");
    } finally {
      writer.release();
    }

    const after = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(after?.server.description).toBe("v2");
    expect(after?.revisionNumber).toBe(2);
    expect(after?.publishedRevisionId).toBe(REVISION_2_ID);
    expect(after?.tools).toHaveLength(1);
    expect(after?.tools[0]?.tool.description).toBe("Fetch one contact (v2).");
  });

  it("resolves rotated secret material without changing revision identity", async () => {
    const asDb = db as unknown as Parameters<typeof loadExecutionSnapshot>[0];

    const before = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    const revisionId = before?.publishedRevisionId;
    const revisionNumber = before?.revisionNumber;
    expect(revisionId).not.toBeNull();
    expect(before?.serverValues.get(SECRET_VALUE_ID)?.value).toBe("secret-v1");

    await db
      .update(schema.mcpServerVariable)
      .set({ ciphertext: encryptCredential("secret-v2", CREDENTIAL_SECRET) })
      .where(eq(schema.mcpServerVariable.id, SECRET_VALUE_ID));

    const after = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(after?.publishedRevisionId).toBe(revisionId);
    expect(after?.revisionNumber).toBe(revisionNumber);
    expect(after?.serverValues.get(SECRET_VALUE_ID)?.value).toBe("secret-v2");
  });
});
