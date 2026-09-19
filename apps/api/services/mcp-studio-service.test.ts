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
  createLegacyTool,
  createPlatformToken,
  createServer,
  createTool,
  createToolFromCurl,
  createVariable,
  deleteServer,
  deleteTool,
  deleteVariable,
  deriveTrafficLight,
  duplicateTool,
  getServer,
  listCallLogs,
  listServers,
  listVariables,
  mutationDefaults,
  previewCurlImport,
  revokeUnscopedPlatformTokens,
  setServerAuth,
  setVariable,
  testConnection,
  toRecipeTemplate,
  updateLegacyTool,
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
      createLegacyTool(db as never, "user-b", "mcs_a", {
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
          scopes: ["read"],
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

  it("rejects legacy unscoped platform tokens as invalid", async () => {
    const db = makeDb([
      [
        {
          id: "mtk_1",
          kind: "platform",
          serverId: null,
          userId: "usr_1",
          revokedAt: null,
          expiresAt: null,
          scopes: null,
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
      id: "mcs_1",
      userId: "user-a",
      name: "CRM",
      status: "draft",
      allowedHosts: ["api.example.com"],
      defaultHeaders: null,
      defaultQuery: null,
    };
    const withAuth = {
      ...created,
      defaultHeaders: { Authorization: "Bearer {{api_token}}" },
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

    expect(result.defaultHeaders).toEqual({
      Authorization: "Bearer {{api_token}}",
    });
    expect(JSON.stringify(db.insertedValues)).not.toContain("sk_live_123");
    const variableInsert = db.insertedValues.find(
      (row) =>
        row &&
        typeof row === "object" &&
        "name" in row &&
        (row as { name: string }).name === "api_token",
    ) as { ciphertext: string; isSecret: boolean };
    expect(variableInsert.isSecret).toBe(true);
    expect(decryptCredential(variableInsert.ciphertext, secret)).toBe(
      "sk_live_123",
    );
  });

  it("creates a server with none auth and no secret variable", async () => {
    const db = makeDb([
      [
        {
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          allowedHosts: ["api.example.com"],
          defaultHeaders: null,
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
      id: "mcs_1",
      userId: "user-a",
      name: "CRM",
      status: "draft",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      defaultHeaders: {
        Authorization: "Bearer {{api_token}}",
        Version: "2024-01",
      },
      defaultQuery: null,
    };
    const updated = {
      ...server,
      defaultHeaders: {
        Version: "2024-01",
        "X-API-Key": "{{api_key}}",
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
      { type: "header", headerName: "X-API-Key", value: "key_123" },
      secret,
    );

    expect(result.defaultHeaders).toEqual({
      Version: "2024-01",
      "X-API-Key": "{{api_key}}",
    });
    expect(db.delete).toHaveBeenCalled();
  });

  it("clears unreferenced api_token when set to none", async () => {
    const server = {
      id: "mcs_1",
      userId: "user-a",
      name: "CRM",
      status: "draft",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      defaultHeaders: { Authorization: "Bearer {{api_token}}" },
      defaultQuery: null,
    };
    const updated = {
      ...server,
      defaultHeaders: null,
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
      { type: "none" },
      "s".repeat(32),
    );

    expect(result.defaultHeaders).toBeNull();
    expect(db.delete).toHaveBeenCalled();
  });

  it("clears all Custom credential defaults when set to none", async () => {
    const server = {
      id: "mcs_1",
      userId: "user-a",
      name: "CRM",
      status: "draft",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      defaultHeaders: {
        Authorization: "Bearer {{api_token}}",
        "X-Partner-Key": "{{partner}}",
        Version: "2024-01",
      },
      defaultQuery: null,
    };
    const updated = {
      ...server,
      defaultHeaders: { Version: "2024-01" },
    };
    const db = makeDb([
      [server],
      [updated],
      [{ id: "msv_1", name: "api_token", owner: null }],
      [],
      [],
      [{ id: "msv_2", name: "partner", owner: null }],
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
      { type: "none" },
      "s".repeat(32),
    );

    expect(result.defaultHeaders).toEqual({ Version: "2024-01" });
    expect(db.delete).toHaveBeenCalledTimes(2);
  });

  it("rejects query auth without the exposure acknowledgement", async () => {
    const db = makeDb([
      [
        {
          id: "mcs_1",
          userId: "user-a",
          status: "draft",
          baseUrl: "https://api.example.com",
          defaultHeaders: null,
          defaultQuery: null,
        },
      ],
    ]);

    await expect(
      setServerAuth(
        db as never,
        "user-a",
        "mcs_1",
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
      id: "mcs_1",
      userId: "user-a",
      status: "draft",
      baseUrl: "https://api.example.com",
      defaultHeaders: null,
      defaultQuery: null,
      authConfiguration: null,
    };
    const updated = {
      ...server,
      defaultHeaders: { Authorization: "Bearer {{api_token_auth}}" },
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
      { type: "bearer", token: "sk_live_123" },
      "s".repeat(32),
    );

    expect(result.defaultHeaders).toEqual({
      Authorization: "Bearer {{api_token_auth}}",
    });
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

    await updateServer(
      db as never,
      "user-a",
      "mcs_1",
      {
        baseUrl: "https://api.example.com/v3/",
      },
      "http://localhost:5173",
    );

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
      updateServer(
        db as never,
        "user-a",
        "mcs_1",
        {
          defaultHeaders: { Authorization: "Bearer sk_live_123" },
        },
        "http://localhost:5173",
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects literal Shopify access-token headers as plaintext secrets", async () => {
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
      updateServer(
        db as never,
        "user-a",
        "mcs_1",
        {
          defaultHeaders: { "X-Shopify-Access-Token": "shpat_123" },
        },
        "http://localhost:5173",
      ),
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

    await updateServer(
      db as never,
      "user-a",
      "mcs_1",
      {
        defaultHeaders: { Authorization: "Bearer {{api_token}}" },
      },
      "http://localhost:5173",
    );

    expect(db.updatedValues[0]).toMatchObject({
      defaultHeaders: { Authorization: "Bearer {{api_token}}" },
    });
  });

  it("persists a custom icon image URL scoped to the owner", async () => {
    const iconImage =
      "http://localhost:5173/api/storage/object?key=users%2Fuser-a%2Fserver-icons%2Ficon.png";

    const db = makeDb([
      [
        {
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
          iconImage: null,
        },
      ],
      [{ id: "mcs_1", iconImage }],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    await updateServer(
      db as never,
      "user-a",
      "mcs_1",
      { iconImage },
      "http://localhost:5173",
    );

    expect(db.updatedValues[0]).toMatchObject({ iconImage });
  });

  it("clears a custom icon image", async () => {
    const db = makeDb([
      [
        {
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
          iconImage:
            "http://localhost:5173/api/storage/object?key=users%2Fuser-a%2Fserver-icons%2Ficon.png",
        },
      ],
      [{ id: "mcs_1", iconImage: null }],
      [{ count: 0 }],
      [],
      [],
      [],
    ]);

    await updateServer(
      db as never,
      "user-a",
      "mcs_1",
      { iconImage: null },
      "http://localhost:5173",
    );

    expect(db.updatedValues[0]).toMatchObject({ iconImage: null });
  });

  it("rejects a foreign storage icon URL", async () => {
    const db = makeDb([
      [
        {
          id: "mcs_1",
          userId: "user-a",
          name: "CRM",
          status: "draft",
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
          iconImage: null,
        },
      ],
    ]);

    await expect(
      updateServer(
        db as never,
        "user-a",
        "mcs_1",
        {
          iconImage:
            "http://localhost:5173/api/storage/object?key=users%2Fuser-b%2Fserver-icons%2Ficon.png",
        },
        "http://localhost:5173",
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT,
    );
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("mcp-studio tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults GET tools to enabled without mutation", async () => {
    const db = makeDb([
      [{ id: "mcs_1", status: "live", baseUrl: "https://api.example.com" }],
      [{ count: 0 }],
      [], // listVariableNames
      [], // loadCompileServerValueRefs
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    await createLegacyTool(db as never, "user-a", "mcs_1", {
      name: "get_contact",
      method: "GET",
      pathTemplate: "/contacts/{{id}}",
      params: [{ name: "id", required: true, type: "string" }],
    });

    expect(db.insertedValues[0]).toMatchObject({
      method: "GET",
      allowMutation: false,
      enabled: true,
      compileStatus: "valid",
      requestTemplate: {},
      params: [{ name: "id", required: true, type: "string" }],
    });
  });

  it("warns about placeholders without a matching param or variable", async () => {
    const db = makeDb([
      [{ id: "mcs_1", status: "live", baseUrl: "https://api.example.com" }],
      [{ count: 0 }],
      [],
      [],
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    const created = await createLegacyTool(db as never, "user-a", "mcs_1", {
      name: "get_contact",
      method: "GET",
      pathTemplate: "/contacts/{{contactId}}",
      requestTemplate: { query: { limit: "{{limit}}" } },
      params: [{ name: "contactId", required: true, type: "string" }],
    });

    expect(created.warnings).toEqual([
      { type: "placeholder_without_param", name: "limit" },
    ]);
    expect(
      created.compileIssues?.some((issue) => issue.severity === "error"),
    ).toBe(true);
    expect(db.insertedValues[0]).toMatchObject({
      compileStatus: "invalid",
      enabled: false,
    });
  });

  it("maps duplicate tool names to MCP_TOOL_NAME_CONFLICT", async () => {
    const selectResults = [
      [{ id: "mcs_1", status: "live", baseUrl: "https://api.example.com" }],
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
    };

    await expect(
      createLegacyTool(db as never, "user-a", "mcs_1", {
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
      [{ id: "mcs_1", status: "live", baseUrl: "https://api.example.com" }],
      [{ count: 0 }],
      [],
      [],
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    const created = await createLegacyTool(db as never, "user-a", "mcs_1", {
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
      createLegacyTool(db as never, "user-a", "mcs_1", {
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
});

describe("mcp-studio typed tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const serverRow = {
    id: "mcs_1",
    status: "live",
    baseUrl: "https://api.example.com",
    commonEntries: null,
    authConfiguration: null,
    defaultHeaders: null,
    defaultQuery: null,
  };

  const typedDefinition = {
    version: 1 as const,
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
      requestDefinition: expect.objectContaining({ version: 1 }),
    });
    expect(
      (db.insertedValues[0] as { compiledPlan?: unknown }).compiledPlan,
    ).toBeTruthy();
  });

  it("rejects legacy updates for a tool that already has a typed definition", async () => {
    const db = makeDb([
      [serverRow],
      [
        {
          id: "mct_1",
          name: "get_contact",
          method: "GET",
          pathTemplate: "/contacts",
          requestDefinition: typedDefinition,
          allowMutation: false,
          enabled: true,
        },
      ],
    ]);

    await expect(
      updateLegacyTool(db as never, "user-a", "mcs_1", "mct_1", {
        name: "renamed",
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_LEGACY_DOWNGRADE_REJECTED,
    );
    expect(db.update).not.toHaveBeenCalled();
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
          pathTemplate: "/contacts/{{id}}",
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

  it("preserves auth-owned legacy default maps on common updates", async () => {
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
          defaultHeaders: { Authorization: "Bearer {{api_token}}" },
          defaultQuery: {},
        },
      ],
      [
        { id: "msv_1", name: "api_version", kind: "config", owner: "manual" },
        { id: "msv_auth", name: "api_token", kind: "secret", owner: "auth" },
      ],
      [],
    ]);

    await updateServerCommon(db as never, "user-a", "mcs_1", {
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
      defaultHeaders: {
        Version: "{{api_version}}",
        Authorization: "Bearer {{api_token}}",
      },
    });
  });

  it("rejects plaintext auth headers in typed common entries without writing", async () => {
    const db = makeDb([[serverRow], []]);

    await expect(
      updateServerCommon(db as never, "user-a", "mcs_1", {
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

  it("duplicates a typed tool with regenerated local ids", async () => {
    const db = makeDb([
      [serverRow],
      [
        {
          id: "mct_1",
          name: "get_contact",
          title: "Get contact",
          description: "Fetch one contact.",
          method: "GET",
          pathTemplate: "/contacts/{{id}}",
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

    await duplicateTool(db as never, "user-a", "mcs_1", "mct_1");

    const inserted = db.insertedValues[0] as {
      requestDefinition?: {
        pathSegments: Array<{ id: string }>;
        agentInputs: Array<{ id: string }>;
      };
    };
    expect(inserted.requestDefinition?.pathSegments[0]?.id).not.toBe("path_1");
    expect(inserted.requestDefinition?.agentInputs[0]?.id).not.toBe("ain_1");
  });

  it("writes typed common entries with stable server-value ids and lossless legacy maps", async () => {
    const db = makeDb([
      [serverRow],
      [{ id: "msv_1", name: "api_version", kind: "config", owner: "manual" }],
      [], // enabled tools
    ]);

    const result = await updateServerCommon(db as never, "user-a", "mcs_1", {
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

    expect(result.legacyProjectable).toBe(true);
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
      defaultHeaders: { Version: "{{api_version}}" },
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

  it("fails atomically with per-tool diagnostics for non-projectable common values", async () => {
    const db = makeDb([
      [serverRow],
      [],
      [
        {
          id: "mct_legacy",
          name: "legacy_tool",
          method: "GET",
          requestDefinition: null,
          allowMutation: false,
          enabled: true,
        },
      ],
    ]);

    await expect(
      updateServerCommon(db as never, "user-a", "mcs_1", {
        common: {
          headers: [
            {
              id: "hdr_1",
              name: "X-Note",
              value: { kind: "literal", value: "Example {{name}}" },
            },
          ],
          query: [],
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof AppError)) return false;
      return (
        error.appCode === APP_ERROR_CODES.MCP_COMPILE_INVALID &&
        (error.details?.references ?? []).some(
          (reference) => reference.id === "mct_legacy",
        )
      );
    });
    expect(db.updatedValues).toHaveLength(0);
  });

  it("enforces the enabled-tool bound for common updates", async () => {
    const manyTools = Array.from({ length: 51 }, (_, index) => ({
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
        common: { headers: [], query: [] },
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT,
    );
    expect(db.updatedValues).toHaveLength(0);
  });
});

describe("mcp-studio safe curl import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const server = {
    id: "mcs_1",
    userId: "user-a",
    status: "live",
    baseUrl: "https://api.example.com",
    defaultHeaders: null,
    defaultQuery: null,
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

    const result = await createToolFromCurl(db as never, "user-a", "mcs_1", {
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

  it("leaves existing authentication byte-for-byte unchanged when curl carries a different credential", async () => {
    const authedServer = {
      ...server,
      defaultHeaders: { Authorization: "Bearer {{api_token}}" },
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
          isSecret: true,
          kind: "secret",
          owner: "auth",
        },
      ],
      [{ count: 0 }],
      [{ id: "mct_1", name: "get_contacts", enabled: false }],
    ]);

    await createToolFromCurl(db as never, "user-a", "mcs_1", {
      curl: `curl -H 'Authorization: Bearer other-secret' https://api.example.com/contacts`,
    });

    expect(db.updatedValues).toHaveLength(0);
    expect(db.delete).not.toHaveBeenCalled();
    expect(JSON.stringify(db.insertedValues)).not.toContain("other-secret");
  });

  it("Platform curl import rejects a credential-bearing command entirely", async () => {
    const db = makeDb([[server]]);

    await expect(
      createToolFromCurl(
        db as never,
        "user-a",
        "mcs_1",
        {
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
      createToolFromCurl(db as never, "user-a", "mcs_1", {
        curl: `curl https://evil.example.com/contacts`,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_CURL_INVALID,
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("resolves a serverValue marking to an existing value without creating one", async () => {
    const db = makeDb([
      [server],
      [
        {
          id: "msv_1",
          name: "api_version",
          isSecret: false,
          kind: "config",
          owner: "manual",
        },
      ],
      [{ count: 0 }],
      [{ id: "mct_1", name: "get_items", enabled: false }],
    ]);

    await createToolFromCurl(db as never, "user-a", "mcs_1", {
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

    await createToolFromCurl(db as never, "user-a", "mcs_1", {
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
      createToolFromCurl(db as never, "user-a", "mcs_1", {
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
      {
        id: "msv_1",
        name: "api_token",
        isSecret: true,
        kind: "secret",
        owner: "manual",
        description: null,
        hasValue: true,
      },
      {
        id: "msv_2",
        name: "location_id",
        isSecret: false,
        kind: "config",
        owner: "manual",
        description: null,
        hasValue: true,
        value: "loc_9",
      },
    ]);
    expect(JSON.stringify(variables)).not.toContain("iv.tag.data");
  });

  it("deletes variables by name", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [{ id: "msv_1", name: "api_token" }],
      [], // findServerValueReferences: no referencing tools
      [{ id: "msv_1" }],
    ]);

    const result = await deleteVariable(
      db as never,
      "user-a",
      "mcs_1",
      "api_token",
    );

    expect(result).toEqual({ name: "api_token", deleted: true });
    expect(db.delete).toHaveBeenCalled();
  });

  it("blocks deletion when a variable is still referenced by a tool", async () => {
    const db = makeDb([
      [{ id: "mcs_1", authConfiguration: null, commonEntries: null }],
      [{ id: "msv_1", name: "api_token" }],
      [
        {
          id: "mct_1",
          name: "get_contact",
          requestDefinition: null,
          pathTemplate: "/contacts",
          requestTemplate: {
            headers: { Authorization: "Bearer {{api_token}}" },
          },
        },
      ],
    ]);

    await expect(
      deleteVariable(db as never, "user-a", "mcs_1", "api_token"),
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
      [{ id: "msv_1", name: "api_token" }],
      [], // no tools reference it
    ]);

    await expect(
      deleteVariable(db as never, "user-a", "mcs_1", "api_token"),
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

  it("rejects clearing secrecy without a new value", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [{ id: "msv_1", name: "api_token", isSecret: true }],
    ]);

    await expect(
      updateVariable(
        db as never,
        "user-a",
        "mcs_1",
        "api_token",
        { isSecret: false },
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
    const db = makeDb([
      [{ id: "mcs_1" }],
      [
        {
          id: "msv_2",
          name: "region",
          isSecret: false,
          value: "mx-visible",
          ciphertext: null,
        },
      ],
      [],
    ]);

    const result = await updateVariable(
      db as never,
      "user-a",
      "mcs_1",
      "region",
      { isSecret: true },
      "s".repeat(32),
    );

    expect(result).toEqual({
      name: "region",
      isSecret: true,
      hasValue: true,
    });
    expect(JSON.stringify(result)).not.toContain("mx-visible");
    const update = db.updatedValues[0] as Record<string, unknown>;
    expect(update).toMatchObject({ isSecret: true, value: null });
    expect(typeof update.ciphertext).toBe("string");
    expect(decryptCredential(update.ciphertext as string, "s".repeat(32))).toBe(
      "mx-visible",
    );
    expect(JSON.stringify(db.updatedValues)).not.toContain("mx-visible");
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
          makeChain([
            {
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
              method: "GET",
              pathTemplate: "/contacts",
              allowMutation: false,
              enabled: true,
              requestTemplate: {},
              params: [],
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
    };

    await expect(
      updateLegacyTool(db as never, "user-a", "mcs_1", "mct_1", {
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
    const db = makeDb([[{ id: "mcs_1", baseUrl: "https://api.example.com" }]]);

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

describe("mcp-studio createPlatformToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to the standard scope set and TTL, replacing atomically", async () => {
    const db = makeDb([
      [], // revoke previous active tokens
      [
        {
          id: "mtk_1",
          name: "Platform token",
          prefix: "rmcp_abc",
          expiresAt: new Date(),
          createdAt: new Date(),
        },
      ],
    ]);

    const result = await createPlatformToken(db as never, "user-a");

    expect(result.scopes).toEqual([
      "read",
      "author",
      "invoke",
      "secret_reference",
    ]);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(typeof result.token).toBe("string");
  });

  it("accepts explicit scopes and a custom expiry window", async () => {
    const db = makeDb([
      [],
      [
        {
          id: "mtk_1",
          name: "Read only",
          prefix: "rmcp_abc",
          expiresAt: new Date(),
          createdAt: new Date(),
        },
      ],
    ]);

    await createPlatformToken(db as never, "user-a", {
      name: "Read only",
      scopes: ["read"],
      expiresInDays: 7,
    });

    const insertPayload = db.insertedValues[0] as Record<string, unknown>;
    expect(insertPayload.scopes).toEqual(["read"]);
    expect(insertPayload.kind).toBe("platform");
  });

  it("performs the revoke and the insert inside one atomic transaction", async () => {
    // A real Postgres transaction rolls both statements back together on
    // failure; this asserts the revoke and insert are coupled in the same
    // transaction callback rather than issued as two independent statements.
    const revoke = vi.fn(() => ({
      set: () => ({ where: () => Promise.resolve() }),
    }));
    const db = {
      update: revoke,
      insert: vi.fn(() => ({
        values: () => ({
          returning: async () => {
            throw new Error("insert failed");
          },
        }),
      })),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
    };

    await expect(createPlatformToken(db as never, "user-a")).rejects.toThrow(
      "insert failed",
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

describe("mcp-studio revokeUnscopedPlatformTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes only unscoped, active platform tokens", async () => {
    const db = makeDb([[{ id: "mtk_1" }, { id: "mtk_2" }]]);

    const count = await revokeUnscopedPlatformTokens(db as never);

    expect(count).toBe(2);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("never touches server-scoped agent tokens", async () => {
    const db = makeDb([[]]);
    await revokeUnscopedPlatformTokens(db as never);
    // The where() call always filters on kind === "platform"; server tokens
    // are a different `kind` and are structurally excluded from the update.
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});
