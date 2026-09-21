/**
 * @file Platform MCP group isolation. Proves Studio tool groups have no
 * Platform MCP surface: a grouped and an ungrouped tool produce identical
 * results, no serialized key or value names group metadata at any depth, no
 * authoring input accepts a group field, the tool list exposes no group filter,
 * and a Platform-created tool stays ungrouped.
 */
import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getTableColumns } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { mcpTool } from "@repo/db";
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
const confirmCurlImport = vi.hoisted(() => vi.fn());
const getToolEditorState = vi.hoisted(() => vi.fn());
const getToolEnabledState = vi.hoisted(() => vi.fn());
const isServerValueRuntimeEffective = vi.hoisted(() => vi.fn());
const listVariables = vi.hoisted(() => vi.fn());
const listTools = vi.hoisted(() => vi.fn());
const getRevisionDetail = vi.hoisted(() => vi.fn());

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
    confirmCurlImport,
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

vi.mock("../services/mcp-publishing-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-publishing-service.js")
  >("../services/mcp-publishing-service.js");
  return { ...actual, getRevisionDetail };
});

import {
  buildPlatformContract,
  createPlatformMcpRoutes,
  PLATFORM_REGISTRY,
} from "./mcp-platform.js";
import { errorHandler } from "./middleware.js";
import { resetRateLimitState } from "./mcp-rate-limit.js";

const LOCAL_SERVER_ID = "mcs_1";
const GROUP_ID = "mtg_1";
const GROUP_NAME = "Contacts import batch";

