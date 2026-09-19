import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import type { McpServer, McpTool } from "@repo/db";
import { AppError } from "../lib/app-error.js";
import { resetAuditQueueState } from "../lib/mcp-audit-queue.js";
import { decryptCredential, encryptCredential } from "../lib/mcp-crypto.js";
import { MCP_UPSTREAM_DEADLINE_MS } from "../lib/mcp-policy.js";

const tables = vi.hoisted(() => ({
  mcpServer: { id: "mcp_server.id" },
  mcpTool: {
    id: "mcp_tool.id",
    serverId: "mcp_tool.server_id",
    name: "mcp_tool.name",
  },
  mcpServerVariable: { serverId: "mcp_server_variable.server_id" },
  mcpServerRevision: {
    id: "mcp_server_revision.id",
    serverId: "mcp_server_revision.server_id",
  },
  mcpServerRevisionTool: {
    revisionId: "mcp_server_revision_tool.revision_id",
    toolOrder: "mcp_server_revision_tool.tool_order",
  },
  mcpServerRevisionConfig: {
    revisionId: "mcp_server_revision_config.revision_id",
  },
  mcpCallLog: {},
}));

let generateIdCounter = 0;

vi.mock("@repo/db", () => ({
  ...tables,
  generateId: vi.fn(
    (prefix: string) => `${prefix}_test_${generateIdCounter++}`,
  ),
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: "and", args })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
  asc: vi.fn((...args: unknown[]) => ({ kind: "asc", args })),
}));

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import {
  compilePlanForTool,
  executeMappedTool,
  type McpExecutionSnapshot,
  type ResolvedServerValue,
  type ToolCompileInputs,
} from "./mcp-executor-service.js";

const SECRET = "c".repeat(32);

/** A promise-like `select().from(table).where(...)` result usable directly,
 * via `.limit(n)`, or via `.orderBy(...)`. */
function selectResult(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return Object.assign(promise, {
    limit: () => Promise.resolve(rows),
    orderBy: () => Promise.resolve(rows),
  });
}

function insertRecorder(insertedValues: unknown[]) {
  return {
    insert: vi.fn(() => ({
      values: (payload: unknown) => {
        insertedValues.push(payload);
        return Promise.resolve([]);
      },
    })),
  };
}

/** Minimal db for the ownership check and best-effort call-log insert. The
 * execution itself is driven from a preloaded snapshot. */
function makeDb(input: { server: unknown[] }) {
  const insertedValues: unknown[] = [];
  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === tables.mcpServer) return selectResult(input.server);
          return selectResult([]);
        },
      }),
    })),
    ...insertRecorder(insertedValues),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { db, insertedValues };
}

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "mcs_1",
    userId: "usr_owner",
    name: "CRM",
    slug: "crm",
    description: null,
    iconAssetId: null,
    baseUrl: "https://api.example.com",
    allowedHosts: ["api.example.com"],
    defaultHeaders: null,
    defaultQuery: null,
    commonEntries: null,
    authConfiguration: null,
    status: "live",
    configRevision: 1,
    draftRevision: 1,
    publishedRevisionId: "msr_1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    id: "mct_1",
    serverId: "mcs_1",
    name: "get_contact",
    title: "Get contact",
    description: "Fetch one contact by id.",
    method: "GET",
    pathTemplate: "/contacts/{{id}}",
    requestTemplate: {},
    params: [{ name: "id", required: true, type: "string" }],
    requestDefinition: null,
    compiledPlan: null,
    compileStatus: null,
    compileIssues: null,
    annotations: null,
    allowMutation: false,
    enabled: true,
    source: "manual",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

type ServerValueFixture = {
  id: string;
  name: string;
  kind?: "config" | "secret";
  isSecret?: boolean;
  owner?: "manual" | "auth";
  value?: string | null;
  ciphertext?: string | null;
};

function buildServerValues(
  serverValues: ServerValueFixture[],
): Map<string, ResolvedServerValue> {
  const map = new Map<string, ResolvedServerValue>();
  for (const row of serverValues) {
    const kind = row.kind ?? (row.isSecret ? "secret" : "config");
    const value =
      kind === "secret"
        ? row.ciphertext
          ? decryptCredential(row.ciphertext, SECRET)
          : ""
        : (row.value ?? "");
    map.set(row.id, { name: row.name, value, kind });
  }
  return map;
}

/** Builds a published-mode snapshot with a real compiled plan from the
 * legacy server/tool fixtures, so the executor request path needs no db. */
