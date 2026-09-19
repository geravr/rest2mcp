import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compilePlanForTool } from "../services/mcp-executor-service.js";
import { buildAgentInputZodObject } from "./mcp-contract.js";
import { compileToolDefinition } from "./mcp-compiler.js";
import { mcpRequestDefinitionSchema } from "./mcp-request-definition.js";

const serverValues = [
  {
    id: "msv_1",
    name: "api_token",
    kind: "secret" as const,
    owner: "manual" as const,
  },
  {
    id: "msv_2",
    name: "tenant",
    kind: "config" as const,
    owner: "manual" as const,
  },
];

const authoredDefinition = {
  version: 1 as const,
  pathSegments: [
    {
      id: "path_1",
      value: { kind: "literal" as const, value: "/contacts/" },
    },
    {
      id: "path_2",
      value: { kind: "agentInput" as const, agentInputId: "ain_1" },
    },
  ],
  query: [
    {
      id: "query_1",
      name: "limit",
      value: { kind: "agentInput" as const, agentInputId: "ain_2" },
    },
  ],
  headers: [
    {
      id: "hdr_1",
      name: "X-Tenant",
      value: { kind: "serverValue" as const, serverValueId: "msv_2" },
    },
    {
      id: "hdr_2",
      name: "X-Note",
      value: { kind: "literal" as const, value: "Example {{api_token}}" },
    },
  ],
  body: {
    bodyType: "json" as const,
    root: {
      kind: "object" as const,
      fields: [
        {
          id: "field_1",
          key: "active",
          value: {
            kind: "literal" as const,
            jsonType: "boolean" as const,
            value: false,
          },
        },
      ],
    },
  },
  agentInputs: [
    {
      id: "ain_1",
      name: "id",
      required: true,
      sensitive: false,
      type: "string" as const,
    },
    {
      id: "ain_2",
      name: "limit",
      required: false,
      sensitive: false,
      type: "integer" as const,
    },
  ],
};

/**
 * Walks the Studio/Platform authoring path: authored definition -> persistence
 * validation -> compile -> stored JSON -> reload -> gateway input schema.
 */
describe("typed authoring integration", () => {
  it("persists, reloads, and derives the gateway schema without reclassifying values", () => {
    // 1. Authoring-time validation (same schema Studio and Platform submit).
    const parsed = mcpRequestDefinitionSchema.parse(authoredDefinition);

    // 2. Persistence-time compilation with the server's value catalog.
    const compiled = compileToolDefinition({
      method: "POST",
      definition: parsed,
      common: { headers: [], query: [] },
      auth: null,
      serverValues,
      basePath: "/",
      allowMutation: true,
    });
    expect(compiled.ok).toBe(true);
    expect(compiled.plan).not.toBeNull();

    // 3. Store and reload the definition as opaque JSON (database round trip).
    const stored = JSON.parse(JSON.stringify(compiled.plan));
    expect(stored.definitionHash).toBe(compiled.plan?.definitionHash);

    const reloadedPlan = compilePlanForTool(
      {
        method: "POST",
        requestDefinition: JSON.parse(JSON.stringify(parsed)),
        compiledPlan: null,
        compileStatus: "valid",
        allowMutation: true,
        pathTemplate: "",
        requestTemplate: null,
        params: null,
      } as never,
      {
        serverValueRefs: serverValues,
        common: { headers: [], query: [] },
        auth: null,
        basePath: "/",
        legacyDefaultHeaders: null,
        legacyDefaultQuery: null,
      },
    );

    // 4. Literal brace text stays literal; agent binding keeps its id.
    const noteHeader = reloadedPlan.headers.find(
      (header) => header.name === "X-Note",
    );
    expect(noteHeader?.source).toEqual({
      kind: "literal",
      value: "Example {{api_token}}",
    });
    const tenantHeader = reloadedPlan.headers.find(
      (header) => header.name === "X-Tenant",
    );
    expect(tenantHeader?.source).toEqual({
      kind: "serverValue",
      serverValueId: "msv_2",
    });

    // 5. MCP schema generation exposes the agent inputs exactly once.
    const inputSchema = buildAgentInputZodObject(reloadedPlan.agentInputs);
    const jsonSchema = z.toJSONSchema(inputSchema) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(jsonSchema.properties).sort()).toEqual(["id", "limit"]);
    expect(inputSchema.safeParse({ id: "abc", limit: 5 }).success).toBe(true);
    expect(
      inputSchema.safeParse({ id: "abc", limit: 5, extra: 1 }).success,
    ).toBe(false);

    // 6. JSON literals keep their primitive type in the plan.
    expect(reloadedPlan.body).toEqual({
      bodyType: "json",
      root: {
        kind: "object",
        fields: [
          {
            id: "field_1",
            key: "active",
            value: { kind: "literal", jsonType: "boolean", value: false },
          },
        ],
      },
    });
  });

  it("rejects an authored definition that references an unknown agent input", () => {
    const result = mcpRequestDefinitionSchema.safeParse({
      ...authoredDefinition,
      query: [
        {
          id: "query_1",
          name: "limit",
          value: { kind: "agentInput", agentInputId: "ain_missing" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
