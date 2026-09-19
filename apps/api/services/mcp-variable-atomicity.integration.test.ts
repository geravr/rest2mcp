import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import { generateAuthId, schema, user } from "@repo/db";
import { createVariable } from "./mcp-studio-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const CREDENTIAL_SECRET = "s".repeat(32);

describeIntegration("server aggregate variable atomicity", () => {
  const userId = generateAuthId("user");
  const serverId = "mcs_variable_atomic";
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 6 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "Variable Atomic",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: "Variable Atomic",
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

  it("keeps concurrent same-name creation singular", async () => {
    const run = () =>
      createVariable(
        db as never,
        userId,
        serverId,
        {
          expectedRevision: 1,
          name: "api_token",
          kind: "secret",
          value: "sk_live_secret",
        },
        CREDENTIAL_SECRET,
      );

    const outcomes = await Promise.allSettled([run(), run()]);
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as {
      appCode?: string;
    };
    expect([
      APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
      APP_ERROR_CODES.MCP_WRITE_CONFLICT,
    ]).toContain(reason.appCode);

    const [rows] = await db
      .select({ count: count() })
      .from(schema.mcpServerVariable)
      .where(
        and(
          eq(schema.mcpServerVariable.serverId, serverId),
          eq(schema.mcpServerVariable.name, "api_token"),
        ),
      );
    expect(rows?.count).toBe(1);
  });
});
