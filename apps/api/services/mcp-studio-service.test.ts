import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "../lib/app-error.js";
import { decryptCredential, encryptCredential } from "../lib/mcp-crypto.js";

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
  mcpServerVariable: {
    id: "mcp_server_variable.id",
    serverId: "mcp_server_variable.server_id",
    name: "mcp_server_variable.name",
    isSecret: "mcp_server_variable.is_secret",
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
  authenticateAgentToken,
  createServer,
  createTool,
  createToolFromCurl,
  createVariable,
  deleteServer,
  deleteTool,
  deleteVariable,
  deriveTrafficLight,
  getServer,
  listCallLogs,
  listServers,
  listVariables,
  mutationDefaults,
  parseCurlPreview,
  previewCurlImport,
  setVariable,
  testConnection,
  toRecipeTemplate,
  updateServer,
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
  const next = () => {
    const value = results[index] ?? [];
    index += 1;
    return makeChain(value);
  };
  const capture =
    (bucket: unknown[], factory: () => ReturnType<typeof makeChain>) => () => {
      const chain = factory();
      return new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === "values" || prop === "set") {
              return (payload: unknown) => {
                bucket.push(payload);
                return chain;
              };
            }
            return Reflect.get(chain as object, prop);
          },
        },
      );
    };
  const db = {
    select: vi.fn(() => next()),
    insert: vi.fn(capture(insertedValues, next)),
    update: vi.fn(capture(updatedValues, next)),
    delete: vi.fn<(table: unknown) => unknown>(() => next()),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    insertedValues,
    updatedValues,
  };
  return db;
}

