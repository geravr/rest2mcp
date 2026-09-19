import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { APP_ERROR_CODES } from "@repo/core";
import { appError } from "./app-error.js";
import type { AppContext } from "./context.js";
import { resetRateLimitState } from "./mcp-rate-limit.js";
import { MCP_RATE_LIMIT_TOKEN_CAPACITY } from "./mcp-policy.js";

vi.mock("./posthog.js", () => ({
  captureServerException: vi.fn(),
  extractRequestTelemetryDetails: vi.fn(() => ({
    hasTracingHeaders: false,
  })),
}));

const authenticateAgentToken = vi.hoisted(() => vi.fn());
const executeMappedTool = vi.hoisted(() => vi.fn());

vi.mock("../services/mcp-studio-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-studio-service.js")
  >("../services/mcp-studio-service.js");
  return {
    ...actual,
    authenticateAgentToken,
  };
});

vi.mock("../services/mcp-executor-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-executor-service.js")
  >("../services/mcp-executor-service.js");
  return {
    ...actual,
    executeMappedTool,
  };
});

const tables = vi.hoisted(() => ({
  mcpServer: { id: "id" },
  mcpTool: { serverId: "serverId", enabled: "enabled", id: "id", name: "name" },
  mcpServerVariable: { serverId: "serverId" },
}));

vi.mock("@repo/db", () => tables);

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
}));

import { createMcpGatewayRoutes } from "./mcp-gateway.js";
import { buildAgentInputZodObject } from "./mcp-contract.js";
import { errorHandler } from "./middleware.js";

const SERVER_ROW = {
  id: "mcs_1",
  userId: "usr_1",
  name: "CRM",
  status: "live",
  baseUrl: "https://api.example.com",
  allowedHosts: ["api.example.com"],
  defaultHeaders: null,
  defaultQuery: null,
  commonEntries: null,
  authConfiguration: null,
};

const TOOL_ROWS = [
  {
    id: "mct_1",
    serverId: "mcs_1",
    name: "get_contact",
    title: "Get contact",
    description: "Fetch one contact by id.",
    method: "GET",
    pathTemplate: "/contacts/{{id}}",
    requestTemplate: {},
    params: [
      {
        name: "id",
        required: true,
        type: "string",
        description: "Contact id",
      },
    ],
    allowMutation: false,
    enabled: true,
    requestDefinition: null,
    compiledPlan: null,
    compileStatus: null,
  },
];

function selectResult(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return Object.assign(promise, { limit: () => Promise.resolve(rows) });
}

function gatewayDb(
  serverRow: typeof SERVER_ROW | null = SERVER_ROW,
  toolRows: typeof TOOL_ROWS = TOOL_ROWS,
) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === tables.mcpServer) {
            return selectResult(serverRow ? [serverRow] : []);
          }
          if (table === tables.mcpTool) return selectResult(toolRows);
          if (table === tables.mcpServerVariable) return selectResult([]);
          return selectResult([]);
        },
      }),
    }),
  };
}

function createApp(
  serverRow: typeof SERVER_ROW | null = SERVER_ROW,
  toolRows: typeof TOOL_ROWS = TOOL_ROWS,
) {
  const app = new Hono<AppContext>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("db", gatewayDb(serverRow, toolRows) as never);
    c.set("dbDirect", c.get("db"));
    c.set("env", {
      MCP_CREDENTIAL_SECRET: "s".repeat(32),
      APP_ORIGIN: "https://app.example.com",
    } as never);
    await next();
  });
  app.route("/mcp", createMcpGatewayRoutes());
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitState();
});

