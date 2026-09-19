import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "./app-error.js";
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
const listServers = vi.hoisted(() => vi.fn());
const listTools = vi.hoisted(() => vi.fn());
const deleteVariable = vi.hoisted(() => vi.fn());
const deleteServer = vi.hoisted(() => vi.fn());
const deleteTool = vi.hoisted(() => vi.fn());
const getServerName = vi.hoisted(() => vi.fn());
const getToolName = vi.hoisted(() => vi.fn());
const getToolMethod = vi.hoisted(() => vi.fn());
const getPublishedToolIdentity = vi.hoisted(() => vi.fn());
const executeMappedTool = vi.hoisted(() => vi.fn());

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
    listServers,
    listTools,
    deleteVariable,
    deleteServer,
    deleteTool,
    getServerName,
    getToolName,
    getToolMethod,
  };
});

vi.mock("../services/mcp-publishing-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-publishing-service.js")
  >("../services/mcp-publishing-service.js");
  return { ...actual, getPublishedToolIdentity };
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

vi.mock("../lib/mcp-audit-queue.js", () => ({ enqueueCallLog: vi.fn() }));

import { createPlatformMcpRoutes } from "./mcp-platform.js";
import { errorHandler } from "./middleware.js";
import { resetRateLimitState } from "./mcp-rate-limit.js";

const SECRET = "s".repeat(32);

function createApp() {
  const app = new Hono<AppContext>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("db", {} as never);
    c.set("dbDirect", {} as never);
    c.set("env", {
      MCP_CREDENTIAL_SECRET: SECRET,
      API_ORIGIN: "http://localhost:3456",
    } as never);
    await next();
  });
  app.route("/api/platform-mcp", createPlatformMcpRoutes());
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetRateLimitState();
});

async function connectClient(
  scopes: string[],
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
  getPublishedToolIdentity.mockImplementation(async () => ({
    method: await getToolMethod(),
    name: await getToolName(),
    snapshot: {},
  }));
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

function definition() {
  return {
    version: 1,
    pathSegments: [],
    query: [],
    headers: [],
    body: { bodyType: "none" },
    agentInputs: [],
  };
}

function toolRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mct_1",
    name: "get_contact",
    title: null,
    description: null,
    method: "GET",
    requestDefinition: { version: 1 },
    compileStatus: "valid",
    compileIssues: [],
    annotations: null,
    allowMutation: false,
    enabled: false,
    source: "manual",
    ...overrides,
  };
}

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function editorState(overrides: Record<string, unknown> = {}) {
  return {
    toolId: "mct_1",
    typed: true,
    definition: null,
    issues: [],
    conversionDraft: null,
    conversionIssues: [],
    ...overrides,
  };
}

function createToolArgs(overrides: Record<string, unknown> = {}) {
  return {
    expectedRevision: 1,
    serverId: "mcs_1",
    name: "get_contact",
    method: "GET",
    requestDefinition: definition(),
    ...overrides,
  };
}

function updateToolArgs(overrides: Record<string, unknown> = {}) {
  return {
    expectedRevision: 1,
    serverId: "mcs_1",
    toolId: "mct_1",
    name: "get_contact",
    method: "GET",
    requestDefinition: definition(),
    ...overrides,
  };
}

function resultText(result: unknown) {
  const content = (result as { content: Array<{ type: string; text: string }> })
    .content;
  return content[0]!.text;
}

function successEnvelope() {
  return {
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
  };
}

