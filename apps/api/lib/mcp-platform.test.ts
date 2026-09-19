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
const createServer = vi.hoisted(() => vi.fn());
const createToolFromCurl = vi.hoisted(() => vi.fn());
const createTool = vi.hoisted(() => vi.fn());
const updateTool = vi.hoisted(() => vi.fn());
const duplicateTool = vi.hoisted(() => vi.fn());
const previewToolCompile = vi.hoisted(() => vi.fn());
const getToolEditorState = vi.hoisted(() => vi.fn());
const listVariables = vi.hoisted(() => vi.fn());
const deleteVariable = vi.hoisted(() => vi.fn());
const deleteServer = vi.hoisted(() => vi.fn());
const deleteTool = vi.hoisted(() => vi.fn());
const getServerName = vi.hoisted(() => vi.fn());
const getToolName = vi.hoisted(() => vi.fn());
const listServers = vi.hoisted(() => vi.fn());
const listTools = vi.hoisted(() => vi.fn());
const executeMappedTool = vi.hoisted(() => vi.fn());

vi.mock("../services/mcp-studio-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-studio-service.js")
  >("../services/mcp-studio-service.js");
  return {
    ...actual,
    authenticateAgentToken,
    setVariable,
    createServer,
    createToolFromCurl,
    createTool,
    updateTool,
    duplicateTool,
    previewToolCompile,
    getToolEditorState,
    listVariables,
    deleteVariable,
    deleteServer,
    deleteTool,
    getServerName,
    getToolName,
    listServers,
    listTools,
  };
});

vi.mock("../services/mcp-executor-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-executor-service.js")
  >("../services/mcp-executor-service.js");
  return { ...actual, executeMappedTool };
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

const ALL_SCOPES = [
  "read",
  "author",
  "invoke",
  "secret_reference",
  "destructive",
];

