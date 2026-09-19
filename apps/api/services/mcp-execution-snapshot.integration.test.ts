import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { generateAuthId, schema, user } from "@repo/db";
import { loadExecutionSnapshot } from "./mcp-executor-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const CREDENTIAL_SECRET = "s".repeat(32);

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
      description: "old",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "live",
    });
    await db.insert(schema.mcpTool).values({
      id: "mct_snapshot_integration",
      serverId,
      name: "get_contact",
      title: "Get contact",
      description: "Fetch one contact.",
      method: "GET",
      pathTemplate: "/contacts/{{id}}",
      requestTemplate: {},
      params: [{ name: "id", required: true, type: "string" }],
      allowMutation: false,
      enabled: true,
      source: "manual",
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  it("observes either the complete previous or complete new revision", async () => {
    const asDb = db as unknown as Parameters<typeof loadExecutionSnapshot>[0];

    const before = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(before?.server.description).toBe("old");
    expect(before?.configRevision).toBe(1);
    expect(before?.tools).toHaveLength(1);
    expect(before?.tools[0]?.plan).not.toBeNull();

    // Hold an uncommitted writer on a separate connection.
    const writer = await client.reserve();
    try {
      await writer.unsafe("begin");
      await writer.unsafe(
        "update mcp_server set description = 'new', config_revision = 2 where id = $1",
        [serverId],
      );
      await writer.unsafe(
        "update mcp_tool set enabled = false where id = 'mct_snapshot_integration'",
      );
      await writer.unsafe(
        "insert into mcp_server_variable (id, server_id, name, is_secret, value) values ('msv_snapshot', $1, 'snapshot_var', false, 'v')",
        [serverId],
      );

      const during = await loadExecutionSnapshot(asDb, {
        serverId,
        credentialSecret: CREDENTIAL_SECRET,
      });
      expect(during?.server.description).toBe("old");
      expect(during?.configRevision).toBe(1);
      // Plans and values stay on the same committed revision as the server row.
      expect(during?.tools[0]?.tool.enabled).toBe(true);
      expect(during?.serverValues.has("msv_snapshot")).toBe(false);

      await writer.unsafe("commit");
    } finally {
      writer.release();
    }

    const after = await loadExecutionSnapshot(asDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    expect(after?.server.description).toBe("new");
    expect(after?.configRevision).toBe(2);
    expect(after?.tools[0]?.tool.enabled).toBe(false);
    expect(after?.serverValues.has("msv_snapshot")).toBe(true);
  });
});