describe("product MCP gateway: transport guards", () => {
  it("rejects a missing token", async () => {
    const response = await createApp().request("/mcp/mcs_1", {
      method: "POST",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
    expect(authenticateAgentToken).not.toHaveBeenCalled();
  });

  it("rejects a token issued for another server", async () => {
    authenticateAgentToken.mockRejectedValue(
      appError({
        appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
        message: "Agent token is invalid.",
        status: 401,
      }),
    );

    const response = await createApp().request("/mcp/mcs_b", {
      method: "POST",
      headers: { Authorization: "Bearer other-server-token" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
    expect(authenticateAgentToken).toHaveBeenCalledWith(
      expect.anything(),
      "other-server-token",
      { kind: "server", serverId: "mcs_b" },
    );
  });

  it("rejects an untrusted Origin before authenticating", async () => {
    const response = await createApp().request("/mcp/mcs_1", {
      method: "POST",
      headers: {
        Authorization: "Bearer x",
        Origin: "https://evil.example",
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_ORIGIN_INVALID,
    });
    expect(authenticateAgentToken).not.toHaveBeenCalled();
  });

  it("allows a trusted Origin to proceed to authentication", async () => {
    const response = await createApp().request("/mcp/mcs_1", {
      method: "POST",
      headers: { Origin: "https://app.example.com" },
    });

    // No bearer token provided, so it still 401s — but past the Origin gate.
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
  });

  it("rejects an oversized request body", async () => {
    const response = await createApp().request("/mcp/mcs_1", {
      method: "POST",
      headers: {
        Authorization: "Bearer x",
        "content-length": String(10 * 1024 * 1024),
      },
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_REQUEST_TOO_LARGE,
    });
  });
});

describe("MCP round-trip", () => {
  async function connectClient(
    serverRow: typeof SERVER_ROW | null = SERVER_ROW,
    toolRows: typeof TOOL_ROWS = TOOL_ROWS,
  ) {
    authenticateAgentToken.mockResolvedValue({
      id: "mtk_1",
      kind: "server",
      serverId: "mcs_1",
      userId: "usr_1",
    });
    const app = createApp(serverRow, toolRows);
    const transport = new StreamableHTTPClientTransport(
      new URL("http://test.local/mcp/mcs_1"),
      {
        fetch: (input, init) =>
          app.request(input as string | URL, init) as Promise<Response>,
        requestInit: {
          headers: { Authorization: "Bearer server-token" },
        },
      },
    );
    const client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(transport);
    return client;
  }

  it("lists tools with input schemas derived from the compiled plan", async () => {
    const client = await connectClient();
    try {
      const { tools } = await client.listTools();

      expect(tools).toHaveLength(1);
      const tool = tools[0];
      expect(tool.name).toBe("get_contact");
      expect(tool.title).toBe("Get contact");
      expect(tool.description).toBe("Fetch one contact by id.");
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        properties: {
          id: { type: "string", description: "Contact id" },
        },
        required: ["id"],
        additionalProperties: false,
      });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
      expect(tool._meta).toMatchObject({
        "io.rest2mcp/contract": { version: 1 },
      });
    } finally {
      await client.close();
    }
  });

  it("lists no callable tools for a paused server", async () => {
    const client = await connectClient({ ...SERVER_ROW, status: "paused" });
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it("executes tools and returns structuredContent for a successful call", async () => {
    executeMappedTool.mockResolvedValue({
      ok: true,
      httpStatus: 200,
      envelope: {
        ok: true,
        status: 200,
        contentType: "application/json",
        headers: {},
        truncated: false,
        body: '{"ok":true}',
        data: { ok: true },
      },
      durationMs: 5,
      callLogId: "log_1",
      secretsUsed: [],
    });
    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: "get_contact",
        arguments: { id: "1" },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        ok: true,
        status: 200,
        data: { ok: true },
      });
      expect(executeMappedTool).toHaveBeenCalledWith(expect.anything(), {
        serverId: "mcs_1",
        toolId: "mct_1",
        args: { id: "1" },
        source: "agent",
        credentialSecret: "s".repeat(32),
      });
    } finally {
      await client.close();
    }
  });

  it("returns structured invalid-arguments diagnostics without calling upstream", async () => {
    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: "get_contact",
        arguments: { id: 123 },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { category: "invalid_arguments", retryable: false },
      });
      const error = (
        result.structuredContent as {
          error: { issues: Array<{ path: string }> };
        }
      ).error;
      expect(error.issues[0]?.path).toBe("id");
      expect(executeMappedTool).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("returns a completed upstream 401 as isError:true structuredContent", async () => {
    executeMappedTool.mockResolvedValue({
      ok: false,
      httpStatus: 401,
      envelope: {
        ok: false,
        status: 401,
        contentType: "application/json",
        headers: {},
        truncated: false,
        body: JSON.stringify({ error: "unauthorized" }),
        data: { error: "unauthorized" },
        error: {
          category: "auth",
          code: APP_ERROR_CODES.MCP_UPSTREAM_HTTP_ERROR,
          message: "Upstream authentication failed.",
          retryable: false,
        },
      },
      durationMs: 12,
      callLogId: "log_1",
      secretsUsed: [],
    });
    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: "get_contact",
        arguments: { id: "1" },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        status: 401,
        error: {
          category: "auth",
          code: APP_ERROR_CODES.MCP_UPSTREAM_HTTP_ERROR,
          retryable: false,
        },
      });
    } finally {
      await client.close();
    }
  });

  it("maps a thrown executor AppError to the structured error contract", async () => {
    executeMappedTool.mockRejectedValue(
      appError({
        appCode: APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
        message: "Mutations are not allowed.",
        status: 403,
      }),
    );
    const client = await connectClient();
    try {
      const result = await client.callTool({
        name: "get_contact",
        arguments: { id: "1" },
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: {
          category: "policy",
          code: APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
          message: "Mutations are not allowed.",
          retryable: false,
        },
      });
    } finally {
      await client.close();
    }
  });

  it("rate-limits invocations beyond the per-token budget", async () => {
    executeMappedTool.mockResolvedValue({
      ok: true,
      httpStatus: 200,
      envelope: {
        ok: true,
        status: 200,
        contentType: "application/json",
        headers: {},
        truncated: false,
        body: "{}",
      },
      durationMs: 1,
      callLogId: "log_1",
      secretsUsed: [],
    });
    const client = await connectClient();
    try {
      for (let i = 0; i < MCP_RATE_LIMIT_TOKEN_CAPACITY; i += 1) {
        const result = await client.callTool({
          name: "get_contact",
          arguments: { id: "1" },
        });
        expect(result.isError).toBeFalsy();
      }

      const limited = await client.callTool({
        name: "get_contact",
        arguments: { id: "1" },
      });
      expect(limited.isError).toBe(true);
      expect(limited.structuredContent).toMatchObject({
        ok: false,
        error: {
          category: "rate_limit",
          code: APP_ERROR_CODES.MCP_RATE_LIMITED,
          retryable: true,
        },
      });
    } finally {
      await client.close();
    }
  }, 20_000);
});