async function connectClient(scopes: string[] = ALL_SCOPES) {
  authenticateAgentToken.mockResolvedValue({
    id: "mtk_1",
    kind: "platform",
    userId: "usr_1",
    scopes,
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

  describe("scope-gated tool visibility", () => {
    it("lists the full tool set for a fully scoped token", async () => {
      const client = await connectClient();
      try {
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name).sort();

        expect(names).toEqual(
          [
            "add_tool_from_curl",
            "create_server",
            "create_tool",
            "delete_server",
            "delete_tool",
            "delete_variable",
            "duplicate_tool",
            "get_connection_snippet",
            "list_recent_calls",
            "list_servers",
            "list_tools",
            "list_variables",
            "preview_tool",
            "set_variable",
            "test_tool",
            "update_tool",
          ].sort(),
        );
        // Platform never accepts a plaintext auth recipe on create_server.
        const createServerTool = tools.find((t) => t.name === "create_server");
        expect(createServerTool?.inputSchema.properties).not.toHaveProperty(
          "auth",
        );
        // set_server_auth is removed entirely — Platform cannot set credentials.
        expect(names).not.toContain("set_server_auth");
      } finally {
        await client.close();
      }
    });

    it("a read-only token only sees read tools", async () => {
      const client = await connectClient(["read"]);
      try {
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name).sort();
        expect(names).toEqual(
          [
            "get_connection_snippet",
            "list_recent_calls",
            "list_servers",
            "list_tools",
            "list_variables",
          ].sort(),
        );
      } finally {
        await client.close();
      }
    });

    it("a read-only token cannot call test_tool", async () => {
      const client = await connectClient(["read"]);
      try {
        const result = await client.callTool({
          name: "test_tool",
          arguments: { serverId: "mcs_1", toolId: "mct_1" },
        });
        expect(result.isError).toBe(true);
        expect(executeMappedTool).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("an author token cannot see or call delete tools", async () => {
      const client = await connectClient(["read", "author"]);
      try {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name);
        expect(names).not.toContain("delete_server");
        expect(names).not.toContain("delete_tool");
        expect(names).not.toContain("delete_variable");
      } finally {
        await client.close();
      }
    });
  });

  describe("authoring tools", () => {
    it("creates a server without accepting an auth recipe", async () => {
      createServer.mockResolvedValue({
        id: "mcs_1",
        name: "CRM",
        slug: "crm",
        description: null,
        baseUrl: "https://api.example.com",
        allowedHosts: ["api.example.com"],
        status: "draft",
        configRevision: 1,
        trafficLight: "draft",
        enabledToolCount: 0,
        lastCallAt: null,
      });
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "create_server",
          arguments: { name: "CRM", baseUrl: "https://api.example.com" },
        });

        expect(result.isError).toBeFalsy();
        expect(createServer).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          expect.objectContaining({ name: "CRM" }),
        );
        // No credentialSecret / auth argument ever reaches the service call.
        expect(createServer.mock.calls[0]).toHaveLength(3);
      } finally {
        await client.close();
      }
    });

    it("returns repairable invalid-arguments diagnostics", async () => {
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "create_server",
          arguments: { name: "CRM", baseUrl: "not-a-url" },
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
        expect(error.issues[0]?.path).toBe("baseUrl");
        expect(createServer).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("routes create_tool typed payloads to the studio service", async () => {
      createTool.mockResolvedValue({
        id: "mct_1",
        name: "get_contact",
        method: "GET",
        requestDefinition: {
          version: 1,
          pathSegments: [],
          query: [],
          headers: [],
          body: { bodyType: "none" },
          agentInputs: [],
        },
        compileStatus: "valid",
        compileIssues: [],
        annotations: null,
        allowMutation: false,
        enabled: true,
        source: "manual",
      });
      listVariables.mockResolvedValue([]);
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "create_tool",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            name: "get_contact",
            method: "GET",
            requestDefinition: {
              version: 1,
              pathSegments: [
                {
                  id: "path_1",
                  value: { kind: "literal", value: "/contacts/" },
                },
                {
                  id: "path_2",
                  value: { kind: "agentInput", agentInputId: "ain_1" },
                },
              ],
              query: [],
              headers: [],
              body: { bodyType: "none" },
              agentInputs: [
                { id: "ain_1", name: "id", required: true, type: "string" },
              ],
            },
          },
        });
        expect(result.isError).toBeFalsy();
        expect(createTool).toHaveBeenCalled();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        // Canonical typed result, no legacy compatibility fields.
        expect(text).not.toContain("pathTemplate");
        expect(text).not.toContain("requestTemplate");
      } finally {
        await client.close();
      }
    });

    it("returns a secret-free structured conflict with the current revision", async () => {
      listVariables.mockResolvedValue([]);
      updateTool.mockRejectedValue(
        appError({
          appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
          message:
            "The server configuration changed elsewhere. Reload before retrying.",
          status: 409,
          details: { currentRevision: 7, serverId: "mcs_1" },
        }),
      );
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "update_tool",
          arguments: {
            expectedRevision: 3,
            serverId: "mcs_1",
            toolId: "mct_1",
            name: "get_contact",
            method: "GET",
            requestDefinition: {
              version: 1,
              pathSegments: [],
              query: [],
              headers: [],
              body: { bodyType: "none" },
              agentInputs: [],
            },
          },
        });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          ok: false,
          error: {
            category: "conflict",
            code: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
            retryable: false,
            currentRevision: 7,
            serverId: "mcs_1",
          },
        });
        expect(JSON.stringify(result.structuredContent)).not.toContain("rmcp_");
      } finally {
        await client.close();
      }
    });

    it("marks exhausted fully-rolled-back transient failures retryable", async () => {
      listVariables.mockResolvedValue([]);
      updateTool.mockRejectedValue(
        appError({
          appCode: APP_ERROR_CODES.MCP_TRANSIENT_WRITE_FAILURE,
          message: "The write failed after retries with no partial change.",
          status: 503,
          details: { retryable: true, serverId: "mcs_1" },
        }),
      );
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "update_tool",
          arguments: {
            expectedRevision: 3,
            serverId: "mcs_1",
            toolId: "mct_1",
            name: "get_contact",
            method: "GET",
            requestDefinition: {
              version: 1,
              pathSegments: [],
              query: [],
              headers: [],
              body: { bodyType: "none" },
              agentInputs: [],
            },
          },
        });
        expect(result.structuredContent).toMatchObject({
          ok: false,
          error: {
            code: APP_ERROR_CODES.MCP_TRANSIENT_WRITE_FAILURE,
            retryable: true,
          },
        });
      } finally {
        await client.close();
      }
    });

    it("returns the committed revision on a successful agent mutation", async () => {
      listVariables.mockResolvedValue([]);
      createTool.mockResolvedValue({
        id: "mct_1",
        name: "get_contact",
        title: "Get contact",
        description: "Fetch one contact.",
        method: "GET",
        requestDefinition: { version: 1 },
        compileStatus: "valid",
        compileIssues: [],
        annotations: null,
        allowMutation: false,
        enabled: true,
        source: "manual",
        revision: 6,
      });
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "create_tool",
          arguments: {
            expectedRevision: 5,
            serverId: "mcs_1",
            name: "get_contact",
            method: "GET",
            requestDefinition: {
              version: 1,
              pathSegments: [],
              query: [],
              headers: [],
              body: { bodyType: "none" },
              agentInputs: [],
            },
          },
        });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toMatchObject({
          ok: true,
          data: { id: "mct_1", revision: 6 },
        });
      } finally {
        await client.close();
      }
    });

    it("rejects mixed typed and legacy create_tool payloads", async () => {
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "create_tool",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            name: "get_contact",
            method: "GET",
            pathTemplate: "/contacts/{{id}}",
            requestDefinition: {
              version: 1,
              pathSegments: [],
              query: [],
              headers: [],
              body: { bodyType: "none" },
              agentInputs: [],
            },
          },
        });
        expect(result.isError).toBe(true);
        expect(createTool).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("denies secret server-value bindings without secret_reference scope", async () => {
      listVariables.mockResolvedValue([
        { id: "msv_1", name: "api_token", isSecret: true, hasValue: true },
      ]);
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "create_tool",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            name: "secure_get",
            method: "GET",
            requestDefinition: {
              version: 1,
              pathSegments: [
                { id: "path_1", value: { kind: "literal", value: "/x" } },
              ],
              query: [],
              headers: [
                {
                  id: "hdr_1",
                  name: "X-Token",
                  value: {
                    kind: "serverValue",
                    serverValueId: "msv_1",
                  },
                },
              ],
              body: { bodyType: "none" },
              agentInputs: [],
            },
          },
        });
        expect(result.isError).toBe(true);
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
        expect(createTool).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("allows owned secret references with secret_reference scope", async () => {
      createTool.mockResolvedValue({
        id: "mct_1",
        name: "secure_get",
        method: "GET",
        requestDefinition: { version: 1 },
        compileStatus: "valid",
        compileIssues: [],
        annotations: null,
        allowMutation: false,
        enabled: true,
        source: "manual",
      });
      listVariables.mockResolvedValue([
        { id: "msv_1", name: "api_token", isSecret: true, hasValue: true },
      ]);
      const client = await connectClient(["author", "secret_reference"]);
      try {
        const result = await client.callTool({
          name: "create_tool",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            name: "secure_get",
            method: "GET",
            requestDefinition: {
              version: 1,
              pathSegments: [
                { id: "path_1", value: { kind: "literal", value: "/x" } },
              ],
              query: [],
              headers: [
                {
                  id: "hdr_1",
                  name: "X-Token",
                  value: {
                    kind: "serverValue",
                    serverValueId: "msv_1",
                  },
                },
              ],
              body: { bodyType: "none" },
              agentInputs: [],
            },
          },
        });
        expect(result.isError).toBeFalsy();
        expect(createTool).toHaveBeenCalled();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).not.toContain("api_token");
      } finally {
        await client.close();
      }
    });

    it("previews and duplicates through the typed services", async () => {
      previewToolCompile.mockResolvedValue({
        ok: false,
        ready: false,
        issues: [
          {
            path: "query[0]",
            id: "query_1",
            code: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
            message: "unresolved",
            severity: "error",
          },
        ],
        plan: null,
        contract: null,
        compatibilityProjectable: false,
      });
      duplicateTool.mockResolvedValue({
        id: "mct_2",
        name: "get_contact_copy",
        method: "GET",
        requestDefinition: { version: 1 },
        compileStatus: "valid",
        compileIssues: [],
        annotations: null,
        allowMutation: false,
        enabled: true,
        source: "manual",
      });
      getToolEditorState.mockResolvedValue({
        toolId: "mct_1",
        typed: true,
        definition: {
          version: 1,
          pathSegments: [],
          query: [],
          headers: [],
          body: { bodyType: "none" },
          agentInputs: [],
        },
        issues: [],
        conversionDraft: null,
        conversionIssues: [],
      });
      listVariables.mockResolvedValue([]);
      const client = await connectClient(["author"]);
      try {
        const preview = await client.callTool({
          name: "preview_tool",
          arguments: {
            serverId: "mcs_1",
            method: "GET",
            requestDefinition: {
              version: 1,
              pathSegments: [],
              query: [],
              headers: [],
              body: { bodyType: "none" },
              agentInputs: [],
            },
          },
        });
        expect(preview.isError).toBeFalsy();
        const previewText = (
          preview.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(previewText).toContain(APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED);
        expect(previewText).toContain("query_1");

        const dup = await client.callTool({
          name: "duplicate_tool",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            toolId: "mct_1",
          },
        });
        expect(dup.isError).toBeFalsy();
        expect(duplicateTool).toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("redacts sensitive input examples from returned tool rows", async () => {
      duplicateTool.mockResolvedValue({
        id: "mct_2",
        name: "secure_get_copy",
        method: "GET",
        requestDefinition: {
          version: 1,
          pathSegments: [],
          query: [],
          headers: [],
          body: { bodyType: "none" },
          agentInputs: [
            {
              id: "ain_1",
              name: "token",
              required: true,
              sensitive: true,
              type: "string",
              examples: ["sk-live-secret"],
            },
          ],
        },
        compileStatus: "valid",
        compileIssues: [],
        annotations: null,
        allowMutation: false,
        enabled: false,
        source: "manual",
      });
      getToolEditorState.mockResolvedValue({
        toolId: "mct_1",
        typed: true,
        definition: {
          version: 1,
          pathSegments: [],
          query: [],
          headers: [],
          body: { bodyType: "none" },
          agentInputs: [],
        },
        issues: [],
        conversionDraft: null,
        conversionIssues: [],
      });
      listVariables.mockResolvedValue([]);
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "duplicate_tool",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            toolId: "mct_1",
          },
        });
        expect(result.isError).toBeFalsy();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).not.toContain("sk-live-secret");
        const data = (
          result.structuredContent as {
            data: {
              requestDefinition: {
                agentInputs: Array<Record<string, unknown>>;
              };
            };
          }
        ).data;
        expect(data.requestDefinition.agentInputs[0]).not.toHaveProperty(
          "examples",
        );
      } finally {
        await client.close();
      }
    });

    it("rejects set_variable requests for a plaintext secret", async () => {
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "set_variable",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            name: "api_token",
            kind: "secret",
            value: "raw-secret",
          },
        });
        expect(result.isError).toBe(true);
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).toContain(APP_ERROR_CODES.MCP_PLAINTEXT_SECRET);
        expect(setVariable).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("allows set_variable for a non-secret configuration value", async () => {
      setVariable.mockResolvedValue({ name: "region", isSecret: false });
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "set_variable",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            name: "region",
            kind: "config",
            value: "mx",
          },
        });
        expect(result.isError).toBeFalsy();
        expect(setVariable).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          "mcs_1",
          { expectedRevision: 1, name: "region", isSecret: false, value: "mx" },
          "s".repeat(32),
        );
      } finally {
        await client.close();
      }
    });

    it("refuses to overwrite an existing secret through set_variable", async () => {
      listVariables.mockResolvedValueOnce([
        { id: "msv_1", name: "api_token", isSecret: true, hasValue: true },
      ]);
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "set_variable",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            name: "api_token",
            kind: "config",
            value: "plaintext",
          },
        });
        expect(result.isError).toBe(true);
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).toContain(APP_ERROR_CODES.MCP_PLAINTEXT_SECRET);
        expect(setVariable).not.toHaveBeenCalled();
      } finally {
        listVariables.mockResolvedValue([]);
        await client.close();
      }
    });

    it("rejects secret-bearing curl entirely instead of sanitizing it", async () => {
      createToolFromCurl.mockResolvedValue({
        id: "mct_1",
        name: "get_items",
        enabled: false,
      });
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "add_tool_from_curl",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            curl: `curl -H 'Authorization: Bearer secret' https://api.example.com/v1/items`,
            markings: [],
          },
        });
        expect(result.isError).toBeFalsy();
        expect(createToolFromCurl).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          "mcs_1",
          expect.objectContaining({ serverId: "mcs_1" }),
          { rejectCredentials: true },
        );
      } finally {
        await client.close();
      }
    });
  });

  describe("invoke", () => {
    it("test_tool runs through the shared executor with invoke scope", async () => {
      executeMappedTool.mockResolvedValue({
        ok: true,
        httpStatus: 200,
        envelope: {
          ok: true,
          status: 200,
          contentType: "application/json",
          headers: {},
          truncated: false,
          data: {},
        },
        durationMs: 3,
        callLogId: "log_1",
        secretsUsed: [],
      });
      const client = await connectClient(["invoke"]);
      try {
        const result = await client.callTool({
          name: "test_tool",
          arguments: { serverId: "mcs_1", toolId: "mct_1" },
        });
        expect(result.isError).toBeFalsy();
        expect(executeMappedTool).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            serverId: "mcs_1",
            toolId: "mct_1",
            source: "platform",
            ownerUserId: "usr_1",
          }),
        );
      } finally {
        await client.close();
      }
    });
  });

  describe("destructive operations", () => {
    it("delete_server requires confirm to match the current name", async () => {
      getServerName.mockResolvedValue("CRM");
      const client = await connectClient(["destructive"]);
      try {
        const result = await client.callTool({
          name: "delete_server",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            confirm: "Not CRM",
          },
        });
        expect(result.isError).toBe(true);
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).toContain(
          APP_ERROR_CODES.MCP_DESTRUCTIVE_CONFIRMATION_REQUIRED,
        );
        expect(deleteServer).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("delete_server succeeds when confirm matches the current name", async () => {
      getServerName.mockResolvedValue("CRM");
      deleteServer.mockResolvedValue({ id: "mcs_1", deleted: true });
      const client = await connectClient(["destructive"]);
      try {
        const result = await client.callTool({
          name: "delete_server",
          arguments: { expectedRevision: 1, serverId: "mcs_1", confirm: "CRM" },
        });
        expect(result.isError).toBeFalsy();
        expect(deleteServer).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          "mcs_1",
          1,
        );
      } finally {
        await client.close();
      }
    });

    it("delete_tool requires confirm to match the tool's current name", async () => {
      getToolName.mockResolvedValue("get_contacts");
      const client = await connectClient(["destructive"]);
      try {
        const result = await client.callTool({
          name: "delete_tool",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            toolId: "mct_1",
            confirm: "wrong_name",
          },
        });
        expect(result.isError).toBe(true);
        expect(deleteTool).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("delete_variable requires confirm to repeat the variable name", async () => {
      const client = await connectClient(["destructive"]);
      try {
        const result = await client.callTool({
          name: "delete_variable",
          arguments: { serverId: "mcs_1", name: "api_token", confirm: "nope" },
        });
        expect(result.isError).toBe(true);
        expect(deleteVariable).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("delete_variable succeeds when confirm repeats the name", async () => {
      deleteVariable.mockResolvedValue({ name: "api_token", deleted: true });
      const client = await connectClient(["destructive"]);
      try {
        const result = await client.callTool({
          name: "delete_variable",
          arguments: {
            expectedRevision: 1,
            serverId: "mcs_1",
            name: "api_token",
            confirm: "api_token",
          },
        });
        expect(result.isError).toBeFalsy();
        expect(deleteVariable).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          "mcs_1",
          "api_token",
          1,
        );
      } finally {
        await client.close();
      }
    });
  });

  describe("secret non-disclosure", () => {
    it("lists secret metadata only with secret_reference scope", async () => {
      listVariables.mockResolvedValue([
        { id: "msv_1", name: "api_token", isSecret: true, hasValue: true },
        {
          id: "msv_2",
          name: "region",
          isSecret: false,
          hasValue: true,
          value: "mx",
          kind: "config",
          owner: "manual",
        },
      ]);
      const client = await connectClient(["read", "secret_reference"]);
      try {
        const result = await client.callTool({
          name: "list_variables",
          arguments: { serverId: "mcs_1" },
        });

        expect(result.isError).toBeFalsy();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        const payload = (
          result.structuredContent as { data: Array<Record<string, unknown>> }
        ).data;
        expect(payload).toEqual([
          {
            id: "msv_1",
            name: "api_token",
            isSecret: true,
            hasValue: true,
          },
          {
            id: "msv_2",
            name: "region",
            isSecret: false,
            hasValue: true,
            kind: "config",
            owner: "manual",
          },
        ]);
        expect(text).not.toContain('"mx"');
      } finally {
        await client.close();
      }
    });

    it("omits secret rows without secret_reference scope", async () => {
      listVariables.mockResolvedValue([
        { id: "msv_1", name: "api_token", isSecret: true, hasValue: true },
        {
          id: "msv_2",
          name: "region",
          isSecret: false,
          hasValue: true,
          value: "mx",
          kind: "config",
          owner: "manual",
        },
      ]);
      const client = await connectClient(["read"]);
      try {
        const result = await client.callTool({
          name: "list_variables",
          arguments: { serverId: "mcs_1" },
        });
        expect(result.isError).toBeFalsy();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        const payload = (
          result.structuredContent as { data: Array<Record<string, unknown>> }
        ).data;
        expect(payload).toEqual([
          {
            id: "msv_2",
            name: "region",
            isSecret: false,
            hasValue: true,
            kind: "config",
            owner: "manual",
          },
        ]);
        expect(text).not.toContain("api_token");
      } finally {
        await client.close();
      }
    });
  });
});
