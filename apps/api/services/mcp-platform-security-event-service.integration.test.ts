import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { generateAuthId, generateId, schema, user } from "@repo/db";
import {
  cleanupExpiredPlatformSecurityEvents,
  listPlatformSecurityEvents,
  recordPlatformSecurityEvent,
  recordPlatformSecurityEventBestEffort,
} from "./mcp-platform-security-event-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const DAY_MS = 24 * 60 * 60 * 1000;

describeIntegration("Platform security events (integration)", () => {
  const ownerId = generateAuthId("user");
  const otherId = generateAuthId("user");
  const rollbackId = generateAuthId("user");
  const base = Date.now();

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 4 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values([
      {
        id: ownerId,
        name: "Security Owner",
        email: `${ownerId}@example.com`,
        emailVerified: true,
      },
      {
        id: otherId,
        name: "Security Other",
        email: `${otherId}@example.com`,
        emailVerified: true,
      },
      {
        id: rollbackId,
        name: "Security Rollback",
        email: `${rollbackId}@example.com`,
        emailVerified: true,
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(user)
      .where(inArray(user.id, [ownerId, otherId, rollbackId]));
    await client.end();
  });

  it("isolates ledger reads by owner and scopes totals to the same predicate", async () => {
    const ownerEvents = [
      {
        id: generateId("pse"),
        userId: ownerId,
        eventType: "token_issued" as const,
        outcome: "success" as const,
        createdAt: new Date(base - 3 * DAY_MS),
      },
      {
        id: generateId("pse"),
        userId: ownerId,
        eventType: "token_issued" as const,
        outcome: "success" as const,
        createdAt: new Date(base - 2 * DAY_MS),
      },
      {
        id: generateId("pse"),
        userId: ownerId,
        eventType: "token_issued" as const,
        outcome: "success" as const,
        createdAt: new Date(base - 1 * DAY_MS),
      },
    ];
    const otherEvents = [
      {
        id: generateId("pse"),
        userId: otherId,
        eventType: "token_issued" as const,
        outcome: "success" as const,
        createdAt: new Date(base - 2 * DAY_MS),
      },
      {
        id: generateId("pse"),
        userId: otherId,
        eventType: "token_issued" as const,
        outcome: "success" as const,
        createdAt: new Date(base - 1 * DAY_MS),
      },
    ];
    await db
      .insert(schema.mcpPlatformSecurityEvent)
      .values([...ownerEvents, ...otherEvents]);

    const page1 = await listPlatformSecurityEvents(db as never, ownerId, {
      page: 1,
      pageSize: 10,
    });
    const page2 = await listPlatformSecurityEvents(db as never, ownerId, {
      page: 2,
      pageSize: 10,
    });

    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(10);
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    expect(page1.items.map((item) => item.id)).toEqual([
      ownerEvents[2]!.id,
      ownerEvents[1]!.id,
      ownerEvents[0]!.id,
    ]);
    expect(page2.items).toEqual([]);

    const returned = page1.items.map((item) => item.id);
    const otherIds = new Set(otherEvents.map((event) => event.id));
    expect(returned.some((id) => otherIds.has(id))).toBe(false);
  });

  it("deletes events older than the retention window and keeps newer ones", async () => {
    const expiredId = generateId("pse");
    const freshId = generateId("pse");
    await db.insert(schema.mcpPlatformSecurityEvent).values([
      {
        id: expiredId,
        userId: ownerId,
        eventType: "token_revoked",
        outcome: "success",
        createdAt: new Date(base - 45 * DAY_MS),
      },
      {
        id: freshId,
        userId: ownerId,
        eventType: "token_revoked",
        outcome: "success",
        createdAt: new Date(base - 1 * DAY_MS),
      },
    ]);

    const deleted = await cleanupExpiredPlatformSecurityEvents(db as never, 30);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select({ id: schema.mcpPlatformSecurityEvent.id })
      .from(schema.mcpPlatformSecurityEvent)
      .where(inArray(schema.mcpPlatformSecurityEvent.id, [expiredId, freshId]));

    expect(remaining.map((row) => row.id)).toEqual([freshId]);
  });

  it("rolls back a lifecycle transaction when the security event insert fails", async () => {
    await expect(
      db.transaction(async (tx) => {
        await recordPlatformSecurityEvent(tx as never, {
          userId: rollbackId,
          eventType: "token_issued",
          outcome: "success",
          metadata: { operation: "create" },
        });
        // Foreign-key violation: the user id does not exist.
        await recordPlatformSecurityEvent(tx as never, {
          userId: generateAuthId("user"),
          eventType: "token_issued",
          outcome: "success",
        });
      }),
    ).rejects.toThrow();

    const rows = await db
      .select({ id: schema.mcpPlatformSecurityEvent.id })
      .from(schema.mcpPlatformSecurityEvent)
      .where(eq(schema.mcpPlatformSecurityEvent.userId, rollbackId));

    expect(rows).toHaveLength(0);
  });

  it("never throws from a best-effort runtime audit when persistence fails", async () => {
    await expect(
      recordPlatformSecurityEventBestEffort(db as never, {
        userId: generateAuthId("user"),
        eventType: "scope_denied",
        outcome: "denied",
        metadata: { reason: "missing_scope" },
      }),
    ).resolves.toBeUndefined();
  });
});
