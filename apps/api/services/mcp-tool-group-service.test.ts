import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES, MCP_TOOL_GROUP_LIMITS } from "@repo/core";
import { AppError } from "../lib/app-error.js";

const tables = vi.hoisted(() => ({
  mcpServer: {
    id: "mcp_server.id",
    userId: "mcp_server.user_id",
    configRevision: "mcp_server.config_revision",
    draftRevision: "mcp_server.draft_revision",
  },
  mcpTool: {
    id: "mcp_tool.id",
    serverId: "mcp_tool.server_id",
    groupId: "mcp_tool.group_id",
  },
  mcpToolGroup: {
    id: "mcp_tool_group.id",
    serverId: "mcp_tool_group.server_id",
    name: "mcp_tool_group.name",
    normalizedName: "mcp_tool_group.normalized_name",
    createdAt: "mcp_tool_group.created_at",
    updatedAt: "mcp_tool_group.updated_at",
  },
}));

vi.mock("@repo/db", () => tables);
vi.mock("../lib/mcp-telemetry.js", () => ({
  captureMcpTelemetry: vi.fn(),
  MCP_TELEMETRY_EVENTS: {
    aggregateWrite: "mcp_aggregate_write",
    aggregateConflict: "mcp_aggregate_conflict",
    aggregateRetry: "mcp_aggregate_retry",
  },
}));
const drizzle = vi.hoisted(() => ({
  and: vi.fn((...args: unknown[]) => ({ kind: "and", args })),
  asc: vi.fn((value: unknown) => ({ kind: "asc", value })),
  count: vi.fn((value: unknown) => ({ kind: "count", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({
    kind: "inArray",
    left,
    right,
  })),
  isNull: vi.fn((value: unknown) => ({ kind: "isNull", value })),
}));

vi.mock("drizzle-orm", () => drizzle);

import { mcpTool, mcpToolGroup } from "@repo/db";
import {
  assignToolsToGroup,
  createToolGroup,
  deleteToolGroup,
  listToolGroups,
  normalizeToolGroupName,
  renameToolGroup,
  validateToolGroupName,
} from "./mcp-tool-group-service.js";

/** The draft revision the mocked boundary write always reports. */
const DRAFT_REVISION = 7;

const serverRow = {
  id: "mcs_1",
  userId: "user-a",
  configRevision: 1,
  draftRevision: DRAFT_REVISION,
};

function groupRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "mtg_1",
    serverId: "mcs_1",
    name: "Customers",
    normalizedName: "customers",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function uniqueViolation() {
  return Object.assign(new Error("duplicate key value"), { code: "23505" });
}

function makeChain<T>(result: T) {
  const handler: ProxyHandler<object> = {
    get(_, prop: string | symbol) {
      if (prop === "then") {
        return (
          resolve: (value: T) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

function makeRejectingChain(error: unknown) {
  const handler: ProxyHandler<object> = {
    get(_, prop: string | symbol) {
      if (prop === "then") {
        return (_resolve: unknown, reject?: (reason: unknown) => unknown) =>
          Promise.reject(error).then(undefined, reject);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

function makeDb(results: unknown[]) {
  let index = 0;
  const insertedValues: Array<{ table: unknown; values: unknown }> = [];
  const updatedValues: Array<{
    table: unknown;
    values: Record<string, unknown>;
  }> = [];
  const deletedTables: unknown[] = [];
  const take = () => {
    const value = results[index] ?? [];
    index += 1;
    return value instanceof Error
      ? makeRejectingChain(value)
      : makeChain(value);
  };
  const db = {
    select: vi.fn(() => take()),
    insert: vi.fn((table: unknown) => ({
      values: (payload: unknown) => {
        insertedValues.push({ table, values: payload });
        return take();
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (payload: Record<string, unknown>) => {
        const isRevisionBoundary =
          payload && typeof payload === "object" && "configRevision" in payload;
        let chain: unknown;
        if (isRevisionBoundary) {
          chain = makeChain([
            {
              configRevision: payload.configRevision,
              draftRevision: DRAFT_REVISION,
            },
          ]);
        } else {
          updatedValues.push({ table, values: payload });
          chain = take();
        }
        return { where: () => chain, returning: () => chain };
      },
    })),
    delete: vi.fn((table: unknown) => {
      deletedTables.push(table);
      return take();
    }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    insertedValues,
    updatedValues,
    deletedTables,
  };
  return db;
}

function isAppErrorWith(code: string) {
  return (error: unknown) =>
    error instanceof AppError && error.appCode === code;
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("mcp-tool-group name normalization", () => {
  it("case-folds and collapses internal whitespace", () => {
    expect(normalizeToolGroupName("  Customer   Support  ")).toBe(
      "customer support",
    );
    expect(normalizeToolGroupName("CUSTOMERS")).toBe("customers");
    expect(normalizeToolGroupName("Customers")).toBe("customers");
    expect(normalizeToolGroupName("Invoices\t\n2026")).toBe("invoices 2026");
  });

  it("validates a display name and returns it trimmed", () => {
    expect(validateToolGroupName("  Customers  ")).toBe("Customers");
    expect(thrownBy(() => validateToolGroupName("   "))).toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.INVALID_INPUT),
    );
    expect(
      thrownBy(() =>
        validateToolGroupName("x".repeat(MCP_TOOL_GROUP_LIMITS.name + 1)),
      ),
    ).toSatisfy(isAppErrorWith(APP_ERROR_CODES.INVALID_INPUT));
  });
});

describe("mcp-tool-group createToolGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a group without moving the publishable draft revision", async () => {
    const created = groupRow({ name: "Customer Support" });
    const db = makeDb([[serverRow], [{ count: 0 }], [created]]);

    const result = await createToolGroup(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      name: "  Customer   Support  ",
    });

    expect(result.group).toEqual(created);
    expect(result.revision).toBe(2);
    expect(result.draftRevision).toBe(DRAFT_REVISION);
    expect(db.insertedValues).toEqual([
      {
        table: mcpToolGroup,
        values: {
          serverId: "mcs_1",
          name: "Customer   Support",
          normalizedName: "customer support",
        },
      },
    ]);
  });

  it("maps a normalized name conflict to MCP_TOOL_GROUP_NAME_CONFLICT", async () => {
    const db = makeDb([[serverRow], [{ count: 0 }], uniqueViolation()]);

    await expect(
      createToolGroup(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        name: "customers",
      }),
    ).rejects.toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.MCP_TOOL_GROUP_NAME_CONFLICT),
    );
  });

  it("conceals another user's server as not found", async () => {
    const db = makeDb([[]]);

    await expect(
      createToolGroup(db as never, "user-b", "mcs_a", {
        expectedRevision: 1,
        name: "Customers",
      }),
    ).rejects.toSatisfy(isAppErrorWith(APP_ERROR_CODES.MCP_SERVER_NOT_FOUND));
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("mcp-tool-group capacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects creation at the server group cap", async () => {
    const observed = MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer;
    const db = makeDb([[serverRow], [{ count: observed }]]);

    await expect(
      createToolGroup(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        name: "Overflow",
      }),
    ).rejects.toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.MCP_TOOL_GROUP_LIMIT_REACHED),
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("reports the measured limit and observed count", async () => {
    const observed = MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer;
    const db = makeDb([[serverRow], [{ count: observed }]]);

    await expect(
      createToolGroup(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        name: "Overflow",
      }),
    ).rejects.toMatchObject({
      details: {
        serverId: "mcs_1",
        limit: MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer,
        observed,
      },
    });
  });
});

describe("mcp-tool-group renameToolGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames only the display and normalized name", async () => {
    const renamed = groupRow({ name: "VIP", normalizedName: "vip" });
    const db = makeDb([[serverRow], [groupRow()], [renamed]]);

    const result = await renameToolGroup(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      groupId: "mtg_1",
      name: "VIP",
    });

    expect(result.group).toEqual(renamed);
    expect(result.revision).toBe(2);
    expect(result.draftRevision).toBe(DRAFT_REVISION);
    expect(db.updatedValues).toEqual([
      { table: mcpToolGroup, values: { name: "VIP", normalizedName: "vip" } },
    ]);
  });

  it("maps a normalized name conflict on rename", async () => {
    const db = makeDb([[serverRow], [groupRow()], uniqueViolation()]);

    await expect(
      renameToolGroup(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        groupId: "mtg_1",
        name: "customers",
      }),
    ).rejects.toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.MCP_TOOL_GROUP_NAME_CONFLICT),
    );
  });

  it("conceals a group that does not belong to the server", async () => {
    const db = makeDb([[serverRow], []]);

    await expect(
      renameToolGroup(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        groupId: "mtg_foreign",
        name: "Renamed",
      }),
    ).rejects.toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND),
    );
    expect(db.updatedValues).toEqual([]);
  });
});

