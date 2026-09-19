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

const authenticatePlatformPat = vi.hoisted(() => vi.fn());
const setVariable = vi.hoisted(() => vi.fn());
const createServer = vi.hoisted(() => vi.fn());
const createToolFromCurl = vi.hoisted(() => vi.fn());
const createTool = vi.hoisted(() => vi.fn());
const updateTool = vi.hoisted(() => vi.fn());
const duplicateTool = vi.hoisted(() => vi.fn());
const previewToolCompile = vi.hoisted(() => vi.fn());
const getToolEditorState = vi.hoisted(() => vi.fn());
const getToolEnabledState = vi.hoisted(() => vi.fn());
const isServerValueRuntimeEffective = vi.hoisted(() => vi.fn());
const listVariables = vi.hoisted(() => vi.fn());
const deleteVariable = vi.hoisted(() => vi.fn());
const deleteServer = vi.hoisted(() => vi.fn());
const deleteTool = vi.hoisted(() => vi.fn());
const getServerName = vi.hoisted(() => vi.fn());
const getToolName = vi.hoisted(() => vi.fn());
const getToolMethod = vi.hoisted(() => vi.fn());
const listServers = vi.hoisted(() => vi.fn());
const listTools = vi.hoisted(() => vi.fn());
const executeMappedTool = vi.hoisted(() => vi.fn());
const handleMcpHttpRequest = vi.hoisted(() => vi.fn());

vi.mock("../services/mcp-studio-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-studio-service.js")
  >("../services/mcp-studio-service.js");
  return {
    ...actual,
    setVariable,
    createServer,
    createToolFromCurl,
    createTool,
    updateTool,
    duplicateTool,
    previewToolCompile,
    getToolEditorState,
    getToolEnabledState,
    isServerValueRuntimeEffective,
    listVariables,
    deleteVariable,
    deleteServer,
    deleteTool,
    getServerName,
    getToolName,
    getToolMethod,
    listServers,
    listTools,
  };
});

vi.mock("../services/mcp-platform-token-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-platform-token-service.js")
  >("../services/mcp-platform-token-service.js");
  return { ...actual, authenticatePlatformPat };
});

vi.mock("../services/mcp-executor-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-executor-service.js")
  >("../services/mcp-executor-service.js");
  return { ...actual, executeMappedTool };
});

vi.mock("./mcp-http.js", async () => {
  const actual =
    await vi.importActual<typeof import("./mcp-http.js")>("./mcp-http.js");
  handleMcpHttpRequest.mockImplementation(actual.handleMcpHttpRequest);
  return { ...actual, handleMcpHttpRequest };
});

import { buildConnectionSnippet } from "../services/mcp-studio-service.js";
import { createPlatformMcpRoutes } from "./mcp-platform.js";
import { errorHandler } from "./middleware.js";
import { resetRateLimitState } from "./mcp-rate-limit.js";
import { MCP_GATEWAY_REQUEST_SIZE_LIMIT } from "./mcp-policy.js";

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
  resetRateLimitState();
});

const ALL_SCOPES = [
  "read",
  "observe",
  "author",
  "publish",
  "invoke",
  "invoke_mutation",
  "secret_reference",
  "destructive",
];

