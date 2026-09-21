/**
 * @file Platform MCP non-disclosure tests. Proves that secret, nonexistent, and
 * foreign server-value references are indistinguishable to an agent without
 * `secret_reference`, and that safe read/authoring projections never serialize
 * ciphertext, stored values, or undisclosed server-value ids.
 */
import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import type { AppContext } from "./context.js";

vi.mock("./posthog.js", () => ({
  captureServerException: vi.fn(),
  extractRequestTelemetryDetails: vi.fn(() => ({
    hasTracingHeaders: false,
  })),
}));

const authenticatePlatformPat = vi.hoisted(() => vi.fn());
const createTool = vi.hoisted(() => vi.fn());
const updateTool = vi.hoisted(() => vi.fn());
const duplicateTool = vi.hoisted(() => vi.fn());
const previewToolCompile = vi.hoisted(() => vi.fn());
const createToolFromCurl = vi.hoisted(() => vi.fn());
const getToolEditorState = vi.hoisted(() => vi.fn());
const getToolEnabledState = vi.hoisted(() => vi.fn());
const isServerValueRuntimeEffective = vi.hoisted(() => vi.fn());
const listVariables = vi.hoisted(() => vi.fn());
const listTools = vi.hoisted(() => vi.fn());

vi.mock("../services/mcp-studio-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-studio-service.js")
  >("../services/mcp-studio-service.js");
  return {
    ...actual,
    createTool,
    updateTool,
    duplicateTool,
    previewToolCompile,
    createToolFromCurl,
    getToolEditorState,
    getToolEnabledState,
    isServerValueRuntimeEffective,
    listVariables,
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
  return { ...actual, executeMappedTool: vi.fn() };
});

import { createPlatformMcpRoutes } from "./mcp-platform.js";
import { errorHandler } from "./middleware.js";
import { resetRateLimitState } from "./mcp-rate-limit.js";

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

const LOCAL_SERVER_ID = "mcs_1";
const SECRET_VALUE_ID = "msv_secret";
const SECRET_VALUE_NAME = "api_token";
const CONFIG_VALUE_ID = "msv_config";
const FOREIGN_VALUE_ID = "msv_other_server_secret";
const MISSING_VALUE_ID = "msv_does_not_exist";
const SECRET_CIPHERTEXT = "ct_9f8e7d6c5b4a";
const RAW_SECRET = "sk-live-super-secret";

const VALUE_ID_PROBES = [
  { label: "secret", id: SECRET_VALUE_ID },
  { label: "nonexistent", id: MISSING_VALUE_ID },
  { label: "foreign", id: FOREIGN_VALUE_ID },
];

const VALUE_NAME_PROBES = [
  { label: "secret", name: SECRET_VALUE_NAME },
  { label: "nonexistent", name: "missing_value" },
  { label: "foreign", name: "foreign_value" },
];

const VARIABLE_ROWS = [
  {
    id: SECRET_VALUE_ID,
    name: SECRET_VALUE_NAME,
    hasValue: true,
    ciphertext: SECRET_CIPHERTEXT,
    kind: "secret",
    owner: "manual",
  },
  {
    id: CONFIG_VALUE_ID,
    name: "region",
    hasValue: true,
    value: "mx",
    kind: "config",
    owner: "manual",
  },
];

type TextPart = { type: string; text?: string };
type ToolResult = {
  isError?: boolean;
  content: TextPart[];
  structuredContent?: Record<string, unknown>;
};

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
    allowedServerIds: resourceMode === "selected" ? [LOCAL_SERVER_ID] : [],
    expiresAt: null,
  });
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

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return (await client.callTool({
    name,
    arguments: args,
  })) as unknown as ToolResult;
}

/** Serializes every agent-visible surface of a result, not just `data`. */
function serialized(result: ToolResult): string {
  const text = result.content
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("\n");
  // Include _meta and any other surfaced fields so a leak through a non-`data`
  // channel is still caught.
  return `${JSON.stringify(result)}\n${JSON.stringify(result.structuredContent ?? null)}\n${text}`;
}

