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
  mcpServerVariable: { serverId: "mcp_server_variable.server_id" },
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
  const insertedValues: unknown[] = [];
  const next = () => {
    const value = results[index] ?? [];
    index += 1;
    return makeChain(value);
  };
  return {
    select: vi.fn(() => next()),
    insert: vi.fn(() => {
      const chain = next();
      return new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === "values") {
              return (payload: unknown) => {
                insertedValues.push(payload);
                return chain;
              };
            }
            return Reflect.get(chain as object, prop);
          },
        },
      );
    }),
    insertedValues,
  };
}

const liveServer = {
  id: "mcs_1",
  userId: "usr_owner",
  status: "live",
  baseUrl: "https://api.example.com",
  allowedHosts: ["api.example.com"],
  defaultHeaders: null,
  defaultQuery: null,
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
};

function okResponse(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

  it("rejects disabled tools without calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb([[liveServer], [{ ...getTool, enabled: false }]]);

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

  it("fails unresolved placeholders before contacting upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = makeDb([[liveServer], [getTool], []]);

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
    expect(db.insert).toHaveBeenCalled();
  });

  it("omits optional query keys for a GHL-style lookup and still calls upstream", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const tokenCipher = encryptCredential("pat-secret", SECRET);
    const tool = {
      ...getTool,
      name: "get_contacts_lookup",
      pathTemplate: "/contacts/",
      params: [
        { name: "email", required: false, type: "string" },
        { name: "phone", required: false, type: "string" },
        { name: "limit", required: false, type: "string" },
        { name: "nextcursor", required: false, type: "string" },
      ],
      requestTemplate: {
        query: {
          email: "{{email}}",
          phone: "{{phone}}",
          limit: "{{limit}}",
          nextCursor: "{{nextcursor}}",
          locationId: "{{location_id}}",
        },
        headers: { Authorization: "Bearer {{api_token}}" },
      },
    };
    const db = makeDb([
      [liveServer],
      [tool],
      [
        {
          name: "location_id",
          isSecret: false,
          value: "loc_1",
          ciphertext: null,
        },
        {
          name: "api_token",
          isSecret: true,
          value: null,
          ciphertext: tokenCipher,
        },
      ],
      [],
    ]);

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { email: "a@b.com" },
      source: "playground",
      credentialSecret: SECRET,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestedUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const url = new URL(String(requestedUrl));
    expect(url.searchParams.get("email")).toBe("a@b.com");
    expect(url.searchParams.get("locationId")).toBe("loc_1");
    expect(url.searchParams.has("phone")).toBe(false);
    expect(url.searchParams.has("limit")).toBe(false);
    expect(url.searchParams.has("nextCursor")).toBe(false);
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer pat-secret",
    );
  });

  it("still fails missing required query params without contacting upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tool = {
      ...getTool,
      pathTemplate: "/contacts/",
      params: [{ name: "email", required: true, type: "string" }],
      requestTemplate: {
        query: { email: "{{email}}" },
      },
    };
    const db = makeDb([[liveServer], [tool], []]);

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
        error.details?.placeholder === "email",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders variables in path, query, headers, and body", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const tokenCipher = encryptCredential("abc-secret", SECRET);
    const tool = {
      ...getTool,
      method: "POST",
      pathTemplate: "/contacts/{{contactId}}",
      allowMutation: true,
      requestTemplate: {
        query: { region: "{{region}}" },
        headers: { Authorization: "Bearer {{api_token}}" },
        body: '{"note": "{{note}}"}',
        bodyType: "json",
      },
    };
    const db = makeDb([
      [liveServer],
      [tool],
      [
        { name: "contactId", isSecret: false, value: "c_9", ciphertext: null },
        { name: "region", isSecret: false, value: "us", ciphertext: null },
        { name: "note", isSecret: false, value: "hello", ciphertext: null },
        {
          name: "api_token",
          isSecret: true,
          value: null,
          ciphertext: tokenCipher,
        },
      ],
      [],
    ]);

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: {},
      source: "playground",
      credentialSecret: SECRET,
    });

    expect(result.ok).toBe(true);
    const [requestedUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const url = new URL(String(requestedUrl));
    expect(url.pathname).toBe("/contacts/c_9");
    expect(url.searchParams.get("region")).toBe("us");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer abc-secret");
    expect(init.body).toBe('{"note": "hello"}');
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("merges server defaults under tool-level query and headers", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const server = {
      ...liveServer,
      defaultHeaders: { Accept: "application/json", Version: "2021-07-28" },
      defaultQuery: { locale: "en", limit: "10" },
    };
    const tool = {
      ...getTool,
      requestTemplate: {
        query: { limit: "{{limit}}" },
        headers: { Accept: "text/csv" },
      },
    };
    const db = makeDb([[server], [tool], [], []]);

    await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1", limit: 50 },
      source: "playground",
      credentialSecret: SECRET,
    });

    const [requestedUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const url = new URL(String(requestedUrl));
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.get("limit")).toBe("50");
    const headers = new Headers(init.headers);
    expect(headers.get("accept")).toBe("text/csv");
    expect(headers.get("version")).toBe("2021-07-28");
  });

  it("keeps the baseUrl path prefix when building the upstream URL", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const db = makeDb([
      [{ ...liveServer, baseUrl: "https://api.example.com/v2" }],
      [getTool],
      [],
      [],
    ]);

    await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v2/contacts/1");
  });

  it("redacts secret variables across query and body in call logs", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const keyCipher = encryptCredential("query-secret", SECRET);
    const tokenCipher = encryptCredential("body-secret", SECRET);
    const tool = {
      ...getTool,
      method: "POST",
      pathTemplate: "/contacts",
      allowMutation: true,
      requestTemplate: {
        query: { api_key: "{{query_key}}" },
        body: '{"token": "{{body_token}}"}',
        bodyType: "json",
      },
    };
    const db = makeDb([
      [liveServer],
      [tool],
      [
        {
          name: "query_key",
          isSecret: true,
          value: null,
          ciphertext: keyCipher,
        },
        {
          name: "body_token",
          isSecret: true,
          value: null,
          ciphertext: tokenCipher,
        },
      ],
      [],
    ]);

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: {},
      source: "playground",
      credentialSecret: SECRET,
    });

    expect(result.ok).toBe(true);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("api_key")).toBe("query-secret");
    const logged = JSON.stringify(db.insertedValues);
    expect(logged).not.toContain("query-secret");
    expect(logged).not.toContain("body-secret");
    expect(logged).toContain("[REDACTED]");
  });

  it("sends no body for GET tools", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = {
      ...getTool,
      requestTemplate: {
        body: '{"ignored": "{{missing}}"}',
        bodyType: "json",
      },
    };
    const db = makeDb([[liveServer], [tool], [], []]);

    await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
  });

  it("sends no body for HEAD tools", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = {
      ...getTool,
      method: "HEAD",
      requestTemplate: { body: "ignore {{missing}}", bodyType: "raw" },
    };
    const db = makeDb([[liveServer], [tool], [], []]);

    await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
  });

  it("URL-encodes literal query values from server defaults", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const server = {
      ...liveServer,
      defaultQuery: { filter: "a&b=c", plain: "ok" },
    };
    const db = makeDb([[server], [getTool], [], []]);

    await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
    });

    const requested = String(fetchMock.mock.calls[0]?.[0]);
    expect(requested).toContain("filter=a%26b%3Dc");
    const url = new URL(requested);
    expect(url.searchParams.get("filter")).toBe("a&b=c");
    expect(url.searchParams.get("plain")).toBe("ok");
  });

  it("renders form bodies with form encoding and content type", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = {
      ...getTool,
      method: "POST",
      pathTemplate: "/contacts",
      allowMutation: true,
      requestTemplate: {
        body: "name={{name}}&city=Salt Lake",
        bodyType: "form",
      },
    };
    const db = makeDb([[liveServer], [tool], [], []]);

    await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { name: "Ada Lovelace" },
      source: "playground",
      credentialSecret: SECRET,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe("name=Ada%20Lovelace&city=Salt Lake");
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("sends raw bodies verbatim without imposing a content type", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const tool = {
      ...getTool,
      method: "POST",
      pathTemplate: "/contacts",
      allowMutation: true,
      requestTemplate: { body: "<x>{{value}}</x>", bodyType: "raw" },
    };
    const db = makeDb([[liveServer], [tool], [], []]);

    await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { value: "<a>&</a>" },
      source: "playground",
      credentialSecret: SECRET,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe("<x><a>&</a></x>");
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBeNull();
  });

  it("returns upstream 401 as a result with error log and no secret leak", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokenCipher = encryptCredential("abc-secret", SECRET);
    const tool = {
      ...getTool,
      requestTemplate: {
        headers: { Authorization: "Bearer {{api_token}}" },
      },
    };
    const db = makeDb([
      [liveServer],
      [tool],
      [
        {
          name: "api_token",
          isSecret: true,
          value: null,
          ciphertext: tokenCipher,
        },
      ],
      [{ id: "log_401" }],
    ]);

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "playground",
      credentialSecret: SECRET,
    });

    expect(result).toMatchObject({
      ok: false,
      httpStatus: 401,
      body: JSON.stringify({ error: "unauthorized" }),
      callLogId: "log_401",
    });
    expect(JSON.stringify(result)).not.toContain("abc-secret");
    expect(JSON.stringify(db.insertedValues)).not.toContain("abc-secret");
    expect(db.insertedValues[0]).toMatchObject({ status: "error" });
  });

  it("redacts reflected secrets from upstream error bodies returned to callers", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "bad token abc-secret" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tokenCipher = encryptCredential("abc-secret", SECRET);
    const tool = {
      ...getTool,
      requestTemplate: {
        headers: { Authorization: "Bearer {{api_token}}" },
      },
    };
    const db = makeDb([
      [liveServer],
      [tool],
      [
        {
          name: "api_token",
          isSecret: true,
          value: null,
          ciphertext: tokenCipher,
        },
      ],
      [{ id: "log_401b" }],
    ]);

    const result = await executeMappedTool(db as never, {
      serverId: "mcs_1",
      ownerUserId: "usr_owner",
      toolId: "mct_1",
      args: { id: "1" },
      source: "agent",
      credentialSecret: SECRET,
    });

    expect(result.httpStatus).toBe(401);
    expect(result.body).toContain("[REDACTED]");
    expect(result.body).not.toContain("abc-secret");
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
