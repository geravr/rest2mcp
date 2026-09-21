import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_ERROR_CODES,
  MCP_PLATFORM_PRESETS,
  MCP_PLATFORM_SCOPES,
  type McpPlatformScope,
} from "@repo/core";
import type { AppContext } from "./context.js";

vi.mock("./posthog.js", () => ({
  captureServerException: vi.fn(),
  extractRequestTelemetryDetails: vi.fn(() => ({ hasTracingHeaders: false })),
}));

const serviceMocks = vi.hoisted(() => ({
  createServer: vi.fn(),
  createTool: vi.fn(),
  createToolFromCurl: vi.fn(),
  deleteServer: vi.fn(),
  deleteTool: vi.fn(),
  deleteVariable: vi.fn(),
  duplicateTool: vi.fn(),
  getConnectionSnippet: vi.fn(),
  getServerName: vi.fn(),
  getToolEditorState: vi.fn(),
  getToolEnabledState: vi.fn(),
  getToolMethod: vi.fn(),
  getToolName: vi.fn(),
  isServerValueRuntimeEffective: vi.fn(),
  listCallLogs: vi.fn(),
  listServers: vi.fn(),
  listTools: vi.fn(),
  listVariables: vi.fn(),
  previewToolCompile: vi.fn(),
  setVariable: vi.fn(),
  updateTool: vi.fn(),
}));

const authenticatePlatformPat = vi.hoisted(() => vi.fn());

const dbMocks = vi.hoisted(() => {
  const col = (table: string, name: string) => ({
    __table: table,
    __col: name,
  });
  const table = (name: string, columns: string[]) => {
    const value: Record<string, unknown> = { __table: name };
    for (const column of columns) value[column] = col(name, column);
    return value;
  };
  return {
    mcpServer: table("mcpServer", [
      "id",
      "userId",
      "name",
      "slug",
      "description",
      "baseUrl",
      "allowedHosts",
      "status",
      "configRevision",
      "createdAt",
      "iconAssetId",
    ]),
    mcpTool: table("mcpTool", ["id", "serverId", "enabled", "createdAt"]),
    mcpServerVariable: table("mcpServerVariable", [
      "id",
      "serverId",
      "name",
      "isSecret",
      "createdAt",
    ]),
    mcpCallLog: table("mcpCallLog", [
      "id",
      "serverId",
      "source",
      "status",
      "createdAt",
    ]),
  };
});

vi.mock("drizzle-orm", async () => {
  const actual =
    await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    and: (...predicates: unknown[]) => ({ op: "and", predicates }),
    or: (...predicates: unknown[]) => ({ op: "or", predicates }),
    eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
    inArray: (left: unknown, right: unknown) => ({
      op: "inArray",
      left,
      right,
    }),
    count: () => ({ __count: true }),
    desc: (value: unknown) => ({ op: "desc", value }),
  };
});

vi.mock("@repo/db", async () => {
  const actual = await vi.importActual<typeof import("@repo/db")>("@repo/db");
  return {
    ...actual,
    mcpServer: dbMocks.mcpServer,
    mcpTool: dbMocks.mcpTool,
    mcpServerVariable: dbMocks.mcpServerVariable,
    mcpCallLog: dbMocks.mcpCallLog,
  };
});

vi.mock("../services/mcp-studio-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-studio-service.js")
  >("../services/mcp-studio-service.js");
  return { ...actual, ...serviceMocks };
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

import {
  assertPlatformResourceAllowed,
  evaluatePlatformToolPolicy,
  PLATFORM_REGISTRY,
  createPlatformMcpRoutes,
} from "./mcp-platform.js";
import { buildPlatformPrincipal } from "./mcp-platform-principal.js";
import type { PlatformPrincipal } from "./mcp-platform-principal.js";
import { errorHandler } from "./middleware.js";
import { resetRateLimitState } from "./mcp-rate-limit.js";
import { AppError } from "./app-error.js";

const realStudioService = await vi.importActual<
  typeof import("../services/mcp-studio-service.js")
>("../services/mcp-studio-service.js");

const ALL_SCOPES = [...MCP_PLATFORM_SCOPES] as McpPlatformScope[];

const SCOPE_SETS: Array<{ id: string; scopes: McpPlatformScope[] }> = [
  ...Object.entries(MCP_PLATFORM_PRESETS).map(([id, scopes]) => ({
    id,
    scopes: [...scopes] as McpPlatformScope[],
  })),
  { id: "publish", scopes: ["read", "author", "publish"] },
  {
    id: "invoke_mutation",
    scopes: ["read", "invoke", "invoke_mutation"],
  },
  { id: "secret_reference", scopes: ["read", "secret_reference"] },
  { id: "destructive", scopes: ["read", "destructive"] },
  { id: "all-scopes", scopes: ALL_SCOPES },
];