function envelope(result: ToolResult) {
  return {
    isError: result.isError ?? false,
    content: result.content,
    structuredContent: result.structuredContent ?? null,
  };
}

function errorOf(result: ToolResult): Record<string, unknown> | undefined {
  return (result.structuredContent as { error?: Record<string, unknown> })
    ?.error;
}

/**
 * Asserts each result is the one generic scope denial, contains none of the
 * forbidden probe identifiers, and is byte-for-byte interchangeable with every
 * other result in the set.
 */
function assertIndistinguishableDenials(
  results: ToolResult[],
  forbidden: string[],
) {
  results.forEach((result) => {
    expect(result.isError).toBe(true);
    const error = errorOf(result);
    expect(error).toBeDefined();
    expect(error).toMatchObject({
      code: APP_ERROR_CODES.MCP_SCOPE_DENIED,
      category: "policy",
    });
    expect(error).not.toHaveProperty("currentRevision");
    expect(error).not.toHaveProperty("serverId");
    const text = serialized(result);
    for (const value of forbidden) {
      expect(text).not.toContain(value);
    }
  });

  for (let index = 1; index < results.length; index += 1) {
    expect(envelope(results[index])).toEqual(envelope(results[0]));
  }
}

function definitionWithServerValue(id: string) {
  return {
    version: 2,
    pathSegments: [{ id: "path_1", value: { kind: "literal", value: "/x" } }],
    query: [],
    headers: [
      {
        id: "hdr_1",
        name: "X-Token",
        value: { kind: "serverValue", serverValueId: id },
      },
    ],
    body: { bodyType: "none" },
    agentInputs: [],
  };
}

function editorStateWithServerValue(id: string) {
  return {
    toolId: "mct_1",
    typed: true,
    definition: definitionWithServerValue(id),
    issues: [],
    conversionDraft: null,
    conversionIssues: [],
  };
}

const ID_PROBE_FORBIDDEN = [
  SECRET_VALUE_ID,
  SECRET_VALUE_NAME,
  SECRET_CIPHERTEXT,
  RAW_SECRET,
  FOREIGN_VALUE_ID,
  MISSING_VALUE_ID,
];

