import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "../lib/app-error.js";

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
  mcpCredential: {
    id: "mcp_credential.id",
    serverId: "mcp_credential.server_id",
    scheme: "mcp_credential.scheme",
    headerName: "mcp_credential.header_name",
    valueLocation: "mcp_credential.value_location",
    ciphertext: "mcp_credential.ciphertext",
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

vi.mock("@repo/db", () => tables);
vi.mock("../lib/user-access.js", () => ({ isUserBanned }));
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
  authenticateAgentToken,
  createServer,
  createTool,
  createToolFromCurl,
  deriveTrafficLight,
  getServer,
  listCallLogs,
  listServers,
  mutationDefaults,
  setCredential,
  toRecipeTemplate,
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
  return {
    select: vi.fn(() => next()),
    insert: vi.fn(capture(insertedValues, next)),
    update: vi.fn(capture(updatedValues, next)),
    insertedValues,
    updatedValues,
  };
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

  it("excludes ciphertext from the recipe template", () => {
    const recipe = toRecipeTemplate({
      name: "CRM",
      description: null,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      tools: [],
      credential: {
        scheme: "bearer",
        headerName: "Authorization",
        valueLocation: "header",
      },
    });
    expect(JSON.stringify(recipe)).not.toContain("ciphertext");
    expect(recipe.credentialScheme?.scheme).toBe("bearer");
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
        pathTemplate: "/contacts/{id}",
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
      [{ count: 0 }],
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

  it("setCredential returns hasSecret without the raw secret", async () => {
    const db = makeDb([[{ id: "mcs_1" }], []]);
    const result = await setCredential(
      db as never,
      "user-a",
      "mcs_1",
      {
        scheme: "bearer",
        valueLocation: "header",
        secret: "abc",
      },
      "s".repeat(32),
    );

    expect(result.hasSecret).toBe(true);
    expect(JSON.stringify(result)).not.toContain("abc");
    expect(db.insert).toHaveBeenCalled();
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

  it("defaults GET tools to enabled without mutation", async () => {
    const db = makeDb([
      [{ id: "mcs_1", status: "live" }],
      [{ count: 0 }],
      [{ id: "mct_1", name: "get_contact" }],
    ]);

    await createTool(db as never, "user-a", "mcs_1", {
      name: "get_contact",
      method: "GET",
      pathTemplate: "/contacts/{id}",
    });

    expect(db.insertedValues[0]).toMatchObject({
      method: "GET",
      allowMutation: false,
      enabled: true,
    });
  });

  it("strips curl secrets before persisting a tool", async () => {
    const db = makeDb([
      [{ id: "mcs_1", status: "live", baseUrl: "https://api.example.com" }],
      [{ count: 0 }],
      [{ id: "mct_1" }],
    ]);

    await createToolFromCurl(db as never, "user-a", "mcs_1", {
      curl: `curl -H 'Authorization: Bearer super-secret' https://api.example.com/contacts`,
    });

    expect(JSON.stringify(db.insertedValues)).not.toContain("super-secret");
    expect(JSON.stringify(db.insertedValues)).not.toContain("Authorization");
  });

  it("replaces an existing credential without echoing the secret", async () => {
    const db = makeDb([[{ id: "mcs_1" }], [{ id: "mcr_1" }], []]);
    const result = await setCredential(
      db as never,
      "user-a",
      "mcs_1",
      {
        scheme: "api_key",
        headerName: "X-API-Key",
        valueLocation: "header",
        secret: "rotated-secret",
      },
      "s".repeat(32),
    );

    expect(result.hasSecret).toBe(true);
    expect(result.scheme).toBe("api_key");
    expect(JSON.stringify(result)).not.toContain("rotated-secret");
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(JSON.stringify(db.updatedValues)).not.toContain("rotated-secret");
  });

  it("keeps the stored secret when replacing metadata only", async () => {
    const db = makeDb([
      [{ id: "mcs_1" }],
      [{ id: "mcr_1", ciphertext: "iv.tag.cipher" }],
      [],
    ]);
    const result = await setCredential(
      db as never,
      "user-a",
      "mcs_1",
      {
        scheme: "header",
        headerName: "X-API-Key",
        valueLocation: "query",
      },
      "s".repeat(32),
    );

    expect(result.hasSecret).toBe(true);
    expect(result.scheme).toBe("header");
    expect(db.update).toHaveBeenCalled();
    expect(db.updatedValues[0]).toMatchObject({
      ciphertext: "iv.tag.cipher",
      valueLocation: "query",
    });
  });
});
