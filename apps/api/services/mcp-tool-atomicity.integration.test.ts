import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import { generateAuthId, schema, user } from "@repo/db";
import { getMcpMaxToolsPerServer } from "../lib/mcp-limits.js";
import { withOwnedServerWrite } from "./mcp-server-command.js";
import { createTool, deleteServer } from "./mcp-studio-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

/** The deployment's effective cap, so seeded rows reach the real boundary. */
const MAX_TOOLS = getMcpMaxToolsPerServer();
const definition = {
  version: 2 as const,
  pathSegments: [
    { id: "seg0", value: { kind: "literal" as const, value: "/x" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" as const },
  agentInputs: [],
};

describeIntegration("server aggregate tool atomicity", () => {
  const userId = generateAuthId("user");
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let counter = 0;

  async function createServer(): Promise<string> {
    counter += 1;
    const id = `mcs_atomic_tool_${counter}`;
    await db.insert(schema.mcpServer).values({
      id,
      userId,
      name: `Atomic ${counter}`,
      slug: id,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
    return id;
  }

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 6 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "Atomic Tools",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  it("rolls back a tool write and the revision when the command fails", async () => {
    const serverId = await createServer();
    await expect(
      withOwnedServerWrite(
        db as never,
        { userId, serverId, expectedRevision: 1 },
        async (ctx) => {
          await ctx.tx.insert(schema.mcpTool).values({
            id: "mct_rollback",
            serverId,
            name: "rollback_tool",
            method: "GET",
            allowMutation: false,
            enabled: false,
            source: "manual",
          });
          throw new Error("injected failure after the child write");
        },
      ),
    ).rejects.toThrow("injected failure");

    const [toolCount] = await db
      .select({ count: count() })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId));
    expect(toolCount?.count).toBe(0);
    const [server] = await db
      .select({ configRevision: schema.mcpServer.configRevision })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    expect(server?.configRevision).toBe(1);
  });

  it("serializes tool capacity so only one of two concurrent creates commits", async () => {
    const serverId = await createServer();
    for (let index = 0; index < MAX_TOOLS - 1; index += 1) {
      await db.insert(schema.mcpTool).values({
        id: `mct_seed_${counter}_${index}`,
        serverId,
        name: `seed_${index}`,
        method: "GET",
        allowMutation: false,
        enabled: false,
        source: "manual",
      });
    }

    const run = (name: string) =>
      createTool(db as never, userId, serverId, {
        expectedRevision: 1,
        name,
        method: "GET",
        requestDefinition: definition,
        enabled: false,
      });

    const outcomes = await Promise.allSettled([
      run("concurrent_a"),
      run("concurrent_b"),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as {
      appCode?: string;
    };
    // The loser either exceeds capacity or loses the revision race.
    expect([
      APP_ERROR_CODES.INVALID_INPUT,
      APP_ERROR_CODES.MCP_WRITE_CONFLICT,
    ]).toContain(reason.appCode);

    const [toolCount] = await db
      .select({ count: count() })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId));
    expect(toolCount?.count).toBe(MAX_TOOLS);
    const [server] = await db
      .select({ configRevision: schema.mcpServer.configRevision })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    expect(server?.configRevision).toBe(2);
  });

  it("serializes server deletion against a concurrent child write", async () => {
    const serverId = await createServer();

    const outcomes = await Promise.allSettled([
      createTool(db as never, userId, serverId, {
        expectedRevision: 1,
        name: "racing_tool",
        method: "GET",
        requestDefinition: definition,
        enabled: false,
      }),
      deleteServer(db as never, userId, serverId, 1),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const [remainingServer] = await db
      .select({ id: schema.mcpServer.id })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    const [tools] = await db
      .select({ count: count() })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId));
    if (remainingServer) {
      // The child write committed; the server and its tool both exist.
      expect(tools?.count).toBe(1);
    } else {
      // Deletion won; no partial child row survives.
      expect(tools?.count).toBe(0);
    }
  });
});
