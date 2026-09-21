import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES, MCP_TOOL_GROUP_LIMITS } from "@repo/core";
import { generateAuthId, schema, user } from "@repo/db";
import { AppError } from "../lib/app-error.js";
import { listTools } from "./mcp-studio-service.js";
import {
  assignToolsToGroup,
  createToolGroup,
  deleteToolGroup,
  listToolGroups,
  renameToolGroup,
} from "./mcp-tool-group-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const GROUP_LIMIT = MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer;
const PAGE_SIZE = 10;

const definition = {
  version: 2 as const,
  pathSegments: [
    { id: "seg0", value: { kind: "literal" as const, value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" as const },
  agentInputs: [],
};

type ServerRevisions = { configRevision: number; draftRevision: number };

describeIntegration("tool group concurrency and pagination parity", () => {
  const ownerId = generateAuthId("user");
  const strangerId = generateAuthId("user");
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let counter = 0;

  function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}_${counter}`;
  }

  async function createServer(userId: string, label: string): Promise<string> {
    const id = nextId("mcs");
    await db.insert(schema.mcpServer).values({
      id,
      userId,
      name: label,
      slug: id,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
    return id;
  }

  async function insertGroup(serverId: string, name: string): Promise<string> {
    const id = nextId("mtg");
    await db.insert(schema.mcpToolGroup).values({
      id,
      serverId,
      name,
      normalizedName: name.trim().replace(/\s+/g, " ").toLowerCase(),
    });
    return id;
  }

  async function insertTool(
    serverId: string,
    input: {
      name: string;
      enabled?: boolean;
      allowMutation?: boolean;
      compileStatus?: string | null;
      requestDefinition?: Record<string, unknown> | null;
      groupId?: string | null;
      createdAt?: Date;
    },
  ): Promise<string> {
    const id = nextId("mct");
    await db.insert(schema.mcpTool).values({
      id,
      serverId,
      name: input.name,
      method: "GET",
      enabled: input.enabled ?? false,
      allowMutation: input.allowMutation ?? false,
      compileStatus: input.compileStatus ?? null,
      requestDefinition: input.requestDefinition ?? null,
      groupId: input.groupId ?? null,
      ...(input.createdAt !== undefined
        ? { createdAt: input.createdAt, updatedAt: input.createdAt }
        : {}),
    });
    return id;
  }

  async function readRevisions(serverId: string): Promise<ServerRevisions> {
    const [row] = await db
      .select({
        configRevision: schema.mcpServer.configRevision,
        draftRevision: schema.mcpServer.draftRevision,
      })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    if (!row) throw new Error(`Server ${serverId} was not found.`);
    return row;
  }

  async function countGroups(serverId: string): Promise<number> {
    const [row] = await db
      .select({ count: count() })
      .from(schema.mcpToolGroup)
      .where(eq(schema.mcpToolGroup.serverId, serverId));
    return row?.count ?? 0;
  }

  async function captureError(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run();
    } catch (error) {
      return error;
    }
    throw new Error("Expected the command to reject.");
  }

  function expectAppError(
    error: unknown,
    appCode: string,
    label: string,
  ): AppError {
    expect(error, label).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.appCode, label).toBe(appCode);
    return appError;
  }

  /**
   * Re-reads the configuration revision before each attempt: a committed
   * sibling write always invalidates the compare-and-swap token, so a raw
   * concurrent call would surface `MCP_WRITE_CONFLICT` instead of the
   * capacity/name verdict these races assert.
   */
  async function withRevisionRetry<T>(
    serverId: string,
    run: (expectedRevision: number) => Promise<T>,
    attempts = 6,
  ): Promise<T> {
    let lastConflict: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const revisions = await readRevisions(serverId);
      try {
        return await run(revisions.configRevision);
      } catch (error) {
        if (
          error instanceof AppError &&
          error.appCode === APP_ERROR_CODES.MCP_WRITE_CONFLICT
        ) {
          lastConflict = error;
          continue;
        }
        throw error;
      }
    }
    throw lastConflict;
  }

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 8 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values([
      {
        id: ownerId,
        name: "Group Concurrency Owner",
        email: `${ownerId}@example.com`,
        emailVerified: true,
      },
      {
        id: strangerId,
        name: "Group Concurrency Stranger",
        email: `${strangerId}@example.com`,
        emailVerified: true,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, ownerId));
    await db.delete(user).where(eq(user.id, strangerId));
    await client.end();
  });

  it("enforces the group cap atomically for concurrent creates", async () => {
    const serverId = await createServer(ownerId, "Capacity");
    await db.insert(schema.mcpToolGroup).values(
      Array.from({ length: GROUP_LIMIT - 1 }, (_, index) => {
        const name = `Seed ${String(index + 1).padStart(2, "0")}`;
        return {
          id: nextId("mtg"),
          serverId,
          name,
          normalizedName: name.toLowerCase(),
        };
      }),
    );
    await expect(countGroups(serverId)).resolves.toBe(GROUP_LIMIT - 1);

    const racers = [
      "Racer Alpha",
      "Racer Bravo",
      "Racer Charlie",
      "Racer Delta",
    ];
    const results = await Promise.allSettled(
      racers.map((name) =>
        withRevisionRetry(serverId, (expectedRevision) =>
          createToolGroup(db as never, ownerId, serverId, {
            expectedRevision,
            name,
          }),
        ),
      ),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(racers.length - 1);
    for (const rejection of rejected) {
      expectAppError(
        (rejection as PromiseRejectedResult).reason,
        APP_ERROR_CODES.MCP_TOOL_GROUP_LIMIT_REACHED,
        "capacity racer",
      );
    }
    await expect(countGroups(serverId)).resolves.toBe(GROUP_LIMIT);
  });

  it("rejects a normalized-name collision between concurrent creates", async () => {
    const serverId = await createServer(ownerId, "Name race");
    const results = await Promise.allSettled([
      withRevisionRetry(serverId, (expectedRevision) =>
        createToolGroup(db as never, ownerId, serverId, {
          expectedRevision,
          name: "Customers",
        }),
      ),
      withRevisionRetry(serverId, (expectedRevision) =>
        createToolGroup(db as never, ownerId, serverId, {
          expectedRevision,
          name: "  customers ",
        }),
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expectAppError(
      (rejected[0] as PromiseRejectedResult).reason,
      APP_ERROR_CODES.MCP_TOOL_GROUP_NAME_CONFLICT,
      "normalized-name loser",
    );

    const rows = await db
      .select({
        name: schema.mcpToolGroup.name,
        normalizedName: schema.mcpToolGroup.normalizedName,
      })
      .from(schema.mcpToolGroup)
      .where(eq(schema.mcpToolGroup.serverId, serverId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.normalizedName).toBe("customers");
  });

  it("reports a stale revision without retrying or changing assignments", async () => {
    const serverId = await createServer(ownerId, "Stale revision");
    const toolId = await insertTool(serverId, { name: "stale_revision_tool" });
    const group = await createToolGroup(db as never, ownerId, serverId, {
      expectedRevision: 1,
      name: "Keep",
    });
    const assigned = await assignToolsToGroup(db as never, ownerId, serverId, {
      expectedRevision: group.revision,
      toolIds: [toolId],
      groupId: group.group.id,
    });
    const observed = await readRevisions(serverId);
    expect(observed.configRevision).toBe(assigned.revision);

    const advanced = await createToolGroup(db as never, ownerId, serverId, {
      expectedRevision: observed.configRevision,
      name: "Advance",
    });

    const error = expectAppError(
      await captureError(() =>
        assignToolsToGroup(db as never, ownerId, serverId, {
          expectedRevision: observed.configRevision,
          toolIds: [toolId],
          groupId: null,
        }),
      ),
      APP_ERROR_CODES.MCP_WRITE_CONFLICT,
      "stale assignment",
    );
    expect(error.details?.currentRevision).toBe(advanced.revision);

    const [tool] = await db
      .select({ groupId: schema.mcpTool.groupId })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.id, toolId));
    expect(tool?.groupId).toBe(group.group.id);
    await expect(readRevisions(serverId)).resolves.toEqual({
      configRevision: advanced.revision,
      draftRevision: observed.draftRevision,
    });
  });

  it("deletes a populated group without altering any member tool", async () => {
    const serverId = await createServer(ownerId, "Delete preservation");
    const groupId = await insertGroup(serverId, "Doomed");
    const firstDefinition = { ...definition, pathSegments: [] };
    const secondDefinition = { ...definition, agentInputs: [] };
    const toolIds = [
      await insertTool(serverId, {
        name: "enabled_tool",
        enabled: true,
        allowMutation: false,
        compileStatus: "valid",
        requestDefinition: firstDefinition,
        groupId,
      }),
      await insertTool(serverId, {
        name: "disabled_tool",
        enabled: false,
        allowMutation: false,
        compileStatus: null,
        requestDefinition: secondDefinition,
        groupId,
      }),
      await insertTool(serverId, {
        name: "mutating_tool",
        enabled: false,
        allowMutation: true,
        compileStatus: "invalid",
        requestDefinition: firstDefinition,
        groupId,
      }),
    ];

    const columns = {
      id: schema.mcpTool.id,
      name: schema.mcpTool.name,
      method: schema.mcpTool.method,
      enabled: schema.mcpTool.enabled,
      allowMutation: schema.mcpTool.allowMutation,
      compileStatus: schema.mcpTool.compileStatus,
      requestDefinition: schema.mcpTool.requestDefinition,
    };
    const before = await db
      .select(columns)
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId));
    expect(before).toHaveLength(3);

    const deleted = await deleteToolGroup(db as never, ownerId, serverId, {
      expectedRevision: 1,
      groupId,
    });
    expect(deleted.ungroupedToolCount).toBe(3);

    await expect(countGroups(serverId)).resolves.toBe(0);
    const after = await db
      .select({ ...columns, groupId: schema.mcpTool.groupId })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId));
    expect(after).toHaveLength(3);
    const beforeById = new Map(before.map((tool) => [tool.id, tool]));
    for (const tool of after) {
      expect(toolIds).toContain(tool.id);
      expect(tool.groupId).toBeNull();
      expect(JSON.stringify(tool)).toBe(
        JSON.stringify({ ...beforeById.get(tool.id), groupId: null }),
      );
    }
  });

  it("keeps draftRevision fixed across create, rename, assign, and delete", async () => {
    const serverId = await createServer(ownerId, "Revision isolation");
    const toolId = await insertTool(serverId, { name: "grouped_tool" });
    const before = await readRevisions(serverId);
    expect(before).toEqual({ configRevision: 1, draftRevision: 1 });

    const created = await createToolGroup(db as never, ownerId, serverId, {
      expectedRevision: before.configRevision,
      name: "Sequence",
    });
    const renamed = await renameToolGroup(db as never, ownerId, serverId, {
      expectedRevision: created.revision,
      groupId: created.group.id,
      name: "Sequence renamed",
    });
    const assigned = await assignToolsToGroup(db as never, ownerId, serverId, {
      expectedRevision: renamed.revision,
      toolIds: [toolId],
      groupId: created.group.id,
    });
    const deleted = await deleteToolGroup(db as never, ownerId, serverId, {
      expectedRevision: assigned.revision,
      groupId: created.group.id,
    });

    for (const outcome of [created, renamed, assigned, deleted]) {
      expect(outcome.draftRevision).toBe(before.draftRevision);
    }
    expect(deleted.revision).toBe(before.configRevision + 4);
    await expect(readRevisions(serverId)).resolves.toEqual({
      configRevision: before.configRevision + 4,
      draftRevision: before.draftRevision,
    });
  });

  it("keeps list and count on one predicate for every group filter", async () => {
    const serverId = await createServer(ownerId, "Pagination parity");
    const groupA = await insertGroup(serverId, "Parity A");
    const groupB = await insertGroup(serverId, "Parity B");
    const baseTime = new Date("2026-01-01T00:00:00.000Z").getTime();
    let index = 0;
    const seed = async (groupId: string | null, amount: number) => {
      for (let item = 0; item < amount; item += 1) {
        index += 1;
        await insertTool(serverId, {
          name: `parity_${String(index).padStart(2, "0")}`,
          groupId,
          createdAt: new Date(baseTime + index * 1000),
        });
      }
    };
    await seed(groupA, 9);
    await seed(groupB, 7);
    await seed(null, 9);
    const total = index;
    expect(total).toBe(25);

    const walk = async (group: string | undefined) => {
      const first = await listTools(db as never, ownerId, serverId, {
        page: 1,
        pageSize: PAGE_SIZE,
        group,
      });
      const items = [...first.items];
      const pages = Math.ceil(first.total / PAGE_SIZE);
      for (let page = 2; page <= pages; page += 1) {
        const next = await listTools(db as never, ownerId, serverId, {
          page,
          pageSize: PAGE_SIZE,
          group,
        });
        items.push(...next.items);
      }
      return { total: first.total, items };
    };

    const unfiltered = await walk(undefined);
    expect(unfiltered.total).toBe(total);
    expect(unfiltered.items).toHaveLength(total);
    expect(new Set(unfiltered.items.map((tool) => tool.id)).size).toBe(total);
    expect(unfiltered.items.every((tool) => tool.serverId === serverId)).toBe(
      true,
    );

    const all = await walk("all");
    expect(all.total).toBe(total);
    expect(all.items).toHaveLength(total);
    expect(new Set(all.items.map((tool) => tool.id)).size).toBe(total);

    const ungrouped = await walk("ungrouped");
    expect(ungrouped.total).toBe(9);
    expect(ungrouped.items).toHaveLength(9);
    expect(ungrouped.items.every((tool) => tool.groupId === null)).toBe(true);

    const filtered = await walk(groupA);
    expect(filtered.total).toBe(9);
    expect(filtered.items).toHaveLength(9);
    expect(filtered.items.every((tool) => tool.groupId === groupA)).toBe(true);
    expect(filtered.items.some((tool) => tool.groupId === groupB)).toBe(false);
  });

  it("filters by name with one predicate for rows and count", async () => {
    const serverId = await createServer(ownerId, "Name search");
    const groupId = await insertGroup(serverId, "Search Group");
    const baseTime = new Date("2026-02-01T00:00:00.000Z").getTime();
    const seeded = [
      { name: "fb_get_ad_account", groupId },
      { name: "fb_pause_ad", groupId },
      { name: "fb_get_ad_accounts", groupId: null },
      { name: "100%_reliable", groupId: null },
    ];
    let index = 0;
    for (const row of seeded) {
      index += 1;
      await insertTool(serverId, {
        name: row.name,
        groupId: row.groupId,
        createdAt: new Date(baseTime + index * 1000),
      });
    }

    const search = (q: string | undefined, group?: string) =>
      listTools(db as never, ownerId, serverId, {
        page: 1,
        pageSize: PAGE_SIZE,
        q,
        group,
      });

    const matching = await search("AD_ACC");
    expect(matching.total).toBe(2);
    expect(matching.items.map((tool) => tool.name).sort()).toEqual([
      "fb_get_ad_account",
      "fb_get_ad_accounts",
    ]);

    const combined = await search("fb_", groupId);
    expect(combined.total).toBe(2);
    expect(combined.items.every((tool) => tool.groupId === groupId)).toBe(true);

    const literal = await search("100%_");
    expect(literal.total).toBe(1);
    expect(literal.items[0]?.name).toBe("100%_reliable");

    for (const blank of [undefined, "", "   "]) {
      const unfiltered = await search(blank);
      expect(unfiltered.total).toBe(seeded.length);
      expect(unfiltered.items).toHaveLength(seeded.length);
    }
  });

  it("conceals another owner's server and groups from every group command", async () => {
    const ownerServerId = await createServer(ownerId, "Owner server");
    const strangerServerId = await createServer(strangerId, "Stranger server");
    const ownerGroupId = await insertGroup(ownerServerId, "Owner group");
    const ownerToolId = await insertTool(ownerServerId, {
      name: "owner_tool",
      groupId: ownerGroupId,
    });
    const strangerToolId = await insertTool(strangerServerId, {
      name: "stranger_tool",
    });
    const expectedRevision = 1;

    const foreignServerCalls: Array<[string, () => Promise<unknown>]> = [
      [
        "listToolGroups",
        () => listToolGroups(db as never, strangerId, ownerServerId),
      ],
      [
        "createToolGroup",
        () =>
          createToolGroup(db as never, strangerId, ownerServerId, {
            expectedRevision,
            name: "Intruder",
          }),
      ],
      [
        "renameToolGroup",
        () =>
          renameToolGroup(db as never, strangerId, ownerServerId, {
            expectedRevision,
            groupId: ownerGroupId,
            name: "Intruder",
          }),
      ],
      [
        "deleteToolGroup",
        () =>
          deleteToolGroup(db as never, strangerId, ownerServerId, {
            expectedRevision,
            groupId: ownerGroupId,
          }),
      ],
      [
        "assignToolsToGroup",
        () =>
          assignToolsToGroup(db as never, strangerId, ownerServerId, {
            expectedRevision,
            toolIds: [ownerToolId],
            groupId: ownerGroupId,
          }),
      ],
    ];
    for (const [label, call] of foreignServerCalls) {
      expectAppError(
        await captureError(call),
        APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
        label,
      );
    }

    const foreignGroupCalls: Array<[string, () => Promise<unknown>]> = [
      [
        "renameToolGroup",
        () =>
          renameToolGroup(db as never, strangerId, strangerServerId, {
            expectedRevision,
            groupId: ownerGroupId,
            name: "Intruder",
          }),
      ],
      [
        "deleteToolGroup",
        () =>
          deleteToolGroup(db as never, strangerId, strangerServerId, {
            expectedRevision,
            groupId: ownerGroupId,
          }),
      ],
      [
        "assignToolsToGroup",
        () =>
          assignToolsToGroup(db as never, strangerId, strangerServerId, {
            expectedRevision,
            toolIds: [strangerToolId],
            groupId: ownerGroupId,
          }),
      ],
    ];
    for (const [label, call] of foreignGroupCalls) {
      expectAppError(
        await captureError(call),
        APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
        label,
      );
    }

    const [group] = await db
      .select({ name: schema.mcpToolGroup.name })
      .from(schema.mcpToolGroup)
      .where(eq(schema.mcpToolGroup.id, ownerGroupId));
    expect(group?.name).toBe("Owner group");
    const [tool] = await db
      .select({ groupId: schema.mcpTool.groupId })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.id, ownerToolId));
    expect(tool?.groupId).toBe(ownerGroupId);
    await expect(readRevisions(ownerServerId)).resolves.toEqual({
      configRevision: 1,
      draftRevision: 1,
    });
  });
});
