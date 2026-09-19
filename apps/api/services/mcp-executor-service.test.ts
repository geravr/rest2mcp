import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "../lib/app-error.js";
import { encryptCredential } from "../lib/mcp-crypto.js";
import { MCP_UPSTREAM_DEADLINE_MS } from "../lib/mcp-policy.js";

const tables = vi.hoisted(() => ({
  mcpServer: { id: "mcp_server.id" },
  mcpTool: {
    id: "mcp_tool.id",
    serverId: "mcp_tool.server_id",
    name: "mcp_tool.name",
  },
  mcpServerVariable: { serverId: "mcp_server_variable.server_id" },
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
}));

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import { executeMappedTool } from "./mcp-executor-service.js";

const SECRET = "c".repeat(32);

/** A promise-like `select().from(table).where(...)` result usable both
 * awaited directly and via a chained `.limit(n)`. */
function selectResult(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return Object.assign(promise, {
    limit: () => Promise.resolve(rows),
  });
}

function makeDb(input: {
  server: unknown[];
  tool: unknown[];
  serverValues?: unknown[];
}) {
  const insertedValues: unknown[] = [];
  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === tables.mcpServer) return selectResult(input.server);
          if (table === tables.mcpTool) return selectResult(input.tool);
          if (table === tables.mcpServerVariable) {
            return selectResult(input.serverValues ?? []);
          }
          return selectResult([]);
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: (payload: unknown) => {
        insertedValues.push(payload);
        return Promise.resolve([]);
      },
    })),
  };
  return { db, insertedValues };
}

const liveServer = {
  id: "mcs_1",
  userId: "usr_owner",
  status: "live",
  baseUrl: "https://api.example.com",
  allowedHosts: ["api.example.com"],
  defaultHeaders: null,
  defaultQuery: null,
  commonEntries: null,
  authConfiguration: null,
};

const getTool = {
  id: "mct_1",
  name: "get_contact",
  method: "GET",
  pathTemplate: "/contacts/{{id}}",
  requestTemplate: {},
  params: [{ name: "id", required: true, type: "string" }],
  allowMutation: false,
  enabled: true,
  requestDefinition: null,
  compiledPlan: null,
  compileStatus: null,
};

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
});

describe("executeMappedTool: guards before contacting upstream", () => {
  it("rejects paused servers", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({
      server: [{ ...liveServer, status: "paused" }],
      tool: [getTool],
    });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
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
    const { db } = makeDb({
      server: [liveServer],
      tool: [{ ...getTool, enabled: false }],
    });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
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
    const { db } = makeDb({
      server: [liveServer],
      tool: [{ ...getTool, method: "DELETE", allowMutation: false }],
    });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        toolId: "mct_1",
        source: "agent",
        credentialSecret: SECRET,
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
    const { db } = makeDb({
      server: [
        {
          ...liveServer,
          baseUrl: "https://evil.example",
          allowedHosts: ["api.example.com"],
        },
      ],
      tool: [getTool],
    });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
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
    const { db } = makeDb({ server: [liveServer], tool: [getTool] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: {},
        source: "playground",
        credentialSecret: SECRET,
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
    const { db } = makeDb({ server: [liveServer], tool: [] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_other",
        toolId: "mct_1",
        source: "playground",
        credentialSecret: SECRET,
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
    const { db } = makeDb({ server: [liveServer], tool: [getTool] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
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

  it("returns a completed 4xx as ok:false with MCP_UPSTREAM_HTTP_ERROR, not a throw", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = makeDb({ server: [liveServer], tool: [getTool] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
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
      ...getTool,
      requestTemplate: { headers: { Authorization: "Bearer {{api_token}}" } },
    };
    const { db } = makeDb({
      server: [liveServer],
      tool: [tool],
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
    });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
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
    const { db } = makeDb({ server: [liveServer], tool: [getTool] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
    });

    expect(result.ok).toBe(true);
    expect(result.envelope.binary).toBe(true);
    expect(result.envelope.body).toBeUndefined();
    expect(result.envelope.data).toBeUndefined();
  });
});

describe("executeMappedTool: redirects", () => {
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
    const tool = {
      ...getTool,
      method: "POST",
      allowMutation: true,
      requestTemplate: { body: '{"note":"hi"}', bodyType: "json" },
    };
    const { db } = makeDb({ server: [liveServer], tool: [tool] });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
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
    const tool = {
      ...getTool,
      method: "POST",
      allowMutation: true,
      requestTemplate: { body: '{"note":"hi"}', bodyType: "json" },
    };
    const { db } = makeDb({ server: [liveServer], tool: [tool] });

    await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
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
    const { db } = makeDb({ server: [liveServer], tool: [getTool] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
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
    const { db } = makeDb({ server: [liveServer], tool: [getTool] });

    const promise = executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
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
    const tool = {
      ...getTool,
      method: "POST",
      allowMutation: true,
      requestTemplate: { body: "{}", bodyType: "json" },
    };
    const { db } = makeDb({ server: [liveServer], tool: [tool] });

    const promise = executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
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
    const tool = {
      ...getTool,
      method: "POST",
      allowMutation: true,
      requestTemplate: { body: "{}", bodyType: "json" },
    };
    const { db } = makeDb({ server: [liveServer], tool: [tool] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
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
    const { db } = makeDb({ server: [liveServer], tool: [getTool] });

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
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
    const { db, insertedValues } = makeDb({
      server: [liveServer],
      tool: [getTool],
    });

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
    });

    await flushMicrotasks();
    expect(insertedValues).toHaveLength(1);
    expect(insertedValues[0]).toMatchObject({
      id: result.callLogId,
      status: "success",
      outcome: "success",
    });
  });
});
