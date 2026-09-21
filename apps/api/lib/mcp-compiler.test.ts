import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "./app-error.js";
import {
  assertCompileSuccess,
  compileToolDefinition,
  type CompileContext,
  type CompileServerValueRef,
} from "./mcp-compiler.js";
import type {
  McpAgentInput,
  McpAuthConfiguration,
  McpRequestDefinition,
  McpValueBinding,
} from "./mcp-request-definition.js";

function literal(value: string | number | boolean | null): McpValueBinding {
  return { kind: "literal", value };
}

function agentInputRef(id: string): McpValueBinding {
  return { kind: "agentInput", agentInputId: id };
}

function serverValueRef(
  id: string,
  extra: { prefix?: string; suffix?: string } = {},
): McpValueBinding {
  return { kind: "serverValue", serverValueId: id, ...extra };
}

function makeInput(overrides: Partial<McpAgentInput> = {}): McpAgentInput {
  return {
    id: "input_1",
    name: "input_1",
    required: true,
    sensitive: false,
    type: "string",
    ...overrides,
  };
}

function makeDefinition(
  overrides: Partial<McpRequestDefinition> = {},
): McpRequestDefinition {
  return {
    version: 2,
    pathSegments: [{ id: "seg0", value: literal("/items") }],
    query: [],
    headers: [],
    body: { bodyType: "none" },
    agentInputs: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<CompileContext> = {}): CompileContext {
  return {
    method: "GET",
    definition: makeDefinition(),
    common: { headers: [], query: [] },
    auth: null,
    serverValues: [],
    basePath: "/v1",
    allowMutation: false,
    ...overrides,
  };
}

function errorCodes(
  result: ReturnType<typeof compileToolDefinition>,
): string[] {
  return result.issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
}

describe("compileToolDefinition: literal handling", () => {
  it("treats literal braces as inert text, never rescanned for placeholders", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        pathSegments: [
          { id: "seg0", value: literal("/items/{{not_a_binding}}") },
        ],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
    expect(result.plan?.pathSegments[0]?.source).toEqual(
      literal("/items/{{not_a_binding}}"),
    );
  });
});

