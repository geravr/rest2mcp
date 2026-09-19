import { describe, expect, it } from "vitest";
import {
  assertCompileSuccess,
  compileToolDefinition,
  type CompileContext,
} from "./mcp-compiler.js";
import {
  compileAgentToolContract,
  MCP_CONTRACT_META_KEY,
} from "./mcp-contract.js";
import { buildPlatformContract, PLATFORM_REGISTRY } from "./mcp-platform.js";
import type {
  McpAgentInput,
  McpRequestDefinition,
} from "./mcp-request-definition.js";

function definition(agentInputs: McpAgentInput[]): McpRequestDefinition {
  return {
    version: 1,
    pathSegments: [{ id: "seg0", value: { kind: "literal", value: "/items" } }],
    query: agentInputs.map((input, index) => ({
      id: `query_${index}`,
      name: input.name,
      value: { kind: "agentInput", agentInputId: input.id },
      omitWhenAbsent: !input.required,
    })),
    headers: [],
    body: { bodyType: "none" },
    agentInputs,
  };
}

function contractFor(
  copy: { name: string; title: string; description: string },
  agentInputs: McpAgentInput[],
  method: string = "GET",
  annotations: McpRequestDefinition["annotations"] = undefined,
) {
  const def = definition(agentInputs);
  const context: CompileContext = {
    method,
    definition: annotations ? { ...def, annotations } : def,
    common: { headers: [], query: [] },
    auth: null,
    serverValues: [],
    basePath: "/v1",
    allowMutation: method !== "GET" && method !== "HEAD",
  };
  const plan = assertCompileSuccess(compileToolDefinition(context));
  const result = compileAgentToolContract({ ...copy, method, plan });
  if (!result.ok || !result.contract) {
    throw new Error("expected a ready contract");
  }
  return result.contract;
}

const constrained: McpAgentInput = {
  id: "ain_limit",
  name: "limit",
  description: "Maximum number of items to return.",
  required: false,
  sensitive: false,
  type: "integer",
  minimum: 1,
  maximum: 100,
  examples: [10],
};

const sensitive: McpAgentInput = {
  id: "ain_token",
  name: "token",
  description: "Short-lived access token.",
  required: true,
  sensitive: true,
  type: "string",
  examples: ["should-not-appear"],
};

describe("product contract fixtures", () => {
  it("advertises a constrained read-only tool", () => {
    const contract = contractFor(
      {
        name: "list_items",
        title: "List items",
        description: "List upstream items with an optional result limit.",
      },
      [constrained],
    );
    expect(contract.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(contract.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of items to return.",
          examples: [10],
        },
      },
    });
    expect(contract.fingerprint).toMatch(/^sha256:/);
  });

  it("advertises a destructive DELETE tool", () => {
    const contract = contractFor(
      {
        name: "delete_item",
        title: "Delete item",
        description: "Permanently delete one upstream item by id.",
      },
      [
        {
          id: "ain_id",
          name: "id",
          description: "Item id to delete.",
          required: true,
          sensitive: false,
          type: "string",
        },
      ],
      "DELETE",
    );
    expect(contract.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("keeps sensitive examples out of the advertised contract", () => {
    const contract = contractFor(
      {
        name: "create_session",
        title: "Create session",
        description: "Exchange a token for a short-lived session.",
      },
      [sensitive],
      "POST",
    );
    expect(JSON.stringify(contract)).not.toContain("should-not-appear");
    const properties = (
      contract.inputSchema as { properties: Record<string, unknown> }
    ).properties;
    expect(properties.token).toMatchObject({ writeOnly: true });
  });

  it("distinguishes two similarly named tools for selection", () => {
    const read = contractFor(
      {
        name: "get_item",
        title: "Get item",
        description: "Fetch a single item by id without modifying it.",
      },
      [
        {
          id: "ain_id",
          name: "id",
          description: "Item id to fetch.",
          required: true,
          sensitive: false,
          type: "string",
        },
      ],
    );
    const remove = contractFor(
      {
        name: "delete_item",
        title: "Delete item",
        description: "Permanently remove a single item by id.",
      },
      [
        {
          id: "ain_id",
          name: "id",
          description: "Item id to delete.",
          required: true,
          sensitive: false,
          type: "string",
        },
      ],
      "DELETE",
    );
    expect(read.title).not.toBe(remove.title);
    expect(read.description).not.toBe(remove.description);
    expect(read.annotations.destructiveHint).toBe(false);
    expect(remove.annotations.destructiveHint).toBe(true);
    expect(read.fingerprint).not.toBe(remove.fingerprint);
  });

  it("stays fingerprint-stable under unrelated recomputation", () => {
    const a = contractFor(
      {
        name: "list_items",
        title: "List items",
        description: "List upstream items.",
      },
      [constrained],
    );
    const b = contractFor(
      {
        name: "list_items",
        title: "List items",
        description: "List upstream items.",
      },
      [constrained],
    );
    expect(b.fingerprint).toBe(a.fingerprint);
  });
});

describe("platform contract fixtures", () => {
  it("registers a fully described contract for every tool", () => {
    for (const tool of PLATFORM_REGISTRY) {
      expect(tool.title.trim().length).toBeGreaterThan(0);
      expect(tool.description.trim().length).toBeGreaterThan(0);
      expect(tool.scopes.length).toBeGreaterThan(0);
      const contract = buildPlatformContract(tool);
      const inputSchema = contract.inputSchema as {
        type?: string;
        properties?: Record<string, unknown>;
      };
      expect(inputSchema.type).toBe("object");
      expect(inputSchema.properties).toBeDefined();
      expect(contract.outputSchema).toMatchObject({ type: "object" });
      expect(contract.metadata[MCP_CONTRACT_META_KEY]).toMatchObject({
        version: 1,
      });
      expect(contract.fingerprint).toBe(
        contract.metadata[MCP_CONTRACT_META_KEY].fingerprint,
      );
    }
  });

  it("keeps registry order stable and scopes within the platform catalog", () => {
    const names = PLATFORM_REGISTRY.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    const allowed = new Set([
      "read",
      "author",
      "invoke",
      "secret_reference",
      "destructive",
    ]);
    for (const tool of PLATFORM_REGISTRY) {
      for (const scope of tool.scopes) {
        expect(allowed.has(scope)).toBe(true);
      }
    }
    const listServers = PLATFORM_REGISTRY.find(
      (tool) => tool.name === "list_servers",
    )!;
    const withoutSecret = buildPlatformContract(
      listServers,
      (scope) => scope !== "secret_reference",
    );
    const withSecret = buildPlatformContract(listServers, () => true);
    expect(JSON.stringify(withoutSecret.outputSchema)).not.toContain(
      "hasSecret",
    );
    expect(JSON.stringify(withSecret.outputSchema)).toContain("hasSecret");

    // Exposure is always sorted by name, so a fully scoped token sees this
    // exact stable order.
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual([
      "add_tool_from_curl",
      "create_server",
      "create_tool",
      "delete_server",
      "delete_tool",
      "delete_variable",
      "duplicate_tool",
      "get_connection_snippet",
      "list_recent_calls",
      "list_servers",
      "list_tools",
      "list_variables",
      "preview_tool",
      "set_variable",
      "test_tool",
      "update_tool",
    ]);
  });
});