const REQUEST_DEFINITION = {
  version: 2,
  pathSegments: [
    { id: "path_1", value: { kind: "literal", value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" },
  agentInputs: [],
};

const SOURCE_PROVENANCE = {
  version: 2,
  batchId: "oab_1",
  operationKey: "listContacts",
  sourceKind: "url",
  sourceLabel: "https://spec.example.com/openapi.json",
  documentFingerprint: "sha256:document",
  generatedDefinitionHash: "sha256:definition",
  tags: [GROUP_NAME],
  openapiVersion: "3.1.0",
};

/**
 * One `mcp_tool` row as the Studio services return it. The grouped variant
 * differs only in the two Studio-only columns.
 */
function toolRow(input: { grouped: boolean }): Record<string, unknown> {
  return {
    id: "mct_1",
    serverId: LOCAL_SERVER_ID,
    name: "list_contacts",
    title: "List contacts",
    description: "List upstream contacts.",
    method: "GET",
    requestDefinition: REQUEST_DEFINITION,
    compiledPlan: {},
    compileStatus: "valid",
    compileIssues: [],
    annotations: null,
    allowMutation: false,
    enabled: false,
    source: "openapi",
    sourceProvenance: input.grouped ? SOURCE_PROVENANCE : null,
    groupId: input.grouped ? GROUP_ID : null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function curlRow(input: { grouped: boolean }): Record<string, unknown> {
  return {
    ...toolRow(input),
    source: "curl",
    compileOk: true,
    issues: [],
    excludedCredentials: [],
  };
}

/** One immutable revision detail, whose tool row carries Studio provenance. */
function revisionDetail(input: {
  provenance: boolean;
}): Record<string, unknown> {
  return {
    id: "mcr_1",
    revisionNumber: 3,
    sourceDraftRevision: 7,
    candidateFingerprint: "sha256:candidate",
    contractFingerprint: "sha256:contract",
    actorSource: "platform",
    note: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    schemaVersion: 1,
    compilerVersion: "2",
    server: {
      name: "CRM",
      description: null,
      baseUrl: "https://api.example.com",
      allowedHosts: [],
    },
    diffSummary: null,
    tools: [
      {
        sourceToolId: "mct_1",
        name: "list_contacts",
        title: "List contacts",
        description: null,
        method: "GET",
        enabled: true,
        allowMutation: false,
        source: "openapi",
        contractFingerprint: "sha256:tool",
        definitionHash: "sha256:definition",
        compileStatus: "valid",
        compileIssueCount: 0,
        sourceProvenance: input.provenance ? SOURCE_PROVENANCE : null,
        groupId: input.provenance ? GROUP_ID : null,
      },
    ],
    configs: [],
  };
}

const AUTHORING_CASES = [
  {
    tool: "create_tool",
    args: {
      expectedRevision: 1,
      serverId: LOCAL_SERVER_ID,
      name: "list_contacts",
      method: "GET",
      requestDefinition: REQUEST_DEFINITION,
    },
    payloadIndex: 3,
  },
  {
    tool: "update_tool",
    args: {
      expectedRevision: 1,
      serverId: LOCAL_SERVER_ID,
      toolId: "mct_1",
      name: "list_contacts",
      method: "GET",
      requestDefinition: REQUEST_DEFINITION,
    },
    payloadIndex: 4,
  },
  {
    tool: "duplicate_tool",
    args: { expectedRevision: 1, serverId: LOCAL_SERVER_ID, toolId: "mct_1" },
    payloadIndex: 4,
  },
  {
    tool: "add_tool_from_curl",
    args: {
      expectedRevision: 1,
      serverId: LOCAL_SERVER_ID,
      curl: "curl https://api.example.com/v1/contacts",
      markings: [],
    },
    payloadIndex: 3,
  },
  {
    tool: "preview_tool",
    args: {
      serverId: LOCAL_SERVER_ID,
      name: "list_contacts",
      method: "GET",
      requestDefinition: REQUEST_DEFINITION,
    },
    payloadIndex: 3,
  },
] as const;

function serviceMockFor(tool: string) {
  switch (tool) {
    case "create_tool":
      return createTool;
    case "update_tool":
      return updateTool;
    case "duplicate_tool":
      return duplicateTool;
    case "add_tool_from_curl":
      return confirmCurlImport;
    case "preview_tool":
      return previewToolCompile;
    case "list_tools":
      return listTools;
    default:
      throw new Error(`Unknown Platform tool in this test: ${tool}`);
  }
}

function authoringArgs(tool: string): Record<string, unknown> {
  const found = AUTHORING_CASES.find((entry) => entry.tool === tool);
  if (!found) throw new Error(`Unknown Platform tool in this test: ${tool}`);
  return found.args;
}

/** Minimal successful service result for one authoring case. */
function authoringResultFor(tool: string): Record<string, unknown> {
  if (tool === "preview_tool") {
    return { ok: true, ready: true, issues: [], plan: {}, contract: {} };
  }
  return toolRow({ grouped: false });
}

type TextPart = { type: string; text?: string };
type ToolResult = {
  isError?: boolean;
  content: TextPart[];
  structuredContent?: Record<string, unknown>;
};

/** Every key at every depth of a serialized value, exactly as an agent sees it. */
function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      collectKeys(item, keys);
    }
  }
  return keys;
}

/** Studio-only names that must never appear as any serialized key. */
function isGroupSurfaceKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/_/g, "");
  return normalized.startsWith("group") || normalized === "sourceprovenance";
}

/** Every agent-visible channel of a result, parsed rather than string-matched. */
function serializedChannels(result: ToolResult): unknown[] {
  const channels: unknown[] = [result.structuredContent ?? null, result];
  for (const part of result.content) {
    if (part.type !== "text" || !part.text) continue;
    try {
      channels.push(JSON.parse(part.text));
    } catch {
      channels.push(part.text);
    }
  }
  return channels;
}

function groupSurfaceKeys(result: ToolResult): string[] {
  return [
    ...new Set(
      serializedChannels(result)
        .flatMap((channel) => collectKeys(channel))
        .filter(isGroupSurfaceKey),
    ),
  ];
}

function serialized(result: ToolResult): string {
  return JSON.stringify(serializedChannels(result));
}