describe("compileToolDefinition: JSON body roots", () => {
  it("compiles a null JSON root", () => {
    const ctx = makeContext({
      method: "POST",
      allowMutation: true,
      definition: makeDefinition({
        body: {
          bodyType: "json",
          root: { kind: "literal", jsonType: "null", value: null },
        },
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
    expect(result.plan?.body).toEqual({
      bodyType: "json",
      root: { kind: "literal", jsonType: "null", value: null },
    });
  });

  it("compiles a string JSON root", () => {
    const ctx = makeContext({
      method: "POST",
      allowMutation: true,
      definition: makeDefinition({
        body: {
          bodyType: "json",
          root: { kind: "literal", jsonType: "string", value: "hello" },
        },
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
  });

  it("rejects a literal whose value does not match its declared JSON type", () => {
    const ctx = makeContext({
      method: "POST",
      allowMutation: true,
      definition: makeDefinition({
        body: {
          bodyType: "json",
          // Zod allows this shape structurally; the compiler still enforces
          // consistency between `jsonType` and the actual literal value.
          root: { kind: "literal", jsonType: "number", value: "5" as never },
        },
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });
});

describe("compileToolDefinition: repeated agent input references", () => {
  it("allows the same agent input id to be referenced from multiple locations", () => {
    const input = makeInput({ id: "region", name: "region", required: true });
    const ctx = makeContext({
      definition: makeDefinition({
        pathSegments: [
          { id: "seg0", value: literal("/items") },
          { id: "seg1", value: agentInputRef("region") },
        ],
        headers: [
          { id: "h0", name: "X-Region", value: agentInputRef("region") },
        ],
        agentInputs: [input],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe("compileToolDefinition: empty required strings", () => {
  it("rejects a required string input with minLength 0 and no explicit allowEmpty", () => {
    const input = makeInput({
      id: "name",
      name: "name",
      required: true,
      minLength: 0,
    });
    const ctx = makeContext({
      definition: makeDefinition({
        query: [{ id: "q0", name: "name", value: agentInputRef("name") }],
        agentInputs: [input],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });

  it("allows minLength 0 when allowEmpty is explicit", () => {
    const input = makeInput({
      id: "name",
      name: "name",
      required: true,
      minLength: 0,
      allowEmpty: true,
    });
    const ctx = makeContext({
      definition: makeDefinition({
        query: [{ id: "q0", name: "name", value: agentInputRef("name") }],
        agentInputs: [input],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
  });
});

describe("compileToolDefinition: collisions", () => {
  it("rejects two agent inputs declared under the same public name", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        query: [
          { id: "q0", name: "a", value: agentInputRef("id_1") },
          { id: "q1", name: "b", value: agentInputRef("id_2") },
        ],
        agentInputs: [
          makeInput({ id: "id_1", name: "shared", required: true }),
          makeInput({ id: "id_2", name: "shared", required: false }),
        ],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(
      APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
    );
  });

  it("rejects an agent input name that collides with a server value name", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_1", name: "api_token", kind: "secret", owner: "manual" },
    ];
    const ctx = makeContext({
      serverValues,
      definition: makeDefinition({
        query: [{ id: "q0", name: "a", value: agentInputRef("id_1") }],
        agentInputs: [
          makeInput({ id: "id_1", name: "api_token", required: true }),
        ],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(
      APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
    );
  });

  it("rejects duplicate header names within the tool (case-insensitive)", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        headers: [
          { id: "h0", name: "Accept", value: literal("json") },
          { id: "h1", name: "accept", value: literal("xml") },
        ],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });

  it("rejects duplicate query names within common entries", () => {
    const ctx = makeContext({
      common: {
        headers: [],
        query: [
          { id: "cq0", name: "limit", value: literal("10") },
          { id: "cq1", name: "limit", value: literal("20") },
        ],
      },
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });
});

describe("compileToolDefinition: secret overrides of auth keys", () => {
  it("allows a tool header to override a non-protected common header", () => {
    const ctx = makeContext({
      common: {
        headers: [{ id: "ch0", name: "Accept", value: literal("json") }],
        query: [],
      },
      definition: makeDefinition({
        headers: [{ id: "h0", name: "Accept", value: literal("csv") }],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
    const accept = result.plan?.headers.find((h) => h.name === "Accept");
    expect(accept?.source).toEqual(literal("csv"));
  });

  it("rejects a tool header attempting to override an auth-protected key", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_auth", name: "api_token", kind: "secret", owner: "auth" },
    ];
    const auth: McpAuthConfiguration = {
      kind: "bearer",
      bindings: [
        {
          location: "header",
          key: "Authorization",
          serverValueId: "sv_auth",
          prefix: "Bearer ",
        },
      ],
    };
    const ctx = makeContext({
      serverValues,
      auth,
      definition: makeDefinition({
        headers: [
          { id: "h0", name: "Authorization", value: literal("Bearer x") },
        ],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });

  it("rejects a common header attempting to override an auth-protected key", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_auth", name: "api_token", kind: "secret", owner: "auth" },
    ];
    const auth: McpAuthConfiguration = {
      kind: "bearer",
      bindings: [
        { location: "header", key: "Authorization", serverValueId: "sv_auth" },
      ],
    };
    const ctx = makeContext({
      serverValues,
      auth,
      common: {
        headers: [
          { id: "ch0", name: "authorization", value: literal("Bearer x") },
        ],
        query: [],
      },
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });

  it("injects the protected auth header after ordinary entries and lists it as protected", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_auth", name: "api_token", kind: "secret", owner: "auth" },
    ];
    const auth: McpAuthConfiguration = {
      kind: "bearer",
      bindings: [
        {
          location: "header",
          key: "Authorization",
          serverValueId: "sv_auth",
          prefix: "Bearer ",
        },
      ],
    };
    const ctx = makeContext({ serverValues, auth });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
    expect(result.plan?.protectedKeys.headers).toEqual(["Authorization"]);
    const authHeader = result.plan?.headers.find(
      (h) => h.name === "Authorization",
    );
    expect(authHeader?.protected).toBe(true);
    expect(authHeader?.source).toEqual(
      serverValueRef("sv_auth", { prefix: "Bearer " }),
    );
  });
});

describe("compileToolDefinition: query secret auth acknowledgement", () => {
  it("rejects a secret query auth binding without exposure acknowledgement", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_auth", name: "api_key", kind: "secret", owner: "auth" },
    ];
    const auth: McpAuthConfiguration = {
      kind: "query",
      bindings: [
        { location: "query", key: "api_key", serverValueId: "sv_auth" },
      ],
    };
    const ctx = makeContext({ serverValues, auth });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_AUTH_ACK_REQUIRED);
  });

  it("allows a secret query auth binding when acknowledged", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_auth", name: "api_key", kind: "secret", owner: "auth" },
    ];
    const auth: McpAuthConfiguration = {
      kind: "query",
      bindings: [
        { location: "query", key: "api_key", serverValueId: "sv_auth" },
      ],
      queryExposureAcknowledged: true,
    };
    const ctx = makeContext({ serverValues, auth });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
    expect(result.plan?.protectedKeys.query).toEqual(["api_key"]);
  });

  it("rejects a direct (non-auth) secret binding in a query entry", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_1", name: "api_key", kind: "secret", owner: "manual" },
    ];
    const ctx = makeContext({
      serverValues,
      definition: makeDefinition({
        query: [{ id: "q0", name: "api_key", value: serverValueRef("sv_1") }],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects a direct secret binding in a path segment", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_1", name: "api_key", kind: "secret", owner: "manual" },
    ];
    const ctx = makeContext({
      serverValues,
      definition: makeDefinition({
        pathSegments: [
          { id: "seg0", value: literal("/items/") },
          { id: "seg1", value: serverValueRef("sv_1") },
        ],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });
});

describe("compileToolDefinition: deterministic output", () => {
  it("produces the same definitionHash for the same context across calls", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        headers: [{ id: "h0", name: "Accept", value: literal("json") }],
      }),
    });
    const first = compileToolDefinition(ctx);
    const second = compileToolDefinition(
      makeContext({
        definition: makeDefinition({
          headers: [{ id: "h0", name: "Accept", value: literal("json") }],
        }),
      }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.plan?.definitionHash).toBe(second.plan?.definitionHash);
    expect(first.plan?.definitionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the hash when the definition changes", () => {
    const base = makeContext();
    const changed = makeContext({
      definition: makeDefinition({
        pathSegments: [{ id: "seg0", value: literal("/other") }],
      }),
    });
    const a = compileToolDefinition(base);
    const b = compileToolDefinition(changed);
    expect(a.plan?.definitionHash).not.toBe(b.plan?.definitionHash);
  });
});

describe("compileToolDefinition: GET/HEAD body rejection", () => {
  it("rejects a GET tool declaring a JSON body", () => {
    const ctx = makeContext({
      method: "GET",
      definition: makeDefinition({
        body: {
          bodyType: "json",
          root: { kind: "literal", jsonType: "string", value: "x" },
        },
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });

  it("rejects a HEAD tool declaring a form body", () => {
    const ctx = makeContext({
      method: "HEAD",
      definition: makeDefinition({
        body: { bodyType: "form", fields: [] },
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });

  it("accepts a GET tool with no body", () => {
    const result = compileToolDefinition(makeContext({ method: "GET" }));
    expect(result.ok).toBe(true);
    expect(result.plan?.body).toEqual({ bodyType: "none" });
  });

  it("rejects allowMutation=true on a GET tool", () => {
    const result = compileToolDefinition(
      makeContext({ method: "GET", allowMutation: true }),
    );
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });

  it("compiles a POST tool with allowMutation=false (annotation reflects, still compiles)", () => {
    const result = compileToolDefinition(
      makeContext({ method: "POST", allowMutation: false }),
    );
    expect(result.ok).toBe(true);
    expect(result.plan?.annotations.readOnlyHint).toBe(false);
  });
});

describe("compileToolDefinition: optional query omission", () => {
  it("omits a query entry bound entirely to one optional agent input", () => {
    const input = makeInput({ id: "q", name: "q", required: false });
    const ctx = makeContext({
      definition: makeDefinition({
        query: [
          {
            id: "q0",
            name: "q",
            value: agentInputRef("q"),
            omitWhenAbsent: true,
          },
        ],
        agentInputs: [input],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
    expect(result.plan?.query[0]?.omitWhenAbsent).toBe(true);
  });

  it("rejects omitWhenAbsent on a query entry bound to a required agent input", () => {
    const input = makeInput({ id: "q", name: "q", required: true });
    const ctx = makeContext({
      definition: makeDefinition({
        query: [
          {
            id: "q0",
            name: "q",
            value: agentInputRef("q"),
            omitWhenAbsent: true,
          },
        ],
        agentInputs: [input],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects omitWhenAbsent on a literal query entry", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        query: [
          {
            id: "q0",
            name: "q",
            value: literal("fixed"),
            omitWhenAbsent: true,
          },
        ],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects an optional agent input used in a path segment", () => {
    const input = makeInput({ id: "id", name: "id", required: false });
    const ctx = makeContext({
      definition: makeDefinition({
        pathSegments: [
          { id: "seg0", value: literal("/items/") },
          { id: "seg1", value: agentInputRef("id") },
        ],
        agentInputs: [input],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });

  it("omits a full JSON object field bound to one optional agent input", () => {
    const input = makeInput({ id: "note", name: "note", required: false });
    const ctx = makeContext({
      method: "POST",
      allowMutation: true,
      definition: makeDefinition({
        body: {
          bodyType: "json",
          root: {
            kind: "object",
            fields: [
              {
                id: "f0",
                key: "note",
                value: {
                  kind: "binding",
                  binding: agentInputRef("note"),
                  jsonType: "string",
                },
                omitWhenAbsent: true,
              },
            ],
          },
        },
        agentInputs: [input],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
  });

  it("rejects a raw body binding to an optional agent input (no omission mechanism)", () => {
    const input = makeInput({ id: "note", name: "note", required: false });
    const ctx = makeContext({
      method: "POST",
      allowMutation: true,
      definition: makeDefinition({
        body: {
          bodyType: "raw",
          bindings: [{ id: "b0", binding: agentInputRef("note") }],
          template: "note={{b0}}",
        },
        agentInputs: [input],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });
});

describe("compileToolDefinition: unused agent inputs", () => {
  it("rejects an agent input declared but never referenced", () => {
    const input = makeInput({ id: "unused", name: "unused", required: true });
    const ctx = makeContext({
      definition: makeDefinition({ agentInputs: [input] }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });

  it("rejects an unresolved agent input reference", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        query: [{ id: "q0", name: "a", value: agentInputRef("missing") }],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(
      APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
    );
  });

  it("rejects an unresolved server value reference", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        query: [{ id: "q0", name: "a", value: serverValueRef("missing") }],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(
      APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
    );
  });
});

describe("compileToolDefinition: path escape literals", () => {
  it("rejects a literal path segment that escapes the base path via dot segments", () => {
    const ctx = makeContext({
      basePath: "/v1",
      definition: makeDefinition({
        pathSegments: [{ id: "seg0", value: literal("/../../secret") }],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_PATH_ESCAPE);
  });

  it("accepts a literal path segment that stays confined under the base path", () => {
    const ctx = makeContext({
      basePath: "/v1",
      definition: makeDefinition({
        pathSegments: [{ id: "seg0", value: literal("/contacts/../items") }],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
  });

  it("does not evaluate dynamic segment values for confinement at compile time", () => {
    const input = makeInput({ id: "id", name: "id", required: true });
    const ctx = makeContext({
      basePath: "/v1",
      definition: makeDefinition({
        pathSegments: [
          { id: "seg0", value: literal("/items/") },
          { id: "seg1", value: agentInputRef("id") },
        ],
        agentInputs: [input],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
  });
});

describe("compileToolDefinition: forbidden transport headers", () => {
  it("rejects Cookie as a tool header", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        headers: [{ id: "h0", name: "Cookie", value: literal("a=b") }],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });

  it("rejects Host, Content-Length, and Proxy-Authorization", () => {
    for (const name of ["Host", "Content-Length", "Proxy-Authorization"]) {
      const ctx = makeContext({
        definition: makeDefinition({
          headers: [{ id: "h0", name, value: literal("x") }],
        }),
      });
      const result = compileToolDefinition(ctx);
      expect(result.ok).toBe(false);
    }
  });
});

describe("compileToolDefinition: annotations", () => {
  it("defaults GET to read-only and open-world", () => {
    const result = compileToolDefinition(makeContext({ method: "GET" }));
    expect(result.plan?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("defaults DELETE to destructive and non-read-only", () => {
    const result = compileToolDefinition(
      makeContext({ method: "DELETE", allowMutation: true }),
    );
    expect(result.plan?.annotations.destructiveHint).toBe(true);
    expect(result.plan?.annotations.readOnlyHint).toBe(false);
  });

  it("lets author metadata override the destructive default", () => {
    const result = compileToolDefinition(
      makeContext({
        method: "DELETE",
        allowMutation: true,
        definition: makeDefinition({
          annotations: { destructiveHint: false },
        }),
      }),
    );
    expect(result.plan?.annotations.destructiveHint).toBe(false);
  });
});

describe("assertCompileSuccess", () => {
  it("returns the plan when compilation succeeds", () => {
    const result = compileToolDefinition(makeContext());
    expect(assertCompileSuccess(result)).toBe(result.plan);
  });

  it("throws AppError with MCP_COMPILE_INVALID and details.path from the first error", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        query: [{ id: "q0", name: "a", value: agentInputRef("missing") }],
      }),
    });
    const result = compileToolDefinition(ctx);
    try {
      assertCompileSuccess(result);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).appCode).toBe(
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
      );
      expect((error as AppError).details?.path).toBe("query.a");
    }
  });
});

describe("compileToolDefinition: auth-owned server values", () => {
  it("rejects a tool binding referencing an auth-owned server value directly", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_auth", name: "api_token", kind: "secret", owner: "auth" },
    ];
    const ctx = makeContext({
      serverValues,
      definition: makeDefinition({
        headers: [
          { id: "h0", name: "X-Custom", value: serverValueRef("sv_auth") },
        ],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });

  it("allows a manual-owned server value to be referenced directly in a header", () => {
    const serverValues: CompileServerValueRef[] = [
      { id: "sv_1", name: "location_id", kind: "config", owner: "manual" },
    ];
    const ctx = makeContext({
      serverValues,
      definition: makeDefinition({
        headers: [
          { id: "h0", name: "X-Location", value: serverValueRef("sv_1") },
        ],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
  });
});

describe("compileToolDefinition: form body", () => {
  it("rejects duplicate form field names", () => {
    const ctx = makeContext({
      method: "POST",
      allowMutation: true,
      definition: makeDefinition({
        body: {
          bodyType: "form",
          fields: [
            { id: "f0", name: "a", value: literal("1") },
            { id: "f1", name: "a", value: literal("2") },
          ],
        },
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
  });

  it("compiles unique form fields", () => {
    const ctx = makeContext({
      method: "POST",
      allowMutation: true,
      definition: makeDefinition({
        body: {
          bodyType: "form",
          fields: [{ id: "f0", name: "a", value: literal("1") }],
        },
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
  });
});

describe("compileToolDefinition: array inputs and query serialization", () => {
  const arrayInput = makeInput({
    id: "ain_tags",
    name: "tags",
    type: "array",
    items: { type: "string" },
    minItems: 1,
    maxItems: 4,
  });

  it("compiles a query array with form serialization into the plan", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        query: [
          {
            id: "query_0",
            name: "tags",
            value: agentInputRef("ain_tags"),
            serialization: { style: "form", explode: false },
          },
        ],
        agentInputs: [arrayInput],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
    expect(result.plan?.query[0]).toMatchObject({
      name: "tags",
      serialization: { style: "form", explode: false },
    });
  });

  it("rejects a query array without serialization metadata", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        query: [
          {
            id: "query_0",
            name: "tags",
            value: agentInputRef("ain_tags"),
          },
        ],
        agentInputs: [arrayInput],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });

  it("rejects array inputs in path segments", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        pathSegments: [
          { id: "seg0", value: literal("/items/") },
          { id: "seg1", value: agentInputRef("ain_tags") },
        ],
        agentInputs: [arrayInput],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });

  it("compiles a JSON body array bound as opaque jsonType any", () => {
    const ctx = makeContext({
      method: "POST",
      allowMutation: true,
      definition: makeDefinition({
        body: {
          bodyType: "json",
          root: {
            kind: "binding",
            binding: agentInputRef("ain_tags"),
            jsonType: "any",
          },
        },
        agentInputs: [arrayInput],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(true);
    expect(result.plan?.body).toEqual({
      bodyType: "json",
      root: {
        kind: "binding",
        binding: { kind: "agentInput", agentInputId: "ain_tags" },
        jsonType: "any",
      },
    });
  });

  it("rejects serialization on a scalar query input", () => {
    const ctx = makeContext({
      definition: makeDefinition({
        query: [
          {
            id: "query_0",
            name: "q",
            value: agentInputRef("input_1"),
            serialization: { style: "form", explode: true },
          },
        ],
        agentInputs: [makeInput()],
      }),
    });
    const result = compileToolDefinition(ctx);
    expect(result.ok).toBe(false);
    expect(errorCodes(result)).toContain(APP_ERROR_CODES.MCP_COMPILE_INVALID);
  });
});