function makeSnapshot(
  input: {
    server?: Partial<McpServer>;
    tool?: Partial<McpTool>;
    serverValues?: ServerValueFixture[];
  } = {},
): McpExecutionSnapshot {
  const server = makeServer(input.server);
  const tool = makeTool(input.tool);
  const serverValues = input.serverValues ?? [];
  const compileInputs: ToolCompileInputs = {
    serverValueRefs: serverValues.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind ?? (row.isSecret ? "secret" : "config"),
      owner: row.owner ?? "manual",
    })),
    common: { headers: [], query: [] },
    auth: null,
    basePath: new URL(server.baseUrl).pathname,
    legacyDefaultHeaders: server.defaultHeaders,
    legacyDefaultQuery: server.defaultQuery,
  };
  return {
    configRevision: server.configRevision,
    server,
    tools: [
      {
        tool,
        plan: compilePlanForTool(tool, compileInputs),
        contractFingerprint: null,
        compileError: null,
      },
    ],
    serverValues: buildServerValues(serverValues),
    compileInputs,
    revisionMode: "published",
    publishedRevisionId: server.publishedRevisionId,
    revisionNumber: 3,
    aggregateFingerprint: "agg_fp",
    draftRevision: server.draftRevision,
  };
}

/** Revision-aware db for the loader path (no preloaded snapshot). */
function makePublishedDb(
  input: { server?: Partial<McpServer>; tool?: Partial<McpTool> } = {},
) {
  const server = makeServer(input.server);
  const tool = makeTool(input.tool);
  const snapshot = makeSnapshot({ server, tool });
  const snapshotTool = snapshot.tools[0];
  if (!snapshotTool) throw new Error("expected one compiled snapshot tool");

  const insertedValues: unknown[] = [];
  const revisionRow = {
    id: server.publishedRevisionId,
    serverId: server.id,
    revisionNumber: snapshot.revisionNumber,
    name: server.name,
    description: server.description,
    baseUrl: server.baseUrl,
    allowedHosts: server.allowedHosts,
    commonEntries: server.commonEntries,
    authConfiguration: server.authConfiguration,
    contractFingerprint: snapshot.aggregateFingerprint,
  };
  const revisionToolRow = {
    id: "mrt_1",
    revisionId: server.publishedRevisionId,
    serverId: server.id,
    sourceToolId: tool.id,
    name: tool.name,
    title: tool.title,
    description: tool.description,
    method: tool.method,
    pathTemplate: tool.pathTemplate,
    requestDefinition: tool.requestDefinition,
    compiledPlan: snapshotTool.plan,
    compileStatus: "valid",
    compileIssues: null,
    annotations: null,
    allowMutation: tool.allowMutation,
    enabled: tool.enabled,
    source: tool.source,
    contractFingerprint: snapshotTool.contractFingerprint,
    definitionHash: null,
    toolOrder: 0,
    createdAt: tool.createdAt,
  };
  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === tables.mcpServer) return selectResult([server]);
          if (table === tables.mcpServerRevision) {
            return selectResult([revisionRow]);
          }
          if (table === tables.mcpServerRevisionTool) {
            return selectResult([revisionToolRow]);
          }
          return selectResult([]);
        },
      }),
    })),
    ...insertRecorder(insertedValues),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return { db, insertedValues };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
  resetAuditQueueState();
});

describe("executeMappedTool: guards before contacting upstream", () => {
  it("rejects a non-owner before loading or decrypting a snapshot", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_other",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: {},
        source: "playground",
        credentialSecret: SECRET,
        snapshot: makeSnapshot(),
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    });
    // The snapshot transaction (which decrypts server values) never opens.
    expect(db.transaction).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects paused servers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer({ status: "paused" })] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
        snapshot: makeSnapshot({ server: { status: "paused" } }),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_PAUSED,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects disabled tools", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
        snapshot: makeSnapshot({ tool: { enabled: false } }),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TOOL_DISABLED,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks mutations when allowMutation is false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        toolId: "mct_1",
        source: "agent",
        credentialSecret: SECRET,
        snapshot: makeSnapshot({
          tool: { method: "DELETE", allowMutation: false },
        }),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects hosts outside the allowlist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const server = makeServer({
      baseUrl: "https://evil.example",
      allowedHosts: ["api.example.com"],
    });
    const { db } = makeDb({ server: [server] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
        snapshot: makeSnapshot({ server }),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails a missing required agent input before contacting upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: {},
        source: "playground",
        credentialSecret: SECRET,
        snapshot: makeSnapshot(),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED &&
        error.details?.placeholder === "id",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects playground invoke for another user's server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_other",
        toolId: "mct_1",
        source: "playground",
        credentialSecret: SECRET,
        snapshot: makeSnapshot(),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("executeMappedTool: envelope for completed responses", () => {
  it("returns a 2xx envelope with parsed JSON data and ok:true", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
      snapshot: makeSnapshot(),
    });

    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.envelope).toMatchObject({
      ok: true,
      status: 200,
      contentType: "application/json",
      truncated: false,
      data: { ok: true },
    });
    expect(result.callLogId).toBeTruthy();
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/contacts/1");
  });

  it("closes the configuration transaction before upstream HTTP begins", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    let transactionFinished = false;
    const fetchMock = vi.fn().mockImplementation(async () => {
      // No database transaction may be open while upstream HTTP runs.
      expect(transactionFinished).toBe(true);
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makePublishedDb();
    const originalTransaction = db.transaction;
    db.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const result = await originalTransaction(fn);
      transactionFinished = true;
      return result;
    }) as typeof db.transaction;

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      toolId: "mct_1",
      args: { id: "1" },
      source: "agent",
      credentialSecret: SECRET,
    });

    expect(result.ok).toBe(true);
    expect(db.transaction).toHaveBeenCalled();
    expect(transactionFinished).toBe(true);
  });

  it("returns a completed 4xx as ok:false with MCP_UPSTREAM_HTTP_ERROR, not a throw", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
      snapshot: makeSnapshot(),
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(401);
    expect(result.envelope.error?.code).toBe(
      APP_ERROR_CODES.MCP_UPSTREAM_HTTP_ERROR,
    );
    expect(result.envelope.error?.category).toBe("auth");
    expect(result.envelope.data).toEqual({ error: "unauthorized" });
  });

  it("redacts secret server values from the response body and headers", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const tokenCipher = encryptCredential("abc-secret", SECRET);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: "bad token abc-secret" }, 401, {
        "x-request-id": "req_abc-secret",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tool = {
      requestTemplate: { headers: { Authorization: "Bearer {{api_token}}" } },
    };
    const { db } = makeDb({ server: [makeServer()] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
      snapshot: makeSnapshot({
        tool,
        serverValues: [
          {
            id: "msv_token",
            name: "api_token",
            isSecret: true,
            kind: "secret",
            owner: "manual",
            value: null,
            ciphertext: tokenCipher,
          },
        ],
      }),
    });

    expect(result.envelope.body).toContain("[REDACTED]");
    expect(result.envelope.body).not.toContain("abc-secret");
    expect(result.envelope.headers["x-request-id"]).toBe("req_[REDACTED]");
    expect(result.secretsUsed).toEqual(["abc-secret"]);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer abc-secret",
    );
  });

  it("returns binary content as binary:true without decoding the body", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const bytes = new Uint8Array([0, 159, 146, 150]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
      snapshot: makeSnapshot(),
    });

    expect(result.ok).toBe(true);
    expect(result.envelope.binary).toBe(true);
    expect(result.envelope.body).toBeUndefined();
    expect(result.envelope.data).toBeUndefined();
  });
});

