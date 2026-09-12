import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "../lib/app-error.js";
import { encryptCredential } from "../lib/mcp-crypto.js";

const tables = vi.hoisted(() => ({
  mcpServer: { id: "mcp_server.id" },
  mcpTool: {
    id: "mcp_tool.id",
    serverId: "mcp_tool.server_id",
    name: "mcp_tool.name",
  },
  mcpCredential: { serverId: "mcp_credential.server_id" },
  mcpCallLog: {},
}));

vi.mock("@repo/db", () => tables);
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

function makeChain<T>(result: T) {
  const handler: ProxyHandler<object> = {
    get(_, prop: string | symbol) {
      if (prop === "then") {
        return (
          resolve: (value: T) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

function makeDb(results: unknown[]) {
  let index = 0;
  const next = () => {
    const value = results[index] ?? [];
    index += 1;
    return makeChain(value);
  };
  return {
    select: vi.fn(() => next()),
    insert: vi.fn(() => next()),
  };
}

const liveServer = {
  id: "mcs_1",
  userId: "usr_owner",
  status: "live",
  baseUrl: "https://api.example.com",
  allowedHosts: ["api.example.com"],
};

const getTool = {
  id: "mct_1",
  name: "get_contact",
  method: "GET",
  pathTemplate: "/contacts/{id}",
  paramMap: {},
  allowMutation: false,
  enabled: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("executeMappedTool", () => {
  it("rejects paused servers without calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb([[{ ...liveServer, status: "paused" }], [getTool]]);

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
        error.appCode === APP_ERROR_CODES.INVALID_INPUT,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it("blocks mutations when allowMutation is false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb([
      [liveServer],
      [{ ...getTool, method: "DELETE", enabled: true, allowMutation: false }],
    ]);

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
    const db = makeDb([
      [
        {
          ...liveServer,
          baseUrl: "https://evil.example",
          allowedHosts: ["api.example.com"],
        },
      ],
      [getTool],
      [],
    ]);

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

  it("persists a redacted success log and does not echo the credential", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ciphertext = encryptCredential("abc-secret", SECRET);
    const db = makeDb([
      [liveServer],
      [getTool],
      [
        {
          scheme: "bearer",
          headerName: "Authorization",
          valueLocation: "header",
          ciphertext,
        },
      ],
      [],
    ]);

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
    });

    expect(result.ok).toBe(true);
    expect(result.body).toContain('"id":"1"');
    expect(JSON.stringify(result)).not.toContain("abc-secret");
    expect(fetchMock).toHaveBeenCalled();
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.pathname).toBe("/contacts/1");
    expect(db.insert).toHaveBeenCalled();
    expect(JSON.stringify(db.insert.mock.calls[0])).not.toContain("abc-secret");
  });

  it("rejects disabled tools without calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb([[liveServer], [{ ...getTool, enabled: false }]]);

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        source: "playground",
        credentialSecret: SECRET,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVALID_INPUT,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows an enabled mutating POST", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb([
      [liveServer],
      [
        {
          ...getTool,
          method: "POST",
          pathTemplate: "/contacts",
          allowMutation: true,
          enabled: true,
        },
      ],
      [],
      [],
    ]);

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { name: "Ada" },
      source: "playground",
      credentialSecret: SECRET,
    });

    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(201);
    expect(fetchMock).toHaveBeenCalled();
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.pathname).toBe("/contacts");
    expect(
      (fetchMock.mock.calls[0]?.[1] as { method?: string } | undefined)?.method,
    ).toBe("POST");
  });

  it("maps upstream 401 to MCP_UPSTREAM_ERROR without leaking the bearer", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Bearer abc-secret rejected", {
        status: 401,
        headers: { "content-type": "text/plain" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const ciphertext = encryptCredential("abc-secret", SECRET);
    const db = makeDb([
      [liveServer],
      [getTool],
      [
        {
          scheme: "bearer",
          headerName: "Authorization",
          valueLocation: "header",
          ciphertext,
        },
      ],
      [],
    ]);

    await expect(
      executeMappedTool(db as never, {
        serverId: "mcs_1",
        ownerUserId: "usr_owner",
        toolId: "mct_1",
        args: { id: "1" },
        source: "playground",
        credentialSecret: SECRET,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof AppError)) return false;
      if (error.appCode !== APP_ERROR_CODES.MCP_UPSTREAM_ERROR) return false;
      return !JSON.stringify(error).includes("abc-secret");
    });
  });

  it("rejects playground invoke for another user's server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb([[liveServer]]);

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