describe("buildAgentInputZodObject", () => {
  it("advertises a closed empty object schema for a tool with no inputs", () => {
    const schema = buildAgentInputZodObject([]);

    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ extra: 1 }).success).toBe(false);
    expect(z.toJSONSchema(schema)).toMatchObject({
      type: "object",
      properties: {},
    });
  });

  it("maps agent input types, constraints, required flags, and descriptions", () => {
    const schema = buildAgentInputZodObject([
      {
        id: "in_query",
        name: "query",
        type: "string",
        required: true,
        sensitive: false,
        description: "Search text",
      },
      {
        id: "in_limit",
        name: "limit",
        type: "integer",
        required: false,
        sensitive: false,
        minimum: 1,
        maximum: 100,
      },
      {
        id: "in_exact",
        name: "exact",
        type: "boolean",
        required: false,
        sensitive: false,
      },
      {
        id: "in_payload",
        name: "payload",
        type: "json",
        required: true,
        sensitive: false,
      },
    ]);

    expect(schema.safeParse({ query: "acme", payload: { a: 1 } }).success).toBe(
      true,
    );
    expect(schema.safeParse({ query: "acme" }).success).toBe(false);
    expect(
      schema.safeParse({ query: "acme", limit: 200, payload: 1 }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ query: "acme", exact: "yes", payload: 1 }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ query: "acme", limit: 10, payload: 1 }).success,
    ).toBe(true);

    const json = z.toJSONSchema(schema) as {
      properties: Record<string, { description?: string }>;
      required?: string[];
    };
    expect(json.properties.query.description).toBe("Search text");
    expect(json.required).toEqual(expect.arrayContaining(["query", "payload"]));
    expect(json.required).not.toContain("limit");
  });
});
