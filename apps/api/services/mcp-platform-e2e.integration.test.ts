import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import { generateAuthId, schema, user } from "@repo/db";
import type { AppContext } from "../lib/context.js";
import { getMcpMaxToolsPerServer } from "../lib/mcp-limits.js";
import { createPlatformMcpRoutes } from "../lib/mcp-platform.js";
import { validatePlatformGrantRequest } from "../lib/mcp-platform-principal.js";
import { resetRateLimitState } from "../lib/mcp-rate-limit.js";
import {
  authenticatePlatformPat,
  createPlatformPat,
  revokePlatformPat,
  rotatePlatformPat,
  type CreatedPlatformPat,
} from "./mcp-platform-token-service.js";
import { createPlatformStepUpGrant } from "./mcp-platform-step-up-service.js";
import { previewPublish, publishServer } from "./mcp-publishing-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

const UPSTREAM_HOST = "api.example.com";
const SESSION_ID = "ses_platform_e2e";
const MCP_ENDPOINT = "http://test.local/api/platform-mcp";
const BODY = { bodyType: "none" as const };

type Db = ReturnType<typeof drizzle<typeof schema>>;
type RawToolResult = Awaited<ReturnType<Client["callTool"]>>;

function structuredData<T>(result: RawToolResult): T {
  const structured = result.structuredContent as { data?: T } | undefined;
  if (!structured || structured.data === undefined) {
    throw new Error("Tool result did not contain structured data.");
  }
  return structured.data;
}

function structuredError(result: RawToolResult): { code: string } {
  const structured = result.structuredContent as
    { error?: { code?: string } } | undefined;
  if (!structured?.error?.code) {
    throw new Error("Tool result did not contain a structured error.");
  }
  return { code: structured.error.code };
}