/**
 * Asserts a grouped and an ungrouped tool are indistinguishable through the
 * Platform surface, both successfully and key-by-key.
 */
function assertGroupBlind(grouped: ToolResult, ungrouped: ToolResult): void {
  expect(grouped.isError ?? false).toBe(false);
  expect(ungrouped.isError ?? false).toBe(false);
  expect({
    content: grouped.content,
    structuredContent: grouped.structuredContent ?? null,
  }).toEqual({
    content: ungrouped.content,
    structuredContent: ungrouped.structuredContent ?? null,
  });
  expect(groupSurfaceKeys(grouped)).toEqual([]);
  expect(groupSurfaceKeys(ungrouped)).toEqual([]);
  expect(serialized(grouped)).not.toContain(GROUP_ID);
  expect(serialized(grouped)).not.toContain(GROUP_NAME);
}

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

async function connectClient(scopes: string[] = ["read", "author"]) {
  authenticatePlatformPat.mockResolvedValue({
    tokenId: "mtk_1",
    userId: "usr_1",
    tokenName: "Test PAT",
    tokenPrefix: "rmcp_test",
    policyVersion: 1,
    scopes,
    resourceMode: "account",
    allowedServerIds: [],
    expiresAt: null,
  });
  getToolEditorState.mockResolvedValue({
    toolId: "mct_1",
    definition: REQUEST_DEFINITION,
    issues: [],
  });
  getToolEnabledState.mockResolvedValue(false);
  isServerValueRuntimeEffective.mockResolvedValue(false);
  listVariables.mockResolvedValue([]);
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

/** Runs one Platform call twice, grouped and ungrouped, and compares results. */
async function compareGroupedAgainstUngrouped(input: {
  tool: string;
  args: Record<string, unknown>;
  groupedRow: Record<string, unknown>;
  ungroupedRow: Record<string, unknown>;
}): Promise<void> {
  const mock = serviceMockFor(input.tool);
  mock.mockResolvedValueOnce(input.groupedRow);
  mock.mockResolvedValueOnce(input.ungroupedRow);
  const client = await connectClient();
  try {
    const grouped = await callTool(client, input.tool, input.args);
    const ungrouped = await callTool(client, input.tool, input.args);
    assertGroupBlind(grouped, ungrouped);
  } finally {
    await client.close();
  }
}

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitState();
});

