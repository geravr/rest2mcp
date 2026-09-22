import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "../lib/app-error.js";
import { decryptCredential, encryptCredential } from "../lib/mcp-crypto.js";
import { getMcpMaxToolsPerServer } from "../lib/mcp-limits.js";

/** The deployment's effective cap, so boundary fixtures track configuration. */
const toolLimit = getMcpMaxToolsPerServer();

afterEach(() => {
  vi.unstubAllEnvs();
});

const tables = vi.hoisted(() => ({
  mcpServer: {
    id: "mcp_server.id",
    userId: "mcp_server.user_id",
    name: "mcp_server.name",
    slug: "mcp_server.slug",
    createdAt: "mcp_server.created_at",
    status: "mcp_server.status",
  },
  mcpTool: {
    id: "mcp_tool.id",
    serverId: "mcp_tool.server_id",
    name: "mcp_tool.name",
    enabled: "mcp_tool.enabled",
    createdAt: "mcp_tool.created_at",
  },
  mcpToolGroup: {
    id: "mcp_tool_group.id",
    serverId: "mcp_tool_group.server_id",
  },
  mcpServerVariable: {
    id: "mcp_server_variable.id",
    serverId: "mcp_server_variable.server_id",
    name: "mcp_server_variable.name",
    kind: "mcp_server_variable.kind",
    owner: "mcp_server_variable.owner",
    createdAt: "mcp_server_variable.created_at",
  },
  mcpAgentToken: {
    id: "mcp_agent_token.id",
    userId: "mcp_agent_token.user_id",
    serverId: "mcp_agent_token.server_id",
    kind: "mcp_agent_token.kind",
    tokenHash: "mcp_agent_token.token_hash",
    revokedAt: "mcp_agent_token.revoked_at",
    createdAt: "mcp_agent_token.created_at",
  },
  mcpCallLog: {
    id: "mcp_call_log.id",
    serverId: "mcp_call_log.server_id",
    source: "mcp_call_log.source",
    status: "mcp_call_log.status",
    createdAt: "mcp_call_log.created_at",
  },
  user: {
    id: "user.id",
  },
}));

const isUserBanned = vi.hoisted(() => vi.fn(async () => false));
const assertUpstreamUrlSafe = vi.hoisted(() =>
  vi.fn(async (rawUrl: string) => new URL(rawUrl)),
);

vi.mock("@repo/db", () => tables);
vi.mock("../lib/user-access.js", () => ({ isUserBanned }));
vi.mock("../lib/mcp-ssrf.js", () => ({
  assertUpstreamUrlSafe,
  assertSameHostRedirect: vi.fn((_from: URL, location: string) => {
    void _from;
    return new URL(location);
  }),
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: "and", args })),
  count: vi.fn(() => ({ kind: "count" })),
  desc: vi.fn((value: unknown) => ({ kind: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({
    kind: "inArray",
    left,
    right,
  })),
  isNull: vi.fn((value: unknown) => ({ kind: "isNull", value })),
  gt: vi.fn((left: unknown, right: unknown) => ({ kind: "gt", left, right })),
  lt: vi.fn((left: unknown, right: unknown) => ({ kind: "lt", left, right })),
  isNotNull: vi.fn((value: unknown) => ({ kind: "isNotNull", value })),
  or: vi.fn((...args: unknown[]) => ({ kind: "or", args })),
}));

import {
  mcpAgentToken,
  mcpCallLog,
  mcpServer,
  mcpServerVariable,
  mcpTool,
} from "@repo/db";
import { appError } from "../lib/app-error.js";
import {
  createServer,
  createTool,
  confirmCurlImport,
  createVariable,
  deleteServer,
  deleteTools,
  deleteVariable,
  deriveTrafficLight,
  duplicateTool,
  getServer,
  listCallLogs,
  listServers,
  listVariables,
  mutationDefaults,
  previewCurlImport,
  setServerAuth,
  setVariable,
  testConnection,
  toRecipeTemplate,
  updateServer,
  updateServerCommon,
  updateTool,
  updateVariable,
} from "./mcp-studio-service.js";

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

function makeDb(results: unknown[]) {
  let index = 0;
  const insertedValues: unknown[] = [];
  const updatedValues: unknown[] = [];
  const take = () => {
    const value = results[index] ?? [];
    index += 1;
    return makeChain(value);
  };
  const db = {
    select: vi.fn(() => take()),
    insert: vi.fn(() => ({
      values: (payload: unknown) => {
        insertedValues.push(payload);
        return take();
      },
    })),
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        const isBoundaryRevision =
          payload && typeof payload === "object" && "configRevision" in payload;
        if (!isBoundaryRevision) {
          updatedValues.push(payload);
        }
        const chain = isBoundaryRevision
          ? makeChain([{ configRevision: payload.configRevision }])
          : take();
        return {
          where: () => chain,
          returning: () => chain,
        };
      },
    })),
    delete: vi.fn((table: unknown) => {
      void table;
      return take();
    }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    insertedValues,
    updatedValues,
  };
  return db;
}

