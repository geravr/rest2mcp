import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import { generateAuthId, schema, user } from "@repo/db";
import {
  createPlatformToken,
  createServerToken,
  listPlatformTokens,
} from "./mcp-studio-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

describeIntegration("platform PAT rotation concurrency", () => {
  const userId = generateAuthId("user");
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 4 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "PAT Integration",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  it("lets only one concurrent rotation of the same token win", async () => {
    const observed = await createPlatformToken(db as never, userId, {
      name: "Primary",
    });

    const outcomes = await Promise.allSettled([
      createPlatformToken(db as never, userId, {
        name: "Successor A",
        replacesTokenId: observed.id,
      }),
      createPlatformToken(db as never, userId, {
        name: "Successor B",
        replacesTokenId: observed.id,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
    });

    const active = await listPlatformTokens(db as never, userId);
    // The original was rotated away; exactly one successor remains.
    expect(active).toHaveLength(1);
    expect(["Successor A", "Successor B"]).toContain(active[0]?.name);
  });

  it("allows multiple default-named server tokens (free-form names)", async () => {
    const serverId = `mcs_server_token_${userId}`;
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: "Server Tokens",
      slug: serverId,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });

    const first = await createServerToken(db as never, userId, serverId, 1);
    const second = await createServerToken(db as never, userId, serverId, 2);
    expect(first.name).toBe("Agent token");
    expect(second.name).toBe("Agent token");
    expect(first.id).not.toBe(second.id);
  });
});