describe("mcp-tool-group deleteToolGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ungroups members and deletes only the group", async () => {
    const db = makeDb([
      [serverRow],
      [groupRow()],
      [{ id: "mct_1" }, { id: "mct_2" }, { id: "mct_3" }],
      [],
    ]);

    const result = await deleteToolGroup(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      groupId: "mtg_1",
    });

    expect(result).toEqual({
      groupId: "mtg_1",
      ungroupedToolCount: 3,
      revision: 2,
      draftRevision: DRAFT_REVISION,
    });
    expect(db.deletedTables).toEqual([mcpToolGroup]);
    expect(db.updatedValues).toEqual([
      { table: mcpTool, values: { groupId: null } },
    ]);
  });

  it("conceals a group that does not belong to the server", async () => {
    const db = makeDb([[serverRow], []]);

    await expect(
      deleteToolGroup(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        groupId: "mtg_foreign",
      }),
    ).rejects.toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND),
    );
    expect(db.deletedTables).toEqual([]);
    expect(db.updatedValues).toEqual([]);
  });
});

describe("mcp-tool-group assignToolsToGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates tool ids and changes only the group id", async () => {
    const db = makeDb([
      [serverRow],
      [groupRow()],
      [{ id: "mct_1" }, { id: "mct_2" }],
      [],
    ]);

    const result = await assignToolsToGroup(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      toolIds: ["mct_1", "mct_1", "mct_2"],
      groupId: "mtg_1",
    });

    expect(result).toEqual({
      groupId: "mtg_1",
      toolIds: ["mct_1", "mct_2"],
      revision: 2,
      draftRevision: DRAFT_REVISION,
    });
    expect(db.updatedValues).toEqual([
      { table: mcpTool, values: { groupId: "mtg_1" } },
    ]);
    expect(drizzle.inArray.mock.calls.map((call) => call[1])).toEqual([
      ["mct_1", "mct_2"],
      ["mct_1", "mct_2"],
    ]);
  });

  it("ungroups without resolving a group on the server", async () => {
    const db = makeDb([[serverRow], [{ id: "mct_1" }], []]);

    const result = await assignToolsToGroup(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      toolIds: ["mct_1"],
      groupId: null,
    });

    expect(result.groupId).toBeNull();
    expect(result.toolIds).toEqual(["mct_1"]);
    expect(result.revision).toBe(2);
    expect(result.draftRevision).toBe(DRAFT_REVISION);
    expect(db.updatedValues).toEqual([
      { table: mcpTool, values: { groupId: null } },
    ]);
  });

  it("rejects a tool id that does not exist on the server", async () => {
    const db = makeDb([[serverRow], [groupRow()], [{ id: "mct_1" }]]);

    await expect(
      assignToolsToGroup(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        toolIds: ["mct_1", "mct_missing"],
        groupId: "mtg_1",
      }),
    ).rejects.toSatisfy(isAppErrorWith(APP_ERROR_CODES.MCP_TOOL_NOT_FOUND));
    expect(db.updatedValues).toEqual([]);
  });

  it("conceals a group that does not belong to the server", async () => {
    const db = makeDb([[serverRow], []]);

    await expect(
      assignToolsToGroup(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        toolIds: ["mct_1"],
        groupId: "mtg_foreign",
      }),
    ).rejects.toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND),
    );
  });

  it("rejects an empty selection before opening a transaction", async () => {
    const db = makeDb([[]]);

    await expect(
      assignToolsToGroup(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        toolIds: [],
        groupId: null,
      }),
    ).rejects.toSatisfy(isAppErrorWith(APP_ERROR_CODES.INVALID_INPUT));
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe("mcp-tool-group listToolGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps counts and orders by normalized name then id", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const db = makeDb([
      [serverRow],
      [
        {
          id: "mtg_a",
          name: "Alpha",
          normalizedName: "alpha",
          toolCount: 2,
          createdAt,
          updatedAt: createdAt,
        },
        {
          id: "mtg_b",
          name: "Beta",
          normalizedName: "beta",
          toolCount: 0,
          createdAt,
          updatedAt: createdAt,
        },
      ],
    ]);

    const groups = await listToolGroups(db as never, "user-a", "mcs_1");

    expect(groups).toEqual([
      {
        id: "mtg_a",
        name: "Alpha",
        normalizedName: "alpha",
        toolCount: 2,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "mtg_b",
        name: "Beta",
        normalizedName: "beta",
        toolCount: 0,
        createdAt,
        updatedAt: createdAt,
      },
    ]);
    expect(drizzle.count).toHaveBeenCalledWith(mcpTool.id);
    expect(drizzle.asc.mock.calls[0][0]).toBe(
      tables.mcpToolGroup.normalizedName,
    );
    expect(drizzle.asc.mock.calls[1][0]).toBe(tables.mcpToolGroup.id);
  });

  it("conceals another user's server as not found", async () => {
    const db = makeDb([[]]);

    await expect(
      listToolGroups(db as never, "user-b", "mcs_a"),
    ).rejects.toSatisfy(isAppErrorWith(APP_ERROR_CODES.MCP_SERVER_NOT_FOUND));
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});