const REQUEST_DEFINITION = {
  version: 2,
  pathSegments: [],
  query: [],
  headers: [],
  body: { bodyType: "none" },
  agentInputs: [],
};

const TOOL_ARGS: Record<string, Record<string, unknown>> = {
  list_tools: { serverId: "mcs_A" },
  get_tool_definition: { serverId: "mcs_A", toolId: "mct_1" },
  list_variables: { serverId: "mcs_A" },
  get_connection_snippet: { serverId: "mcs_A" },
  list_recent_calls: { serverId: "mcs_A" },
  create_tool: {
    serverId: "mcs_A",
    expectedRevision: 1,
    name: "get_contact",
    method: "GET",
    requestDefinition: REQUEST_DEFINITION,
  },
  update_tool: {
    serverId: "mcs_A",
    expectedRevision: 1,
    toolId: "mct_1",
  },
  preview_tool: {
    serverId: "mcs_A",
    method: "GET",
    requestDefinition: REQUEST_DEFINITION,
  },
  duplicate_tool: {
    serverId: "mcs_A",
    expectedRevision: 1,
    toolId: "mct_1",
  },
  add_tool_from_curl: {
    serverId: "mcs_A",
    expectedRevision: 1,
    curl: "curl https://api.example.com/v1/items",
    markings: [],
  },
  set_variable: {
    serverId: "mcs_A",
    expectedRevision: 1,
    name: "region",
    kind: "config",
    value: "mx",
  },
  test_tool: { serverId: "mcs_A", toolId: "mct_1" },
  delete_server: { serverId: "mcs_A", expectedRevision: 1, confirm: "CRM" },
  delete_tool: {
    serverId: "mcs_A",
    expectedRevision: 1,
    toolId: "mct_1",
    confirm: "get_contacts",
  },
  delete_variable: {
    serverId: "mcs_A",
    expectedRevision: 1,
    name: "api_token",
    confirm: "api_token",
  },
};

const RESOURCE_TOOLS = PLATFORM_REGISTRY.filter(
  (tool) => TOOL_ARGS[tool.name] !== undefined,
);

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

function principalFor(
  scopes: readonly McpPlatformScope[],
  resourceMode: "account" | "selected" = "account",
  allowedServerIds: readonly string[] = [],
): PlatformPrincipal {
  return buildPlatformPrincipal({
    tokenId: "mtk_1",
    userId: "usr_1",
    tokenName: "Matrix PAT",
    tokenPrefix: "rmcp_test",
    policyVersion: 1,
    scopes,
    resourceMode,
    allowedServerIds,
    expiresAt: null,
  });
}

function expectedAdvertisedNames(
  scopes: readonly McpPlatformScope[],
): string[] {
  return PLATFORM_REGISTRY.filter((tool) =>
    tool.scopes.every((scope) => scopes.includes(scope)),
  )
    .map((tool) => tool.name)
    .sort();
}

async function connectClient(principal: PlatformPrincipal) {
  authenticatePlatformPat.mockResolvedValue(principal);
  serviceMocks.getToolMethod.mockResolvedValue("GET");
  serviceMocks.getToolName.mockResolvedValue("tool_name");
  serviceMocks.getToolEnabledState.mockResolvedValue(false);
  serviceMocks.isServerValueRuntimeEffective.mockResolvedValue(false);
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
  const client = new Client({ name: "matrix-client", version: "0.0.1" });
  await client.connect(transport);
  return client;
}

