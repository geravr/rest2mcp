import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import { generateAuthId, schema, user } from "@repo/db";
import { withOwnedServerWrite } from "./mcp-server-command.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

describeIntegration("withOwnedServerWrite concurrency", () => {
  const userId = generateAuthId("user");
  const serverId = "mcs_atomic_integration";
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 4 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "Atomic Integration",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: "Atomic Integration",
      slug: serverId,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  it("lets at most one command win from the same revision", async () => {
    const runCommand = () =>
      withOwnedServerWrite(
        db as unknown as Parameters<typeof withOwnedServerWrite>[0],
        { userId, serverId, expectedRevision: 1 },
        async () => "committed",
      );

    const outcomes = await Promise.allSettled([runCommand(), runCommand()]);
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
    });

    const [serverRow] = await db
      .select()
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    expect(serverRow?.configRevision).toBe(2);
  });
});