const simpleTypedDefinition = {
  version: 2 as const,
  pathSegments: [
    { id: "path_1", value: { kind: "literal" as const, value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" as const },
  agentInputs: [],
};

/** Drops the compile timestamp so two compiles of one definition compare equal. */
function withoutPlanTimestamp(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const plan = fields.compiledPlan;
  if (!plan || typeof plan !== "object") return fields;
  const entries = Object.entries(plan as Record<string, unknown>).filter(
    ([key]) => key !== "compiledAt",
  );
  return { ...fields, compiledPlan: Object.fromEntries(entries) };
}

describe("mcp-studio helpers", () => {
  it("derives traffic-light states", () => {
    expect(
      deriveTrafficLight({
        status: "paused",
        publishedRevisionId: "msr_1",
        recentCallStatuses: ["success"],
      }),
    ).toBe("paused");
    expect(
      deriveTrafficLight({
        status: "live",
        publishedRevisionId: null,
        recentCallStatuses: [],
      }),
    ).toBe("draft");
    expect(
      deriveTrafficLight({
        status: "live",
        publishedRevisionId: "msr_1",
        recentCallStatuses: [],
      }),
    ).toBe("green");
    expect(
      deriveTrafficLight({
        status: "live",
        publishedRevisionId: "msr_1",
        recentCallStatuses: ["error", "success"],
      }),
    ).toBe("yellow");
    expect(
      deriveTrafficLight({
        status: "live",
        publishedRevisionId: "msr_1",
        recentCallStatuses: ["error", "error", "error", "error", "error"],
      }),
    ).toBe("red");
  });

  it("keeps mutations disabled until allowed", () => {
    expect(mutationDefaults("DELETE")).toEqual({
      allowMutation: false,
      enabled: false,
    });
    expect(mutationDefaults("GET")).toEqual({
      allowMutation: false,
      enabled: true,
    });
    expect(mutationDefaults("POST", true)).toEqual({
      allowMutation: true,
      enabled: true,
    });
  });

  it("recipe template carries canonical entries without secret material", () => {
    const recipe = toRecipeTemplate({
      name: "CRM",
      description: null,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      commonEntries: {
        headers: [
          {
            id: "hdr_1",
            name: "Version",
            value: { kind: "literal", value: "2024-01" },
          },
        ],
        query: [],
      },
      authConfiguration: {
        kind: "bearer",
        bindings: [
          {
            location: "header",
            key: "Authorization",
            serverValueId: "msv_1",
          },
        ],
      },
      tools: [],
      variables: [{ name: "api_token", kind: "secret", owner: "auth" }],
    });
    const serialized = JSON.stringify(recipe);
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("sk_live");
    expect(recipe.variables).toEqual([
      { name: "api_token", kind: "secret", owner: "auth" },
    ]);
    expect(recipe.commonEntries.headers[0]).toMatchObject({
      name: "Version",
    });
    expect(recipe.authConfiguration?.kind).toBe("bearer");
  });
});

describe("mcp-studio ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isUserBanned.mockResolvedValue(false);
  });

  it("hides another user's server as not found", async () => {
    const db = makeDb([[]]);
    await expect(getServer(db as never, "user-b", "mcs_a")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
  });

  it("rejects adding a tool to another user's server", async () => {
    const db = makeDb([[]]);
    await expect(
      createTool(db as never, "user-b", "mcs_a", {
        expectedRevision: 1,
        name: "get_contact",
        method: "GET",
        requestDefinition: simpleTypedDefinition,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects reading another user's call logs as not found", async () => {
    const db = makeDb([[]]);
    await expect(
      listCallLogs(db as never, "user-b", "mcs_a", { page: 1, pageSize: 10 }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
  });

  it("rejects listing variables for another user's server", async () => {
    const db = makeDb([[]]);
    await expect(
      listVariables(db as never, "user-b", "mcs_a"),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
  });

  it("lists only the caller's servers", async () => {
    const db = makeDb([
      [
        {
          configRevision: 1,
          id: "mcs_1",
          userId: "user-a",
          name: "A1",
          status: "draft",
          allowedHosts: [],
        },
        {
          id: "mcs_2",
          userId: "user-a",
          name: "A2",
          status: "draft",
          allowedHosts: [],
        },
      ],
      [{ count: 2 }],
      [{ count: 0 }],
      [],
      [],
      [],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    const page = await listServers(db as never, "user-a", {
      page: 1,
      pageSize: 10,
    });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
  });

  it("enriches list items with enabled tool count and last call timestamp", async () => {
    const lastCall = new Date("2026-09-11T10:00:00Z");
    const db = makeDb([
      [
        {
          configRevision: 1,
          id: "mcs_1",
          userId: "user-a",
          name: "A1",
          status: "live",
          publishedRevisionId: "msr_1",
          allowedHosts: [],
        },
      ],
      [{ count: 1 }],
      [{ count: 3 }],
      [{ status: "success" }],
      [],
      [{ createdAt: lastCall }],
    ]);

    const page = await listServers(db as never, "user-a", {
      page: 1,
      pageSize: 10,
    });

    expect(page.items[0]).toMatchObject({
      enabledToolCount: 3,
      lastCallAt: lastCall,
      trafficLight: "green",
    });
  });

  it("maps unique slug violations to MCP_SERVER_SLUG_CONFLICT", async () => {
    const db = {
      insert: vi.fn(() => ({
        values: () => ({
          returning: async () => {
            throw { code: "23505" };
          },
        }),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
    };

    await expect(
      createServer(db as never, "user-a", {
        name: "CRM",
        baseUrl: "https://api.example.com",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_SLUG_CONFLICT,
    );
  });
});

describe("mcp-studio servers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves the baseUrl path prefix on create", async () => {
    const db = makeDb([
      [
        {
          configRevision: 1,
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          allowedHosts: ["api.example.com"],
        },
      ],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    await createServer(db as never, "user-a", {
      name: "CRM",
      baseUrl: "https://api.example.com/v2?ignored=1#frag",
    });

    expect(db.insertedValues[0]).toMatchObject({
      baseUrl: "https://api.example.com/v2",
      allowedHosts: ["api.example.com"],
    });
  });

  it("creates a server with bearer auth as a secret variable", async () => {
    const secret = "s".repeat(32);
    const created = {
      configRevision: 1,
      id: "mcs_1",
      userId: "user-a",
      name: "CRM",
      status: "draft",
      allowedHosts: ["api.example.com"],
      commonEntries: null,
      authConfiguration: null,
    };
    const withAuth = {
      ...created,
      commonEntries: {
        headers: [],
        query: [],
      },
      authConfiguration: {
        kind: "bearer",
        bindings: [
          {
            location: "header",
            key: "Authorization",
            serverValueId: "msv_1",
            prefix: "Bearer ",
          },
        ],
      },
    };
    const db = makeDb([
      [created],
      [],
      [{ id: "msv_1", name: "api_token" }],
      [withAuth],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    const result = await createServer(
      db as never,
      "user-a",
      {
        name: "CRM",
        baseUrl: "https://api.example.com",
        auth: { type: "bearer", token: "sk_live_123" },
      },
      secret,
    );

    expect(result.authConfiguration).toEqual(withAuth.authConfiguration);
    expect(JSON.stringify(db.insertedValues)).not.toContain("sk_live_123");
    const variableInsert = db.insertedValues.find(
      (row) =>
        row &&
        typeof row === "object" &&
        "name" in row &&
        (row as { name: string }).name === "api_token",
    ) as { ciphertext: string; kind: string };
    expect(variableInsert.kind).toBe("secret");
    expect(decryptCredential(variableInsert.ciphertext, secret)).toBe(
      "sk_live_123",
    );
  });

  it("creates a server with none auth and no secret variable", async () => {
    const db = makeDb([
      [
        {
          configRevision: 1,
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          allowedHosts: ["api.example.com"],
        },
      ],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    await createServer(db as never, "user-a", {
      name: "CRM",
      baseUrl: "https://api.example.com",
      auth: { type: "none" },
    });

    expect(db.insertedValues).toHaveLength(1);
    expect(db.updatedValues).toHaveLength(0);
  });

  it("rejects empty bearer token on create before writing", async () => {
    const db = makeDb([]);

    await expect(
      createServer(
        db as never,
        "user-a",
        {
          name: "CRM",
          baseUrl: "https://api.example.com",
          auth: { type: "bearer", token: "   " },
        },
        "s".repeat(32),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT,
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("switches bearer to header without dropping unrelated Version", async () => {
    const secret = "s".repeat(32);
    const server = {
      configRevision: 1,
      id: "mcs_1",
      userId: "user-a",
      name: "CRM",
      status: "draft",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      commonEntries: {
        headers: [
          {
            id: "h_version",
            name: "Version",
            value: { kind: "literal", value: "2024-01" },
          },
          {
            id: "h_auth",
            name: "Authorization",
            value: {
              kind: "serverValue",
              serverValueId: "msv_1",
              prefix: "Bearer ",
            },
          },
        ],
        query: [],
      },
      authConfiguration: {
        kind: "bearer",
        bindings: [
          {
            location: "header",
            key: "Authorization",
            serverValueId: "msv_1",
            prefix: "Bearer ",
          },
        ],
      },
    };
    const updated = {
      ...server,
      commonEntries: {
        headers: [
          {
            id: "h_version",
            name: "Version",
            value: { kind: "literal", value: "2024-01" },
          },
          {
            id: "h_key",
            name: "X-API-Key",
            value: { kind: "serverValue", serverValueId: "msv_2" },
          },
        ],
        query: [],
      },
      authConfiguration: {
        kind: "header",
        bindings: [
          { location: "header", key: "X-API-Key", serverValueId: "msv_2" },
        ],
      },
    };
    const db = makeDb([
      [server],
      [{ id: "msv_1", name: "api_token", owner: null }],
      [],
      [{ id: "msv_2", name: "api_key" }],
      [updated],
      [{ id: "msv_1", name: "api_token", owner: null }],
      [],
      [],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    const result = await setServerAuth(
      db as never,
      "user-a",
      "mcs_1",

      1,
      { type: "header", headerName: "X-API-Key", value: "key_123" },
      secret,
    );

    expect(result.authConfiguration?.kind).toBe("header");
    const names = (result.commonEntries?.headers ?? []).map(
      (header) => header.name,
    );
    expect(names).toContain("Version");
    expect(names).toContain("X-API-Key");
    expect(names).not.toContain("Authorization");
    expect(db.delete).toHaveBeenCalled();
  });

  it("clears unreferenced api_token when set to none", async () => {
    const server = {
      configRevision: 1,
      id: "mcs_1",
      userId: "user-a",
      name: "CRM",
      status: "draft",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      commonEntries: {
        headers: [
          {
            id: "h_auth",
            name: "Authorization",
            value: {
              kind: "serverValue",
              serverValueId: "msv_1",
              prefix: "Bearer ",
            },
          },
        ],
        query: [],
      },
      authConfiguration: {
        kind: "bearer",
        bindings: [
          {
            location: "header",
            key: "Authorization",
            serverValueId: "msv_1",
            prefix: "Bearer ",
          },
        ],
      },
    };
    const updated = {
      ...server,
      commonEntries: { headers: [], query: [] },
      authConfiguration: null,
    };
    const db = makeDb([
      [server],
      [updated],
      [{ id: "msv_1", name: "api_token", owner: null }],
      [],
      [],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    const result = await setServerAuth(
      db as never,
      "user-a",
      "mcs_1",

      1,
      { type: "none" },
      "s".repeat(32),
    );

    expect(result.authConfiguration).toBeNull();
    expect(db.delete).toHaveBeenCalled();
  });

  it("rejects query auth without the exposure acknowledgement", async () => {
    const db = makeDb([
      [
        {
          configRevision: 1,
          id: "mcs_1",
          userId: "user-a",
          status: "draft",
          baseUrl: "https://api.example.com",
        },
      ],
    ]);

    await expect(
      setServerAuth(
        db as never,
        "user-a",
        "mcs_1",

        1,
        { type: "query", paramName: "api_key", value: "secret" },
        "s".repeat(32),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_AUTH_ACK_REQUIRED,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("never reuses or overwrites a manual value with a colliding name", async () => {
    const server = {
      configRevision: 1,
      id: "mcs_1",
      userId: "user-a",
      status: "draft",
      baseUrl: "https://api.example.com",
      authConfiguration: null,
    };
    const updated = {
      ...server,
      authConfiguration: {
        kind: "bearer",
        bindings: [
          {
            location: "header",
            key: "Authorization",
            serverValueId: "msv_new",
          },
        ],
      },
    };
    const db = makeDb([
      [server], // requireOwnedServer
      // legacyPreviousName is null (no prior auth), so no previous-row lookup
      [{ id: "msv_manual", name: "api_token", owner: "manual" }], // pickAuthOwnedVariableName attempt 1: "api_token" is manual
      [], // pickAuthOwnedVariableName attempt 2: "api_token_auth" is free
      [{ id: "msv_new", name: "api_token_auth" }], // insert distinct auth-owned row
      [updated], // update server
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    const result = await setServerAuth(
      db as never,
      "user-a",
      "mcs_1",

      1,
      { type: "bearer", token: "sk_live_123" },
      "s".repeat(32),
    );

    expect(result.authConfiguration?.bindings[0]?.serverValueId).toBe(
      "msv_new",
    );
    // The manual "api_token" row is never targeted by update or delete.
    expect(
      db.updatedValues.some(
        (value) =>
          value &&
          typeof value === "object" &&
          "name" in value &&
          (value as { name: string }).name === "api_token",
      ),
    ).toBe(false);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("preserves the baseUrl path prefix on update", async () => {
    const db = makeDb([
      [
        {
          configRevision: 1,
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
        },
      ],
      [{ configRevision: 1, id: "mcs_1" }],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    await updateServer(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      baseUrl: "https://api.example.com/v3/",
    });

    expect(db.updatedValues[0]).toMatchObject({
      baseUrl: "https://api.example.com/v3",
    });
  });
});

describe("mcp-studio tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults GET tools to enabled without mutation", async () => {
    const db = makeDb([
      [
        {
          configRevision: 1,
          id: "mcs_1",
          status: "live",
          baseUrl: "https://api.example.com",
        },
      ],
      [{ count: 0 }],
      [], // listVariableNames
      [], // loadCompileServerValueRefs
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    await createTool(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      name: "get_contact",
      title: "Get contact",
      description: "Fetch one contact.",
      method: "GET",
      requestDefinition: simpleTypedDefinition,
    });

    expect(db.insertedValues[0]).toMatchObject({
      method: "GET",
      allowMutation: false,
      enabled: true,
      compileStatus: "valid",
      requestDefinition: expect.objectContaining({ version: 2 }),
    });
  });

  it("maps duplicate tool names to MCP_TOOL_NAME_CONFLICT", async () => {
    const selectResults = [
      [
        {
          configRevision: 1,
          id: "mcs_1",
          status: "live",
          baseUrl: "https://api.example.com",
        },
      ],
      [{ count: 0 }],
      [],
      [],
    ];
    let selectIndex = 0;
    const db = {
      select: vi.fn(() => makeChain(selectResults[selectIndex++] ?? [])),
      insert: vi.fn(() => ({
        values: () => ({
          returning: async () => {
            throw { code: "23505" };
          },
        }),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
    };

    await expect(
      createTool(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        name: "get_contact",
        title: "Get contact",
        description: "Fetch one contact.",
        method: "GET",
        requestDefinition: simpleTypedDefinition,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
    );
  });
});

describe("mcp-studio typed tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const serverRow = {
    configRevision: 1,
    id: "mcs_1",
    status: "live",
    baseUrl: "https://api.example.com",
    commonEntries: null,
    authConfiguration: null,
  };

  const typedDefinition = {
    version: 2 as const,
    pathSegments: [
      { id: "path_1", value: { kind: "literal" as const, value: "/contacts" } },
      {
        id: "path_2",
        value: { kind: "agentInput" as const, agentInputId: "ain_1" },
      },
    ],
    query: [],
    headers: [],
    body: { bodyType: "none" as const },
    agentInputs: [
      {
        id: "ain_1",
        name: "id",
        description: "Contact id.",
        required: true,
        sensitive: false,
        type: "string" as const,
      },
    ],
  };

  it("persists a typed definition and its compiled plan without inference", async () => {
    const db = makeDb([
      [serverRow],
      [{ count: 0 }],
      [], // server values
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    await createTool(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      name: "get_contact",
      title: "Get contact",
      description: "Fetch one contact.",
      method: "GET",
      requestDefinition: typedDefinition,
    });

    expect(db.insertedValues[0]).toMatchObject({
      method: "GET",
      compileStatus: "valid",
      enabled: true,
      requestDefinition: expect.objectContaining({ version: 2 }),
    });
    expect(
      (db.insertedValues[0] as { compiledPlan?: unknown }).compiledPlan,
    ).toBeTruthy();
  });

  it("updates a typed tool without re-inferring its definition", async () => {
    const db = makeDb([
      [serverRow],
      [
        {
          id: "mct_1",
          serverId: "mcs_1",
          name: "get_contact",
          description: null,
          method: "GET",
          requestDefinition: typedDefinition,
          compiledPlan: null,
          compileStatus: "valid",
          compileIssues: [],
          annotations: null,
          allowMutation: false,
          enabled: true,
        },
      ],
      [], // server values
      [{ id: "mct_1", name: "renamed" }],
    ]);

    await updateTool(db as never, "user-a", "mcs_1", "mct_1", {
      expectedRevision: 1,
      name: "renamed",
      title: "Get contact",
      description: "Fetch one contact.",
    });

    const updated = db.updatedValues[0] as {
      name: string;
      requestDefinition?: {
        pathSegments: Array<{ id: string }>;
        agentInputs: Array<{ id: string }>;
      };
      compileStatus: string;
    };
    expect(updated.name).toBe("renamed");
    expect(updated.requestDefinition?.pathSegments[1]?.id).toBe("path_2");
    expect(updated.requestDefinition?.agentInputs[0]?.id).toBe("ain_1");
    expect(updated.compileStatus).toBe("valid");
  });

  it("rejects a plaintext auth header embedded literally in a typed definition", async () => {
    const db = makeDb([[serverRow], [{ count: 0 }], []]);

    await expect(
      createTool(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        name: "secure_get",
        method: "GET",
        enabled: true,
        requestDefinition: {
          ...typedDefinition,
          headers: [
            {
              id: "hdr_1",
              name: "Authorization",
              value: { kind: "literal", value: "Bearer sk_live_123" },
            },
          ],
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("stores common entries without disturbing auth configuration", async () => {
    const db = makeDb([
      [
        {
          ...serverRow,
          authConfiguration: {
            kind: "bearer",
            bindings: [
              {
                location: "header",
                key: "Authorization",
                serverValueId: "msv_auth",
              },
            ],
          },
        },
      ],
      [
        { id: "msv_1", name: "api_version", kind: "config", owner: "manual" },
        { id: "msv_auth", name: "api_token", kind: "secret", owner: "auth" },
      ],
      [],
    ]);

    await updateServerCommon(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      common: {
        headers: [
          {
            id: "hdr_1",
            name: "Version",
            value: { kind: "serverValue", serverValueId: "msv_1" },
          },
        ],
        query: [],
      },
    });

    expect(db.updatedValues[0]).toMatchObject({
      commonEntries: {
        headers: [
          {
            id: "hdr_1",
            name: "Version",
            value: { kind: "serverValue", serverValueId: "msv_1" },
          },
        ],
        query: [],
      },
    });
    expect(
      (db.updatedValues[0] as { authConfiguration?: unknown })
        .authConfiguration,
    ).toBeUndefined();
  });

  it("rejects plaintext auth headers in typed common entries without writing", async () => {
    const db = makeDb([[serverRow], []]);

    await expect(
      updateServerCommon(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        common: {
          headers: [
            {
              id: "hdr_1",
              name: "X-Api-Key",
              value: { kind: "literal", value: "sk_live_123" },
            },
          ],
          query: [],
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
    );
    expect(db.updatedValues).toHaveLength(0);
  });

  // Duplicating adds a second tool, so it needs room for two tool slots.
  it.skipIf(toolLimit < 2)(
    "duplicates a typed tool with regenerated local ids",
    async () => {
      const db = makeDb([
        [serverRow],
        [
          {
            id: "mct_1",
            name: "get_contact",
            title: "Get contact",
            description: "Fetch one contact.",
            method: "GET",
            requestDefinition: typedDefinition,
            allowMutation: false,
            enabled: true,
            source: "manual",
          },
        ],
        [{ count: 1 }],
        [], // server values
        [{ id: "mct_2", name: "get_contact_copy" }],
      ]);

      await duplicateTool(db as never, "user-a", "mcs_1", "mct_1", {
        expectedRevision: 1,
      });

      const inserted = db.insertedValues[0] as {
        requestDefinition?: {
          pathSegments: Array<{ id: string }>;
          agentInputs: Array<{ id: string }>;
        };
      };
      expect(inserted.requestDefinition?.pathSegments[0]?.id).not.toBe(
        "path_1",
      );
      expect(inserted.requestDefinition?.agentInputs[0]?.id).not.toBe("ain_1");
    },
  );

  it("writes typed common entries with stable server-value ids", async () => {
    const db = makeDb([
      [serverRow],
      [{ id: "msv_1", name: "api_version", kind: "config", owner: "manual" }],
      [], // enabled tools
    ]);

    await updateServerCommon(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      common: {
        headers: [
          {
            id: "hdr_1",
            name: "Version",
            value: { kind: "serverValue", serverValueId: "msv_1" },
          },
        ],
        query: [],
      },
    });

    expect(db.updatedValues[0]).toMatchObject({
      commonEntries: {
        headers: [
          {
            id: "hdr_1",
            name: "Version",
            value: { kind: "serverValue", serverValueId: "msv_1" },
          },
        ],
        query: [],
      },
    });
  });

  it("rejects a common entry that collides with auth-owned keys without writing", async () => {
    const db = makeDb([
      [
        {
          ...serverRow,
          authConfiguration: {
            kind: "bearer",
            bindings: [
              {
                location: "header",
                key: "Authorization",
                serverValueId: "msv_1",
              },
            ],
          },
        },
      ],
      [{ id: "msv_1", name: "api_token", kind: "secret", owner: "auth" }],
    ]);

    await expect(
      updateServerCommon(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        common: {
          headers: [
            {
              id: "hdr_1",
              name: "Authorization",
              value: { kind: "literal", value: "Bearer x" },
            },
          ],
          query: [],
        },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_COMPILE_INVALID,
    );
    expect(db.updatedValues).toHaveLength(0);
  });

  it("enforces the enabled-tool bound for common updates", async () => {
    const manyTools = Array.from({ length: toolLimit + 1 }, (_, index) => ({
      id: `mct_${index}`,
      name: `tool_${index}`,
      method: "GET",
      requestDefinition: typedDefinition,
      allowMutation: false,
      enabled: true,
    }));
    const db = makeDb([[serverRow], [], manyTools]);

    await expect(
      updateServerCommon(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        common: { headers: [], query: [] },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT,
    );
    expect(db.updatedValues).toHaveLength(0);
  });

  it("reads the enabled-tool bound from the configured cap", async () => {
    vi.stubEnv("MCP_MAX_TOOLS_PER_SERVER", "3");
    const overCap = Array.from({ length: 4 }, (_, index) => ({
      id: `mct_${index}`,
      name: `tool_${index}`,
      method: "GET",
      requestDefinition: typedDefinition,
      allowMutation: false,
      enabled: true,
    }));
    const db = makeDb([[serverRow], [], overCap]);

    await expect(
      updateServerCommon(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        common: { headers: [], query: [] },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT &&
        error.message.includes("more than 3 enabled tools"),
    );
    expect(db.updatedValues).toHaveLength(0);
  });
});

describe("mcp-studio tool group placement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const serverRow = {
    configRevision: 1,
    id: "mcs_1",
    userId: "user-a",
    status: "live",
    baseUrl: "https://api.example.com",
    commonEntries: null,
    authConfiguration: null,
  };

  const storedTool = {
    id: "mct_1",
    serverId: "mcs_1",
    name: "get_contact",
    title: "Get contact",
    description: "Fetch one contact.",
    method: "GET",
    requestDefinition: simpleTypedDefinition,
    compiledPlan: null,
    compileStatus: "valid",
    compileIssues: [],
    annotations: null,
    allowMutation: false,
    enabled: true,
    groupId: "mtg_old",
  };

  it("persists a same-server group on manual create", async () => {
    const db = makeDb([
      [serverRow],
      [{ count: 0 }],
      [{ id: "mtg_1" }],
      [], // server values
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    await createTool(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      name: "get_contact",
      title: "Get contact",
      description: "Fetch one contact.",
      method: "GET",
      requestDefinition: simpleTypedDefinition,
      groupId: "mtg_1",
    });

    expect(db.insertedValues).toHaveLength(1);
    expect(db.insertedValues[0]).toMatchObject({ groupId: "mtg_1" });
  });

  it("creates no tool for a foreign or unknown group on manual create", async () => {
    const db = makeDb([[serverRow], [{ count: 0 }], []]);

    await expect(
      createTool(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        name: "get_contact",
        method: "GET",
        requestDefinition: simpleTypedDefinition,
        groupId: "mtg_foreign",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("leaves the stored assignment untouched when the group key is absent", async () => {
    const db = makeDb([
      [serverRow],
      [storedTool],
      [], // server values
      [{ id: "mct_1" }],
    ]);

    await updateTool(db as never, "user-a", "mcs_1", "mct_1", {
      expectedRevision: 1,
      title: "Get a contact",
    });

    const updated = db.updatedValues[0] as Record<string, unknown>;
    expect(updated).not.toHaveProperty("groupId");
    expect(updated).toMatchObject({
      name: "get_contact",
      title: "Get a contact",
      method: "GET",
      enabled: true,
      allowMutation: false,
    });
  });

  it("ungroups when groupId is null", async () => {
    const db = makeDb([
      [serverRow],
      [storedTool],
      [], // server values
      [{ id: "mct_1" }],
    ]);

    await updateTool(db as never, "user-a", "mcs_1", "mct_1", {
      expectedRevision: 1,
      groupId: null,
    });

    expect(db.updatedValues[0]).toHaveProperty("groupId", null);
  });

  it("moves the tool when a valid group is supplied", async () => {
    const db = makeDb([
      [serverRow],
      [storedTool],
      [{ id: "mtg_new" }],
      [], // server values
      [{ id: "mct_1" }],
    ]);

    await updateTool(db as never, "user-a", "mcs_1", "mct_1", {
      expectedRevision: 1,
      groupId: "mtg_new",
    });

    expect(db.updatedValues[0]).toHaveProperty("groupId", "mtg_new");
  });

  it("rejects a foreign group on update without changing the tool", async () => {
    const db = makeDb([[serverRow], [storedTool], []]);

    await expect(
      updateTool(db as never, "user-a", "mcs_1", "mct_1", {
        expectedRevision: 1,
        groupId: "mtg_foreign",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
    );
    expect(db.updatedValues).toHaveLength(0);
  });

  // Duplicating adds a second tool, so it needs room for two tool slots.
  it.skipIf(toolLimit < 2)(
    "copies the source group onto a duplicate only while it still exists",
    async () => {
      const withGroup = makeDb([
        [serverRow],
        [storedTool],
        [{ count: 1 }],
        [{ id: "mtg_old" }],
        [], // server values
        [{ id: "mct_2", name: "get_contact_copy" }],
      ]);
      await duplicateTool(withGroup as never, "user-a", "mcs_1", "mct_1", {
        expectedRevision: 1,
      });
      expect(withGroup.insertedValues[0]).toMatchObject({ groupId: "mtg_old" });

      const withoutGroup = makeDb([
        [serverRow],
        [storedTool],
        [{ count: 1 }],
        [], // the source group no longer exists
        [], // server values
        [{ id: "mct_3", name: "get_contact_copy" }],
      ]);
      await duplicateTool(withoutGroup as never, "user-a", "mcs_1", "mct_1", {
        expectedRevision: 1,
      });
      expect(withoutGroup.insertedValues[0]).toMatchObject({ groupId: null });
    },
  );

  it("changes only the assignment for a group-only edit", async () => {
    const untouched = makeDb([
      [serverRow],
      [storedTool],
      [], // server values
      [{ id: "mct_1" }],
    ]);
    await updateTool(untouched as never, "user-a", "mcs_1", "mct_1", {
      expectedRevision: 1,
    });

    const moved = makeDb([
      [serverRow],
      [storedTool],
      [{ id: "mtg_new" }],
      [], // server values
      [{ id: "mct_1" }],
    ]);
    await updateTool(moved as never, "user-a", "mcs_1", "mct_1", {
      expectedRevision: 1,
      groupId: "mtg_new",
    });

    const { groupId: untouchedGroupId, ...untouchedFields } = untouched
      .updatedValues[0] as Record<string, unknown>;
    const { groupId: movedGroupId, ...movedFields } = moved
      .updatedValues[0] as Record<string, unknown>;

    expect(untouchedGroupId).toBeUndefined();
    expect(movedGroupId).toBe("mtg_new");
    // The compiled plan timestamp is the only volatile field.
    expect(withoutPlanTimestamp(movedFields)).toEqual(
      withoutPlanTimestamp(untouchedFields),
    );
    expect(movedFields).toMatchObject({
      name: "get_contact",
      title: "Get contact",
      description: "Fetch one contact.",
      method: "GET",
      enabled: true,
      allowMutation: false,
      compileStatus: "valid",
    });
    expect(movedFields.requestDefinition).toEqual(simpleTypedDefinition);
    expect(movedFields.compiledPlan).toBeTruthy();
  });
});

describe("mcp-studio safe curl import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const server = {
    configRevision: 1,
    id: "mcs_1",
    userId: "user-a",
    status: "live",
    baseUrl: "https://api.example.com",
    authConfiguration: null,
    commonEntries: null,
  };

  it("imports curl as exactly one disabled draft tool and excludes the credential", async () => {
    const db = makeDb([
      [server], // requireOwnedServer
      [], // loadCompileServerValueRefs: no existing variables
      [{ count: 0 }], // assertToolCapacity
      [
        {
          id: "mct_1",
          name: "get_contacts",
          enabled: false,
          source: "curl",
        },
      ], // insert tool
    ]);

    const result = await confirmCurlImport(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      curl: `curl -H 'Authorization: Bearer super-secret' https://api.example.com/contacts`,
    });

    expect(result.enabled).toBe(false);
    expect(result.excludedCredentials).toEqual([
      { kind: "bearer", headerName: "Authorization" },
    ]);
    expect(db.insertedValues).toHaveLength(1);
    expect(db.updatedValues).toHaveLength(0);
    expect(db.delete).not.toHaveBeenCalled();
    expect(JSON.stringify(db.insertedValues)).not.toContain("super-secret");
    expect(JSON.stringify(db.insertedValues)).not.toContain("Authorization");
  });

  it("reads the tool capacity bound from the configured cap", async () => {
    vi.stubEnv("MCP_MAX_TOOLS_PER_SERVER", "3");
    const db = makeDb([
      [server], // requireOwnedServer
      [], // loadCompileServerValueRefs: no existing variables
      [{ count: 3 }], // assertToolCapacity: the server sits at the configured cap
    ]);

    await expect(
      confirmCurlImport(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        curl: `curl https://api.example.com/contacts`,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT &&
        error.message.includes("more than 3 tools"),
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("leaves existing authentication byte-for-byte unchanged when curl carries a different credential", async () => {
    const authedServer = {
      ...server,
      authConfiguration: {
        kind: "bearer",
        bindings: [
          { location: "header", key: "Authorization", serverValueId: "msv_1" },
        ],
      },
    };
    const db = makeDb([
      [authedServer],
      [
        {
          id: "msv_1",
          name: "api_token",
          kind: "secret",
          owner: "auth",
        },
      ],
      [{ count: 0 }],
      [{ id: "mct_1", name: "get_contacts", enabled: false }],
    ]);

    await confirmCurlImport(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      curl: `curl -H 'Authorization: Bearer other-secret' https://api.example.com/contacts`,
    });

    expect(db.updatedValues).toHaveLength(0);
    expect(db.delete).not.toHaveBeenCalled();
    expect(JSON.stringify(db.insertedValues)).not.toContain("other-secret");
  });

  it("Platform curl import rejects a credential-bearing command entirely", async () => {
    const db = makeDb([[server]]);

    await expect(
      confirmCurlImport(
        db as never,
        "user-a",
        "mcs_1",
        {
          expectedRevision: 1,
          curl: `curl -H 'Authorization: Bearer super-secret' https://api.example.com/contacts`,
        },
        { rejectCredentials: true },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects a curl target outside the server base path without writing", async () => {
    const db = makeDb([[server], []]);

    await expect(
      confirmCurlImport(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        curl: `curl https://evil.example.com/contacts`,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_CURL_INVALID,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("imports into an existing group as exactly one disabled curl draft", async () => {
    const db = makeDb([
      [server],
      [], // loadCompileServerValueRefs: no existing variables
      [{ count: 0 }], // assertToolCapacity
      [{ id: "mtg_1" }], // group placement
      [{ id: "mct_1", name: "get_contacts", enabled: false, source: "curl" }],
    ]);

    const result = await confirmCurlImport(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      curl: `curl -H 'Authorization: Bearer super-secret' https://api.example.com/contacts`,
      groupId: "mtg_1",
    });

    expect(db.insertedValues).toHaveLength(1);
    expect(db.insertedValues[0]).toMatchObject({
      groupId: "mtg_1",
      enabled: false,
      allowMutation: false,
      source: "curl",
    });
    expect(result.enabled).toBe(false);
    expect(result.excludedCredentials).toEqual([
      { kind: "bearer", headerName: "Authorization" },
    ]);
    expect(db.updatedValues).toHaveLength(0);
    expect(db.delete).not.toHaveBeenCalled();
    expect(JSON.stringify(db.insertedValues)).not.toContain("super-secret");
  });

  it("creates nothing when the curl import targets a foreign group", async () => {
    const db = makeDb([[server], [], [{ count: 0 }], []]);

    await expect(
      confirmCurlImport(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        curl: `curl https://api.example.com/contacts`,
        groupId: "mtg_foreign",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
    );
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.updatedValues).toHaveLength(0);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("resolves a serverValue marking to an existing value without creating one", async () => {
    const db = makeDb([
      [server],
      [
        {
          id: "msv_1",
          name: "api_version",
          kind: "config",
          owner: "manual",
        },
      ],
      [{ count: 0 }],
      [{ id: "mct_1", name: "get_items", enabled: false }],
    ]);

    await confirmCurlImport(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      curl: `curl -H 'X-Api-Version: v2' https://api.example.com/items`,
      markings: [
        {
          location: "header",
          key: "X-Api-Version",
          occurrenceId: "header:x-api-version:0",
          as: "serverValue",
          name: "api_version",
        },
      ],
    });

    // Only the tool row is written — no new or updated server value.
    expect(db.insertedValues).toHaveLength(1);
    expect(db.updatedValues).toHaveLength(0);
  });

  it("turns a marked occurrence into a declared agent input", async () => {
    const db = makeDb([
      [server],
      [],
      [{ count: 0 }],
      [{ id: "mct_1", name: "get_items", enabled: false }],
    ]);

    await confirmCurlImport(db as never, "user-a", "mcs_1", {
      expectedRevision: 1,
      curl: `curl 'https://api.example.com/v1/items?locationId=loc_9'`,
      markings: [
        {
          location: "query",
          key: "locationId",
          occurrenceId: "query:locationId:0",
          as: "agentInput",
          agentInput: {
            id: "location_id",
            name: "location_id",
            required: true,
            sensitive: false,
            type: "string",
          },
        },
      ],
    });

    expect(db.insertedValues).toHaveLength(1);
    const toolInsert = db.insertedValues[0] as Record<string, unknown>;
    expect(toolInsert.requestDefinition).toMatchObject({
      query: [
        {
          name: "locationId",
          value: { kind: "agentInput", agentInputId: "location_id" },
        },
      ],
    });
  });

  it("maps duplicate tool names to MCP_TOOL_NAME_CONFLICT", async () => {
    const selectResults = [[server], [], [{ count: 0 }]];
    let selectIndex = 0;
    const db = {
      select: vi.fn(() => makeChain(selectResults[selectIndex++] ?? [])),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
      insert: vi.fn(() => ({
        values: () => ({
          returning: async () => {
            throw { code: "23505" };
          },
        }),
      })),
    };

    await expect(
      confirmCurlImport(db as never, "user-a", "mcs_1", {
        expectedRevision: 1,
        curl: `curl https://api.example.com/items`,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
    );
  });
});

describe("mcp-studio variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores secret variables encrypted without echoing the value", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [
        {
          id: "msv_1",
          name: "api_token",
          kind: "secret",
          value: null,
          ciphertext: "iv.tag.data",
        },
      ],
    ]);

    const result = await createVariable(
      db as never,
      "user-a",
      "mcs_1",
      {
        expectedRevision: 1,
        name: "api_token",
        kind: "secret",
        value: "sk_live_123",
      },
      "s".repeat(32),
    );

    expect(result).toMatchObject({
      name: "api_token",
      kind: "secret",
      hasValue: true,
    });
    expect(JSON.stringify(result)).not.toContain("sk_live_123");
    expect(JSON.stringify(db.insertedValues)).not.toContain("sk_live_123");
    expect(db.insertedValues[0]).toMatchObject({ value: null });
  });

  it("stores plain variables in readable plaintext", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [
        {
          id: "msv_1",
          name: "location_id",
          kind: "config",
          value: "loc_9",
          ciphertext: null,
        },
      ],
    ]);

    const result = await createVariable(
      db as never,
      "user-a",
      "mcs_1",
      {
        expectedRevision: 1,
        name: "location_id",
        kind: "config",
        value: "loc_9",
      },
      "s".repeat(32),
    );

    expect(result).toMatchObject({
      name: "location_id",
      kind: "config",
      value: "loc_9",
    });
  });

  it("rejects invalid variable names", async () => {
    const db = makeDb([[{ configRevision: 1, id: "mcs_1" }]]);

    await expect(
      createVariable(
        db as never,
        "user-a",
        "mcs_1",
        { expectedRevision: 1, name: "1Bad-Name", kind: "config", value: "x" },
        "s".repeat(32),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("maps duplicate names to MCP_VARIABLE_NAME_CONFLICT", async () => {
    const db = {
      select: vi.fn(() => makeChain([{ configRevision: 1, id: "mcs_1" }])),
      insert: vi.fn(() => ({
        values: () => ({
          returning: async () => {
            throw { code: "23505" };
          },
        }),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
    };

    await expect(
      createVariable(
        db as never,
        "user-a",
        "mcs_1",
        { expectedRevision: 1, name: "api_token", kind: "secret", value: "sk" },
        "s".repeat(32),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
    );
  });

  it("lists variables with hasValue metadata and no secret values", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [
        {
          id: "msv_1",
          name: "api_token",
          kind: "secret",
          owner: "manual",
          description: null,
          value: null,
          ciphertext: "iv.tag.data",
        },
        {
          id: "msv_2",
          name: "location_id",
          kind: "config",
          owner: "manual",
          description: null,
          value: "loc_9",
          ciphertext: null,
        },
      ],
    ]);

    const variables = await listVariables(db as never, "user-a", "mcs_1");

    expect(variables).toEqual([
      {
        id: "msv_1",
        name: "api_token",
        kind: "secret",
        owner: "manual",
        description: null,
        hasValue: true,
      },
      {
        id: "msv_2",
        name: "location_id",
        kind: "config",
        owner: "manual",
        description: null,
        hasValue: true,
        value: "loc_9",
      },
    ]);
    expect(JSON.stringify(variables)).not.toContain("iv.tag.data");
  });

  it("deletes variables by stable id", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [{ id: "msv_1", name: "api_token", kind: "config" }],
      [], // findServerValueReferences: no referencing tools
    ]);

    const result = await deleteVariable(
      db as never,
      "user-a",
      "mcs_1",
      "msv_1",
      1,
    );

    expect(result).toEqual({
      id: "msv_1",
      name: "api_token",
      deleted: true,
      revision: 2,
    });
    expect(db.delete).toHaveBeenCalled();
  });

  it("blocks deletion when a variable is still referenced by a tool", async () => {
    const db = makeDb([
      [
        {
          configRevision: 1,
          id: "mcs_1",
          authConfiguration: null,
          commonEntries: null,
        },
      ],
      [{ id: "msv_1", name: "api_token", kind: "config" }],
      [
        {
          id: "mct_1",
          name: "get_contact",
          requestDefinition: {
            version: 2,
            pathSegments: [],
            query: [],
            headers: [
              {
                id: "h1",
                name: "Authorization",
                value: { kind: "serverValue", serverValueId: "msv_1" },
              },
            ],
            body: { bodyType: "none" },
            agentInputs: [],
          },
        },
      ],
    ]);

    await expect(
      deleteVariable(db as never, "user-a", "mcs_1", "msv_1", 1),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_VALUE_IN_USE &&
        (error.details?.references?.some((ref) => ref.kind === "tool") ??
          false),
    );
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("blocks deletion when a variable is owned by authentication", async () => {
    const db = makeDb([
      [
        {
          configRevision: 1,
          id: "mcs_1",
          authConfiguration: {
            kind: "bearer",
            bindings: [
              {
                location: "header",
                key: "Authorization",
                serverValueId: "msv_1",
              },
            ],
          },
          commonEntries: null,
        },
      ],
      [{ id: "msv_1", name: "api_token", kind: "config" }],
      [], // no tools reference it
    ]);

    await expect(
      deleteVariable(db as never, "user-a", "mcs_1", "msv_1", 1),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_VALUE_IN_USE &&
        (error.details?.references?.some((ref) => ref.kind === "auth") ??
          false),
    );
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("rotates secret variables with fresh encryption and no echo", async () => {
    const secret = "s".repeat(32);
    const existing = {
      id: "msv_1",
      name: "api_token",
      kind: "secret",
      owner: "manual",
      description: null,
      value: null,
      ciphertext: encryptCredential("old", secret),
    };
    const updated = {
      ...existing,
      ciphertext: encryptCredential("new", secret),
    };
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [existing],
      [updated],
    ]);

    const result = await updateVariable(
      db as never,
      "user-a",
      "mcs_1",
      "msv_1",
      { expectedRevision: 1, value: "sk_rotated" },
      secret,
    );

    expect(result).toMatchObject({ name: "api_token", kind: "secret" });
    expect(JSON.stringify(result)).not.toContain("sk_rotated");
    const update = db.updatedValues[0] as Record<string, unknown>;
    expect(update).toMatchObject({ value: null });
    expect(typeof update.ciphertext).toBe("string");
    expect(decryptCredential(update.ciphertext as string, secret)).toBe(
      "sk_rotated",
    );
    expect(JSON.stringify(db.updatedValues)).not.toContain("sk_rotated");
  });

  it("updates plain variables in readable plaintext", async () => {
    const existing = {
      id: "msv_2",
      name: "region",
      kind: "config",
      owner: "manual",
      description: null,
      value: "mx",
      ciphertext: null,
    };
    const updated = { ...existing, value: "mx-2" };
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [existing],
      [updated],
    ]);

    const result = await updateVariable(
      db as never,
      "user-a",
      "mcs_1",
      "msv_2",
      { expectedRevision: 1, value: "mx-2" },
      "s".repeat(32),
    );

    expect(result).toEqual({
      id: "msv_2",
      name: "region",
      kind: "config",
      owner: "manual",
      description: null,
      hasValue: true,
      value: "mx-2",
      revision: 2,
    });
    expect(db.updatedValues[0]).toMatchObject({
      kind: "config",
      value: "mx-2",
      ciphertext: null,
    });
  });

  it("rejects clearing secrecy without a new value", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [
        {
          id: "msv_1",
          name: "api_token",
          kind: "secret",
          owner: "manual",
          value: null,
          ciphertext: "old",
        },
      ],
    ]);

    await expect(
      updateVariable(
        db as never,
        "user-a",
        "mcs_1",
        "msv_1",
        { expectedRevision: 1, kind: "config" },
        "s".repeat(32),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT &&
        error.status === 400,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("encrypts the current plaintext when flipping a variable to secret", async () => {
    const secret = "s".repeat(32);
    const existing = {
      id: "msv_2",
      name: "region",
      kind: "config",
      owner: "manual",
      description: null,
      value: "mx-visible",
      ciphertext: null,
    };
    const updated = {
      ...existing,
      kind: "secret",
      value: null,
      ciphertext: encryptCredential("mx-visible", secret),
    };
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [existing],
      [updated],
    ]);

    const result = await updateVariable(
      db as never,
      "user-a",
      "mcs_1",
      "msv_2",
      { expectedRevision: 1, kind: "secret" },
      secret,
    );

    expect(result).toMatchObject({ name: "region", kind: "secret" });
    expect(JSON.stringify(result)).not.toContain("mx-visible");
    const update = db.updatedValues[0] as Record<string, unknown>;
    expect(update).toMatchObject({ kind: "secret", value: null });
    expect(typeof update.ciphertext).toBe("string");
    expect(decryptCredential(update.ciphertext as string, secret)).toBe(
      "mx-visible",
    );
    expect(JSON.stringify(db.updatedValues)).not.toContain("mx-visible");
  });

  it("rejects updates to variables that do not exist", async () => {
    const db = makeDb([[{ configRevision: 1, id: "mcs_1" }], []]);

    await expect(
      updateVariable(
        db as never,
        "user-a",
        "mcs_1",
        "missing",
        { expectedRevision: 1, value: "x" },
        "s".repeat(32),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT &&
        error.status === 404,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("setVariable transitions an existing secret variable to config", async () => {
    const secret = "s".repeat(32);
    const existing = {
      id: "msv_1",
      name: "api_token",
      kind: "secret",
      owner: "manual",
      description: null,
      value: null,
      ciphertext: encryptCredential("old", secret),
    };
    const updated = {
      ...existing,
      kind: "config",
      value: "now-plain",
      ciphertext: null,
    };
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [existing],
      [updated],
    ]);

    const result = await setVariable(
      db as never,
      "user-a",
      "mcs_1",
      {
        expectedRevision: 1,
        name: "api_token",
        kind: "config",
        value: "now-plain",
      },
      secret,
    );

    expect(result).toMatchObject({ name: "api_token", kind: "config" });
    expect(db.updatedValues[0]).toMatchObject({
      kind: "config",
      value: "now-plain",
      ciphertext: null,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("setVariable transitions an existing config variable to secret", async () => {
    const secret = "s".repeat(32);
    const existing = {
      id: "msv_2",
      name: "region",
      kind: "config",
      owner: "manual",
      description: null,
      value: "visible",
      ciphertext: null,
    };
    const updated = {
      ...existing,
      kind: "secret",
      value: null,
      ciphertext: encryptCredential("now-secret", secret),
    };
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [existing],
      [updated],
    ]);

    const result = await setVariable(
      db as never,
      "user-a",
      "mcs_1",
      {
        expectedRevision: 1,
        name: "region",
        kind: "secret",
        value: "now-secret",
      },
      secret,
    );

    expect(result).toMatchObject({ name: "region", kind: "secret" });
    expect(JSON.stringify(result)).not.toContain("now-secret");
    const update = db.updatedValues[0] as Record<string, unknown>;
    expect(update).toMatchObject({ kind: "secret", value: null });
    expect(typeof update.ciphertext).toBe("string");
    expect(JSON.stringify(db.updatedValues)).not.toContain("now-secret");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("setVariable creates the variable when it does not exist", async () => {
    const created = {
      id: "msv_3",
      name: "location_id",
      kind: "config",
      owner: "manual",
      description: null,
      value: "loc_9",
      ciphertext: null,
    };
    const db = makeDb([[{ configRevision: 1, id: "mcs_1" }], [], [created]]);

    const result = await setVariable(
      db as never,
      "user-a",
      "mcs_1",
      {
        expectedRevision: 1,
        name: "location_id",
        kind: "config",
        value: "loc_9",
      },
      "s".repeat(32),
    );

    expect(result).toMatchObject({
      name: "location_id",
      kind: "config",
      value: "loc_9",
    });
    expect(db.insert).toHaveBeenCalled();
  });
});

describe("mcp-studio deleteServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the server and its related rows in one transaction", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1", userId: "user-a" }],
      [],
      [],
      [],
      [],
      [],
    ]);

    const result = await deleteServer(db as never, "user-a", "mcs_1", 1);

    expect(result).toEqual({ id: "mcs_1", deleted: true, revision: 2 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.delete.mock.calls.map((call) => call[0])).toEqual([
      mcpCallLog,
      mcpTool,
      mcpServerVariable,
      mcpAgentToken,
      mcpServer,
    ]);
  });

  it("rejects deleting another user's server as not found", async () => {
    const db = makeDb([[]]);

    await expect(
      deleteServer(db as never, "user-b", "mcs_a", 1),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe("mcp-studio deleteTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only the tool rows so call logs survive", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [{ id: "mct_1" }],
    ]);

    const result = await deleteTools(
      db as never,
      "user-a",
      "mcs_1",
      ["mct_1"],
      1,
    );

    expect(result).toEqual({ ids: ["mct_1"], deleted: true, revision: 2 });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete.mock.calls[0][0]).toBe(mcpTool);
  });

  it("removes every requested tool in one revision-checked command", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [{ id: "mct_1" }, { id: "mct_2" }],
    ]);

    const result = await deleteTools(
      db as never,
      "user-a",
      "mcs_1",
      ["mct_1", "mct_2"],
      1,
    );

    expect(result).toEqual({
      ids: ["mct_1", "mct_2"],
      deleted: true,
      revision: 2,
    });
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it("returns not found when any requested tool is missing", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1" }],
      [{ id: "mct_1" }],
    ]);

    await expect(
      deleteTools(db as never, "user-a", "mcs_1", ["mct_1", "mct_missing"], 1),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
    );
  });

  it("rejects deleting tools on another user's server", async () => {
    const db = makeDb([[]]);

    await expect(
      deleteTools(db as never, "user-b", "mcs_a", ["mct_1"], 1),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe("mcp-studio updateTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps a rename onto an existing name to MCP_TOOL_NAME_CONFLICT", async () => {
    const db = {
      select: vi
        .fn()
        .mockImplementationOnce(() =>
          makeChain([
            {
              configRevision: 1,
              id: "mcs_1",
              status: "live",
              baseUrl: "https://api.example.com",
            },
          ]),
        )
        .mockImplementationOnce(() =>
          makeChain([
            {
              id: "mct_1",
              name: "get_contact",
              title: "Get contact",
              description: "Fetch one contact.",
              method: "GET",
              allowMutation: false,
              enabled: true,
              requestDefinition: simpleTypedDefinition,
            },
          ]),
        )
        .mockImplementationOnce(() => makeChain([])) // listVariableNames
        .mockImplementationOnce(() => makeChain([])), // loadCompileServerValueRefs
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              throw { code: "23505" };
            },
          }),
        }),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
    };

    await expect(
      updateTool(db as never, "user-a", "mcs_1", "mct_1", {
        expectedRevision: 1,
        name: "list_contacts",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
    );
  });
});

describe("mcp-studio curl preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a sanitized preview and requires ownership", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1", baseUrl: "https://api.example.com" }],
    ]);

    const preview = await previewCurlImport(
      db as never,
      "user-a",
      "mcs_1",
      "curl -H 'Authorization: Bearer tok' https://api.example.com/x",
    );

    expect(preview.relativePath).toBe("/x");
    expect(preview.excludedCredentials).toEqual([
      { kind: "bearer", headerName: "Authorization" },
    ]);
    expect(JSON.stringify(preview)).not.toContain("tok");
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();

    const foreign = makeDb([[]]);
    await expect(
      previewCurlImport(
        foreign as never,
        "user-b",
        "mcs_a",
        "curl https://x.co",
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
  });

  it("rejects an unparseable curl with MCP_CURL_INVALID", async () => {
    const db = makeDb([
      [{ configRevision: 1, id: "mcs_1", baseUrl: "https://api.example.com" }],
    ]);

    await expect(
      previewCurlImport(db as never, "user-a", "mcs_1", "not a curl"),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_CURL_INVALID,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("mcp-studio testConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const server = {
    configRevision: 1,
    id: "mcs_1",
    userId: "user-a",
    baseUrl: "https://api.example.com",
    allowedHosts: ["api.example.com"],
  };

  it("treats any HTTP response, including 401, as reachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    const db = makeDb([[server], []]);

    const result = await testConnection(
      db as never,
      "user-a",
      "mcs_1",
      "s".repeat(32),
    );

    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(401);
    expect(typeof result.durationMs).toBe("number");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("renders secret auth configuration and writes no call log", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ciphertext = encryptCredential("tok_secret", "s".repeat(32));
    const db = makeDb([
      [
        {
          ...server,
          authConfiguration: {
            kind: "bearer",
            bindings: [
              {
                location: "header",
                key: "Authorization",
                serverValueId: "msv_1",
                prefix: "Bearer ",
              },
            ],
          },
        },
      ],
      [
        {
          id: "msv_1",
          name: "api_token",
          kind: "secret",
          owner: "auth",
          value: null,
          ciphertext,
        },
      ],
    ]);

    const result = await testConnection(
      db as never,
      "user-a",
      "mcs_1",
      "s".repeat(32),
    );

    expect(result.ok).toBe(true);
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Headers).get("authorization")).toBe(
      "Bearer tok_secret",
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("reports a blocked host without connecting upstream", async () => {
    assertUpstreamUrlSafe.mockRejectedValueOnce(
      appError({
        appCode: APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
        message: "The request target is not allowed.",
        status: 403,
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb([[server]]);

    const result = await testConnection(
      db as never,
      "user-a",
      "mcs_1",
      "s".repeat(32),
    );

    expect(result).toMatchObject({
      ok: false,
      httpStatus: null,
      appCode: APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("reports upstream failures as MCP_UPSTREAM_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const db = makeDb([[server], []]);

    const result = await testConnection(
      db as never,
      "user-a",
      "mcs_1",
      "s".repeat(32),
    );

    expect(result).toMatchObject({
      ok: false,
      httpStatus: null,
      appCode: APP_ERROR_CODES.MCP_UPSTREAM_ERROR,
    });
  });

  it("requires server ownership", async () => {
    const db = makeDb([[]]);

    await expect(
      testConnection(db as never, "user-b", "mcs_a", "s".repeat(32)),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
  });
});