function rawToolCall(name: string, args: Record<string, unknown>) {
  return createApp().request("/api/platform-mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer platform-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

function allServiceSpies() {
  return Object.values(serviceMocks);
}

function toolError(result: unknown): Record<string, unknown> | undefined {
  const structured = (result as { structuredContent?: unknown })
    .structuredContent as { error?: Record<string, unknown> } | undefined;
  return structured?.error;
}

afterEach(() => {
  vi.clearAllMocks();
  resetRateLimitState();
});

describe("Platform authorization matrix discovery vs enforcement", () => {
  it.each(SCOPE_SETS)(
    "advertises exactly the tools whose static scopes are granted: $id",
    async ({ scopes }) => {
      const client = await connectClient(principalFor(scopes));
      try {
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name).sort();
        expect(names).toEqual(expectedAdvertisedNames(scopes));
      } finally {
        await client.close();
      }
    },
  );

  it.each(SCOPE_SETS)(
    "denies a direct call to every non-advertised tool before any service runs: $id",
    async ({ scopes }) => {
      authenticatePlatformPat.mockResolvedValue(principalFor(scopes));
      const advertised = new Set(expectedAdvertisedNames(scopes));
      const nonAdvertised = PLATFORM_REGISTRY.filter(
        (tool) => !advertised.has(tool.name),
      );
      if (nonAdvertised.length === 0) {
        // Fully scoped principal: everything is callable, so there is no
        // denial path to assert here (discovery asserts the full set).
        expect(advertised.size).toBe(PLATFORM_REGISTRY.length);
        return;
      }
      for (const tool of nonAdvertised) {
        const response = await rawToolCall(tool.name, {});
        expect(response.status, tool.name).toBe(403);
        await expect(response.json(), tool.name).resolves.toMatchObject({
          code: APP_ERROR_CODES.MCP_SCOPE_DENIED,
        });
      }
      for (const spy of allServiceSpies()) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

  it.each(SCOPE_SETS)(
    "handler-level evaluator matches the advertised/denied split: $id",
    ({ scopes }) => {
      const principal = principalFor(scopes);
      const advertised = new Set(expectedAdvertisedNames(scopes));
      for (const tool of PLATFORM_REGISTRY) {
        const decision = evaluatePlatformToolPolicy(tool, principal, {});
        if (advertised.has(tool.name)) {
          expect(decision, tool.name).toEqual({ ok: true });
        } else {
          expect(decision.ok, tool.name).toBe(false);
          if (!decision.ok) {
            expect([...decision.missingScopes].sort(), tool.name).toEqual(
              [
                ...tool.scopes.filter((scope) => !scopes.includes(scope)),
              ].sort(),
            );
          }
        }
      }
    },
  );

  it("keeps a statically-advertised account-only tool in discovery but denies it for a selected token", async () => {
    const selected = principalFor(["read", "author"], "selected", ["mcs_A"]);
    expect(expectedAdvertisedNames(selected.scopes)).toContain("create_server");

    const decision = evaluatePlatformToolPolicy(
      PLATFORM_REGISTRY.find((tool) => tool.name === "create_server")!,
      selected,
      {},
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.missingScopes).toEqual([]);

    const client = await connectClient(selected);
    try {
      const result = await client.callTool({
        name: "create_server",
        arguments: { name: "CRM", baseUrl: "https://api.example.com" },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: APP_ERROR_CODES.MCP_SCOPE_DENIED },
      });
      expect(serviceMocks.createServer).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});

describe("Platform resource isolation across grants and accounts", () => {
  it.each(PLATFORM_REGISTRY.map((tool) => [tool.name] as const))(
    "guards the %s resource boundary identically for ungranted and nonexistent servers",
    (name) => {
      const tool = PLATFORM_REGISTRY.find((entry) => entry.name === name)!;
      if (tool.resourceArg !== "serverId") {
        expect(() =>
          assertPlatformResourceAllowed(principalFor(ALL_SCOPES), "mcs_any"),
        ).not.toThrow();
        return;
      }

      const selected = principalFor(ALL_SCOPES, "selected", ["mcs_A"]);
      expect(() =>
        assertPlatformResourceAllowed(selected, "mcs_A"),
      ).not.toThrow();

      const ungranted = (() => {
        try {
          assertPlatformResourceAllowed(selected, "mcs_B");
          return null;
        } catch (error) {
          return error as AppError;
        }
      })();
      const missing = (() => {
        try {
          assertPlatformResourceAllowed(selected, "mcs_does_not_exist");
          return null;
        } catch (error) {
          return error as AppError;
        }
      })();

      expect(ungranted).toBeInstanceOf(AppError);
      expect(missing).toBeInstanceOf(AppError);
      expect(ungranted?.appCode).toBe(APP_ERROR_CODES.MCP_RESOURCE_DENIED);
      expect(ungranted?.appCode).toBe(missing?.appCode);
      expect(ungranted?.status).toBe(404);
      expect(ungranted?.status).toBe(missing?.status);
      expect(ungranted?.message).toBe(missing?.message);

      // Account-wide principals are never subject to the selected-server guard.
      expect(() =>
        assertPlatformResourceAllowed(principalFor(ALL_SCOPES), "mcs_B"),
      ).not.toThrow();
    },
  );

  it("returns the same resource-denied contract for every read and mutation path", async () => {
    const client = await connectClient(
      principalFor(ALL_SCOPES, "selected", ["mcs_A"]),
    );
    try {
      for (const tool of RESOURCE_TOOLS) {
        const args = TOOL_ARGS[tool.name];
        expect(args, `missing matrix args for ${tool.name}`).toBeDefined();

        const ungranted = await client.callTool({
          name: tool.name,
          arguments: { ...args, serverId: "mcs_B" },
        });
        const missing = await client.callTool({
          name: tool.name,
          arguments: { ...args, serverId: "mcs_does_not_exist" },
        });

        expect(ungranted.isError, tool.name).toBe(true);
        expect(missing.isError, tool.name).toBe(true);
        const ungrantedError = toolError(ungranted);
        const missingError = toolError(missing);
        expect(ungrantedError?.code, tool.name).toBe(
          APP_ERROR_CODES.MCP_RESOURCE_DENIED,
        );
        expect(ungrantedError).toEqual(missingError);
      }

      for (const spy of allServiceSpies()) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      await client.close();
    }
  });

  it("passes only granted ids into selected list_servers and never falls back to account-wide", async () => {
    serviceMocks.listServers.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    const client = await connectClient(
      principalFor(["read"], "selected", ["mcs_A"]),
    );
    try {
      await client.callTool({ name: "list_servers", arguments: {} });
      expect(serviceMocks.listServers).toHaveBeenCalledWith(
        expect.anything(),
        "usr_1",
        { page: 1, pageSize: 10 },
        { allowedServerIds: ["mcs_A"] },
      );
    } finally {
      await client.close();
    }
  });

  it("exposes no resources when a selected token has zero remaining grants", async () => {
    serviceMocks.listServers.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    const client = await connectClient(
      principalFor(["read", "invoke"], "selected", []),
    );
    try {
      const listed = await client.callTool({
        name: "list_servers",
        arguments: {},
      });
      expect(listed.isError).toBeFalsy();
      expect(listed.structuredContent).toMatchObject({
        data: { items: [], total: 0 },
      });
      expect(serviceMocks.listServers).toHaveBeenCalledWith(
        expect.anything(),
        "usr_1",
        { page: 1, pageSize: 10 },
        { allowedServerIds: [] },
      );

      const denied = await client.callTool({
        name: "list_tools",
        arguments: { serverId: "mcs_A" },
      });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toMatchObject({
        error: { code: APP_ERROR_CODES.MCP_RESOURCE_DENIED },
      });
      expect(serviceMocks.listTools).not.toHaveBeenCalled();

      const invoked = await client.callTool({
        name: "test_tool",
        arguments: { serverId: "mcs_A", toolId: "mct_1" },
      });
      expect(invoked.structuredContent).toMatchObject({
        error: { code: APP_ERROR_CODES.MCP_RESOURCE_DENIED },
      });
      expect(serviceMocks.getToolMethod).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});

type FakeRow = Record<string, unknown>;

function matchesPredicate(predicate: unknown, row: FakeRow): boolean {
  if (!predicate || typeof predicate !== "object") return true;
  const node = predicate as {
    op?: string;
    left?: { __col?: string };
    right?: unknown;
    predicates?: unknown[];
  };
  switch (node.op) {
    case "eq":
      return row[node.left?.__col ?? ""] === node.right;
    case "inArray":
      return (node.right as unknown[]).includes(row[node.left?.__col ?? ""]);
    case "and":
      return (node.predicates ?? []).every((child) =>
        matchesPredicate(child, row),
      );
    case "or":
      return (node.predicates ?? []).some((child) =>
        matchesPredicate(child, row),
      );
    default:
      return true;
  }
}

function createFakeDb(stores: Record<string, FakeRow[]>) {
  const select = vi.fn((projection?: Record<string, unknown>) => ({
    from(table: { __table: string }) {
      const tableName = table.__table;
      const rows = stores[tableName] ?? [];
      return {
        where(predicate: unknown) {
          const filtered = rows.filter((row) =>
            matchesPredicate(predicate, row),
          );
          const isCount =
            projection !== undefined &&
            Object.values(projection).some(
              (value) =>
                typeof value === "object" &&
                value !== null &&
                "__count" in (value as Record<string, unknown>),
            );
          const result: unknown[] = isCount
            ? [{ count: filtered.length }]
            : projection !== undefined
              ? filtered.map((row) => {
                  const projected: FakeRow = {};
                  for (const [key, column] of Object.entries(projection)) {
                    projected[key] =
                      row[(column as { __col?: string }).__col ?? ""];
                  }
                  return projected;
                })
              : filtered.map((row) => ({ ...row }));
          let limitValue: number | undefined;
          let offsetValue = 0;
          const chain = {
            orderBy: () => chain,
            limit: (value?: number) => {
              limitValue = value;
              return chain;
            },
            offset: (value?: number) => {
              offsetValue = value ?? 0;
              return chain;
            },
            then: (
              resolve: (value: unknown) => unknown,
              reject?: (reason: unknown) => unknown,
            ) => {
              const start = offsetValue;
              const end =
                limitValue === undefined ? undefined : start + limitValue;
              return Promise.resolve(result.slice(start, end)).then(
                resolve,
                reject,
              );
            },
          };
          return chain;
        },
      };
    },
  }));
  return { select };
}

function serverRow(id: string, userId: string, extra: FakeRow = {}): FakeRow {
  return {
    id,
    userId,
    name: id,
    slug: id,
    description: null,
    baseUrl: "https://api.example.com",
    allowedHosts: ["api.example.com"],
    status: "draft",
    configRevision: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    iconAssetId: null,
    ...extra,
  };
}

describe("Platform listServers allow-list behavior", () => {
  it("counts and returns only granted, owned servers", async () => {
    const db = createFakeDb({
      mcpServer: [
        serverRow("mcs_a", "user-a"),
        serverRow("mcs_b", "user-a"),
        serverRow("mcs_c", "user-b"),
      ],
      mcpTool: [],
      mcpServerVariable: [],
      mcpCallLog: [],
    });

    const page = await realStudioService.listServers(
      db as never,
      "user-a",
      { page: 1, pageSize: 10 },
      { allowedServerIds: ["mcs_a"] },
    );

    expect(page.items.map((item) => item.id)).toEqual(["mcs_a"]);
    expect(page.total).toBe(1);
  });

  it("applies the same granted-only predicate to pagination totals", async () => {
    const db = createFakeDb({
      mcpServer: [
        serverRow("mcs_a", "user-a"),
        serverRow("mcs_b", "user-a"),
        serverRow("mcs_c", "user-b"),
      ],
      mcpTool: [],
      mcpServerVariable: [],
      mcpCallLog: [],
    });

    const first = await realStudioService.listServers(
      db as never,
      "user-a",
      { page: 1, pageSize: 10 },
      { allowedServerIds: ["mcs_a", "mcs_b"] },
    );

    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(2);
    expect(first.items.map((item) => item.id)).not.toContain("mcs_c");

    const emptyPage = await realStudioService.listServers(
      createFakeDb({
        mcpServer: [
          serverRow("mcs_a", "user-a"),
          serverRow("mcs_b", "user-a"),
          serverRow("mcs_c", "user-b"),
        ],
        mcpTool: [],
        mcpServerVariable: [],
        mcpCallLog: [],
      }) as never,
      "user-a",
      { page: 2, pageSize: 10 },
      { allowedServerIds: ["mcs_a", "mcs_b"] },
    );
    expect(emptyPage.items).toHaveLength(0);
    expect(emptyPage.total).toBe(2);
  });

  it("does not broaden access when a selected token loses its last grant", async () => {
    const stores = {
      mcpServer: [
        serverRow("mcs_a", "user-a"),
        serverRow("mcs_b", "user-a"),
        serverRow("mcs_c", "user-b"),
      ],
      mcpTool: [],
      mcpServerVariable: [],
      mcpCallLog: [],
    };

    const withGrant = await realStudioService.listServers(
      createFakeDb(stores) as never,
      "user-a",
      { page: 1, pageSize: 10 },
      { allowedServerIds: ["mcs_a"] },
    );
    expect(withGrant.items.map((item) => item.id)).toEqual(["mcs_a"]);

    const afterDeletionDb = createFakeDb(stores);
    const afterDeletion = await realStudioService.listServers(
      afterDeletionDb as never,
      "user-a",
      { page: 1, pageSize: 10 },
      { allowedServerIds: [] },
    );

    expect(afterDeletion).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    // The empty boundary short-circuits before any query, so it can never
    // degrade into an account-wide scan.
    expect(afterDeletionDb.select).not.toHaveBeenCalled();

    const accountWide = await realStudioService.listServers(
      createFakeDb(stores) as never,
      "user-a",
      { page: 1, pageSize: 10 },
      {},
    );
    expect(accountWide.items.map((item) => item.id).sort()).toEqual([
      "mcs_a",
      "mcs_b",
    ]);
    expect(accountWide.total).toBe(2);
  });
});
