import { describe, expect, it } from "vitest";
import {
  buildServerValueLookup,
  createDefinitionId,
  definitionAgentInputs,
  definitionToBodyState,
  definitionToPathParts,
  definitionToSourceRows,
  formStateToDefinition,
  isClientRequestDefinition,
  sourceRowsToJsonText,
  type ClientAgentInput,
  type ClientJsonNode,
  type ClientRequestDefinition,
} from "./request-definition";
import type { SourceRow } from "./value-origin";

const lookup = buildServerValueLookup([
  { id: "msv_1", name: "api_token" },
  { id: "msv_2", name: "tenant" },
]);

function baseInput(
  overrides: Partial<Parameters<typeof formStateToDefinition>[0]>,
) {
  return {
    pathParts: [{ kind: "text" as const, value: "/contacts" }],
    query: [] as SourceRow[],
    headers: [] as SourceRow[],
    bodyType: "none" as const,
    formRows: [],
    jsonRows: [],
    jsonAdvanced: false,
    advancedBody: "",
    serverValueIdByName: lookup.idByName,
    agentInputId: (name: string) => `ain_${name}`,
    ...overrides,
  };
}

describe("client request-definition adapters", () => {
  it("keeps fixed placeholder-shaped text literal", () => {
    const definition = formStateToDefinition(
      baseInput({
        headers: [
          {
            key: "X-Note",
            origin: "fixed",
            value: "Example {{name}}",
          },
        ],
      }),
    );
    expect(definition.headers[0]?.value).toEqual({
      kind: "literal",
      value: "Example {{name}}",
    });
  });

  it("round-trips advanced JSON id tokens for server-value rows", () => {
    const text = sourceRowsToJsonText([
      {
        key: "token",
        origin: "variable",
        name: "api_token",
        prefix: "",
        serverValueId: "msv_1",
      },
    ]);
    const definition = formStateToDefinition(
      baseInput({
        bodyType: "json",
        jsonAdvanced: true,
        advancedBody: text,
        agentNames: new Set<string>(),
      }),
    );
    expect(definition.body).toEqual({
      bodyType: "json",
      root: {
        kind: "object",
        fields: [
          {
            id: expect.any(String),
            key: "token",
            value: {
              kind: "binding",
              binding: { kind: "serverValue", serverValueId: "msv_1" },
              jsonType: "string",
            },
          },
        ],
      },
    });
  });

  it("keeps advanced raw id tokens bound to server values", () => {
    const definition = formStateToDefinition(
      baseInput({
        bodyType: "raw",
        advancedBody: '{"token":"{{msv_1}}"}',
      }),
    );
    const body = definition.body;
    expect(body.bodyType).toBe("raw");
    if (body.bodyType !== "raw") throw new Error("expected raw body");
    expect(body.bindings).toEqual([
      expect.objectContaining({
        binding: { kind: "serverValue", serverValueId: "msv_1" },
      }),
    ]);
  });

  it("preserves boolean and null JSON literals with their type", () => {
    const definition = formStateToDefinition(
      baseInput({
        bodyType: "json",
        jsonRows: [
          { key: "active", origin: "fixed", value: "false" },
          { key: "deleted", origin: "fixed", value: "null" },
          { key: "count", origin: "fixed", value: "0" },
        ],
      }),
    );
    expect(definition.body).toEqual({
      bodyType: "json",
      root: {
        kind: "object",
        fields: [
          {
            id: expect.any(String),
            key: "active",
            value: { kind: "literal", jsonType: "boolean", value: false },
          },
          {
            id: expect.any(String),
            key: "deleted",
            value: { kind: "literal", jsonType: "null", value: null },
          },
          {
            id: expect.any(String),
            key: "count",
            value: { kind: "literal", jsonType: "number", value: 0 },
          },
        ],
      },
    });
  });

  it("registers a shared agent input once and references it by id", () => {
    const definition = formStateToDefinition(
      baseInput({
        pathParts: [
          { kind: "text", value: "/users/" },
          {
            kind: "agent",
            id: "ain_shared",
            name: "user_id",
            type: "string",
            required: true,
          },
        ],
        headers: [
          {
            key: "X-User",
            origin: "agent",
            id: "ain_shared",
            name: "user_id",
            type: "string",
            required: true,
          },
        ],
      }),
    );
    expect(definition.agentInputs).toHaveLength(1);
    expect(definition.agentInputs[0]?.id).toBe("ain_shared");
    expect(definition.pathSegments[1]?.value).toEqual({
      kind: "agentInput",
      agentInputId: "ain_shared",
    });
    expect(definition.headers[0]?.value).toEqual({
      kind: "agentInput",
      agentInputId: "ain_shared",
    });
  });

  it("round-trips a typed definition preserving ids and order", () => {
    const definition: ClientRequestDefinition = {
      version: 1,
      pathSegments: [
        { id: "path_1", value: { kind: "literal", value: "/contacts/" } },
        {
          id: "path_2",
          value: { kind: "agentInput", agentInputId: "ain_1" },
        },
      ],
      query: [
        {
          id: "query_1",
          name: "first",
          value: { kind: "literal", value: "a" },
        },
        {
          id: "query_2",
          name: "second",
          value: { kind: "serverValue", serverValueId: "msv_2" },
        },
      ],
      headers: [],
      body: { bodyType: "none" },
      agentInputs: [
        {
          id: "ain_1",
          name: "id",
          required: true,
          sensitive: false,
          type: "string",
        },
      ],
    };

    const path = definitionToPathParts(definition, lookup);
    expect(path).toEqual([
      { kind: "text", value: "/contacts/", nodeId: "path_1" },
      {
        kind: "agent",
        id: "ain_1",
        nodeId: "path_2",
        name: "id",
        type: "string",
        inputType: "string",
        required: true,
        sensitive: false,
      },
    ]);

    const rows = definitionToSourceRows(
      definition.query,
      lookup,
      new Map(definition.agentInputs.map((input) => [input.id, input])),
    );
    expect(rows.map((row) => row.key)).toEqual(["first", "second"]);
    expect(rows[1]).toMatchObject({
      origin: "variable",
      serverValueId: "msv_2",
      name: "tenant",
    });
  });

  it("treats undeclared brace text in a raw body as literal", () => {
    const definition = formStateToDefinition(
      baseInput({
        bodyType: "raw",
        advancedBody: "fixed {{example}} and {{api_token}}",
      }),
    );
    expect(definition.body).toMatchObject({ bodyType: "raw" });
    if (definition.body.bodyType !== "raw") throw new Error("expected raw");
    expect(definition.body.bindings).toHaveLength(1);
    expect(definition.body.bindings[0]?.binding).toEqual({
      kind: "serverValue",
      serverValueId: "msv_1",
    });
    expect(definition.body.template).toContain("{{example}}");
  });

  it("loads typed JSON body rows with binding ids intact", () => {
    const definition: ClientRequestDefinition = {
      version: 1,
      pathSegments: [{ id: "path_1", value: { kind: "literal", value: "/" } }],
      query: [],
      headers: [],
      body: {
        bodyType: "json",
        root: {
          kind: "object",
          fields: [
            {
              id: "field_1",
              key: "limit",
              value: {
                kind: "binding",
                binding: { kind: "agentInput", agentInputId: "ain_1" },
                jsonType: "number",
              },
            },
          ],
        },
      },
      agentInputs: [
        {
          id: "ain_1",
          name: "limit",
          required: false,
          sensitive: false,
          type: "number",
        },
      ],
    };
    const body = definitionToBodyState(definition, lookup);
    expect(body.bodyType).toBe("json");
    expect(body.jsonRows[0]).toMatchObject({
      key: "limit",
      origin: "agent",
      id: "ain_1",
      name: "limit",
      type: "number",
    });
  });

  it("generates unique definition ids", () => {
    const ids = new Set([
      createDefinitionId("x"),
      createDefinitionId("x"),
      createDefinitionId("x"),
    ]);
    expect(ids.size).toBe(3);
  });

  it("guards persisted typed definitions", () => {
    expect(
      isClientRequestDefinition({
        version: 1,
        pathSegments: [],
        query: [],
        headers: [],
        agentInputs: [],
        body: { bodyType: "none" },
      }),
    ).toBe(true);
    expect(isClientRequestDefinition({ version: 2 })).toBe(false);
    expect(isClientRequestDefinition(null)).toBe(false);
  });

  it("drops existing agent inputs that are no longer referenced", () => {
    const existing: ClientAgentInput[] = [
      {
        id: "ain_old",
        name: "old",
        required: true,
        sensitive: false,
        type: "string",
      },
    ];
    const definition = formStateToDefinition(
      baseInput({ existingAgentInputs: existing }),
    );
    expect(definition.agentInputs).toEqual([]);
  });

  it("round-trips entry ids on reopen and keeps them when reordered", () => {
    const source: ClientRequestDefinition = {
      version: 1,
      pathSegments: [{ id: "path_1", value: { kind: "literal", value: "/" } }],
      query: [
        { id: "query_a", name: "a", value: { kind: "literal", value: "1" } },
        { id: "query_b", name: "b", value: { kind: "literal", value: "2" } },
      ],
      headers: [],
      body: { bodyType: "none" },
      agentInputs: [],
    };
    const rows = definitionToSourceRows(source.query, lookup, new Map());
    expect(rows.map((row) => row.nodeId)).toEqual(["query_a", "query_b"]);

    const reordered = [rows[1]!, rows[0]!];
    const rebuilt = formStateToDefinition(baseInput({ query: reordered }));
    expect(rebuilt.query.map((entry) => entry.id)).toEqual([
      "query_b",
      "query_a",
    ]);
    expect(rebuilt.query.map((entry) => entry.name)).toEqual(["b", "a"]);
  });

  it("regenerates local ids for a client-side duplicate", () => {
    const source: ClientRequestDefinition = {
      version: 1,
      pathSegments: [{ id: "path_1", value: { kind: "literal", value: "/" } }],
      query: [
        {
          id: "query_a",
          name: "a",
          value: { kind: "serverValue", serverValueId: "msv_2" },
        },
      ],
      headers: [],
      body: { bodyType: "none" },
      agentInputs: [],
    };
    const rows = definitionToSourceRows(source.query, lookup, new Map());
    const rebuilt = formStateToDefinition(
      baseInput({ query: rows, reuseNodeIds: false }),
    );
    expect(rebuilt.query[0]?.id).not.toBe("query_a");
    expect(rebuilt.query[0]?.value).toEqual({
      kind: "serverValue",
      serverValueId: "msv_2",
    });
  });

  it("round-trips a shared agent binding by id", () => {
    const source: ClientRequestDefinition = {
      version: 1,
      pathSegments: [{ id: "path_1", value: { kind: "literal", value: "/" } }],
      query: [
        {
          id: "query_1",
          name: "limit",
          value: { kind: "agentInput", agentInputId: "ain_1" },
        },
      ],
      headers: [
        {
          id: "hdr_1",
          name: "X-Limit",
          value: { kind: "agentInput", agentInputId: "ain_1" },
        },
      ],
      body: { bodyType: "none" },
      agentInputs: [
        {
          id: "ain_1",
          name: "limit",
          required: true,
          sensitive: false,
          type: "integer",
        },
      ],
    };
    const rows = definitionToSourceRows(
      source.query,
      lookup,
      definitionAgentInputs(source),
    );
    const headerRows = definitionToSourceRows(
      source.headers,
      lookup,
      definitionAgentInputs(source),
    );
    const rebuilt = formStateToDefinition(
      baseInput({ query: rows, headers: headerRows }),
    );
    expect(rebuilt.query[0]?.value).toEqual({
      kind: "agentInput",
      agentInputId: "ain_1",
    });
    expect(rebuilt.headers[0]?.value).toEqual({
      kind: "agentInput",
      agentInputId: "ain_1",
    });
    expect(rebuilt.agentInputs).toHaveLength(1);
    expect(rebuilt.agentInputs[0]?.id).toBe("ain_1");
  });

  it("round-trips flat JSON literal types and field ids", () => {
    const source: ClientRequestDefinition = {
      version: 1,
      pathSegments: [{ id: "path_1", value: { kind: "literal", value: "/" } }],
      query: [],
      headers: [],
      body: {
        bodyType: "json",
        root: {
          kind: "object",
          fields: [
            {
              id: "field_1",
              key: "s",
              value: { kind: "literal", jsonType: "string", value: "123" },
            },
            {
              id: "field_2",
              key: "n",
              value: { kind: "literal", jsonType: "null", value: null },
            },
            {
              id: "field_3",
              key: "b",
              value: { kind: "literal", jsonType: "boolean", value: false },
            },
          ],
        },
      },
      agentInputs: [],
    };
    const body = definitionToBodyState(source, lookup);
    const rebuilt = formStateToDefinition(
      baseInput({ bodyType: "json", jsonRows: body.jsonRows }),
    );
    expect(rebuilt.body).toEqual(source.body);
  });

  it("preserves an existing raw agent binding and dedupes repeated tokens", () => {
    const agentInputs: ClientAgentInput[] = [
      {
        id: "ain_1",
        name: "token",
        required: true,
        sensitive: false,
        type: "string",
      },
    ];
    const rebuilt = formStateToDefinition(
      baseInput({
        bodyType: "raw",
        advancedBody: "{{raw_1}} and {{raw_1}}",
        existingAgentInputs: agentInputs,
        existingRawBindings: new Map([
          ["raw_1", { kind: "agentInput", agentInputId: "ain_1" }],
        ]),
      }),
    );
    if (rebuilt.body.bodyType !== "raw") throw new Error("expected raw");
    expect(rebuilt.body.bindings).toHaveLength(1);
    expect(rebuilt.body.bindings[0]?.id).toBe("raw_1");
    expect(rebuilt.agentInputs).toHaveLength(1);
    expect(rebuilt.agentInputs[0]?.id).toBe("ain_1");
  });

  it("maps binding tokens in advanced JSON edits back to bindings", () => {
    const source: ClientRequestDefinition = {
      version: 1,
      pathSegments: [{ id: "path_1", value: { kind: "literal", value: "/" } }],
      query: [],
      headers: [],
      body: {
        bodyType: "json",
        root: {
          kind: "object",
          fields: [
            {
              id: "field_1",
              key: "tenant",
              value: {
                kind: "binding",
                binding: { kind: "serverValue", serverValueId: "msv_2" },
                jsonType: "string",
              },
            },
          ],
        },
      },
      agentInputs: [],
    };
    const rebuilt = formStateToDefinition(
      baseInput({
        bodyType: "json",
        jsonAdvanced: true,
        advancedBody: '{\n  "tenant": "{{msv_2}}",\n  "fixed": "abc"\n}',
        existingJsonRoot:
          source.body.bodyType === "json" ? source.body.root : undefined,
      }),
    );
    if (rebuilt.body.bodyType !== "json") throw new Error("expected json");
    expect(rebuilt.body.root).toEqual({
      kind: "object",
      fields: [
        {
          id: "field_1",
          key: "tenant",
          value: {
            kind: "binding",
            binding: { kind: "serverValue", serverValueId: "msv_2" },
            jsonType: "string",
          },
        },
        {
          id: expect.any(String),
          key: "fixed",
          value: { kind: "literal", jsonType: "string", value: "abc" },
        },
      ],
    });
  });

  it("assigns unique field ids for repeated keys in advanced JSON", () => {
    const root: ClientRequestDefinition["body"] = {
      bodyType: "json",
      root: {
        kind: "object",
        fields: [
          {
            id: "field_items",
            key: "items",
            value: {
              kind: "array",
              items: [
                {
                  kind: "object",
                  fields: [
                    {
                      id: "field_id_1",
                      key: "id",
                      value: { kind: "literal", jsonType: "number", value: 1 },
                    },
                  ],
                },
                {
                  kind: "object",
                  fields: [
                    {
                      id: "field_id_2",
                      key: "id",
                      value: { kind: "literal", jsonType: "number", value: 2 },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    };
    if (root.bodyType !== "json") throw new Error("expected json");
    const advancedBody = JSON.stringify({
      items: [{ id: 1 }, { id: 2 }],
    });
    const rebuilt = formStateToDefinition(
      baseInput({
        bodyType: "json",
        jsonAdvanced: true,
        advancedBody,
        existingJsonRoot: root.root,
      }),
    );
    if (rebuilt.body.bodyType !== "json") throw new Error("expected json");
    const ids = new Set<string>();
    const walk = (node: ClientJsonNode) => {
      if (node.kind === "object") {
        for (const field of node.fields) {
          expect(ids.has(field.id)).toBe(false);
          ids.add(field.id);
          walk(field.value);
        }
      } else if (node.kind === "array") {
        node.items.forEach(walk);
      }
    };
    walk(rebuilt.body.root);
    expect(ids.size).toBe(3);
  });

  it("preserves an integer agent input type on save", () => {
    const source: ClientRequestDefinition = {
      version: 1,
      pathSegments: [{ id: "path_1", value: { kind: "literal", value: "/" } }],
      query: [
        {
          id: "query_1",
          name: "limit",
          value: { kind: "agentInput", agentInputId: "ain_1" },
        },
      ],
      headers: [],
      body: { bodyType: "none" },
      agentInputs: [
        {
          id: "ain_1",
          name: "limit",
          required: true,
          sensitive: false,
          type: "integer",
        },
      ],
    };
    const rows = definitionToSourceRows(
      source.query,
      lookup,
      definitionAgentInputs(source),
    );
    const rebuilt = formStateToDefinition(baseInput({ query: rows }));
    expect(rebuilt.agentInputs[0]?.type).toBe("integer");
  });

  it("drops a stale integer inputType when the param type changes", () => {
    const rebuilt = formStateToDefinition(
      baseInput({
        query: [
          {
            key: "limit",
            nodeId: "query_1",
            origin: "agent",
            id: "ain_1",
            name: "limit",
            type: "string",
            inputType: "integer",
            required: true,
          },
        ],
      }),
    );
    expect(rebuilt.agentInputs[0]?.type).toBe("string");
  });

  it("preserves a raw body content type", () => {
    const rebuilt = formStateToDefinition(
      baseInput({
        bodyType: "raw",
        advancedBody: "plain text",
        existingRawContentType: "text/plain",
      }),
    );
    expect(rebuilt.body).toEqual({
      bodyType: "raw",
      contentType: "text/plain",
      bindings: [],
      template: "plain text",
    });
  });

  it("round-trips a string agent input format", () => {
    const source: ClientRequestDefinition = {
      version: 1,
      pathSegments: [{ id: "path_1", value: { kind: "literal", value: "/" } }],
      query: [
        {
          id: "query_1",
          name: "email",
          value: { kind: "agentInput", agentInputId: "ain_1" },
        },
      ],
      headers: [],
      body: { bodyType: "none" },
      agentInputs: [
        {
          id: "ain_1",
          name: "email",
          description: "Email address",
          required: true,
          sensitive: false,
          type: "string",
          format: "email",
        },
      ],
    };
    const rows = definitionToSourceRows(
      source.query,
      lookup,
      definitionAgentInputs(source),
    );
    expect(rows[0]).toMatchObject({ origin: "agent", format: "email" });

    const rebuilt = formStateToDefinition(baseInput({ query: rows }));
    expect(rebuilt.agentInputs[0]).toMatchObject({
      id: "ain_1",
      name: "email",
      type: "string",
      format: "email",
    });
  });

  it("omits an advertised format for non-string inputs", () => {
    const rebuilt = formStateToDefinition(
      baseInput({
        query: [
          {
            key: "count",
            origin: "agent",
            id: "ain_1",
            name: "count",
            type: "number",
            format: "email",
            required: true,
          },
        ],
      }),
    );
    expect(rebuilt.agentInputs[0]?.format).toBeUndefined();
  });
});
