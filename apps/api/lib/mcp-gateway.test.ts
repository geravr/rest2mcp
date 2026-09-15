import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { APP_ERROR_CODES } from "@repo/core";
import { appError } from "./app-error.js";
import type { AppContext } from "./context.js";

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
  mcpTool: { serverId: "serverId", enabled: "enabled" },
}));

vi.mock("@repo/db", () => tables);

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
}));

import { createMcpGatewayRoutes, deriveInputSchema } from "./mcp-gateway.js";
import { errorHandler } from "./middleware.js";

const SERVER_ROW = { id: "mcs_1", name: "CRM" };
const TOOL_ROWS = [
  {
    id: "mct_1",
    name: "get_contact",
    description: null,
    method: "GET",
    pathTemplate: "/contacts/{{id}}",
    params: [
      {
        name: "id",
        required: true,
        type: "string",
        description: "Contact id",
      },
    ],
    enabled: true,
  },
];

function gatewayDb() {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === tables.mcpTool) return Promise.resolve(TOOL_ROWS);
          return { limit: async () => [SERVER_ROW] };
        },
      }),
    }),
  };
}

function createApp() {
  const app = new Hono<AppContext>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("db", gatewayDb() as never);
    c.set("dbDirect", c.get("db"));
    c.set("env", { MCP_CREDENTIAL_SECRET: "s".repeat(32) } as never);
    await next();
  });
  app.route("/mcp", createMcpGatewayRoutes());
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("product MCP gateway", () => {
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

  describe("MCP round-trip", () => {
    async function connectClient() {
      authenticateAgentToken.mockResolvedValue({
        id: "mtk_1",
        kind: "server",
        serverId: "mcs_1",
        userId: "usr_1",
      });
      const app = createApp();
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

    it("lists tools with input schemas derived from params", async () => {
      const client = await connectClient();
      try {
        const { tools } = await client.listTools();

        expect(tools).toHaveLength(1);
        const tool = tools[0];
        expect(tool.name).toBe("get_contact");
        expect(tool.description).toBe("GET /contacts/{{id}}");
        expect(tool.inputSchema).toMatchObject({
          type: "object",
          properties: {
            id: { type: "string", description: "Contact id" },
          },
          required: ["id"],
        });
      } finally {
        await client.close();
      }
    });

    it("executes tools and returns the upstream payload", async () => {
      executeMappedTool.mockResolvedValue({
        httpStatus: 200,
        truncated: false,
        body: '{"ok":true}',
      });
      const client = await connectClient();
      try {
        const result = await client.callTool({
          name: "get_contact",
          arguments: { id: "1" },
        });

        expect(result.isError).toBeFalsy();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        const payload = JSON.parse(text) as {
          httpStatus: number;
          truncated: boolean;
          body: string;
        };
        expect(payload).toMatchObject({ httpStatus: 200, truncated: false });
        expect(JSON.parse(payload.body)).toEqual({ ok: true });
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

    it("returns upstream 401 as a tool result with httpStatus", async () => {
      executeMappedTool.mockResolvedValue({
        ok: false,
        httpStatus: 401,
        truncated: false,
        body: JSON.stringify({ error: "unauthorized" }),
        durationMs: 12,
        contentType: "application/json",
        callLogId: "log_1",
      });
      const client = await connectClient();
      try {
        const result = await client.callTool({
          name: "get_contact",
          arguments: { id: "1" },
        });

        expect(result.isError).toBeFalsy();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        const payload = JSON.parse(text) as {
          httpStatus: number;
          body: string;
        };
        expect(payload).toMatchObject({ httpStatus: 401 });
        expect(JSON.parse(payload.body)).toEqual({ error: "unauthorized" });
      } finally {
        await client.close();
      }
    });

    it("maps executor AppErrors to tool errors with appCode", async () => {
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
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).toContain(APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED);
        expect(text).toContain("Mutations are not allowed.");
      } finally {
        await client.close();
      }
    });
  });
});

describe("deriveInputSchema", () => {
  it("advertises an empty object schema for a paramless tool", () => {
    const schema = deriveInputSchema(null);

    expect(schema.safeParse({}).success).toBe(true);
    expect(z.toJSONSchema(schema)).toMatchObject({
      type: "object",
      properties: {},
    });
  });

  it("maps param types, required flags, and descriptions", () => {
    const schema = deriveInputSchema([
      {
        name: "query",
        type: "string",
        required: true,
        description: "Search text",
      },
      { name: "limit", type: "number", required: false },
      { name: "exact", type: "boolean", required: false },
      { name: "payload", type: "json", required: true },
    ]);

    expect(schema.safeParse({ query: "acme", payload: { a: 1 } }).success).toBe(
      true,
    );
    expect(schema.safeParse({ query: "acme", payload: null }).success).toBe(
      true,
    );
    expect(schema.safeParse({ query: "acme" }).success).toBe(false);
    expect(
      schema.safeParse({ query: "acme", limit: "ten", payload: 1 }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ query: "acme", exact: "yes", payload: 1 }).success,
    ).toBe(false);

    const json = z.toJSONSchema(schema) as {
      properties: Record<string, { description?: string }>;
      required?: string[];
    };
    expect(json.properties.query.description).toBe("Search text");
    expect(json.required).toEqual(expect.arrayContaining(["query", "payload"]));
    expect(json.required).not.toContain("limit");
  });
});