async function connectClient(
  scopes: string[] = ALL_SCOPES,
  resourceMode: "account" | "selected" = "account",
) {
  authenticatePlatformPat.mockResolvedValue({
    tokenId: "mtk_1",
    userId: "usr_1",
    tokenName: "Test PAT",
    tokenPrefix: "rmcp_test",
    policyVersion: 1,
    scopes,
    resourceMode,
    allowedServerIds: resourceMode === "selected" ? ["mcs_1"] : [],
    expiresAt: null,
  });
  getToolMethod.mockResolvedValue("GET");
  getToolName.mockResolvedValue("tool_name");
  getToolEnabledState.mockResolvedValue(false);
  isServerValueRuntimeEffective.mockResolvedValue(false);
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
    authenticatePlatformPat.mockRejectedValue(
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
    expect(authenticatePlatformPat).toHaveBeenCalledWith(
      expect.anything(),
      "server-token",
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
            "get_tool_definition",
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
            "list_servers",
            "list_tools",
            "list_variables",
          ].sort(),
        );
      } finally {
        await client.close();
      }
    });

    it("omits stored authoring definitions from list_tools", async () => {
      listTools.mockResolvedValue({
        items: [
          {
            id: "mct_1",
            name: "get_contact",
            title: null,
            description: null,
            method: "GET",
            requestDefinition: {
              version: 1,
              headers: [
                {
                  id: "hdr_1",
                  name: "X-Token",
                  value: { kind: "serverValue", serverValueId: "msv_secret" },
                },
              ],
            },
            compileStatus: "valid",
            compileIssues: [],
            annotations: null,
            allowMutation: false,
            enabled: true,
            source: "manual",
          },
        ],
        page: 1,
        pageSize: 10,
        total: 1,
      });
      const client = await connectClient(["read"]);
      try {
        const result = await client.callTool({
          name: "list_tools",
          arguments: { serverId: "mcs_1" },
        });
        expect(result.isError).toBeFalsy();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).not.toContain("requestDefinition");
        expect(text).not.toContain("msv_secret");
        const data = (
          result.structuredContent as {
            data: { items: Array<Record<string, unknown>> };
          }
        ).data;
        expect(data.items[0]).not.toHaveProperty("requestDefinition");
        expect(data.items[0]).toMatchObject({
          id: "mct_1",
          name: "get_contact",
          enabled: true,
        });
      } finally {
        await client.close();
      }
    });

    it("challenges a direct call missing a static scope with HTTP 403", async () => {
      authenticatePlatformPat.mockResolvedValue({
        tokenId: "mtk_1",
        userId: "usr_1",
        tokenName: "Test PAT",
        tokenPrefix: "rmcp_test",
        policyVersion: 1,
        scopes: ["read"],
        resourceMode: "account",
        allowedServerIds: [],
        expiresAt: null,
      });
      const response = await createApp().request("/api/platform-mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer platform-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "test_tool",
            arguments: { serverId: "mcs_1", toolId: "mct_1" },
          },
        }),
      });
      expect(response.status).toBe(403);
      const challenge = response.headers.get("WWW-Authenticate") ?? "";
      expect(challenge).toContain('error="insufficient_scope"');
      expect(challenge).toContain('scope="invoke"');
      await expect(response.json()).resolves.toMatchObject({
        code: APP_ERROR_CODES.MCP_SCOPE_DENIED,
      });
      expect(executeMappedTool).not.toHaveBeenCalled();
    });

    it("call logs require observe scope", async () => {
      const client = await connectClient(["read"]);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).not.toContain("list_recent_calls");
      } finally {
        await client.close();
      }
    });

    it("a read-only token cannot call test_tool", async () => {
      const client = await connectClient(["read"]);
      try {
        await expect(
          client.callTool({
            name: "test_tool",
            arguments: { serverId: "mcs_1", toolId: "mct_1" },
          }),
        ).rejects.toThrow(/MCP_SCOPE_DENIED/);
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

    it("forces a disabled draft when creating without publish scope", async () => {
      createTool.mockResolvedValue({
        id: "mct_1",
        name: "get_contact",
        method: "GET",
        requestDefinition: { version: 1 },
        compileStatus: "valid",
        compileIssues: [],
        annotations: null,
        allowMutation: false,
        enabled: false,
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
            enabled: true,
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
        expect(createTool).toHaveBeenCalledWith(
          expect.anything(),
          "usr_1",
          "mcs_1",
          expect.objectContaining({ enabled: false }),
        );
      } finally {
        await client.close();
      }
    });

    it("denies updating an enabled tool without publish scope", async () => {
      listVariables.mockResolvedValue([]);
      getToolEnabledState.mockResolvedValueOnce(true);
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "update_tool",
          arguments: {
            expectedRevision: 1,
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
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
        expect(updateTool).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("denies changing a value used by an enabled tool without publish scope", async () => {
      listVariables.mockResolvedValue([
        { id: "msv_2", name: "region", isSecret: false, hasValue: true },
      ]);
      isServerValueRuntimeEffective.mockResolvedValueOnce(true);
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
        expect(result.isError).toBe(true);
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
        expect(setVariable).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("denies get_tool_definition for a secret binding without secret_reference", async () => {
      getToolEditorState.mockResolvedValue({
        toolId: "mct_1",
        typed: true,
        definition: {
          version: 1,
          pathSegments: [],
          query: [],
          headers: [
            {
              id: "hdr_1",
              name: "X-Token",
              value: { kind: "serverValue", serverValueId: "msv_secret" },
            },
          ],
          body: { bodyType: "none" },
          agentInputs: [],
        },
        issues: [],
        conversionDraft: null,
        conversionIssues: [],
      });
      listVariables.mockResolvedValue([
        {
          id: "msv_secret",
          name: "api_token",
          isSecret: true,
          hasValue: true,
        },
      ]);
      const client = await connectClient(["author"]);
      try {
        const result = await client.callTool({
          name: "get_tool_definition",
          arguments: { serverId: "mcs_1", toolId: "mct_1" },
        });
        expect(result.isError).toBe(true);
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
        expect(text).not.toContain("msv_secret");
      } finally {
        await client.close();
      }
    });

    it("returns a secret-bound definition with secret_reference without values", async () => {
      getToolEditorState.mockResolvedValue({
        toolId: "mct_1",
        typed: true,
        definition: {
          version: 1,
          pathSegments: [],
          query: [],
          headers: [
            {
              id: "hdr_1",
              name: "X-Token",
              value: { kind: "serverValue", serverValueId: "msv_secret" },
            },
          ],
          body: { bodyType: "none" },
          agentInputs: [],
        },
        issues: [],
        conversionDraft: null,
        conversionIssues: [],
      });
      const client = await connectClient(["author", "secret_reference"]);
      try {
        const result = await client.callTool({
          name: "get_tool_definition",
          arguments: { serverId: "mcs_1", toolId: "mct_1" },
        });
        expect(result.isError).toBeFalsy();
        const data = (
          result.structuredContent as { data: { definition: unknown } }
        ).data;
        expect(data.definition).toBeTruthy();
        const text = (
          result.content as Array<{ type: string; text: string }>
        )[0].text;
        expect(text).not.toContain("ciphertext");
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
        // Generic non-disclosure denial: the response must not confirm that a
        // same-named secret exists (no secret-specific code or message).
        expect(text).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
        expect(text).not.toContain(APP_ERROR_CODES.MCP_PLAINTEXT_SECRET);
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

  describe("transport hardening", () => {
    function platformPrincipal(scopes: string[]) {
      return {
        tokenId: "mtk_1",
        userId: "usr_1",
        tokenName: "Test PAT",
        tokenPrefix: "rmcp_test",
        policyVersion: 1,
        scopes,
        resourceMode: "account" as const,
        allowedServerIds: [],
        expiresAt: null,
      };
    }

    function trackedBody(chunks: Uint8Array[]) {
      let pulls = 0;
      let cancelled = false;
      let index = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls += 1;
            if (index < chunks.length) {
              controller.enqueue(chunks[index]);
              index += 1;
              return;
            }
            controller.close();
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      return { stream, pulls: () => pulls, cancelled: () => cancelled };
    }

    function streamingRequest(
      stream: ReadableStream<Uint8Array>,
      headers: Record<string, string>,
    ) {
      return new Request("http://test.local/api/platform-mcp", {
        method: "POST",
        headers,
        body: stream,
        duplex: "half",
      } as RequestInit);
    }

    it("does not read an unauthenticated streaming body", async () => {
      authenticatePlatformPat.mockRejectedValue(
        appError({
          appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
          message: "Agent token is invalid.",
          status: 401,
        }),
      );
      const body = trackedBody([
        new TextEncoder().encode(
          JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        ),
      ]);
      const request = streamingRequest(body.stream, {
        Authorization: "Bearer revoked-token",
        "Content-Type": "application/json",
      });

      const pullsBefore = body.pulls();
      const response = await createApp().fetch(request);

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        'Bearer realm="platform-mcp", error="invalid_token"',
      );
      await expect(response.json()).resolves.toMatchObject({
        code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
      });
      expect(body.pulls()).toBe(pullsBefore);
      expect(body.cancelled()).toBe(false);
      expect(handleMcpHttpRequest).not.toHaveBeenCalled();
    });

    it("cancels an oversized chunked body instead of buffering it", async () => {
      authenticatePlatformPat.mockResolvedValue(platformPrincipal(["read"]));
      const body = trackedBody([
        new Uint8Array(MCP_GATEWAY_REQUEST_SIZE_LIMIT + 1),
      ]);
      const request = streamingRequest(body.stream, {
        Authorization: "Bearer platform-token",
      });

      const response = await createApp().fetch(request);

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        code: APP_ERROR_CODES.MCP_REQUEST_TOO_LARGE,
      });
      expect(body.cancelled()).toBe(true);
      expect(handleMcpHttpRequest).not.toHaveBeenCalled();
    });

    it("rejects a declared oversized content-length before reading the body", async () => {
      const body = trackedBody([new Uint8Array(32)]);
      const request = streamingRequest(body.stream, {
        Authorization: "Bearer platform-token",
        "Content-Length": String(MCP_GATEWAY_REQUEST_SIZE_LIMIT + 1),
      });

      const response = await createApp().fetch(request);

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        code: APP_ERROR_CODES.MCP_REQUEST_TOO_LARGE,
      });
      expect(authenticatePlatformPat).not.toHaveBeenCalled();
      expect(body.pulls()).toBe(0);
      expect(body.cancelled()).toBe(false);
      expect(handleMcpHttpRequest).not.toHaveBeenCalled();
    });

    it("denies a statically under-scoped tools/call without constructing handlers", async () => {
      authenticatePlatformPat.mockResolvedValue(platformPrincipal(["read"]));

      const response = await createApp().request("/api/platform-mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer platform-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "test_tool",
            arguments: { serverId: "mcs_1", toolId: "mct_1" },
          },
        }),
      });

      expect(response.status).toBe(403);
      expect(response.headers.get("WWW-Authenticate")).toBe(
        'Bearer realm="platform-mcp", error="insufficient_scope", scope="invoke"',
      );
      await expect(response.json()).resolves.toMatchObject({
        code: APP_ERROR_CODES.MCP_SCOPE_DENIED,
      });
      expect(handleMcpHttpRequest).not.toHaveBeenCalled();
      expect(getToolMethod).not.toHaveBeenCalled();
      expect(executeMappedTool).not.toHaveBeenCalled();
    });

    it("does not expose OAuth protected-resource discovery", async () => {
      const response = await createApp().request(
        "/api/platform-mcp/.well-known/oauth-protected-resource",
        { method: "GET" },
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("WWW-Authenticate")).toBeNull();
      expect(handleMcpHttpRequest).not.toHaveBeenCalled();
      expect(authenticatePlatformPat).not.toHaveBeenCalled();
    });
  });
});