describeIntegration("Platform MCP end-to-end journey", () => {
  const userId = generateAuthId("user");
  const serverId = `mcs_platform_e2e_${userId}`;
  let client: ReturnType<typeof postgres>;
  let db: Db;
  let upstreamFetch: ReturnType<typeof vi.fn>;
  const upstreamRequests: Array<{ url: string; method: string }> = [];
  const openClients: Client[] = [];

  const getToolDefinition = {
    version: 2 as const,
    pathSegments: [
      { id: "path_1", value: { kind: "literal" as const, value: "/widgets" } },
    ],
    query: [
      {
        id: "query_1",
        name: "q",
        value: { kind: "agentInput" as const, agentInputId: "ain_q" },
        omitWhenAbsent: true,
      },
    ],
    headers: [],
    body: BODY,
    agentInputs: [
      {
        id: "ain_q",
        name: "q",
        description: "Search text for widgets.",
        required: false,
        sensitive: false,
        type: "string" as const,
      },
    ],
  };

  const postToolDefinition = {
    version: 2 as const,
    pathSegments: [
      { id: "path_2", value: { kind: "literal" as const, value: "/widgets" } },
    ],
    query: [],
    headers: [],
    body: {
      bodyType: "form" as const,
      fields: [
        {
          id: "field_1",
          name: "note",
          value: { kind: "literal" as const, value: "hello" },
        },
      ],
    },
    agentInputs: [],
  };

  let getToolId = "";
  let postToolId = "";

  const inspector = {} as CreatedPlatformPat;
  const author = {} as CreatedPlatformPat;
  const publisher = {} as CreatedPlatformPat;
  const operator = {} as CreatedPlatformPat;
  const mutator = {} as CreatedPlatformPat;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 6 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "Platform E2E",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: "Platform E2E Server",
      slug: serverId,
      baseUrl: `https://${UPSTREAM_HOST}`,
      allowedHosts: [UPSTREAM_HOST],
      status: "draft",
    });

    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    upstreamFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url,
        );
        upstreamRequests.push({
          url: url.toString(),
          method: (init?.method ?? "GET").toUpperCase(),
        });
        return new Response(
          JSON.stringify({
            ok: true,
            path: url.pathname,
            method: init?.method,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", upstreamFetch);
  });

  afterAll(async () => {
    await closeClients();
    vi.unstubAllGlobals();
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  afterEach(async () => {
    await closeClients();
    upstreamRequests.length = 0;
    upstreamFetch?.mockClear();
    resetRateLimitState();
  });

  async function closeClients() {
    await Promise.all(
      openClients.splice(0).map((open) => open.close().catch(() => undefined)),
    );
  }

  async function currentRevision(): Promise<number> {
    const [row] = await db
      .select({ configRevision: schema.mcpServer.configRevision })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    return row!.configRevision;
  }

  async function createPat(
    name: string,
    scopes: string[],
  ): Promise<CreatedPlatformPat> {
    const grant = validatePlatformGrantRequest({
      scopes,
      resourceMode: "selected",
      serverIds: [serverId],
    });
    if (grant.highRisk) {
      await createPlatformStepUpGrant(db as never, {
        userId,
        sessionId: SESSION_ID,
        fingerprint: grant.fingerprint,
      });
    }
    return createPlatformPat(db as never, userId, {
      name,
      scopes,
      resourceMode: "selected",
      serverIds: [serverId],
      sessionId: SESSION_ID,
    });
  }

  async function publishFixtureServer(requestId: string): Promise<void> {
    const preview = await previewPublish(db as never, userId, serverId);
    await publishServer(db as never, {
      userId,
      serverId,
      expectedDraftRevision: preview.draftRevision,
      expectedPublishedRevisionId: preview.publishedRevisionId,
      publishRequestId: requestId,
      candidateFingerprint: preview.candidateFingerprint,
      acknowledgedWarningCodes: preview.warningCodes,
      actorSource: "platform",
      note: null,
    });
  }

  function createApp() {
    const app = new Hono<AppContext>();
    app.use("*", async (c, next) => {
      c.set("db", db as never);
      c.set("dbDirect", db as never);
      c.set("env", {
        MCP_CREDENTIAL_SECRET: "s".repeat(32),
        API_ORIGIN: "http://localhost:3456",
        APP_ORIGIN: "http://localhost:3456",
      } as never);
      await next();
    });
    app.route("/api/platform-mcp", createPlatformMcpRoutes());
    return app;
  }

  async function connectClient(rawToken: string): Promise<Client> {
    const app = createApp();
    const transport = new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT), {
      fetch: (input, init) =>
        app.request(input as string | URL, init) as Promise<Response>,
      requestInit: { headers: { Authorization: `Bearer ${rawToken}` } },
    });
    const connected = new Client({ name: "platform-e2e", version: "1.0.0" });
    await connected.connect(transport);
    openClients.push(connected);
    return connected;
  }

  async function rawRequest(rawToken: string, body: unknown) {
    return createApp().request("/api/platform-mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rawToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  it("creates a read-only selected PAT and discovers only read tools", async () => {
    Object.assign(inspector, await createPat("E2E Inspector", ["read"]));
    expect(inspector.token).toMatch(/^rmcp_/);
    expect(inspector.resourceMode).toBe("selected");

    const connected = await connectClient(inspector.token);
    const { tools } = await connected.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      [
        "get_connection_snippet",
        "get_revision",
        "list_revisions",
        "list_servers",
        "list_tools",
        "list_variables",
      ].sort(),
    );
    expect(names).not.toContain("create_tool");
    expect(names).not.toContain("test_tool");
  });

  it("reads the owned server and its (empty) tool and value lists", async () => {
    const connected = await connectClient(inspector.token);

    const servers = await connected.callTool({
      name: "list_servers",
      arguments: {},
    });
    const serverPage = structuredData<{
      items: Array<{ id: string }>;
      total: number;
    }>(servers);
    expect(serverPage.items.map((item) => item.id)).toContain(serverId);

    const tools = await connected.callTool({
      name: "list_tools",
      arguments: { serverId },
    });
    expect(structuredData<{ items: unknown[] }>(tools).items).toEqual([]);

    const values = await connected.callTool({
      name: "list_variables",
      arguments: { serverId },
    });
    expect(structuredData<unknown[]>(values)).toEqual([]);
  });

  it("authors a disabled GET draft with an author token", async () => {
    Object.assign(author, await createPat("E2E Author", ["read", "author"]));
    const connected = await connectClient(author.token);

    const created = await connected.callTool({
      name: "create_tool",
      arguments: {
        serverId,
        expectedRevision: await currentRevision(),
        name: "get_widget",
        title: "Get widget",
        description: "Fetch widgets from the upstream service.",
        method: "GET",
        requestDefinition: getToolDefinition,
        allowMutation: false,
        enabled: true,
      },
    });

    expect(created.isError).toBeFalsy();
    const tool = structuredData<{
      id: string;
      enabled: boolean;
      allowMutation: boolean;
      compileStatus: string;
    }>(created);
    expect(tool.enabled).toBe(false);
    expect(tool.allowMutation).toBe(false);
    expect(tool.compileStatus).toBe("valid");
    getToolId = tool.id;
  });

  it("denies enabling a tool without publish scope, then publishes with it", async () => {
    const authorClient = await connectClient(author.token);
    const denied = await authorClient.callTool({
      name: "update_tool",
      arguments: {
        serverId,
        expectedRevision: await currentRevision(),
        toolId: getToolId,
        enabled: true,
      },
    });
    expect(denied.isError).toBe(true);
    expect(structuredError(denied).code).toBe(APP_ERROR_CODES.MCP_SCOPE_DENIED);
    expect(upstreamRequests).toHaveLength(0);

    const [beforePublish] = await db
      .select({ enabled: schema.mcpTool.enabled })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.id, getToolId));
    expect(beforePublish!.enabled).toBe(false);

    Object.assign(
      publisher,
      await createPat("E2E Publisher", ["read", "author", "publish"]),
    );
    const publisherClient = await connectClient(publisher.token);
    const published = await publisherClient.callTool({
      name: "update_tool",
      arguments: {
        serverId,
        expectedRevision: await currentRevision(),
        toolId: getToolId,
        enabled: true,
      },
    });
    expect(published.isError).toBeFalsy();
    expect(structuredData<{ enabled: boolean }>(published).enabled).toBe(true);
  });

  // Authors a second tool, so it needs room for two tool slots.
  it.skipIf(getMcpMaxToolsPerServer() < 2)(
    "requires allowMutation to publish a POST tool",
    async () => {
      const publisherClient = await connectClient(publisher.token);
      const created = await publisherClient.callTool({
        name: "create_tool",
        arguments: {
          serverId,
          expectedRevision: await currentRevision(),
          name: "create_widget_no_mutation",
          title: "Create widget (no mutation)",
          description: "Attempts to enable a mutating tool without permission.",
          method: "POST",
          requestDefinition: postToolDefinition,
          allowMutation: false,
          enabled: true,
        },
      });
      expect(created.isError).toBeFalsy();
      const tool = structuredData<{ enabled: boolean; allowMutation: boolean }>(
        created,
      );
      expect(tool.allowMutation).toBe(false);
      expect(tool.enabled).toBe(false);
    },
  );

  // The journey has already authored tools by this step, so a third slot is
  // required; a cap below 3 cannot express it.
  it.skipIf(getMcpMaxToolsPerServer() < 3)(
    "authors and publishes a mutating POST tool",
    async () => {
      const authorClient = await connectClient(author.token);
      const created = await authorClient.callTool({
        name: "create_tool",
        arguments: {
          serverId,
          expectedRevision: await currentRevision(),
          name: "create_widget",
          title: "Create widget",
          description: "Create a widget upstream.",
          method: "POST",
          requestDefinition: postToolDefinition,
          allowMutation: true,
          enabled: true,
        },
      });
      expect(created.isError).toBeFalsy();
      const tool = structuredData<{
        id: string;
        enabled: boolean;
        allowMutation: boolean;
      }>(created);
      expect(tool.allowMutation).toBe(true);
      expect(tool.enabled).toBe(false);
      postToolId = tool.id;

      const publisherClient = await connectClient(publisher.token);
      const published = await publisherClient.callTool({
        name: "update_tool",
        arguments: {
          serverId,
          expectedRevision: await currentRevision(),
          toolId: postToolId,
          enabled: true,
        },
      });
      expect(published.isError).toBeFalsy();
      expect(structuredData<{ enabled: boolean }>(published).enabled).toBe(
        true,
      );
    },
  );

  it("invokes an enabled GET tool with a read-only invoke token", async () => {
    Object.assign(
      operator,
      await createPat("E2E Operator", ["read", "invoke"]),
    );
    await publishFixtureServer("req_platform_e2e_publish_1");
    const connected = await connectClient(operator.token);

    const invoked = await connected.callTool({
      name: "test_tool",
      arguments: { serverId, toolId: getToolId, args: { q: "sprockets" } },
    });
    expect(invoked.isError).toBeFalsy();
    const result = structuredData<{
      ok: boolean;
      httpStatus: number;
      envelope: { status: number };
    }>(invoked);
    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.envelope.status).toBe(200);
    expect(
      upstreamRequests.some(
        (request) =>
          request.method === "GET" && request.url.includes("/widgets?q="),
      ),
    ).toBe(true);
  });

  // Depends on the POST tool authored above, so it needs the same third slot.
  // Invokes the POST tool authored by the previous step, so it skips with it.
  it.skipIf(getMcpMaxToolsPerServer() < 3)(
    "denies a mutating invoke without invoke_mutation and allows it with it",
    async () => {
      const operatorClient = await connectClient(operator.token);
      const denied = await operatorClient.callTool({
        name: "test_tool",
        arguments: { serverId, toolId: postToolId },
      });
      expect(denied.isError).toBe(true);
      expect(structuredError(denied).code).toBe(
        APP_ERROR_CODES.MCP_SCOPE_DENIED,
      );
      expect(upstreamRequests).toHaveLength(0);

      Object.assign(
        mutator,
        await createPat("E2E Mutator", ["read", "invoke", "invoke_mutation"]),
      );
      const mutatorClient = await connectClient(mutator.token);
      const allowed = await mutatorClient.callTool({
        name: "test_tool",
        arguments: { serverId, toolId: postToolId },
      });
      expect(allowed.isError).toBeFalsy();
      expect(structuredData<{ httpStatus: number }>(allowed).httpStatus).toBe(
        200,
      );
      expect(
        upstreamRequests.some((request) => request.method === "POST"),
      ).toBe(true);
    },
  );

  it("returns structured denials for missing scope and ungranted resources", async () => {
    const deniedScope = await rawRequest(inspector.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "create_tool", arguments: { serverId } },
    });
    expect(deniedScope.status).toBe(403);
    await expect(deniedScope.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_SCOPE_DENIED,
    });
    expect(deniedScope.headers.get("WWW-Authenticate")).toContain(
      'scope="author"',
    );

    const operatorClient = await connectClient(operator.token);
    const deniedResource = await operatorClient.callTool({
      name: "list_tools",
      arguments: { serverId: `mcs_not_granted_${userId}` },
    });
    expect(deniedResource.isError).toBe(true);
    expect(structuredError(deniedResource).code).toBe(
      APP_ERROR_CODES.MCP_RESOURCE_DENIED,
    );
    expect(upstreamRequests).toHaveLength(0);
  });

  it("rotates a PAT, revoking the predecessor and honoring only the successor", async () => {
    const rotating = await createPat("E2E Rotating", ["read"]);
    const successor = await rotatePlatformPat(db as never, userId, {
      name: "E2E Rotating successor",
      scopes: ["read"],
      resourceMode: "selected",
      serverIds: [serverId],
      sessionId: SESSION_ID,
      tokenId: rotating.id,
    });
    expect(successor.id).not.toBe(rotating.id);

    const [predecessorRow] = await db
      .select()
      .from(schema.mcpAgentToken)
      .where(eq(schema.mcpAgentToken.id, rotating.id));
    expect(predecessorRow!.revokedAt).not.toBeNull();
    expect(predecessorRow!.replacedByTokenId).toBe(successor.id);

    const [successorRow] = await db
      .select()
      .from(schema.mcpAgentToken)
      .where(eq(schema.mcpAgentToken.id, successor.id));
    expect(successorRow!.replacesTokenId).toBe(rotating.id);
    expect(successorRow!.revokedAt).toBeNull();

    await expect(
      authenticatePlatformPat(db as never, rotating.token),
    ).rejects.toMatchObject({ status: 401 });

    const oldTokenResponse = await rawRequest(rotating.token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(oldTokenResponse.status).toBe(401);

    const successorClient = await connectClient(successor.token);
    const { tools } = await successorClient.listTools();
    expect(tools.length).toBeGreaterThan(0);

    await revokePlatformPat(db as never, userId, successor.id);
    const revokedResponse = await rawRequest(successor.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/list",
      params: {},
    });
    expect(revokedResponse.status).toBe(401);
    await expect(revokedResponse.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
  });

  it("rejects an unknown persisted policy version with 401", async () => {
    const policyPat = await createPat("E2E Policy", ["read"]);
    await db
      .update(schema.mcpAgentToken)
      .set({ policyVersion: 999 })
      .where(eq(schema.mcpAgentToken.id, policyPat.id));

    await expect(
      authenticatePlatformPat(db as never, policyPat.token),
    ).rejects.toMatchObject({ status: 401 });

    const response = await rawRequest(policyPat.token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
  });
});