describe("Platform MCP group isolation", () => {
  describe("a Studio-grouped tool is indistinguishable from the same ungrouped tool", () => {
    it("lists a grouped tool exactly like its ungrouped twin", async () => {
      listTools.mockResolvedValueOnce({
        items: [toolRow({ grouped: true })],
        page: 1,
        pageSize: 10,
        total: 1,
      });
      listTools.mockResolvedValueOnce({
        items: [toolRow({ grouped: false })],
        page: 1,
        pageSize: 10,
        total: 1,
      });
      const client = await connectClient(["read"]);
      try {
        const grouped = await callTool(client, "list_tools", {
          serverId: LOCAL_SERVER_ID,
        });
        const ungrouped = await callTool(client, "list_tools", {
          serverId: LOCAL_SERVER_ID,
        });
        assertGroupBlind(grouped, ungrouped);
        // Guard against a vacuous comparison: the projection really did emit
        // the tool.
        const items = (
          grouped.structuredContent as {
            data: { items: Array<Record<string, unknown>> };
          }
        ).data.items;
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
          id: "mct_1",
          name: "list_contacts",
          source: "openapi",
        });
      } finally {
        await client.close();
      }
    });

    it("returns identical create_tool results for a grouped row", async () => {
      await compareGroupedAgainstUngrouped({
        tool: "create_tool",
        args: authoringArgs("create_tool"),
        groupedRow: toolRow({ grouped: true }),
        ungroupedRow: toolRow({ grouped: false }),
      });
      expect(createTool).toHaveBeenCalledTimes(2);
    });

    it("returns identical update_tool results for a grouped row", async () => {
      await compareGroupedAgainstUngrouped({
        tool: "update_tool",
        args: authoringArgs("update_tool"),
        groupedRow: toolRow({ grouped: true }),
        ungroupedRow: toolRow({ grouped: false }),
      });
      expect(updateTool).toHaveBeenCalledTimes(2);
    });

    it("returns identical duplicate_tool results for a grouped row", async () => {
      await compareGroupedAgainstUngrouped({
        tool: "duplicate_tool",
        args: authoringArgs("duplicate_tool"),
        groupedRow: toolRow({ grouped: true }),
        ungroupedRow: toolRow({ grouped: false }),
      });
      expect(duplicateTool).toHaveBeenCalledTimes(2);
    });

    it("returns identical add_tool_from_curl results for a grouped row", async () => {
      await compareGroupedAgainstUngrouped({
        tool: "add_tool_from_curl",
        args: authoringArgs("add_tool_from_curl"),
        groupedRow: curlRow({ grouped: true }),
        ungroupedRow: curlRow({ grouped: false }),
      });
      expect(confirmCurlImport).toHaveBeenCalledTimes(2);
    });

    it("returns identical get_revision results for a tool row carrying provenance", async () => {
      getRevisionDetail.mockResolvedValueOnce(
        revisionDetail({ provenance: true }),
      );
      getRevisionDetail.mockResolvedValueOnce(
        revisionDetail({ provenance: false }),
      );
      const client = await connectClient(["read"]);
      try {
        const args = { serverId: LOCAL_SERVER_ID, revisionId: "mcr_1" };
        const grouped = await callTool(client, "get_revision", args);
        const ungrouped = await callTool(client, "get_revision", args);
        assertGroupBlind(grouped, ungrouped);
        const tools = (
          grouped.structuredContent as {
            data: { tools: Array<Record<string, unknown>> };
          }
        ).data.tools;
        expect(tools).toHaveLength(1);
      } finally {
        await client.close();
      }
    });
  });

  describe("no Platform authoring input accepts a group field", () => {
    it("declares no group key in the advertised input schema of any registry tool", () => {
      for (const tool of PLATFORM_REGISTRY) {
        const inputSchema = z.toJSONSchema(tool.input, {
          io: "input",
          target: "draft-2020-12",
        }) as Record<string, unknown>;
        const declared = [
          ...new Set(collectKeys(inputSchema).filter(isGroupSurfaceKey)),
        ];
        expect(declared, tool.name).toEqual([]);
      }
    });

    it.each(AUTHORING_CASES)(
      "rejects an extra groupId on $tool before any service runs",
      async ({ tool, args }) => {
        const client = await connectClient();
        try {
          const result = await callTool(client, tool, {
            ...args,
            groupId: GROUP_ID,
          });
          expect(result.isError).toBe(true);
          expect(result.structuredContent).toMatchObject({
            ok: false,
            error: { category: "invalid_arguments", retryable: false },
          });
          expect(groupSurfaceKeys(result)).toEqual([]);
        } finally {
          await client.close();
        }
        for (const [, mock] of [
          ["create_tool", createTool],
          ["update_tool", updateTool],
          ["duplicate_tool", duplicateTool],
          ["add_tool_from_curl", confirmCurlImport],
        ] as const) {
          expect(mock).not.toHaveBeenCalled();
        }
      },
    );

    it("has no group filter on the tool list", async () => {
      const listToolsDefinition = PLATFORM_REGISTRY.find(
        (tool) => tool.name === "list_tools",
      );
      expect(listToolsDefinition).toBeDefined();
      const inputSchema = z.toJSONSchema(listToolsDefinition!.input, {
        io: "input",
        target: "draft-2020-12",
      }) as { properties?: Record<string, unknown> };
      expect(Object.keys(inputSchema.properties ?? {}).sort()).toEqual([
        "page",
        "pageSize",
        "serverId",
      ]);

      const client = await connectClient(["read"]);
      try {
        const rejected = await callTool(client, "list_tools", {
          serverId: LOCAL_SERVER_ID,
          group: GROUP_ID,
        });
        expect(rejected.isError).toBe(true);
        expect(rejected.structuredContent).toMatchObject({
          error: { category: "invalid_arguments" },
        });
        expect(listTools).not.toHaveBeenCalled();

        // A successful list is unfiltered: the Platform never forwards a group
        // predicate to the Studio query.
        listTools.mockResolvedValue({
          items: [toolRow({ grouped: false })],
          page: 1,
          pageSize: 10,
          total: 1,
        });
        const listed = await callTool(client, "list_tools", {
          serverId: LOCAL_SERVER_ID,
        });
        expect(listed.isError ?? false).toBe(false);
        const query = listTools.mock.calls[0]?.[3] as Record<string, unknown>;
        expect(query).toEqual({ page: 1, pageSize: 10 });
        expect(collectKeys(query).filter(isGroupSurfaceKey)).toEqual([]);
      } finally {
        await client.close();
      }
    });
  });

  describe("Platform-created tools stay ungrouped", () => {
    it.each(AUTHORING_CASES)(
      "$tool builds a service payload with no group or provenance column",
      async ({ tool, args, payloadIndex }) => {
        const mock = serviceMockFor(tool);
        mock.mockResolvedValue(authoringResultFor(tool));
        const client = await connectClient();
        try {
          const result = await callTool(client, tool, args);
          expect(result.isError ?? false).toBe(false);
          expect(mock).toHaveBeenCalledTimes(1);
          const payload = mock.mock.calls[0]?.[payloadIndex] as Record<
            string,
            unknown
          >;
          expect(payload).toBeDefined();
          expect(collectKeys(payload).filter(isGroupSurfaceKey)).toEqual([]);
          expect(payload).not.toHaveProperty("groupId");
          expect(payload).not.toHaveProperty("sourceProvenance");
        } finally {
          await client.close();
        }
      },
    );

    it("forwards no groupId from the Platform create and curl paths onto the nullable column", async () => {
      for (const { tool, args, payloadIndex } of AUTHORING_CASES.filter(
        (entry) =>
          entry.tool === "create_tool" || entry.tool === "add_tool_from_curl",
      )) {
        const mock = serviceMockFor(tool);
        mock.mockResolvedValue(
          tool === "add_tool_from_curl"
            ? curlRow({ grouped: false })
            : toolRow({ grouped: false }),
        );
        const client = await connectClient();
        try {
          const result = await callTool(client, tool, args);
          expect(result.isError ?? false).toBe(false);
          expect(mock).toHaveBeenCalledTimes(1);
          const payload = mock.mock.calls[0]?.[payloadIndex] as Record<
            string,
            unknown
          >;
          expect(payload).toBeDefined();
          // The omission is observable on the payload the Platform layer builds,
          // so it reaches the database as SQL NULL instead of a default group.
          expect("groupId" in payload).toBe(false);
          expect(payload.groupId).toBeUndefined();
        } finally {
          await client.close();
        }
      }
      expect(getTableColumns(mcpTool).groupId.notNull).toBe(false);
      expect(getTableColumns(mcpTool).groupId.hasDefault).toBe(false);
    });
  });

  describe("advertised Platform contracts carry no group surface", () => {
    it("declares no group key in any registry input or output schema", () => {
      for (const tool of PLATFORM_REGISTRY) {
        const contract = buildPlatformContract(tool);
        const declared = [
          ...new Set(
            [
              ...collectKeys(contract.inputSchema),
              ...collectKeys(contract.outputSchema),
            ].filter(isGroupSurfaceKey),
          ),
        ];
        expect(declared, tool.name).toEqual([]);
      }
    });
  });
});