describe("mcp-studio helpers", () => {
  it("derives traffic-light states", () => {
    expect(
      deriveTrafficLight({
        status: "paused",
        enabledToolCount: 2,
        recentCallStatuses: ["success"],
      }),
    ).toBe("paused");
    expect(
      deriveTrafficLight({
        status: "live",
        enabledToolCount: 0,
        recentCallStatuses: [],
      }),
    ).toBe("draft");
    expect(
      deriveTrafficLight({
        status: "live",
        enabledToolCount: 1,
        recentCallStatuses: [],
      }),
    ).toBe("green");
    expect(
      deriveTrafficLight({
        status: "live",
        enabledToolCount: 1,
        recentCallStatuses: ["error", "success"],
      }),
    ).toBe("yellow");
    expect(
      deriveTrafficLight({
        status: "live",
        enabledToolCount: 1,
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

  it("recipe template carries variable flags without values", () => {
    const recipe = toRecipeTemplate({
      name: "CRM",
      description: null,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      defaultHeaders: { Authorization: "Bearer {{api_token}}" },
      defaultQuery: null,
      tools: [],
      variables: [{ name: "api_token", isSecret: true }],
    });
    const serialized = JSON.stringify(recipe);
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("sk_live");
    expect(recipe.variables).toEqual([{ name: "api_token", isSecret: true }]);
    expect(recipe.defaultHeaders).toEqual({
      Authorization: "Bearer {{api_token}}",
    });
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
        name: "get_contact",
        method: "GET",
        pathTemplate: "/contacts/{{id}}",
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
          id: "mcs_1",
          userId: "user-a",
          name: "A1",
          status: "live",
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

  it("rejects tokens belonging to a suspended account", async () => {
    isUserBanned.mockResolvedValueOnce(true);
    const db = makeDb([
      [
        {
          id: "mtk_1",
          kind: "platform",
          serverId: null,
          userId: "usr_1",
          revokedAt: null,
          expiresAt: null,
        },
      ],
    ]);

    await expect(
      authenticateAgentToken(db as never, "rmcp_test", { kind: "platform" }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.ACCOUNT_SUSPENDED,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects a server token when a platform token is required", async () => {
    const db = makeDb([
      [
        {
          id: "mtk_1",
          kind: "server",
          serverId: "mcs_1",
          revokedAt: null,
          expiresAt: null,
        },
      ],
    ]);

    await expect(
      authenticateAgentToken(db as never, "rmcp_test", { kind: "platform" }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    );
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

  it("preserves the baseUrl path prefix on update", async () => {
    const db = makeDb([
      [
        {
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
        },
      ],
      [{ id: "mcs_1" }],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    await updateServer(db as never, "user-a", "mcs_1", {
      baseUrl: "https://api.example.com/v3/",
    });

    expect(db.updatedValues[0]).toMatchObject({
      baseUrl: "https://api.example.com/v3",
    });
  });

  it("rejects literal auth headers in server defaults", async () => {
    const db = makeDb([
      [
        {
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
        },
      ],
    ]);

    await expect(
      updateServer(db as never, "user-a", "mcs_1", {
        defaultHeaders: { Authorization: "Bearer sk_live_123" },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("accepts templated auth headers in server defaults", async () => {
    const db = makeDb([
      [
        {
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
        },
      ],
      [{ id: "mcs_1" }],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    await updateServer(db as never, "user-a", "mcs_1", {
      defaultHeaders: { Authorization: "Bearer {{api_token}}" },
    });

    expect(db.updatedValues[0]).toMatchObject({
      defaultHeaders: { Authorization: "Bearer {{api_token}}" },
    });
  });
});

describe("mcp-studio tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults GET tools to enabled without mutation", async () => {
    const db = makeDb([
      [{ id: "mcs_1", status: "live" }],
      [{ count: 0 }],
      [],
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    await createTool(db as never, "user-a", "mcs_1", {
      name: "get_contact",
      method: "GET",
      pathTemplate: "/contacts/{{id}}",
    });

    expect(db.insertedValues[0]).toMatchObject({
      method: "GET",
      allowMutation: false,
      enabled: true,
      requestTemplate: {},
      params: [],
    });
  });

  it("warns about placeholders without a matching param or variable", async () => {
    const db = makeDb([
      [{ id: "mcs_1", status: "live" }],
      [{ count: 0 }],
      [],
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    const created = await createTool(db as never, "user-a", "mcs_1", {
      name: "get_contact",
      method: "GET",
      pathTemplate: "/contacts/{{contactId}}",
      requestTemplate: { query: { limit: "{{limit}}" } },
      params: [{ name: "contactId", required: true, type: "string" }],
    });

    expect(created.warnings).toEqual([
      { type: "placeholder_without_param", name: "limit" },
    ]);
  });

  it("maps duplicate tool names to MCP_TOOL_NAME_CONFLICT", async () => {
    const selectResults = [
      [{ id: "mcs_1", status: "live" }],
      [{ count: 0 }],
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
    };

    await expect(
      createTool(db as never, "user-a", "mcs_1", {
        name: "get_contact",
        method: "GET",
        pathTemplate: "/contacts",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
    );
  });

  it("warns about params without a matching placeholder", async () => {
    const db = makeDb([
      [{ id: "mcs_1", status: "live" }],
      [{ count: 0 }],
      [],
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    const created = await createTool(db as never, "user-a", "mcs_1", {
      name: "get_contact",
      method: "GET",
      pathTemplate: "/contacts",
      params: [{ name: "unused", required: false, type: "string" }],
    });

    expect(created.warnings).toEqual([
      { type: "param_without_placeholder", name: "unused" },
    ]);
  });

  it("rejects literal auth headers on tools", async () => {
    const db = makeDb([[{ id: "mcs_1", status: "live" }], [{ count: 0 }]]);

    await expect(
      createTool(db as never, "user-a", "mcs_1", {
        name: "get_contact",
        method: "GET",
        pathTemplate: "/contacts",
        requestTemplate: { headers: { "X-API-Key": "sk_live_123" } },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("captures curl auth headers as a secret variable and default header", async () => {
    const server = {
      id: "mcs_1",
      userId: "user-a",
      status: "live",
      baseUrl: "https://api.example.com",
      defaultHeaders: null,
    };
    const db = makeDb([
      [server],
      [],
      [],
      [],
      [server],
      [{ count: 0 }],
      [],
      [{ id: "mct_1" }],
    ]);

    const result = await createToolFromCurl(
      db as never,
      "user-a",
      "mcs_1",
      {
        curl: `curl -H 'Authorization: Bearer super-secret' https://api.example.com/contacts`,
      },
      "s".repeat(32),
    );

    expect(result.capturedVariable).toBe("api_token");
    expect(result.capturedHeader).toBe("Authorization");
    expect(JSON.stringify(db.insertedValues)).not.toContain("super-secret");
    expect(JSON.stringify(db.updatedValues)).not.toContain("super-secret");
    expect(db.updatedValues[0]).toMatchObject({
      defaultHeaders: { Authorization: "Bearer {{api_token}}" },
    });
    const toolInsert = db.insertedValues.at(-1);
    expect(JSON.stringify(toolInsert)).not.toContain("Authorization");
  });

  it("captures api-key curl headers without a Bearer prefix", async () => {
    const server = {
      id: "mcs_1",
      userId: "user-a",
      status: "live",
      baseUrl: "https://api.example.com",
      defaultHeaders: null,
    };
    const db = makeDb([
      [server],
      [],
      [],
      [],
      [server],
      [{ count: 0 }],
      [],
      [{ id: "mct_1" }],
    ]);

    const result = await createToolFromCurl(
      db as never,
      "user-a",
      "mcs_1",
      {
        curl: `curl -H 'X-API-Key: super-secret' https://api.example.com/v1/items`,
      },
      "s".repeat(32),
    );

    expect(result.capturedVariable).toBe("api_key");
    expect(result.capturedHeader).toBe("X-API-Key");
    expect(db.updatedValues[0]).toMatchObject({
      defaultHeaders: { "X-API-Key": "{{api_key}}" },
    });
    expect(JSON.stringify(db.insertedValues)).not.toContain("super-secret");
    expect(JSON.stringify(db.updatedValues)).not.toContain("super-secret");
    const toolInsert = db.insertedValues.at(-1);
    expect(JSON.stringify(toolInsert)).not.toContain("X-API-Key");
  });

  it("keeps curl literal values as templates without capture when no auth header", async () => {
    const server = {
      id: "mcs_1",
      userId: "user-a",
      status: "live",
      baseUrl: "https://api.example.com",
      defaultHeaders: null,
    };
    const db = makeDb([
      [server],
      [server],
      [{ count: 0 }],
      [],
      [{ id: "mct_1" }],
    ]);

    const result = await createToolFromCurl(
      db as never,
      "user-a",
      "mcs_1",
      {
        curl: `curl -H 'Accept: application/json' 'https://api.example.com/v1/items?limit=10'`,
      },
      "s".repeat(32),
    );

    expect(result.capturedVariable).toBeNull();
    expect(result.capturedHeader).toBeNull();
    expect(db.insertedValues[0]).toMatchObject({
      requestTemplate: {
        query: { limit: "10" },
        headers: { Accept: "application/json" },
      },
    });
  });
});

describe("mcp-studio variables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores secret variables encrypted without echoing the value", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [
        {
          id: "msv_1",
          name: "api_token",
          isSecret: true,
          value: null,
          ciphertext: "iv.tag.data",
        },
      ],
    ]);

    const result = await createVariable(
      db as never,
      "user-a",
      "mcs_1",
      { name: "api_token", isSecret: true, value: "sk_live_123" },
      "s".repeat(32),
    );

    expect(result).toMatchObject({
      name: "api_token",
      isSecret: true,
      hasValue: true,
    });
    expect(JSON.stringify(result)).not.toContain("sk_live_123");
    expect(JSON.stringify(db.insertedValues)).not.toContain("sk_live_123");
    expect(db.insertedValues[0]).toMatchObject({ value: null });
  });

  it("stores plain variables in readable plaintext", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [
        {
          id: "msv_1",
          name: "location_id",
          isSecret: false,
          value: "loc_9",
          ciphertext: null,
        },
      ],
    ]);

    const result = await createVariable(
      db as never,
      "user-a",
      "mcs_1",
      { name: "location_id", isSecret: false, value: "loc_9" },
      "s".repeat(32),
    );

    expect(result).toMatchObject({
      name: "location_id",
      isSecret: false,
      value: "loc_9",
    });
  });

  it("rejects invalid variable names", async () => {
    const db = makeDb([[{ id: "mcs_1" }]]);

    await expect(
      createVariable(
        db as never,
        "user-a",
        "mcs_1",
        { name: "1Bad-Name", isSecret: false, value: "x" },
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
      select: vi.fn(() => makeChain([{ id: "mcs_1" }])),
      insert: vi.fn(() => ({
        values: () => ({
          returning: async () => {
            throw { code: "23505" };
          },
        }),
      })),
    };

    await expect(
      createVariable(
        db as never,
        "user-a",
        "mcs_1",
        { name: "api_token", isSecret: true, value: "sk" },
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
      [{ id: "mcs_1" }],
      [
        {
          id: "msv_1",
          name: "api_token",
          isSecret: true,
          value: null,
          ciphertext: "iv.tag.data",
        },
        {
          id: "msv_2",
          name: "location_id",
          isSecret: false,
          value: "loc_9",
          ciphertext: null,
        },
      ],
    ]);

    const variables = await listVariables(db as never, "user-a", "mcs_1");

    expect(variables).toEqual([
      { id: "msv_1", name: "api_token", isSecret: true, hasValue: true },
      {
        id: "msv_2",
        name: "location_id",
        isSecret: false,
        hasValue: true,
        value: "loc_9",
      },
    ]);
    expect(JSON.stringify(variables)).not.toContain("iv.tag.data");
  });

  it("deletes variables by name", async () => {
    const db = makeDb([[{ id: "mcs_1" }], [{ id: "msv_1" }]]);

    const result = await deleteVariable(
      db as never,
      "user-a",
      "mcs_1",
      "api_token",
    );

    expect(result).toEqual({ name: "api_token", deleted: true });
    expect(db.delete).toHaveBeenCalled();
  });

  it("rotates secret variables with fresh encryption and no echo", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [{ id: "msv_1", name: "api_token", isSecret: true }],
      [],
    ]);

    const result = await updateVariable(
      db as never,
      "user-a",
      "mcs_1",
      "api_token",
      { value: "sk_rotated" },
      "s".repeat(32),
    );

    expect(result).toMatchObject({ name: "api_token", isSecret: true });
    expect(JSON.stringify(result)).not.toContain("sk_rotated");
    const update = db.updatedValues[0] as Record<string, unknown>;
    expect(update).toMatchObject({ value: null });
    expect(typeof update.ciphertext).toBe("string");
    expect(decryptCredential(update.ciphertext as string, "s".repeat(32))).toBe(
      "sk_rotated",
    );
    expect(JSON.stringify(db.updatedValues)).not.toContain("sk_rotated");
  });

  it("updates plain variables in readable plaintext", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [{ id: "msv_2", name: "region", isSecret: false }],
      [],
    ]);

    const result = await updateVariable(
      db as never,
      "user-a",
      "mcs_1",
      "region",
      { value: "mx-2" },
      "s".repeat(32),
    );

    expect(result).toEqual({
      name: "region",
      isSecret: false,
      hasValue: true,
    });
    expect(db.updatedValues[0]).toMatchObject({
      isSecret: false,
      value: "mx-2",
      ciphertext: null,
    });
  });

  it("rejects updates to variables that do not exist", async () => {
    const db = makeDb([[{ id: "mcs_1" }], []]);

    await expect(
      updateVariable(
        db as never,
        "user-a",
        "mcs_1",
        "missing",
        { value: "x" },
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

  it("setVariable transitions an existing secret variable to plain", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [{ name: "api_token" }],
      [{ id: "mcs_1" }],
      [{ id: "msv_1", name: "api_token", isSecret: true }],
      [],
    ]);

    const result = await setVariable(
      db as never,
      "user-a",
      "mcs_1",
      { name: "api_token", isSecret: false, value: "now-plain" },
      "s".repeat(32),
    );

    expect(result).toMatchObject({ name: "api_token", isSecret: false });
    expect(db.updatedValues[0]).toMatchObject({
      isSecret: false,
      value: "now-plain",
      ciphertext: null,
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("setVariable transitions an existing plain variable to secret", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [{ name: "region" }],
      [{ id: "mcs_1" }],
      [{ id: "msv_2", name: "region", isSecret: false }],
      [],
    ]);

    const result = await setVariable(
      db as never,
      "user-a",
      "mcs_1",
      { name: "region", isSecret: true, value: "now-secret" },
      "s".repeat(32),
    );

    expect(result).toMatchObject({ name: "region", isSecret: true });
    expect(JSON.stringify(result)).not.toContain("now-secret");
    const update = db.updatedValues[0] as Record<string, unknown>;
    expect(update).toMatchObject({ isSecret: true, value: null });
    expect(typeof update.ciphertext).toBe("string");
    expect(JSON.stringify(db.updatedValues)).not.toContain("now-secret");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("setVariable creates the variable when it does not exist", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [],
      [{ id: "mcs_1" }],
      [
        {
          id: "msv_3",
          name: "location_id",
          isSecret: false,
          value: "loc_9",
          ciphertext: null,
        },
      ],
    ]);

    const result = await setVariable(
      db as never,
      "user-a",
      "mcs_1",
      { name: "location_id", isSecret: false, value: "loc_9" },
      "s".repeat(32),
    );

    expect(result).toMatchObject({
      name: "location_id",
      isSecret: false,
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
      [{ id: "mcs_1", userId: "user-a" }],
      [],
      [],
      [],
      [],
      [],
    ]);

    const result = await deleteServer(db as never, "user-a", "mcs_1");

    expect(result).toEqual({ id: "mcs_1", deleted: true });
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
      deleteServer(db as never, "user-b", "mcs_a"),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe("mcp-studio deleteTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only the tool row so call logs survive", async () => {
    const db = makeDb([[{ id: "mcs_1" }], [{ id: "mct_1" }]]);

    const result = await deleteTool(db as never, "user-a", "mcs_1", "mct_1");

    expect(result).toEqual({ id: "mct_1", deleted: true });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete.mock.calls[0][0]).toBe(mcpTool);
  });

  it("returns not found for a missing tool", async () => {
    const db = makeDb([[{ id: "mcs_1" }], []]);

    await expect(
      deleteTool(db as never, "user-a", "mcs_1", "mct_missing"),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
    );
  });

  it("rejects deleting a tool on another user's server", async () => {
    const db = makeDb([[]]);

    await expect(
      deleteTool(db as never, "user-b", "mcs_a", "mct_1"),
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
          makeChain([{ id: "mcs_1", status: "live" }]),
        )
        .mockImplementationOnce(() =>
          makeChain([
            {
              id: "mct_1",
              name: "get_contact",
              method: "GET",
              pathTemplate: "/contacts",
              allowMutation: false,
              enabled: true,
            },
          ]),
        )
        .mockImplementationOnce(() => makeChain([])),
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              throw { code: "23505" };
            },
          }),
        }),
      })),
    };

    await expect(
      updateTool(db as never, "user-a", "mcs_1", "mct_1", {
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

  it("parses the request and lists markable literal values", () => {
    const preview = parseCurlPreview(
      "https://api.example.com",
      `curl -H 'Authorization: Bearer tok' -H 'Accept: application/json' 'https://api.example.com/v1/items?limit=10'`,
    );

    expect(preview.method).toBe("GET");
    expect(preview.pathTemplate).toBe("/v1/items");
    expect(preview.query).toEqual({ limit: "10" });
    expect(preview.headers).toEqual({ Accept: "application/json" });
    expect(preview.auth).toEqual({
      scheme: "bearer",
      headerName: "Authorization",
      value: "tok",
      variableName: "api_token",
    });
    expect(preview.values).toContainEqual({
      value: "10",
      location: "query",
      key: "limit",
    });
    expect(preview.values).toContainEqual({
      value: "items",
      location: "path",
      key: null,
    });
    expect(preview.values).toContainEqual({
      value: "application/json",
      location: "header",
      key: "Accept",
    });
  });

  it("strips the server path prefix from the preview path", () => {
    const preview = parseCurlPreview(
      "https://api.example.com/v2",
      "curl 'https://api.example.com/v2/items'",
    );
    expect(preview.pathTemplate).toBe("/items");
  });

  it("lists JSON body leaf values as markable", () => {
    const preview = parseCurlPreview(
      "https://api.example.com",
      `curl -X POST -H 'Content-Type: application/json' -d '{"name":"John","age":30}' https://api.example.com/contacts`,
    );
    expect(preview.bodyType).toBe("json");
    expect(preview.values).toContainEqual({
      value: "John",
      location: "body",
      key: "name",
    });
    expect(preview.values).toContainEqual({
      value: "30",
      location: "body",
      key: "age",
    });
  });

  it("writes nothing and requires ownership", async () => {
    const db = makeDb([[{ id: "mcs_1", baseUrl: "https://api.example.com" }]]);

    const preview = await previewCurlImport(
      db as never,
      "user-a",
      "mcs_1",
      "curl https://api.example.com/x",
    );

    expect(preview.pathTemplate).toBe("/x");
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
    const db = makeDb([[{ id: "mcs_1", baseUrl: "https://api.example.com" }]]);

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

describe("mcp-studio curl markings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const server = {
    id: "mcs_1",
    userId: "user-a",
    status: "live",
    baseUrl: "https://api.example.com",
    defaultHeaders: null,
  };

  it("turns a marked query value into a declared param", async () => {
    const db = makeDb([
      [server],
      [server],
      [{ count: 0 }],
      [],
      [{ id: "mct_1" }],
    ]);

    const result = await createToolFromCurl(
      db as never,
      "user-a",
      "mcs_1",
      {
        curl: `curl 'https://api.example.com/v1/items?locationId=loc_9'`,
        markings: [{ value: "loc_9", as: "param", name: "location_id" }],
      },
      "s".repeat(32),
    );

    expect(result.capturedParams).toEqual(["location_id"]);
    expect(result.capturedVariables).toEqual([]);
    expect(db.insertedValues[0]).toMatchObject({
      requestTemplate: { query: { locationId: "{{location_id}}" } },
      params: [{ name: "location_id", required: true, type: "string" }],
    });
  });

  it("stores a marked value as an encrypted variable and templates it", async () => {
    const db = makeDb([
      [server],
      [],
      [],
      [server],
      [{ count: 0 }],
      [],
      [{ id: "mct_1" }],
    ]);

    const result = await createToolFromCurl(
      db as never,
      "user-a",
      "mcs_1",
      {
        curl: `curl -H 'X-Tenant: acme' https://api.example.com/v1/items`,
        markings: [
          { value: "acme", as: "variable", name: "tenant", isSecret: true },
        ],
      },
      "s".repeat(32),
    );

    expect(result.capturedVariables).toEqual(["tenant"]);
    const variableInsert = db.insertedValues[0] as Record<string, unknown>;
    expect(variableInsert).toMatchObject({
      name: "tenant",
      isSecret: true,
      value: null,
    });
    expect(typeof variableInsert.ciphertext).toBe("string");
    expect(JSON.stringify(db.insertedValues)).not.toContain("acme");
    expect(db.insertedValues.at(-1)).toMatchObject({
      requestTemplate: { headers: { "X-Tenant": "{{tenant}}" } },
    });
  });

  it("honors a custom variable name for the detected auth value", async () => {
    const db = makeDb([
      [server],
      [],
      [],
      [],
      [server],
      [{ count: 0 }],
      [],
      [{ id: "mct_1" }],
    ]);

    const result = await createToolFromCurl(
      db as never,
      "user-a",
      "mcs_1",
      {
        curl: `curl -H 'Authorization: Bearer super-secret' https://api.example.com/contacts`,
        markings: [
          {
            value: "super-secret",
            as: "variable",
            name: "crm_token",
            isSecret: true,
          },
        ],
      },
      "s".repeat(32),
    );

    expect(result.capturedVariable).toBe("crm_token");
    expect(result.capturedHeader).toBe("Authorization");
    expect(result.capturedVariables).toEqual(["crm_token"]);
    expect(db.updatedValues[0]).toMatchObject({
      defaultHeaders: { Authorization: "Bearer {{crm_token}}" },
    });
    expect(JSON.stringify(db.insertedValues)).not.toContain("super-secret");
  });

  it("rejects marking names that are not valid placeholders", async () => {
    const db = makeDb([[server]]);

    await expect(
      createToolFromCurl(
        db as never,
        "user-a",
        "mcs_1",
        {
          curl: `curl 'https://api.example.com/v1/items?x=1'`,
          markings: [{ value: "1", as: "param", name: "1bad" }],
        },
        "s".repeat(32),
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rewrites a marked value only in its own location", async () => {
    const db = makeDb([
      [server],
      [server],
      [{ count: 0 }],
      [],
      [{ id: "mct_1" }],
    ]);

    const result = await createToolFromCurl(
      db as never,
      "user-a",
      "mcs_1",
      {
        curl: `curl 'https://api.example.com/v1/items?page=1'`,
        markings: [{ value: "1", as: "param", name: "page" }],
      },
      "s".repeat(32),
    );

    expect(result.capturedParams).toEqual(["page"]);
    // The "1" inside the "v1" path segment must survive untouched.
    expect(db.insertedValues[0]).toMatchObject({
      pathTemplate: "/v1/items",
      requestTemplate: { query: { page: "{{page}}" } },
    });
  });

  it("rewrites a whole path segment without touching lookalikes", async () => {
    const db = makeDb([
      [server],
      [server],
      [{ count: 0 }],
      [],
      [{ id: "mct_1" }],
    ]);

    const result = await createToolFromCurl(
      db as never,
      "user-a",
      "mcs_1",
      {
        curl: `curl 'https://api.example.com/v1/items?v=1'`,
        markings: [{ value: "v1", as: "param", name: "version" }],
      },
      "s".repeat(32),
    );

    expect(result.capturedParams).toEqual(["version"]);
    expect(db.insertedValues[0]).toMatchObject({
      pathTemplate: "/{{version}}/items",
      requestTemplate: { query: { v: "1" } },
    });
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
    id: "mcs_1",
    userId: "user-a",
    baseUrl: "https://api.example.com",
    allowedHosts: ["api.example.com"],
    defaultHeaders: null,
    defaultQuery: null,
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

  it("renders secret default headers and writes no call log", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ciphertext = encryptCredential("tok_secret", "s".repeat(32));
    const db = makeDb([
      [
        {
          ...server,
          defaultHeaders: { Authorization: "Bearer {{api_token}}" },
        },
      ],
      [
        {
          id: "msv_1",
          name: "api_token",
          isSecret: true,
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