describe("platform MCP non-disclosure", () => {
  describe("authoring value-id probes are indistinguishable", () => {
    it("create_tool returns one generic denial for secret, nonexistent, and foreign ids", async () => {
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["author"]);
      try {
        const results: ToolResult[] = [];
        for (const probe of VALUE_ID_PROBES) {
          results.push(
            await callTool(client, "create_tool", {
              expectedRevision: 1,
              serverId: LOCAL_SERVER_ID,
              name: "probe_tool",
              method: "GET",
              requestDefinition: definitionWithServerValue(probe.id),
            }),
          );
        }
        assertIndistinguishableDenials(results, ID_PROBE_FORBIDDEN);
        expect(createTool).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("update_tool returns one generic denial for secret, nonexistent, and foreign ids", async () => {
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["author"]);
      try {
        const results: ToolResult[] = [];
        for (const probe of VALUE_ID_PROBES) {
          results.push(
            await callTool(client, "update_tool", {
              expectedRevision: 1,
              serverId: LOCAL_SERVER_ID,
              toolId: "mct_1",
              name: "probe_tool",
              method: "GET",
              requestDefinition: definitionWithServerValue(probe.id),
            }),
          );
        }
        assertIndistinguishableDenials(results, ID_PROBE_FORBIDDEN);
        expect(updateTool).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("preview_tool returns one generic denial for secret, nonexistent, and foreign ids", async () => {
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["author"]);
      try {
        const results: ToolResult[] = [];
        for (const probe of VALUE_ID_PROBES) {
          results.push(
            await callTool(client, "preview_tool", {
              serverId: LOCAL_SERVER_ID,
              method: "GET",
              requestDefinition: definitionWithServerValue(probe.id),
            }),
          );
        }
        assertIndistinguishableDenials(results, ID_PROBE_FORBIDDEN);
        expect(previewToolCompile).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("duplicate_tool returns one generic denial for secret, nonexistent, and foreign ids", async () => {
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["author"]);
      try {
        const results: ToolResult[] = [];
        for (const probe of VALUE_ID_PROBES) {
          getToolEditorState.mockResolvedValue(
            editorStateWithServerValue(probe.id),
          );
          results.push(
            await callTool(client, "duplicate_tool", {
              expectedRevision: 1,
              serverId: LOCAL_SERVER_ID,
              toolId: "mct_1",
            }),
          );
        }
        assertIndistinguishableDenials(results, ID_PROBE_FORBIDDEN);
        expect(duplicateTool).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });

    it("get_tool_definition returns one generic denial for secret, nonexistent, and foreign ids", async () => {
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["author"]);
      try {
        const results: ToolResult[] = [];
        for (const probe of VALUE_ID_PROBES) {
          getToolEditorState.mockResolvedValue(
            editorStateWithServerValue(probe.id),
          );
          results.push(
            await callTool(client, "get_tool_definition", {
              serverId: LOCAL_SERVER_ID,
              toolId: "mct_1",
            }),
          );
        }
        assertIndistinguishableDenials(results, ID_PROBE_FORBIDDEN);
      } finally {
        await client.close();
      }
    });

    it("add_tool_from_curl returns one generic denial for secret, nonexistent, and foreign names", async () => {
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["author"]);
      try {
        const results: ToolResult[] = [];
        for (const probe of VALUE_NAME_PROBES) {
          results.push(
            await callTool(client, "add_tool_from_curl", {
              expectedRevision: 1,
              serverId: LOCAL_SERVER_ID,
              curl: "curl https://api.example.com/v1/items",
              markings: [
                {
                  location: "header",
                  occurrenceId: "occ_1",
                  as: "serverValue",
                  name: probe.name,
                },
              ],
            }),
          );
        }
        assertIndistinguishableDenials(results, [
          SECRET_VALUE_NAME,
          SECRET_VALUE_ID,
          SECRET_CIPHERTEXT,
          RAW_SECRET,
        ]);
        expect(createToolFromCurl).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    });
  });

  describe("safe read projections", () => {
    it("list_variables omits secret rows entirely without secret_reference", async () => {
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["read"]);
      try {
        const result = await callTool(client, "list_variables", {
          serverId: LOCAL_SERVER_ID,
        });
        expect(result.isError).toBeFalsy();
        const data = (
          result.structuredContent as {
            data: Array<Record<string, unknown>>;
          }
        ).data;
        expect(data).toEqual([
          {
            id: CONFIG_VALUE_ID,
            name: "region",
            hasValue: true,
            kind: "config",
            owner: "manual",
          },
        ]);
        const text = serialized(result);
        expect(text).not.toContain(SECRET_VALUE_ID);
        expect(text).not.toContain(SECRET_VALUE_NAME);
        expect(text).not.toContain(SECRET_CIPHERTEXT);
        expect(text).not.toContain(RAW_SECRET);
        expect(text).not.toContain('"value"');
      } finally {
        await client.close();
      }
    });

    it("list_variables returns secret ids but never values with secret_reference", async () => {
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["read", "secret_reference"]);
      try {
        const result = await callTool(client, "list_variables", {
          serverId: LOCAL_SERVER_ID,
        });
        expect(result.isError).toBeFalsy();
        const data = (
          result.structuredContent as {
            data: Array<Record<string, unknown>>;
          }
        ).data;
        expect(data).toContainEqual({
          id: SECRET_VALUE_ID,
          name: SECRET_VALUE_NAME,
          hasValue: true,
          kind: "secret",
          owner: "manual",
        });
        const secretRow = data.find((row) => row.id === SECRET_VALUE_ID);
        expect(secretRow).not.toHaveProperty("value");
        expect(secretRow).not.toHaveProperty("ciphertext");
        const text = serialized(result);
        expect(text).toContain(SECRET_VALUE_ID);
        expect(text).not.toContain(SECRET_CIPHERTEXT);
        expect(text).not.toContain(RAW_SECRET);
        expect(text).not.toContain('"value":"mx"');
      } finally {
        await client.close();
      }
    });

    it("list_tools never exposes definitions, server-value ids, or values", async () => {
      listTools.mockResolvedValue({
        items: [
          {
            id: "mct_1",
            name: "get_contact",
            title: null,
            description: null,
            method: "GET",
            requestDefinition: definitionWithServerValue(SECRET_VALUE_ID),
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
      const client = await connectClient(ALL_SCOPES);
      try {
        const result = await callTool(client, "list_tools", {
          serverId: LOCAL_SERVER_ID,
        });
        expect(result.isError).toBeFalsy();
        const item = (
          result.structuredContent as {
            data: { items: Array<Record<string, unknown>> };
          }
        ).data.items[0];
        expect(item).not.toHaveProperty("requestDefinition");
        expect(item).toMatchObject({
          id: "mct_1",
          name: "get_contact",
          enabled: true,
        });
        const text = serialized(result);
        expect(text).not.toContain("requestDefinition");
        expect(text).not.toContain(SECRET_VALUE_ID);
        expect(text).not.toContain(CONFIG_VALUE_ID);
        expect(text).not.toContain("ciphertext");
        expect(text).not.toContain('"value"');
        expect(text).not.toContain(RAW_SECRET);
      } finally {
        await client.close();
      }
    });

    it("get_tool_definition returns ids but no values or ciphertext with secret_reference", async () => {
      getToolEditorState.mockResolvedValue(
        editorStateWithServerValue(SECRET_VALUE_ID),
      );
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["author", "secret_reference"]);
      try {
        const result = await callTool(client, "get_tool_definition", {
          serverId: LOCAL_SERVER_ID,
          toolId: "mct_1",
        });
        expect(result.isError).toBeFalsy();
        const definition = (
          result.structuredContent as {
            data: {
              definition: {
                headers: Array<{ value: Record<string, unknown> }>;
              };
            };
          }
        ).data.definition;
        // The referenced id is disclosed; the binding carries no stored value.
        expect(definition.headers[0].value).toMatchObject({
          kind: "serverValue",
          serverValueId: SECRET_VALUE_ID,
        });
        expect(Object.keys(definition.headers[0].value).sort()).toEqual([
          "kind",
          "serverValueId",
        ]);
        const text = serialized(result);
        expect(text).toContain(SECRET_VALUE_ID);
        expect(text).not.toContain(SECRET_CIPHERTEXT);
        expect(text).not.toContain(RAW_SECRET);
      } finally {
        await client.close();
      }
    });
  });

  describe("successful authoring never discloses stored values", () => {
    it("create_tool with secret_reference returns the referenced id without values or ciphertext", async () => {
      createTool.mockResolvedValue({
        id: "mct_2",
        name: "secure_get",
        method: "GET",
        requestDefinition: definitionWithServerValue(SECRET_VALUE_ID),
        compileStatus: "valid",
        compileIssues: [],
        annotations: null,
        allowMutation: false,
        enabled: false,
        source: "manual",
        revision: 2,
      });
      listVariables.mockResolvedValue(VARIABLE_ROWS);
      const client = await connectClient(["author", "secret_reference"]);
      try {
        const result = await callTool(client, "create_tool", {
          expectedRevision: 1,
          serverId: LOCAL_SERVER_ID,
          name: "secure_get",
          method: "GET",
          requestDefinition: definitionWithServerValue(SECRET_VALUE_ID),
        });
        expect(result.isError).toBeFalsy();
        expect(createTool).toHaveBeenCalledTimes(1);
        const text = serialized(result);
        expect(text).toContain(SECRET_VALUE_ID);
        expect(text).not.toContain(SECRET_CIPHERTEXT);
        expect(text).not.toContain(RAW_SECRET);
        expect(text).not.toContain(SECRET_VALUE_NAME);
      } finally {
        await client.close();
      }
    });
  });
});