describe("executeMappedTool: redirects", () => {
  const mutatingTool = {
    method: "POST" as const,
    allowMutation: true,
    requestTemplate: { body: '{"note":"hi"}', bodyType: "json" as const },
  };

  it("follows a same-origin 307 redirect, preserving method and body", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: "/contacts/1/canonical" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
      snapshot: makeSnapshot({ tool: mutatingTool }),
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCall = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(new URL(String(secondCall[0])).pathname).toBe(
      "/contacts/1/canonical",
    );
    expect(secondCall[1].method).toBe("POST");
    expect(secondCall[1].body).toBe('{"note":"hi"}');
  });

  it("downgrades a 302 POST redirect to GET without a body", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/contacts/1/canonical" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
      snapshot: makeSnapshot({ tool: mutatingTool }),
    });

    const secondCall = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(secondCall[1].method).toBe("GET");
    expect(secondCall[1].body).toBeUndefined();
  });

  it("rejects a cross-origin redirect target", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/steal" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
        snapshot: makeSnapshot(),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_REDIRECT_REJECTED,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("executeMappedTool: deadline and network failures", () => {
  it("times out a stalled non-mutating request with MCP_TIMEOUT", async () => {
    vi.useFakeTimers();
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    const promise = executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
      snapshot: makeSnapshot(),
    });
    const assertion = expect(promise).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_TIMEOUT,
    );
    await vi.advanceTimersByTimeAsync(MCP_UPSTREAM_DEADLINE_MS + 10);
    await assertion;
  });

  it("maps a timeout after a mutating send to MCP_MUTATION_INDETERMINATE", async () => {
    vi.useFakeTimers();
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    const promise = executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
      snapshot: makeSnapshot({
        tool: {
          method: "POST",
          allowMutation: true,
          requestTemplate: { body: "{}", bodyType: "json" },
        },
      }),
    });
    const assertion = expect(promise).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE,
    );
    await vi.advanceTimersByTimeAsync(MCP_UPSTREAM_DEADLINE_MS + 10);
    await assertion;
  });

  it("maps a network failure after a mutating send to MCP_MUTATION_INDETERMINATE", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
        snapshot: makeSnapshot({
          tool: {
            method: "POST",
            allowMutation: true,
            requestTemplate: { body: "{}", bodyType: "json" },
          },
        }),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE,
    );
  });

  it("maps a network failure for a non-mutating request to MCP_UPSTREAM_ERROR", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [makeServer()] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
        snapshot: makeSnapshot(),
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_UPSTREAM_ERROR,
    );
  });
});

describe("executeMappedTool: audit logging", () => {
  it("persists a best-effort call log without affecting the returned result", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { db, insertedValues } = makeDb({ server: [makeServer()] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
      snapshot: makeSnapshot(),
    });

    await flushMicrotasks();
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      id: result.callLogId,
      status: "success",
      outcome: "success",
      revisionMode: "published",
      publishedRevisionId: "msr_1",
      revisionNumber: 3,
      aggregateFingerprint: "agg_fp",
    });
  });
});