describe("platform policy: draft, publish, and config transitions", () => {
  it("persists create_tool enabled:true as a disabled draft without publish", async () => {
    createTool.mockResolvedValue(toolRow({ enabled: false }));
    const client = await connectClient(["read", "author"]);
    try {
      const result = await client.callTool({
        name: "create_tool",
        arguments: createToolArgs({ enabled: true }),
      });
      expect(result.isError).toBeFalsy();
      expect(createTool).toHaveBeenCalledWith(
        expect.anything(),
        "usr_1",
        "mcs_1",
        expect.objectContaining({ enabled: false }),
      );
      expect(
        (result.structuredContent as { data: { enabled: boolean } }).data
          .enabled,
      ).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("enables create_tool only when publish scope is present", async () => {
    createTool.mockResolvedValue(toolRow({ enabled: true }));
    const client = await connectClient(["read", "author", "publish"]);
    try {
      const result = await client.callTool({
        name: "create_tool",
        arguments: createToolArgs({ enabled: true }),
      });
      expect(result.isError).toBeFalsy();
      expect(createTool).toHaveBeenCalledWith(
        expect.anything(),
        "usr_1",
        "mcs_1",
        expect.objectContaining({ enabled: true }),
      );
    } finally {
      await client.close();
    }
  });

  it("denies editing an enabled tool without publish", async () => {
    const client = await connectClient(["read", "author"]);
    getToolEnabledState.mockResolvedValue(true);
    try {
      const result = await client.callTool({
        name: "update_tool",
        arguments: updateToolArgs(),
      });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
      expect(updateTool).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("denies enabling a disabled tool without publish", async () => {
    getToolEnabledState.mockResolvedValue(false);
    const client = await connectClient(["read", "author"]);
    try {
      const result = await client.callTool({
        name: "update_tool",
        arguments: updateToolArgs({ enabled: true }),
      });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
      expect(updateTool).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("denies disabling an enabled tool without publish", async () => {
    const client = await connectClient(["read", "author"]);
    getToolEnabledState.mockResolvedValue(true);
    try {
      const result = await client.callTool({
        name: "update_tool",
        arguments: updateToolArgs({ enabled: false }),
      });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
      expect(updateTool).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("edits a disabled tool as a draft without publish", async () => {
    getToolEnabledState.mockResolvedValue(false);
    updateTool.mockResolvedValue(toolRow({ enabled: false }));
    const client = await connectClient(["read", "author"]);
    try {
      const result = await client.callTool({
        name: "update_tool",
        arguments: updateToolArgs(),
      });
      expect(result.isError).toBeFalsy();
      expect(updateTool).toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("enables a disabled tool with publish", async () => {
    getToolEnabledState.mockResolvedValue(false);
    updateTool.mockResolvedValue(toolRow({ enabled: true }));
    const client = await connectClient(["read", "author", "publish"]);
    try {
      const result = await client.callTool({
        name: "update_tool",
        arguments: updateToolArgs({ enabled: true }),
      });
      expect(result.isError).toBeFalsy();
      expect(updateTool).toHaveBeenCalledWith(
        expect.anything(),
        "usr_1",
        "mcs_1",
        "mct_1",
        expect.objectContaining({ enabled: true }),
      );
    } finally {
      await client.close();
    }
  });

  it("duplicates as a disabled draft without publish and preserves enabled with publish", async () => {
    getToolEditorState.mockResolvedValue(editorState());
    duplicateTool.mockResolvedValue(toolRow({ enabled: false }));

    const draftClient = await connectClient(["read", "author"]);
    try {
      const result = await draftClient.callTool({
        name: "duplicate_tool",
        arguments: {
          expectedRevision: 1,
          serverId: "mcs_1",
          toolId: "mct_1",
          enabled: true,
        },
      });
      expect(result.isError).toBeFalsy();
      expect(duplicateTool).toHaveBeenCalledWith(
        expect.anything(),
        "usr_1",
        "mcs_1",
        "mct_1",
        expect.objectContaining({ enabled: false }),
      );
    } finally {
      await draftClient.close();
    }

    duplicateTool.mockClear();
    duplicateTool.mockResolvedValue(toolRow({ enabled: true }));
    const publishClient = await connectClient(["read", "author", "publish"]);
    try {
      const result = await publishClient.callTool({
        name: "duplicate_tool",
        arguments: {
          expectedRevision: 1,
          serverId: "mcs_1",
          toolId: "mct_1",
          enabled: true,
        },
      });
      expect(result.isError).toBeFalsy();
      expect(duplicateTool).toHaveBeenCalledWith(
        expect.anything(),
        "usr_1",
        "mcs_1",
        "mct_1",
        expect.objectContaining({ enabled: true }),
      );
    } finally {
      await publishClient.close();
    }
  });

  it("denies changing a runtime-effective server value without publish", async () => {
    const client = await connectClient(["read", "author"]);
    listVariables.mockResolvedValue([]);
    isServerValueRuntimeEffective.mockResolvedValue(true);
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
      expect(resultText(result)).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
      expect(setVariable).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("allows changing a runtime-effective server value with publish", async () => {
    listVariables.mockResolvedValue([]);
    isServerValueRuntimeEffective.mockResolvedValue(true);
    setVariable.mockResolvedValue({ name: "region" });
    const client = await connectClient(["read", "author", "publish"]);
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
      expect(isServerValueRuntimeEffective).not.toHaveBeenCalled();
      expect(setVariable).toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("allows changing an unreferenced config value without publish", async () => {
    listVariables.mockResolvedValue([]);
    isServerValueRuntimeEffective.mockResolvedValue(false);
    setVariable.mockResolvedValue({ name: "region" });
    const client = await connectClient(["read", "author"]);
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
      expect(isServerValueRuntimeEffective).toHaveBeenCalled();
      expect(setVariable).toHaveBeenCalledWith(
        expect.anything(),
        "usr_1",
        "mcs_1",
        {
          expectedRevision: 1,
          name: "region",
          isSecret: false,
          value: "mx",
        },
        SECRET,
      );
    } finally {
      await client.close();
    }
  });

  it("creates a draft server with an account-wide token", async () => {
    createServer.mockResolvedValue(serverRow());
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
      expect(
        (result.structuredContent as { data: { status: string } }).data.status,
      ).toBe("draft");
    } finally {
      await client.close();
    }
  });

  it("denies create_server for a selected-resource token", async () => {
    const client = await connectClient(["author"], "selected");
    try {
      const result = await client.callTool({
        name: "create_server",
        arguments: { name: "CRM", baseUrl: "https://api.example.com" },
      });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
      expect(createServer).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});

describe("platform policy: invocation guards", () => {
  const mutatingMethods = ["POST", "PUT", "PATCH", "DELETE"];

  it("requires invoke_mutation for every mutating compiled method regardless of annotations", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = await connectClient(["invoke"]);
    try {
      for (const method of mutatingMethods) {
        getToolMethod.mockResolvedValue(method);
        const result = await client.callTool({
          name: "test_tool",
          arguments: { serverId: "mcs_1", toolId: "mct_1" },
        });
        expect(result.isError).toBe(true);
        expect(resultText(result)).toContain(APP_ERROR_CODES.MCP_SCOPE_DENIED);
      }
      expect(executeMappedTool).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("denies a DELETE tool when confirm does not match the current name", async () => {
    const client = await connectClient(["invoke", "invoke_mutation"]);
    getToolMethod.mockResolvedValue("DELETE");
    getToolName.mockResolvedValue("delete_contact");
    try {
      const result = await client.callTool({
        name: "test_tool",
        arguments: {
          serverId: "mcs_1",
          toolId: "mct_1",
          confirm: "wrong_name",
        },
      });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(
        APP_ERROR_CODES.MCP_DESTRUCTIVE_CONFIRMATION_REQUIRED,
      );
      expect(executeMappedTool).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("runs a DELETE tool only when confirm matches the current name", async () => {
    const client = await connectClient(["invoke", "invoke_mutation"]);
    getToolMethod.mockResolvedValue("DELETE");
    getToolName.mockResolvedValue("delete_contact");
    executeMappedTool.mockResolvedValue(successEnvelope());
    try {
      const result = await client.callTool({
        name: "test_tool",
        arguments: {
          serverId: "mcs_1",
          toolId: "mct_1",
          confirm: "delete_contact",
        },
      });
      expect(result.isError).toBeFalsy();
      expect(executeMappedTool).toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});

async function realExecuteMappedTool() {
  const actual = await vi.importActual<
    typeof import("../services/mcp-executor-service.js")
  >("../services/mcp-executor-service.js");
  return actual.executeMappedTool;
}

function snapshotFor(tool: Record<string, unknown>) {
  return {
    configRevision: 1,
    server: {
      id: "mcs_1",
      userId: "usr_1",
      status: "live",
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
    },
    tools: [{ tool, plan: null, compileError: null }],
    serverValues: new Map(),
    compileInputs: {},
  };
}

describe("executor: mutation guard before upstream contact", () => {
  it("rejects allowMutation:false for a POST tool even when annotations claim read-only", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const execute = await realExecuteMappedTool();

    await expect(
      execute(
        {} as never,
        {
          serverId: "mcs_1",
          toolId: "mct_1",
          source: "agent",
          credentialSecret: SECRET,
          snapshot: snapshotFor({
            id: "mct_1",
            name: "create_contact",
            method: "POST",
            enabled: true,
            allowMutation: false,
            annotations: { readOnlyHint: true, destructiveHint: false },
          }),
        } as never,
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects allowMutation:false for a DELETE tool before upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const execute = await realExecuteMappedTool();

    await expect(
      execute(
        {} as never,
        {
          serverId: "mcs_1",
          toolId: "mct_1",
          source: "agent",
          credentialSecret: SECRET,
          snapshot: snapshotFor({
            id: "mct_1",
            name: "delete_contact",
            method: "DELETE",
            enabled: true,
            allowMutation: false,
          }),
        } as never,
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not reach upstream for a disabled mutating tool", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const execute = await realExecuteMappedTool();

    await expect(
      execute(
        {} as never,
        {
          serverId: "mcs_1",
          toolId: "mct_1",
          source: "agent",
          credentialSecret: SECRET,
          snapshot: snapshotFor({
            id: "mct_1",
            name: "create_contact",
            method: "POST",
            enabled: false,
            allowMutation: true,
          }),
        } as never,
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_DISABLED,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
