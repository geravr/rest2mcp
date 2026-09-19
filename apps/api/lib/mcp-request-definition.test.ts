import { describe, expect, it } from "vitest";
import { createToolCommandSchema } from "./mcp-domain-commands.js";
import { compileToolDefinition } from "./mcp-compiler.js";
import {
  mcpRequestDefinitionSchema,
  regenerateDefinitionIds,
} from "./mcp-request-definition.js";
import {
  projectCommonEntriesToLegacy,
  projectDefinitionToLegacy,
} from "./mcp-legacy-migrate.js";

function definition(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    pathSegments: [
      { id: "path_1", value: { kind: "literal" as const, value: "/contacts" } },
    ],
    query: [],
    headers: [],
    body: { bodyType: "none" as const },
    agentInputs: [],
    ...overrides,
  };
}

describe("mcpRequestDefinitionSchema hardening", () => {
  it("rejects unknown keys on nested bindings", () => {
    const result = mcpRequestDefinitionSchema.safeParse(
      definition({
        headers: [
          {
            id: "hdr_1",
            name: "X-Test",
            value: { kind: "literal", value: "a", extra: true },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects duplicate definition-local ids", () => {
    const result = mcpRequestDefinitionSchema.safeParse(
      definition({
        query: [
          { id: "dup", name: "a", value: { kind: "literal", value: "1" } },
        ],
        headers: [
          { id: "dup", name: "b", value: { kind: "literal", value: "2" } },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects unresolved agent-input references", () => {
    const result = mcpRequestDefinitionSchema.safeParse(
      definition({
        query: [
          {
            id: "query_1",
            name: "limit",
            value: { kind: "agentInput", agentInputId: "ain_missing" },
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects malformed recursive JSON nodes", () => {
    const result = mcpRequestDefinitionSchema.safeParse(
      definition({
        body: {
          bodyType: "json",
          root: {
            kind: "object",
            fields: [
              {
                id: "field_1",
                key: "nested",
                value: { kind: "array", items: "not-a-node" },
              },
            ],
          },
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("enforces path-segment limits", () => {
    const result = mcpRequestDefinitionSchema.safeParse(
      definition({
        pathSegments: Array.from({ length: 40 }, (_, index) => ({
          id: `path_${index}`,
          value: { kind: "literal", value: `/${index}` },
        })),
      }),
    );
    expect(result.success).toBe(false);
  });

  it("enforces form-body entry limits", () => {
    const result = mcpRequestDefinitionSchema.safeParse(
      definition({
        body: {
          bodyType: "form",
          fields: Array.from({ length: 61 }, (_, index) => ({
            id: `field_${index}`,
            name: `f${index}`,
            value: { kind: "literal", value: "x" },
          })),
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects typed definitions mixed with legacy fields", () => {
    const result = createToolCommandSchema.safeParse({
      serverId: "mcs_1",
      name: "get_contact",
      method: "GET",
      requestDefinition: definition(),
      pathTemplate: "/contacts/{{id}}",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid typed create command", () => {
    const result = createToolCommandSchema.safeParse({
      serverId: "mcs_1",
      expectedRevision: 1,
      name: "get_contact",
      method: "GET",
      requestDefinition: definition(),
    });
    expect(result.success).toBe(true);
  });
});

describe("regenerateDefinitionIds", () => {
  it("rewrites local ids and internal references but preserves server values", () => {
    const source = mcpRequestDefinitionSchema.parse(
      definition({
        pathSegments: [
          { id: "path_1", value: { kind: "literal", value: "/x/" } },
          {
            id: "path_2",
            value: { kind: "agentInput", agentInputId: "ain_1" },
          },
        ],
        headers: [
          {
            id: "hdr_1",
            name: "X-Value",
            value: { kind: "serverValue", serverValueId: "msv_1" },
          },
        ],
        agentInputs: [
          { id: "ain_1", name: "id", required: true, type: "string" },
        ],
      }),
    );
    const regenerated = regenerateDefinitionIds(
      source,
      (prefix) => `${prefix}_new`,
    );
    expect(regenerated.pathSegments[1]?.value).toEqual({
      kind: "agentInput",
      agentInputId: "ain_new",
    });
    expect(regenerated.headers[0]?.value).toEqual({
      kind: "serverValue",
      serverValueId: "msv_1",
    });
    expect(regenerated.agentInputs[0]?.id).toBe("ain_new");
  });
});

describe("server-value changes cannot reclassify typed bindings", () => {
  const serverValues = [
    {
      id: "msv_1",
      name: "api_token",
      kind: "secret" as const,
      owner: "manual" as const,
    },
  ];

  it("keeps a literal that matches a newly created server-value name", () => {
    const source = mcpRequestDefinitionSchema.parse(
      definition({
        headers: [
          {
            id: "hdr_1",
            name: "X-Note",
            value: { kind: "literal", value: "{{api_token}}" },
          },
        ],
      }),
    );
    const result = compileToolDefinition({
      method: "GET",
      definition: source,
      common: { headers: [], query: [] },
      auth: null,
      serverValues,
      basePath: "/",
      allowMutation: false,
    });
    expect(result.ok).toBe(true);
    expect(result.plan?.headers[0]?.source).toEqual({
      kind: "literal",
      value: "{{api_token}}",
    });
  });

  it("reports a name conflict instead of reclassifying an agent binding", () => {
    const source = mcpRequestDefinitionSchema.parse(
      definition({
        query: [
          {
            id: "query_1",
            name: "token",
            value: { kind: "agentInput", agentInputId: "ain_1" },
          },
        ],
        agentInputs: [
          { id: "ain_1", name: "api_token", required: true, type: "string" },
        ],
      }),
    );
    const result = compileToolDefinition({
      method: "GET",
      definition: source,
      common: { headers: [], query: [] },
      auth: null,
      serverValues,
      basePath: "/",
      allowMutation: false,
    });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (issue) => issue.code === "MCP_VARIABLE_NAME_CONFLICT",
      ),
    ).toBe(true);
  });
});

describe("legacy compatibility projection", () => {
  it("projects a lossless definition", () => {
    const source = mcpRequestDefinitionSchema.parse(
      definition({
        query: [
          {
            id: "query_1",
            name: "limit",
            value: { kind: "agentInput", agentInputId: "ain_1" },
          },
        ],
        agentInputs: [
          { id: "ain_1", name: "limit", required: false, type: "integer" },
        ],
      }),
    );
    const result = projectDefinitionToLegacy(source, "GET", {});
    expect(result.projectable).toBe(true);
    expect(result.projection?.params).toEqual([
      expect.objectContaining({
        name: "limit",
        type: "number",
        required: false,
      }),
    ]);
    expect(result.projection?.requestTemplate.query).toEqual({
      limit: "{{limit}}",
    });
  });

  it("marks literal placeholder-shaped text non-projectable", () => {
    const source = mcpRequestDefinitionSchema.parse(
      definition({
        headers: [
          {
            id: "hdr_1",
            name: "X-Note",
            value: { kind: "literal", value: "Example {{name}}" },
          },
        ],
      }),
    );
    const result = projectDefinitionToLegacy(source, "GET", {});
    expect(result.projectable).toBe(false);
    expect(result.projection).toBeNull();
    expect(result.issues[0]?.code).toBe("MCP_LEGACY_PROJECTION_UNAVAILABLE");
  });

  it("marks repeated entry names non-projectable", () => {
    const source = mcpRequestDefinitionSchema.parse(
      definition({
        query: [
          { id: "q1", name: "tag", value: { kind: "literal", value: "a" } },
          { id: "q2", name: "tag", value: { kind: "literal", value: "b" } },
        ],
      }),
    );
    const result = projectDefinitionToLegacy(source, "GET", {});
    expect(result.projectable).toBe(false);
  });

  it("projects lossless common entries and rejects repeated names", () => {
    const lossless = projectCommonEntriesToLegacy(
      {
        headers: [
          {
            id: "h1",
            name: "Version",
            value: { kind: "serverValue", serverValueId: "msv_1" },
          },
        ],
        query: [],
      },
      { msv_1: "api_version" },
    );
    expect(lossless.projectable).toBe(true);
    expect(lossless.defaultHeaders).toEqual({
      Version: "{{api_version}}",
    });

    const repeated = projectCommonEntriesToLegacy(
      {
        headers: [
          { id: "h1", name: "X", value: { kind: "literal", value: "a" } },
          { id: "h2", name: "x", value: { kind: "literal", value: "b" } },
        ],
        query: [],
      },
      {},
    );
    expect(repeated.projectable).toBe(false);
  });
});
