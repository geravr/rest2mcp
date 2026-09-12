import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
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
const setVariable = vi.hoisted(() => vi.fn());
const listVariables = vi.hoisted(() => vi.fn());
const deleteVariable = vi.hoisted(() => vi.fn());
const deleteServer = vi.hoisted(() => vi.fn());
const deleteTool = vi.hoisted(() => vi.fn());

vi.mock("../services/mcp-studio-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-studio-service.js")
  >("../services/mcp-studio-service.js");
  return {
    ...actual,
    authenticateAgentToken,
    setVariable,
    listVariables,
    deleteVariable,
    deleteServer,
    deleteTool,
  };
});

import { buildConnectionSnippet } from "../services/mcp-studio-service.js";
import { createPlatformMcpRoutes } from "./mcp-platform.js";
import { errorHandler } from "./middleware.js";

function createApp() {
  const app = new Hono<AppContext>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("db", {} as never);
    c.set("dbDirect", {} as never);
    c.set("env", {
      MCP_CREDENTIAL_SECRET: "s".repeat(32),
      API_ORIGIN: "http://localhost:3456",
    } as never);
    await next();
  });
  app.route("/api/platform-mcp", createPlatformMcpRoutes());
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("platform MCP", () => {
  it("rejects a missing token", async () => {
    const response = await createApp().request("/api/platform-mcp", {
      method: "POST",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
  });

  it("rejects a server-scoped token", async () => {
    authenticateAgentToken.mockRejectedValue(
      appError({
        appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
        message: "Agent token is invalid.",
        status: 401,
      }),
    );

    const response = await createApp().request("/api/platform-mcp", {
      method: "POST",
      headers: { Authorization: "Bearer server-token" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
    expect(authenticateAgentToken).toHaveBeenCalledWith(
      expect.anything(),
      "server-token",
      { kind: "platform" },
    );
  });

  it("returns a snippet without ciphertext", () => {
    const snippet = buildConnectionSnippet("http://localhost:3456", "mcs_1");
    expect(snippet.url).toBe("http://localhost:3456/mcp/mcs_1");
    expect(JSON.stringify(snippet)).not.toContain("ciphertext");
  });

  describe("tool surface", () => {
    async function connectClient() {
      authenticateAgentToken.mockResolvedValue({
        id: "mtk_1",
        kind: "platform",
        userId: "usr_1",
      });
      const app = createApp();
      const transport = new StreamableHTTPClientTransport(
        new URL("http://test.local/api/platform-mcp"),
        {
          fetch: (input, init) =>
            app.request(input as string | URL, init) as Promise<Response>,
          requestInit: {
            headers: { Authorization: "Bearer platform-token" },
          },
        },
      );
      const client = new Client({ name: "test-client", version: "0.0.1" });
      await client.connect(transport);
      return client;
    }

    it("lists exactly the thirteen platform tools", async () => {
      const client = await connectClient();
      try {
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name).sort();

        expect(names).toEqual(
          [
            "add_tool",
            "add_tool_from_curl",
            "create_server",
            "delete_server",
            "delete_tool",
            "delete_variable",
            "get_connection_snippet",
            "list_recent_calls",
            "list_servers",
            "list_tools",
            "list_variables",
            "set_variable",
            "test_tool",
          ].sort(),
        );

        const addTool = tools.find((tool) => tool.name === "add_tool");
        const properties = (addTool?.inputSchema.properties ?? {}) as Record<
          string,
          unknown
        >;
        expect(properties).toHaveProperty("requestTemplate");
        expect(properties).toHaveProperty("params");
      } finally {
        await client.close();
      }
    });

    it("routes set_variable payloads to the studio service", async () => {
      setVariable.mockResolvedValue({ name: "api_token", isSecret: true });
      const client = await connectClient();
      try {
        const result = await client.callTool({
          name: "set_variable",
          arguments: {
            serverId: "mcs_1",
            name: "api_token",
            isSecret: true,
            value: "raw-secret",
          },
        });

        expect(result.isError).toBeFalsy();
        expect(setVariable).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          "mcs_1",
          { name: "api_token", isSecret: true, value: "raw-secret" },
          "s".repeat(32),
        );
      } finally {
        await client.close();
      }
    });

    it("routes delete_variable payloads to the studio service", async () => {
      deleteVariable.mockResolvedValue({ name: "api_token", deleted: true });
      const client = await connectClient();
      try {
        const result = await client.callTool({
          name: "delete_variable",
          arguments: { serverId: "mcs_1", name: "api_token" },
        });

        expect(result.isError).toBeFalsy();
        expect(deleteVariable).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          "mcs_1",
          "api_token",
        );
      } finally {
        await client.close();
      }
    });

    it("routes delete_server payloads to the studio service", async () => {
      deleteServer.mockResolvedValue({ id: "mcs_1", deleted: true });
      const client = await connectClient();
      try {
        const result = await client.callTool({
          name: "delete_server",
          arguments: { serverId: "mcs_1" },
        });

        expect(result.isError).toBeFalsy();
        expect(deleteServer).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          "mcs_1",
        );
      } finally {
        await client.close();
      }
    });

    it("routes delete_tool payloads to the studio service", async () => {
      deleteTool.mockResolvedValue({ id: "mct_1", deleted: true });
      const client = await connectClient();
      try {
        const result = await client.callTool({
          name: "delete_tool",
          arguments: { serverId: "mcs_1", toolId: "mct_1" },
        });

        expect(result.isError).toBeFalsy();
        expect(deleteTool).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          "mcs_1",
          "mct_1",
        );
      } finally {
        await client.close();
      }
    });

    it("lists variables without values", async () => {
      listVariables.mockResolvedValue([
        { id: "msv_1", name: "api_token", isSecret: true, hasValue: true },
        {
          id: "msv_2",
          name: "region",
          isSecret: false,
          hasValue: true,
          value: "mx",
        },
      ]);
      const client = await connectClient();
      try {
        const result = await client.callTool({
          name: "list_variables",
          arguments: { serverId: "mcs_1" },
        });

        expect(result.isError).toBeFalsy();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        const payload = JSON.parse(text) as Array<Record<string, unknown>>;
        expect(payload).toEqual([
          { id: "msv_1", name: "api_token", isSecret: true, hasValue: true },
          { id: "msv_2", name: "region", isSecret: false, hasValue: true },
        ]);
        expect(text).not.toContain('"mx"');
      } finally {
        await client.close();
      }
    });
  });
});
