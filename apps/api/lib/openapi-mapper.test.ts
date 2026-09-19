import { describe, expect, it } from "vitest";
import { MCP_OPENAPI_ISSUE_CODES } from "@repo/core";
import { compileToolDefinition } from "./mcp-compiler.js";
import {
  mapInventoryOperation,
  openApiIssue,
  stripSensitiveExamples,
  type MapInventoryOperationInput,
  type MapInventoryOperationResult,
} from "./openapi-mapper.js";
import { REDACTION_PLACEHOLDER } from "./openapi-redact.js";
import type {
  McpOpenApiDocumentMetadata,
  McpOpenApiInventoryMediaType,
  McpOpenApiInventoryOperation,
  McpOpenApiInventoryParameter,
} from "./openapi-import-contracts.js";
import type {
  McpJsonNode,
  McpRequestDefinition,
} from "./mcp-request-definition.js";

const ISSUE = MCP_OPENAPI_ISSUE_CODES;
const SERVER_BASE_URL = "https://api.example.com/v1";

function documentMetadata(): McpOpenApiDocumentMetadata {
  return {
    version: "3.1",
    fingerprint: "fingerprint",
    servers: [],
    securitySchemes: {},
    security: [],
  };
}

function operation(
  overrides: Partial<McpOpenApiInventoryOperation> = {},
): McpOpenApiInventoryOperation {
  return {
    operationKey: "list_items",
    method: "GET",
    path: "/items",
    tags: [],
    deprecated: false,
    parameters: [],
    security: [],
    servers: [],
    issues: [],
    pointer: "#/paths/~1items/get",
    ...overrides,
  };
}

function parameter(
  overrides: Partial<McpOpenApiInventoryParameter> &
    Pick<McpOpenApiInventoryParameter, "name" | "in">,
): McpOpenApiInventoryParameter {
  return {
    required: false,
    deprecated: false,
    pointer: "#/paths/~1items/get/parameters/0",
    ...overrides,
  };
}

function mediaType(
  type: string,
  schema?: Record<string, unknown>,
): McpOpenApiInventoryMediaType {
  return {
    mediaType: type,
    ...(schema !== undefined ? { schema } : {}),
    pointer: "#/paths/~1items/post/requestBody/content",
  };
}

function map(
  overrides: Partial<MapInventoryOperationInput> = {},
): MapInventoryOperationResult {
  return mapInventoryOperation({
    operation: operation(),
    document: documentMetadata(),
    serverBaseUrl: SERVER_BASE_URL,
    suggestedName: "list_items",
    existingToolNames: [],
    ...overrides,
  });
}

function issueCodes(result: MapInventoryOperationResult): string[] {
  return result.issues.map((issue) => issue.code);
}

function compile(definition: McpRequestDefinition, method: string) {
  return compileToolDefinition({
    method,
    definition,
    common: { headers: [], query: [] },
    auth: null,
    serverValues: [],
    basePath: new URL(SERVER_BASE_URL).pathname,
    allowMutation: false,
  });
}

function objectFields(
  node: McpJsonNode,
): Array<{ key: string; value: McpJsonNode }> {
  if (node.kind !== "object") throw new Error("expected an object node");
  return node.fields;
}

function fieldNamed(node: McpJsonNode, key: string): McpJsonNode {
  const field = objectFields(node).find((entry) => entry.key === key);
  if (!field) throw new Error(`missing object field "${key}"`);
  return field.value;
}

function propertyOf(
  schema: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const properties = schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  return properties[key];
}

describe("mapInventoryOperation", () => {
  it("maps a typed GET with a required path parameter and an optional integer query", () => {
    const result = map({
      operation: operation({
        operationKey: "get_item",
        path: "/items/{id}",
        parameters: [
          parameter({
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          }),
          parameter({
            name: "limit",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100 },
          }),
        ],
      }),
      suggestedName: "get_item",
    });

    expect(result.selectable).toBe(true);
    expect(result.method).toBe("GET");
    expect(result.issues).toEqual([]);

    const definition = result.requestDefinition;
    expect(definition).toBeDefined();
    expect(definition?.pathSegments).toEqual([
      { id: "path_0", value: { kind: "literal", value: "/items/" } },
      { id: "path_1", value: { kind: "agentInput", agentInputId: "ain_0" } },
    ]);
    expect(definition?.query).toEqual([
      {
        id: "query_0",
        name: "limit",
        value: { kind: "agentInput", agentInputId: "ain_1" },
        omitWhenAbsent: true,
      },
    ]);
    expect(definition?.agentInputs).toEqual([
      {
        id: "ain_0",
        name: "id",
        required: true,
        sensitive: false,
        type: "string",
      },
      {
        id: "ain_1",
        name: "limit",
        required: false,
        sensitive: false,
        type: "integer",
        minimum: 1,
        maximum: 100,
      },
    ]);

    const compiled = compile(definition!, "GET");
    expect(compiled.ok).toBe(true);
    expect(compiled.plan?.annotations.readOnlyHint).toBe(true);
  });

  it("forces a path parameter declared optional to be required", () => {
    const result = map({
      operation: operation({
        operationKey: "get_item",
        path: "/items/{id}",
        parameters: [
          parameter({
            name: "id",
            in: "path",
            required: false,
            schema: { type: "string", minLength: 0 },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(issueCodes(result)).not.toContain(ISSUE.LIMIT_EXCEEDED);
    expect(result.requestDefinition?.agentInputs[0]).toMatchObject({
      name: "id",
      required: true,
      minLength: 0,
      allowEmpty: true,
    });
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("keeps path literals around a mid-path parameter executable", () => {
    const result = map({
      operation: operation({
        operationKey: "get_item_history",
        path: "/items/{id}/history",
        parameters: [
          parameter({
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          }),
        ],
      }),
    });

    expect(result.requestDefinition?.pathSegments).toEqual([
      { id: "path_0", value: { kind: "literal", value: "/items/" } },
      { id: "path_1", value: { kind: "agentInput", agentInputId: "ain_0" } },
      { id: "path_2", value: { kind: "literal", value: "/history" } },
    ]);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("normalizes foreign parameter names into MCP-safe agent input names", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "page-size",
            in: "query",
            schema: { type: "integer" },
          }),
          parameter({ name: "2fa", in: "header", schema: { type: "string" } }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(
      result.requestDefinition?.agentInputs.map((input) => input.name),
    ).toEqual(["page_size", "fa"]);
    expect(result.requestDefinition?.headers[0]?.name).toBe("2fa");
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("maps a JSON body with nested objects and arrays within the node and depth limits", () => {
    const result = map({
      operation: operation({
        operationKey: "create_item",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json; charset=utf-8", {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 50 },
                tags: { type: "array", items: { type: "string" } },
                meta: {
                  type: "object",
                  properties: {
                    active: { type: "boolean" },
                    count: { type: "integer", minimum: 0 },
                  },
                },
              },
            }),
          ],
        },
      }),
      suggestedName: "create_item",
    });

    expect(result.selectable).toBe(true);
    const definition = result.requestDefinition!;
    expect(definition.body.bodyType).toBe("json");
    if (definition.body.bodyType !== "json")
      throw new Error("expected json body");

    const root = definition.body.root;
    expect(fieldNamed(root, "name")).toEqual({
      kind: "binding",
      binding: { kind: "agentInput", agentInputId: "ain_0" },
      jsonType: "string",
    });
    expect(fieldNamed(root, "tags")).toEqual({
      kind: "array",
      items: [
        {
          kind: "binding",
          binding: { kind: "agentInput", agentInputId: "ain_1" },
          jsonType: "string",
        },
      ],
    });
    expect(fieldNamed(root, "meta")).toEqual({
      kind: "object",
      fields: [
        {
          id: "field_3",
          key: "active",
          value: {
            kind: "binding",
            binding: { kind: "agentInput", agentInputId: "ain_2" },
            jsonType: "boolean",
            omitWhenAbsent: true,
          },
        },
        {
          id: "field_4",
          key: "count",
          value: {
            kind: "binding",
            binding: { kind: "agentInput", agentInputId: "ain_3" },
            jsonType: "number",
            omitWhenAbsent: true,
          },
        },
      ],
    });
    expect(definition.agentInputs).toMatchObject([
      {
        id: "ain_0",
        name: "name",
        required: true,
        type: "string",
        minLength: 1,
        maxLength: 50,
      },
      { id: "ain_1", name: "tags", required: true, type: "string" },
      { id: "ain_2", name: "active", required: false, type: "boolean" },
      {
        id: "ain_3",
        name: "count",
        required: false,
        type: "integer",
        minimum: 0,
      },
    ]);
    expect(issueCodes(result)).toContain(ISSUE.METADATA_IGNORED);
    expect(compile(definition, "POST").ok).toBe(true);
  });

  it("compiles a POST as a mutating tool without hand-written annotations", () => {
    const result = map({
      operation: operation({
        operationKey: "create_item",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              required: ["name"],
              properties: { name: { type: "string" } },
            }),
          ],
        },
      }),
      suggestedName: "create_item",
    });

    const definition = result.requestDefinition!;
    expect(definition).not.toHaveProperty("annotations");
    const compiled = compile(definition, "POST");
    expect(compiled.ok).toBe(true);
    expect(compiled.plan?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("maps a form-urlencoded body into named entries with omission", () => {
    const result = map({
      operation: operation({
        operationKey: "subscribe",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/x-www-form-urlencoded", {
              type: "object",
              required: ["email"],
              properties: {
                email: { type: "string", format: "email" },
                remember: { type: "boolean" },
              },
            }),
          ],
        },
      }),
      suggestedName: "subscribe",
    });

    expect(result.selectable).toBe(true);
    const definition = result.requestDefinition!;
    expect(definition.body).toEqual({
      bodyType: "form",
      fields: [
        {
          id: "field_1",
          name: "email",
          value: { kind: "agentInput", agentInputId: "ain_0" },
        },
        {
          id: "field_2",
          name: "remember",
          value: { kind: "agentInput", agentInputId: "ain_1" },
          omitWhenAbsent: true,
        },
      ],
    });
    expect(definition.agentInputs[0]).toMatchObject({
      name: "email",
      required: true,
      type: "string",
      format: "email",
    });
    expect(compile(definition, "POST").ok).toBe(true);
  });

  it("maps a text/plain body into a raw body bound to one agent input", () => {
    const result = map({
      operation: operation({
        operationKey: "append_note",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [mediaType("text/plain", { type: "string" })],
        },
      }),
      suggestedName: "append_note",
    });

    expect(result.selectable).toBe(true);
    const definition = result.requestDefinition!;
    expect(definition.body).toEqual({
      bodyType: "raw",
      contentType: "text/plain",
      bindings: [
        {
          id: "raw_0",
          binding: { kind: "agentInput", agentInputId: "ain_0" },
        },
      ],
      template: "{{raw_0}}",
    });
    expect(compile(definition, "POST").ok).toBe(true);
  });

  it("uses the first representable media type and warns about the ignored ones", () => {
    const result = map({
      operation: operation({
        operationKey: "create_item",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/x-www-form-urlencoded", {
              type: "object",
              properties: { name: { type: "string" } },
            }),
            mediaType("application/json", {
              type: "object",
              properties: { name: { type: "string" } },
            }),
          ],
        },
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.requestDefinition?.body.bodyType).toBe("json");
    const ignored = result.issues.find(
      (issue) => issue.code === ISSUE.METADATA_IGNORED,
    );
    expect(ignored?.severity).toBe("warning");
    expect(ignored?.message).toContain("application/x-www-form-urlencoded");
    expect(compile(result.requestDefinition!, "POST").ok).toBe(true);
  });

  it("omits the omission flag on required query and header entries", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "region",
            in: "query",
            required: true,
            schema: { type: "string" },
          }),
          parameter({
            name: "X-Trace",
            in: "header",
            required: true,
            schema: { type: "string" },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.requestDefinition?.query[0]).not.toHaveProperty(
      "omitWhenAbsent",
    );
    expect(result.requestDefinition?.headers[0]).not.toHaveProperty(
      "omitWhenAbsent",
    );
    expect(result.requestDefinition?.agentInputs).toMatchObject([
      { name: "region", required: true },
      { name: "x_trace", required: true },
    ]);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("warns when two declared media types map to the same canonical shape", () => {
    const result = map({
      operation: operation({
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              properties: { name: { type: "string" } },
            }),
            mediaType("application/json", {
              type: "object",
              properties: { name: { type: "string" } },
            }),
          ],
        },
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.requestDefinition?.body.bodyType).toBe("json");
    expect(issueCodes(result)).toContain(ISSUE.METADATA_IGNORED);
    expect(compile(result.requestDefinition!, "POST").ok).toBe(true);
  });

  it("substitutes declared server variable defaults and stays inside the base path", () => {
    const result = map({
      operation: operation({
        servers: [
          {
            url: "https://api.example.com/{version}",
            variables: [{ name: "version", default: "v1" }],
            pointer: "#/paths/~1items/get/servers/0",
          },
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.requestDefinition?.pathSegments).toEqual([
      { id: "path_0", value: { kind: "literal", value: "/items" } },
    ]);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("treats an absent operation server list as the selected server", () => {
    const result = map({
      operation: operation({ servers: [] }),
    });

    expect(result.selectable).toBe(true);
    expect(result.requestDefinition?.pathSegments).toEqual([
      { id: "path_0", value: { kind: "literal", value: "/items" } },
    ]);
  });
});

describe("mapInventoryOperation blockers", () => {
  function expectBlocked(
    result: MapInventoryOperationResult,
    code: string,
  ): void {
    expect(issueCodes(result)).toContain(code);
    expect(result.selectable).toBe(false);
    expect(result.requestDefinition).toBeUndefined();
  }

  it("blocks unsupported methods", () => {
    expectBlocked(
      map({ operation: operation({ method: "TRACE" }) }),
      ISSUE.METHOD_UNSUPPORTED,
    );
    const result = map({ operation: operation({ method: "TRACE" }) });
    expect(result.method).toBeUndefined();
  });

  it("blocks cookie parameters", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "session",
            in: "cookie",
            required: true,
            schema: { type: "string" },
          }),
        ],
      }),
    });
    expectBlocked(result, ISSUE.COOKIE_PARAMETER);
  });

  it("blocks multipart and file bodies", () => {
    const result = map({
      operation: operation({
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("multipart/form-data", {
              type: "object",
              properties: { file: { type: "string", format: "binary" } },
            }),
          ],
        },
      }),
    });
    expectBlocked(result, ISSUE.MULTIPART_BODY);
  });

  it("blocks unrepresentable media types", () => {
    const result = map({
      operation: operation({
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/octet-stream", { type: "string" }),
          ],
        },
      }),
    });
    expectBlocked(result, ISSUE.UNREPRESENTABLE_REQUEST);
  });

  it("blocks non-default parameter serialization", () => {
    const deepObject = map({
      operation: operation({
        parameters: [
          parameter({
            name: "filter",
            in: "query",
            style: "deepObject",
            explode: true,
            schema: { type: "string" },
          }),
        ],
      }),
    });
    expectBlocked(deepObject, ISSUE.UNSUPPORTED_SERIALIZATION);
    expect(deepObject.issues[0]?.message).toContain("deepObject");
    expect(deepObject.issues[0]?.message).toContain("query");

    const explodedPath = map({
      operation: operation({
        operationKey: "get_item",
        path: "/items/{id}",
        parameters: [
          parameter({
            name: "id",
            in: "path",
            required: true,
            style: "label",
            schema: { type: "string" },
          }),
        ],
      }),
    });
    expectBlocked(explodedPath, ISSUE.UNSUPPORTED_SERIALIZATION);

    const nonExplodedQuery = map({
      operation: operation({
        parameters: [
          parameter({
            name: "tags",
            in: "query",
            explode: false,
            schema: { type: "string" },
          }),
        ],
      }),
    });
    expectBlocked(nonExplodedQuery, ISSUE.UNSUPPORTED_SERIALIZATION);
  });

  it("blocks structured parameters and schema composition", () => {
    expectBlocked(
      map({
        operation: operation({
          parameters: [
            parameter({
              name: "ids",
              in: "query",
              schema: { type: "array", items: { type: "string" } },
            }),
          ],
        }),
      }),
      ISSUE.UNSUPPORTED_SCHEMA,
    );

    expectBlocked(
      map({
        operation: operation({
          parameters: [
            parameter({
              name: "value",
              in: "query",
              schema: { oneOf: [{ type: "string" }, { type: "integer" }] },
            }),
          ],
        }),
      }),
      ISSUE.UNSUPPORTED_SCHEMA,
    );

    expectBlocked(
      map({
        operation: operation({
          method: "POST",
          requestBody: {
            required: true,
            pointer: "#/paths/~1items/post/requestBody",
            mediaTypes: [
              mediaType("application/json", {
                type: "object",
                properties: {
                  extra: { type: "object", additionalProperties: true },
                },
              }),
            ],
          },
        }),
      }),
      ISSUE.UNSUPPORTED_SCHEMA,
    );

    expectBlocked(
      map({
        operation: operation({
          parameters: [
            parameter({
              name: "code",
              in: "query",
              schema: { type: "string", pattern: "a".repeat(513) },
            }),
          ],
        }),
      }),
      ISSUE.UNSUPPORTED_SCHEMA,
    );
  });

  it("blocks ambiguous parameter naming and required properties without a schema", () => {
    expectBlocked(
      map({
        operation: operation({
          parameters: [
            parameter({
              name: "user-id",
              in: "query",
              schema: { type: "string" },
            }),
            parameter({
              name: "user.id",
              in: "query",
              schema: { type: "string" },
            }),
          ],
        }),
      }),
      ISSUE.AMBIGUOUS_PARAMETER,
    );

    expectBlocked(
      map({
        operation: operation({
          method: "POST",
          requestBody: {
            required: true,
            pointer: "#/paths/~1items/post/requestBody",
            mediaTypes: [
              mediaType("application/json", {
                type: "object",
                required: ["missing"],
                properties: { present: { type: "string" } },
              }),
            ],
          },
        }),
      }),
      ISSUE.AMBIGUOUS_PARAMETER,
    );
  });

  it("blocks forbidden transport headers and read-method bodies", () => {
    expectBlocked(
      map({
        operation: operation({
          parameters: [
            parameter({
              name: "Host",
              in: "header",
              required: true,
              schema: { type: "string" },
            }),
          ],
        }),
      }),
      ISSUE.UNREPRESENTABLE_REQUEST,
    );

    expectBlocked(
      map({
        operation: operation({
          method: "GET",
          requestBody: {
            required: true,
            pointer: "#/paths/~1items/get/requestBody",
            mediaTypes: [
              mediaType("application/json", {
                type: "object",
                properties: { name: { type: "string" } },
              }),
            ],
          },
        }),
      }),
      ISSUE.UNREPRESENTABLE_REQUEST,
    );
  });

  it("blocks foreign origins and paths outside the selected base path", () => {
    expectBlocked(
      map({
        operation: operation({
          servers: [
            {
              url: "https://evil.example.com/v1",
              variables: [],
              pointer: "#/paths/~1items/get/servers/0",
            },
          ],
        }),
      }),
      ISSUE.FOREIGN_ORIGIN,
    );

    expectBlocked(
      map({
        operation: operation({
          servers: [
            {
              url: "https://api.example.com/v2",
              variables: [],
              pointer: "#/paths/~1items/get/servers/0",
            },
          ],
        }),
      }),
      ISSUE.FOREIGN_ORIGIN,
    );

    expectBlocked(
      map({
        operation: operation({
          servers: [
            {
              url: "not-a-url",
              variables: [],
              pointer: "#/paths/~1items/get/servers/0",
            },
          ],
        }),
      }),
      ISSUE.FOREIGN_ORIGIN,
    );
  });

  it("blocks unresolvable server variables", () => {
    expectBlocked(
      map({
        operation: operation({
          servers: [
            {
              url: "https://{region}.api.example.com/v1",
              variables: [{ name: "region" }],
              pointer: "#/paths/~1items/get/servers/0",
            },
          ],
        }),
      }),
      ISSUE.AMBIGUOUS_SERVER,
    );
  });

  it("blocks operations beyond the agent input cap", () => {
    const result = map({
      operation: operation({
        parameters: Array.from({ length: 41 }, (_, index) =>
          parameter({
            name: `q${index}`,
            in: "query",
            schema: { type: "string" },
          }),
        ),
      }),
    });
    expectBlocked(result, ISSUE.LIMIT_EXCEEDED);
  });

  it("blocks bodies nested beyond the depth limit", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 40; index += 1) {
      schema = { type: "object", properties: { child: schema } };
    }
    const result = map({
      operation: operation({
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [mediaType("application/json", schema)],
        },
      }),
    });
    expectBlocked(result, ISSUE.LIMIT_EXCEEDED);
  });

  it("blocks name collisions without renaming", () => {
    const existing = map({
      suggestedName: "list_items",
      existingToolNames: ["list_items", "other_tool"],
    });
    expectBlocked(existing, ISSUE.NAME_CONFLICT);
    expect(existing.name).toBe("list_items");

    const duplicate = map({
      suggestedName: "list_items",
      claimedNames: ["list_items"],
    });
    expectBlocked(duplicate, ISSUE.DUPLICATE_NAME);
    expect(duplicate.name).toBe("list_items");
  });

  it("honors the owner name override for collision checks", () => {
    const result = map({
      suggestedName: "list_items",
      nameOverride: "list_catalog_items",
      existingToolNames: ["list_items"],
      claimedNames: ["list_items"],
    });

    expect(result.selectable).toBe(true);
    expect(result.name).toBe("list_catalog_items");
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("honors parser issues that already block the operation", () => {
    const result = map({
      operation: operation({
        issues: [
          {
            code: ISSUE.EXTERNAL_REFERENCE,
            severity: "error",
            message: "External reference is not fetched.",
            path: "#/paths/~1items/get/responses/200",
          },
        ],
      }),
    });

    expect(result.selectable).toBe(false);
    expect(result.requestDefinition).toBeUndefined();
    expect(issueCodes(result)).toContain(ISSUE.EXTERNAL_REFERENCE);
  });
});

describe("mapInventoryOperation warnings", () => {
  it("keeps deprecated operations selectable with a warning", () => {
    const result = map({
      operation: operation({
        deprecated: true,
        parameters: [
          parameter({
            name: "legacy",
            in: "query",
            deprecated: true,
            schema: { type: "string" },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.deprecated).toBe(true);
    expect(
      result.issues.filter((issue) => issue.code === ISSUE.DEPRECATED),
    ).toHaveLength(2);
    expect(result.issues.every((issue) => issue.severity === "warning")).toBe(
      true,
    );
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("warns about ignored metadata without blocking", () => {
    const result = map({
      operation: operation({
        method: "POST",
        requestBody: {
          required: false,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              properties: { name: { type: "string", readOnly: true } },
              externalDocs: { url: "https://example.com" },
            }),
            mediaType("application/octet-stream"),
          ],
        },
      }),
    });

    expect(result.selectable).toBe(true);
    const ignored = result.issues.find(
      (issue) => issue.code === ISSUE.METADATA_IGNORED,
    );
    expect(ignored?.severity).toBe("warning");
    expect(ignored?.message).toContain("application/octet-stream");
    expect(ignored?.message).toContain("read-only");
    expect(result.requestDefinition).toBeDefined();
  });

  it("isolates valid and blocked operations in the same batch", () => {
    const blocked = map({
      operation: operation({
        operationKey: "upload_asset",
        method: "POST",
        path: "/assets",
        requestBody: {
          required: true,
          pointer: "#/paths/~1assets/post/requestBody",
          mediaTypes: [
            mediaType("multipart/form-data", {
              type: "object",
              properties: { file: { type: "string" } },
            }),
          ],
        },
      }),
      suggestedName: "upload_asset",
      claimedNames: ["upload_asset"],
    });
    const valid = map({
      operation: operation({
        operationKey: "list_assets",
        path: "/assets",
      }),
      suggestedName: "list_assets",
    });

    expect(blocked.selectable).toBe(false);
    expect(valid.selectable).toBe(true);
    expect(valid.requestDefinition).toBeDefined();
    expect(compile(valid.requestDefinition!, "GET").ok).toBe(true);
  });
});

describe("openApiIssue", () => {
  it("derives severity from the shared blocking code list", () => {
    expect(openApiIssue(ISSUE.METHOD_UNSUPPORTED, "blocked")).toEqual({
      code: ISSUE.METHOD_UNSUPPORTED,
      severity: "error",
      message: "blocked",
    });
    expect(openApiIssue(ISSUE.DEPRECATED, "warned", "#/paths/0")).toEqual({
      code: ISSUE.DEPRECATED,
      severity: "warning",
      message: "warned",
      path: "#/paths/0",
    });
  });
});

describe("openapi redaction", () => {
  it("strips credential-like examples and defaults at every depth", () => {
    const schema = {
      type: "object",
      properties: {
        profile: {
          type: "object",
          properties: {
            api_key: {
              type: "string",
              example: "sk_live_123",
              default: "sk_live_123",
            },
            name: { type: "string", example: "Ada" },
          },
        },
        secretBlob: {
          type: "object",
          writeOnly: true,
          example: { token: "x" },
          properties: {
            value: { type: "string", example: "inner", default: "inner" },
          },
        },
      },
    };

    const stripped = stripSensitiveExamples(schema);

    expect(stripped).not.toBe(schema);
    const profile = propertyOf(stripped, "profile");
    expect(propertyOf(profile, "api_key")).toEqual({ type: "string" });
    expect(propertyOf(profile, "name")).toEqual({
      type: "string",
      example: "Ada",
    });
    expect(propertyOf(stripped, "secretBlob")).toEqual({
      type: "object",
      writeOnly: true,
      properties: { value: { type: "string" } },
    });
    expect(propertyOf(propertyOf(schema, "profile"), "api_key")).toMatchObject({
      example: "sk_live_123",
      default: "sk_live_123",
    });
  });

  it("drops credential-like example and default values from mapped inputs", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "api_key",
            in: "header",
            required: true,
            schema: { type: "string", default: "sk_live_123" },
            examples: ["sk_live_123"],
          }),
          parameter({
            name: "note",
            in: "query",
            schema: {
              type: "string",
              example: "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
            },
          }),
          parameter({
            name: "cursor",
            in: "query",
            schema: { type: "string", default: "page-2" },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    const inputs = result.requestDefinition!.agentInputs;
    expect(inputs.find((input) => input.name === "api_key")).not.toHaveProperty(
      "examples",
    );
    expect(inputs.find((input) => input.name === "note")).not.toHaveProperty(
      "examples",
    );
    expect(inputs.find((input) => input.name === "cursor")).toMatchObject({
      examples: ["page-2"],
    });
  });

  it("caps agent input examples at eight entries", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "tag",
            in: "query",
            schema: { type: "string" },
            examples: Array.from(
              { length: 10 },
              (_, index) => `value-${index}`,
            ),
          }),
        ],
      }),
    });

    expect(result.requestDefinition?.agentInputs[0]?.examples).toHaveLength(8);
  });

  it("never copies a JWT or long base64 example into a JSON body node", () => {
    const result = map({
      operation: operation({
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              properties: {
                client_secret: {
                  type: "string",
                  example:
                    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
                },
                blob: {
                  type: "string",
                  example:
                    "dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgYmxvYiB2YWx1ZQ==",
                },
              },
            }),
          ],
        },
      }),
    });

    expect(result.selectable).toBe(true);
    expect(JSON.stringify(result.requestDefinition)).not.toContain(
      "eyJhbGciOiJIUzI1NiI",
    );
    expect(JSON.stringify(result.requestDefinition)).not.toContain(
      "dGhpcyBpcyBhIHZlcn",
    );
    expect(result.requestDefinition?.agentInputs).toEqual([
      {
        id: "ain_0",
        name: "client_secret",
        required: false,
        sensitive: true,
        type: "string",
      },
      {
        id: "ain_1",
        name: "blob",
        required: false,
        sensitive: false,
        type: "string",
      },
    ]);
  });
});

describe("openapi enum redaction", () => {
  const ENUM_SECRET = "sk_live_51H8xSECRETVALUE0001";
  const ENUM_JWT = "eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.LongBase64SignatureValueHere";

  function metadataWarnings(result: MapInventoryOperationResult) {
    return result.issues.filter(
      (issue) => issue.code === ISSUE.METADATA_IGNORED,
    );
  }

  it("drops a credential-like enum on a credential-named parameter and marks the input sensitive", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "api_key",
            in: "header",
            required: true,
            schema: { type: "string", enum: [ENUM_SECRET] },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(JSON.stringify(result.requestDefinition)).not.toContain(ENUM_SECRET);

    const input = result.requestDefinition?.agentInputs[0];
    expect(input).toMatchObject({ name: "api_key", sensitive: true });
    expect(input).not.toHaveProperty("enum");

    const warnings = metadataWarnings(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe("warning");
    expect(warnings[0]?.message.toLowerCase()).toContain(
      "credential-like enum",
    );
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("drops a credential-like enum value on an innocuously named parameter", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "cursor",
            in: "query",
            schema: { type: "string", enum: [ENUM_JWT] },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(JSON.stringify(result.requestDefinition)).not.toContain(
      ENUM_JWT.slice(0, 24),
    );
    const input = result.requestDefinition?.agentInputs[0];
    expect(input).toMatchObject({ name: "cursor", sensitive: true });
    expect(input).not.toHaveProperty("enum");
    expect(metadataWarnings(result)).toHaveLength(1);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("drops every enum value when the schema position is writeOnly", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "mode",
            in: "query",
            schema: { type: "string", writeOnly: true, enum: ["fast", "slow"] },
          }),
        ],
      }),
    });

    const input = result.requestDefinition?.agentInputs[0];
    expect(input).toMatchObject({ name: "mode", sensitive: true });
    expect(input).not.toHaveProperty("enum");
    expect(metadataWarnings(result)).toHaveLength(1);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("narrows a mixed enum to the surviving values without marking it sensitive", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "mode",
            in: "query",
            schema: {
              type: "string",
              enum: ["fast", ENUM_SECRET, "slow"],
            },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(JSON.stringify(result.requestDefinition)).not.toContain(ENUM_SECRET);
    const input = result.requestDefinition?.agentInputs[0];
    expect(input).toMatchObject({
      name: "mode",
      sensitive: false,
      enum: ["fast", "slow"],
    });

    const warnings = metadataWarnings(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("narrowed");
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("keeps an enum of safe values unchanged without a warning", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "sort",
            in: "query",
            schema: { type: "string", enum: ["asc", "desc"] },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(metadataWarnings(result)).toEqual([]);
    expect(result.requestDefinition?.agentInputs[0]).toMatchObject({
      name: "sort",
      sensitive: false,
      enum: ["asc", "desc"],
    });
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });
});

describe("openapi checksum enums", () => {
  const SHA256_LOWER =
    "8f3a1c9e2b7d4f60a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f7081";
  const SHA256_UPPER =
    "8F3A1C9E2B7D4F60A1B2C3D4E5F60718293A4B5C6D7E8F901A2B3C4D5E6F7081";
  const DIGESTS = [SHA256_LOWER, SHA256_UPPER];

  it("keeps a checksum enum of SHA-256 digests whole, non-sensitive, and silent", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "checksum",
            in: "query",
            schema: {
              type: "string",
              enum: DIGESTS,
              example: SHA256_LOWER,
              default: SHA256_UPPER,
            },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.issues).toEqual([]);
    const input = result.requestDefinition?.agentInputs[0];
    expect(input).toMatchObject({
      name: "checksum",
      sensitive: false,
      enum: DIGESTS,
      examples: [SHA256_LOWER, SHA256_UPPER],
    });
    const serializedDefinition = JSON.stringify(result.requestDefinition);
    expect(serializedDefinition).toContain(SHA256_LOWER);
    expect(serializedDefinition).toContain(SHA256_UPPER);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("keeps a sha256 ETag example on an ordinary header", () => {
    const etag = `W/"${SHA256_LOWER}"`;
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "etag",
            in: "query",
            schema: { type: "string", example: etag },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.requestDefinition?.agentInputs[0]?.examples).toEqual([etag]);
    expect(JSON.stringify(result.requestDefinition)).toContain(SHA256_LOWER);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });
});

describe("openapi const redaction", () => {
  const CONST_SECRET = "sk_live_CONST_SECRET_0001";
  const CONST_APIKEY = "APIKEY-abcdef0123456789";

  it("replaces a credential-like JSON body const with a sensitive agent input", () => {
    const result = map({
      operation: operation({
        operationKey: "create_item",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              properties: {
                api_key: { type: "string", const: CONST_SECRET },
              },
            }),
          ],
        },
      }),
    });

    expect(result.selectable).toBe(true);
    const definition = result.requestDefinition!;
    expect(JSON.stringify(definition)).not.toContain(CONST_SECRET);
    expect(JSON.stringify(definition)).not.toContain("sk_live_CONST");

    if (definition.body.bodyType !== "json")
      throw new Error("expected json body");
    const node = fieldNamed(definition.body.root, "api_key");
    expect(node.kind).toBe("binding");
    expect(node).toEqual({
      kind: "binding",
      binding: { kind: "agentInput", agentInputId: "ain_0" },
      jsonType: "any",
      omitWhenAbsent: true,
    });
    expect(definition.agentInputs[0]).toMatchObject({
      name: "api_key",
      sensitive: true,
    });
    expect(
      result.issues.some(
        (issue) =>
          issue.code === ISSUE.METADATA_IGNORED &&
          issue.message.includes("credential-like constant"),
      ),
    ).toBe(true);
    expect(compile(definition, "POST").ok).toBe(true);
  });

  it("replaces a credential-like const value on an innocuous property", () => {
    const result = map({
      operation: operation({
        operationKey: "create_item",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              properties: { note: { type: "string", const: CONST_APIKEY } },
            }),
          ],
        },
      }),
    });

    const definition = result.requestDefinition!;
    expect(JSON.stringify(definition)).not.toContain(CONST_APIKEY);
    if (definition.body.bodyType !== "json")
      throw new Error("expected json body");
    expect(fieldNamed(definition.body.root, "note").kind).toBe("binding");
    expect(definition.agentInputs[0]).toMatchObject({
      name: "note",
      sensitive: true,
    });
    expect(compile(definition, "POST").ok).toBe(true);
  });

  it("binds a credential-like text/plain const instead of inlining it in the template", () => {
    const result = map({
      operation: operation({
        operationKey: "append_note",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [mediaType("text/plain", { const: CONST_APIKEY })],
        },
      }),
    });

    expect(result.selectable).toBe(true);
    const definition = result.requestDefinition!;
    expect(JSON.stringify(definition)).not.toContain(CONST_APIKEY);
    expect(definition.body.bodyType).toBe("raw");
    if (definition.body.bodyType !== "raw")
      throw new Error("expected raw body");
    expect(definition.body.template).not.toContain(CONST_APIKEY);
    expect(definition.body.bindings).toHaveLength(1);
    expect(definition.body.bindings[0]?.binding).toEqual({
      kind: "agentInput",
      agentInputId: "ain_0",
    });
    expect(definition.body.template).toBe(
      `{{${definition.body.bindings[0]?.id}}}`,
    );
    expect(definition.agentInputs[0]).toMatchObject({ sensitive: true });
    expect(compile(definition, "POST").ok).toBe(true);
  });

  it("keeps a non-credential const as a literal", () => {
    const result = map({
      operation: operation({
        operationKey: "create_item",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              properties: { kind: { type: "string", const: "widget" } },
            }),
          ],
        },
      }),
    });

    const definition = result.requestDefinition!;
    if (definition.body.bodyType !== "json")
      throw new Error("expected json body");
    expect(fieldNamed(definition.body.root, "kind")).toEqual({
      kind: "literal",
      jsonType: "string",
      value: "widget",
    });
    expect(definition.agentInputs).toEqual([]);
    expect(
      result.issues.some((issue) => issue.code === ISSUE.METADATA_IGNORED),
    ).toBe(false);
    expect(compile(definition, "POST").ok).toBe(true);
  });

  it("keeps a non-credential text/plain const as the raw template", () => {
    const result = map({
      operation: operation({
        operationKey: "append_note",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [mediaType("text/plain", { const: "plain note body" })],
        },
      }),
    });

    expect(result.requestDefinition?.body).toEqual({
      bodyType: "raw",
      contentType: "text/plain",
      bindings: [],
      template: "plain note body",
    });
    expect(compile(result.requestDefinition!, "POST").ok).toBe(true);
  });
});

describe("openapi agent input sensitivity", () => {
  it("marks writeOnly and credential-named inputs sensitive and ordinary strings not", () => {
    const result = map({
      operation: operation({
        operationKey: "create_item",
        method: "POST",
        parameters: [
          parameter({
            name: "api_key",
            in: "header",
            required: true,
            schema: { type: "string" },
          }),
        ],
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              properties: {
                payload: { type: "string", writeOnly: true },
                label: { type: "string" },
              },
            }),
          ],
        },
      }),
    });

    expect(result.selectable).toBe(true);
    const inputs = result.requestDefinition!.agentInputs;
    expect(inputs.find((input) => input.name === "api_key")).toMatchObject({
      sensitive: true,
    });
    expect(inputs.find((input) => input.name === "payload")).toMatchObject({
      sensitive: true,
    });
    expect(inputs.find((input) => input.name === "label")).toMatchObject({
      sensitive: false,
    });
    expect(compile(result.requestDefinition!, "POST").ok).toBe(true);
  });
});

describe("openapi sensitive derivation", () => {
  const CREDENTIAL_NAMES = [
    "api_key",
    "apikey",
    "access_token",
    "refresh_token",
    "auth_token",
    "authorization",
    "client_secret",
    "secret_key",
    "secret",
    "private_key",
    "password",
    "passwd",
    "passphrase",
    "credentials",
    "cookie",
    "set_cookie",
    "session_id",
    "sessionid",
    "session_token",
    "bearer",
    "signature",
    "otp",
    "otp_code",
    "token",
    "token_value",
    "secret_value",
    "password_confirmation",
    "password_hash",
    "password_value",
    "api_key_hash",
    "session_token_hash",
    "cookie_value",
    "oauth_token",
    "id_token",
    "auth_key",
    "jwt",
    "totp",
    "pwd",
    "pass",
    "auth",
  ];

  const ORDINARY_NAMES = [
    "author",
    "keyword",
    "keywords",
    "key",
    "key_id",
    "key_type",
    "sort_key",
    "monkey",
    "hockey",
    "keyboard",
    "session",
    "session_type",
    "cookie_consent",
    "token_count",
    "access_token_ttl",
    "signature_version",
    "signature_algorithm",
    "client_id",
    "private_key_id",
    "secretary",
    "password_policy",
    "bearer_count",
    "otp_required",
    "cursor",
    "status",
  ];

  function metadataWarnings(result: MapInventoryOperationResult) {
    return result.issues.filter(
      (issue) => issue.code === ISSUE.METADATA_IGNORED,
    );
  }

  function mapQueryNames(
    names: readonly string[],
  ): MapInventoryOperationResult {
    return map({
      operation: operation({
        parameters: names.map((name) =>
          parameter({ name, in: "query", schema: { type: "string" } }),
        ),
      }),
    });
  }

  function sensitiveFlags(
    result: MapInventoryOperationResult,
  ): Map<string, boolean | undefined> {
    return new Map(
      result.requestDefinition!.agentInputs.map((input) => [
        input.name,
        input.sensitive,
      ]),
    );
  }

  it("marks credential positions, writeOnly, and password inputs sensitive", () => {
    for (let index = 0; index < CREDENTIAL_NAMES.length; index += 20) {
      const batch = CREDENTIAL_NAMES.slice(index, index + 20);
      const result = mapQueryNames(batch);

      expect(result.selectable, batch.join(", ")).toBe(true);
      expect(metadataWarnings(result), batch.join(", ")).toEqual([]);
      const sensitive = sensitiveFlags(result);
      for (const name of batch) {
        expect(sensitive.get(name), name).toBe(true);
      }
      expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
    }

    const special = map({
      operation: operation({
        parameters: [
          parameter({
            name: "declared_write_only",
            in: "query",
            schema: { type: "string", writeOnly: true },
          }),
          parameter({
            name: "pin",
            in: "query",
            schema: { type: "string", format: "password" },
          }),
        ],
      }),
    });

    expect(metadataWarnings(special)).toEqual([]);
    const specialSensitive = sensitiveFlags(special);
    expect(specialSensitive.get("declared_write_only")).toBe(true);
    expect(specialSensitive.get("pin")).toBe(true);
    expect(compile(special.requestDefinition!, "GET").ok).toBe(true);
  });

  it("leaves names that merely qualify or resemble a credential insensitive", () => {
    const result = mapQueryNames(ORDINARY_NAMES);

    expect(result.selectable).toBe(true);
    expect(metadataWarnings(result)).toEqual([]);
    const sensitive = sensitiveFlags(result);
    for (const name of ORDINARY_NAMES) {
      expect(sensitive.get(name), name).toBe(false);
    }
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("keeps an ordinary author, session, or keyword enum whole and silent", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "author",
            in: "query",
            schema: { type: "string", enum: ["alice", "bob"] },
          }),
          parameter({
            name: "session",
            in: "query",
            schema: {
              type: "string",
              enum: ["morning", "afternoon", "evening"],
            },
          }),
          parameter({
            name: "keyword",
            in: "query",
            schema: { type: "string", enum: ["machine", "learning"] },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.requestDefinition?.agentInputs).toMatchObject([
      { name: "author", sensitive: false, enum: ["alice", "bob"] },
      {
        name: "session",
        sensitive: false,
        enum: ["morning", "afternoon", "evening"],
      },
      { name: "keyword", sensitive: false, enum: ["machine", "learning"] },
    ]);
    expect(JSON.stringify(result.requestDefinition)).toContain("afternoon");
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("keeps author and keyword example and default material", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "author",
            in: "query",
            schema: {
              type: "string",
              example: "Ada Lovelace",
              default: "Ada Lovelace",
            },
            examples: ["Grace Hopper"],
          }),
          parameter({
            name: "keyword",
            in: "query",
            schema: { type: "string", default: "machine learning" },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(metadataWarnings(result)).toEqual([]);
    const inputs = result.requestDefinition!.agentInputs;
    expect(inputs.find((input) => input.name === "author")?.examples).toEqual([
      "Grace Hopper",
      "Ada Lovelace",
      "Ada Lovelace",
    ]);
    expect(inputs.find((input) => input.name === "keyword")?.examples).toEqual([
      "machine learning",
    ]);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });
});

describe("openapi credential-bearing positions", () => {
  function metadataWarnings(result: MapInventoryOperationResult) {
    return result.issues.filter(
      (issue) => issue.code === ISSUE.METADATA_IGNORED,
    );
  }

  it("removes parameter-level examples from a writeOnly position and warns", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "value",
            in: "query",
            examples: ["hunter2"],
            schema: { type: "string", writeOnly: true },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(JSON.stringify(result.requestDefinition)).not.toContain("hunter2");
    const input = result.requestDefinition!.agentInputs[0];
    expect(input).toMatchObject({ name: "value", sensitive: true });
    expect(input).not.toHaveProperty("examples");

    const warnings = metadataWarnings(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("credential-bearing");
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("removes parameter-level examples from a credential-named position", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "api_key",
            in: "header",
            required: true,
            examples: ["hunter2"],
            schema: { type: "string", default: "hunter2" },
          }),
        ],
      }),
    });

    expect(JSON.stringify(result.requestDefinition)).not.toContain("hunter2");
    expect(result.requestDefinition?.agentInputs[0]).toMatchObject({
      name: "api_key",
      sensitive: true,
    });
    expect(result.requestDefinition?.agentInputs[0]).not.toHaveProperty(
      "examples",
    );
    expect(metadataWarnings(result)).toHaveLength(1);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("empties an enum on a password-format position and warns", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "pin",
            in: "query",
            schema: {
              type: "string",
              format: "password",
              enum: ["1234", "9999"],
            },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(JSON.stringify(result.requestDefinition)).not.toContain("1234");
    const input = result.requestDefinition!.agentInputs[0];
    expect(input).toMatchObject({
      name: "pin",
      sensitive: true,
      type: "string",
    });
    expect(input).not.toHaveProperty("enum");

    const warnings = metadataWarnings(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message.toLowerCase()).toContain(
      "credential-like enum",
    );
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("binds a const under a password-format position to a sensitive input", () => {
    const result = map({
      operation: operation({
        operationKey: "create_item",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              properties: {
                pin: { type: "string", format: "password", const: "hunter2" },
              },
            }),
          ],
        },
      }),
    });

    expect(result.selectable).toBe(true);
    const definition = result.requestDefinition!;
    expect(JSON.stringify(definition)).not.toContain("hunter2");
    if (definition.body.bodyType !== "json")
      throw new Error("expected json body");
    expect(fieldNamed(definition.body.root, "pin")).toEqual({
      kind: "binding",
      binding: { kind: "agentInput", agentInputId: "ain_0" },
      jsonType: "any",
      omitWhenAbsent: true,
    });
    expect(definition.agentInputs[0]).toMatchObject({
      name: "pin",
      sensitive: true,
    });
    expect(
      result.issues.some(
        (issue) =>
          issue.code === ISSUE.METADATA_IGNORED &&
          issue.message.includes("constant"),
      ),
    ).toBe(true);
    expect(compile(definition, "POST").ok).toBe(true);
  });
});

describe("openapi value-shape redaction", () => {
  const SLACK_TOKEN =
    "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx";
  const AWS_ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";

  it("narrows an enum that hides a Slack token and drops an AWS default", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "mode",
            in: "query",
            schema: {
              type: "string",
              enum: ["fast", SLACK_TOKEN],
              default: AWS_ACCESS_KEY,
            },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(JSON.stringify(result.requestDefinition)).not.toContain(SLACK_TOKEN);
    expect(JSON.stringify(result.requestDefinition)).not.toContain(
      AWS_ACCESS_KEY,
    );
    const input = result.requestDefinition!.agentInputs[0];
    expect(input).toMatchObject({ name: "mode", sensitive: false });
    expect(input?.enum).toEqual(["fast"]);
    expect(input).not.toHaveProperty("examples");

    const warnings = result.issues.filter(
      (issue) => issue.code === ISSUE.METADATA_IGNORED,
    );
    expect(warnings).toHaveLength(2);
    expect(warnings.some((issue) => issue.message.includes("narrowed"))).toBe(
      true,
    );
    expect(
      warnings.some((issue) => issue.message.includes("example/default")),
    ).toBe(true);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });
});

describe("openapi pattern redaction", () => {
  it("omits a credential-like pattern and warns", () => {
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: "code",
            in: "query",
            schema: {
              type: "string",
              pattern:
                "^eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.LongBase64SignatureValueHere$",
            },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(JSON.stringify(result.requestDefinition)).not.toContain(
      "eyJhbGciOiJIUzI1NiJ9",
    );
    expect(result.requestDefinition?.agentInputs[0]).not.toHaveProperty(
      "pattern",
    );
    expect(
      result.issues.some(
        (issue) =>
          issue.code === ISSUE.METADATA_IGNORED &&
          issue.message.includes("pattern"),
      ),
    ).toBe(true);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("keeps uuid, date, and slug patterns without warning", () => {
    const patterns = {
      user_id: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      published_on: "^\\d{4}-\\d{2}-\\d{2}$",
      slug: "^[a-z][a-z0-9-]{2,63}$",
    };
    const result = map({
      operation: operation({
        parameters: Object.entries(patterns).map(([name, pattern]) =>
          parameter({
            name,
            in: "query",
            schema: { type: "string", pattern },
          }),
        ),
      }),
    });

    expect(result.selectable).toBe(true);
    expect(
      result.issues.filter((issue) => issue.code === ISSUE.METADATA_IGNORED),
    ).toEqual([]);
    expect(
      result.requestDefinition?.agentInputs.map((input) => input.pattern),
    ).toEqual(Object.values(patterns));
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });
});

describe("openapi document text redaction", () => {
  const SUMMARY_SECRET = "sk_live_SUMMARY00000001";
  const JWT_SECRET =
    "eyJhbGciOiJIUzI1NiJ9.c2VjcmV0.LongBase64SignatureValueHere";

  function metadataWarnings(result: MapInventoryOperationResult) {
    return result.issues.filter(
      (issue) => issue.code === ISSUE.METADATA_IGNORED,
    );
  }

  it("replaces credential-shaped spans in summary, description, and tags", () => {
    const result = map({
      operation: operation({
        summary: `List items using key ${SUMMARY_SECRET}`,
        description: `Send Authorization: Bearer ${JWT_SECRET}`,
        tags: ["billing sk_live_TAG0000000000001", "catalog"],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.title).toBe(`List items using key ${REDACTION_PLACEHOLDER}`);
    expect(result.description).toBe(
      `Send Authorization: ${REDACTION_PLACEHOLDER}`,
    );
    expect(result.tags).toEqual([
      `billing ${REDACTION_PLACEHOLDER}`,
      "catalog",
    ]);
    expect(JSON.stringify(result)).not.toContain(SUMMARY_SECRET);
    expect(JSON.stringify(result)).not.toContain(JWT_SECRET);
    expect(JSON.stringify(result)).not.toContain("sk_live_TAG");

    const warnings = metadataWarnings(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("summary");
    expect(warnings[0]?.message).toContain("description");
    expect(warnings[0]?.message).toContain("tags");
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("keeps ordinary prose that names credentials intact", () => {
    const summary = "Authentication uses the API key header.";
    const description =
      "The secret is never echoed back; session and author are plain values.";
    const result = map({
      operation: operation({
        summary,
        description,
        tags: ["authentication", "catalog"],
      }),
    });

    expect(result.title).toBe(summary);
    expect(result.description).toBe(description);
    expect(result.tags).toEqual(["authentication", "catalog"]);
    expect(metadataWarnings(result)).toEqual([]);
    expect(JSON.stringify(result)).toContain("API key header");
  });

  it("keeps bearer, API key, and secret wording verbatim with no warning", () => {
    const summary =
      "Bearer authentication is required. Send the API key header per request.";
    const description = "The secret is never echoed, not even in errors.";
    const result = map({ operation: operation({ summary, description }) });

    expect(result.selectable).toBe(true);
    expect(result.title).toBe(summary);
    expect(result.description).toBe(description);
    expect(metadataWarnings(result)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(REDACTION_PLACEHOLDER);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("replaces only the credential span inside an otherwise intact summary", () => {
    const mixedBase64 = "dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgYmxvYiB2YWx1ZQ==";
    const summary = `Read ${JWT_SECRET}, rotate ${SUMMARY_SECRET}, and cache ${mixedBase64} for five minutes`;
    const result = map({ operation: operation({ summary }) });

    expect(result.selectable).toBe(true);
    expect(result.title).toBe(
      `Read ${REDACTION_PLACEHOLDER}, rotate ${REDACTION_PLACEHOLDER}, and cache ${REDACTION_PLACEHOLDER} for five minutes`,
    );
    expect(metadataWarnings(result)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(JWT_SECRET);
    expect(JSON.stringify(result)).not.toContain(SUMMARY_SECRET);
    expect(JSON.stringify(result)).not.toContain(mixedBase64);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });

  it("drops a tag that is nothing but a credential instead of keeping it empty", () => {
    const result = map({
      operation: operation({
        summary: "List items",
        tags: ["sk_live_TAG0000000000001", "catalog"],
      }),
    });

    expect(result.tags).toEqual(["catalog"]);
    expect(result.tags[0]).toBe("catalog");

    const warnings = metadataWarnings(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("dropped");

    const allCredentialTags = map({
      operation: operation({
        summary: "List items",
        tags: ["sk_live_TAG0000000000001"],
      }),
    });
    expect(allCredentialTags.tags).toEqual([]);
    expect(allCredentialTags.tags[0]).toBeUndefined();
  });
});

describe("openapi server variable credentials", () => {
  it("blocks a credential-like server variable default", () => {
    const result = map({
      operation: operation({
        servers: [
          {
            url: "https://api.example.com/{tenant}",
            variables: [
              { name: "tenant", default: "sk_live_SERVERVAR00000001" },
            ],
            pointer: "#/paths/~1items/get/servers/0",
          },
        ],
      }),
    });

    expect(result.selectable).toBe(false);
    expect(result.requestDefinition).toBeUndefined();
    const blocking = result.issues.find(
      (issue) => issue.code === ISSUE.AMBIGUOUS_SERVER,
    );
    expect(blocking?.severity).toBe("error");
    expect(blocking?.message).toContain("tenant");
    expect(JSON.stringify(result)).not.toContain("sk_live_SERVERVAR00000001");
  });

  it("still inlines an ordinary server variable default", () => {
    const result = map({
      operation: operation({
        servers: [
          {
            url: "https://api.example.com/v1/{tenant}",
            variables: [{ name: "tenant", default: "acme" }],
            pointer: "#/paths/~1items/get/servers/0",
          },
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    expect(result.requestDefinition?.pathSegments).toEqual([
      { id: "path_0", value: { kind: "literal", value: "/acme/items" } },
    ]);
    expect(compile(result.requestDefinition!, "GET").ok).toBe(true);
  });
});

describe("openapi residual risk: credential-shaped names", () => {
  /**
   * Pinned behavior: the request name is structurally required by the wire
   * format and cannot be renamed, so a credential-shaped NAME is persisted
   * verbatim. Accepted residual risk, reported rather than redacted.
   */
  it("persists a credential-shaped parameter name because the name is structurally required", () => {
    const secretName = "sk_live_51H8xSECRETVALUE0001";
    const result = map({
      operation: operation({
        parameters: [
          parameter({
            name: secretName,
            in: "query",
            required: true,
            schema: { type: "string" },
          }),
        ],
      }),
    });

    expect(result.selectable).toBe(true);
    const definition = result.requestDefinition!;
    expect(definition.query[0]?.name).toBe(secretName);
    expect(JSON.stringify(definition)).toContain(secretName);
    expect(compile(definition, "GET").ok).toBe(true);
  });

  it("persists a credential-shaped JSON body property name because the name is structurally required", () => {
    const secretKey = "sk_live_51H8xBODYKEY0001";
    const result = map({
      operation: operation({
        operationKey: "create_item",
        method: "POST",
        requestBody: {
          required: true,
          pointer: "#/paths/~1items/post/requestBody",
          mediaTypes: [
            mediaType("application/json", {
              type: "object",
              properties: { [secretKey]: { type: "string" } },
            }),
          ],
        },
      }),
    });

    expect(result.selectable).toBe(true);
    const definition = result.requestDefinition!;
    if (definition.body.bodyType !== "json")
      throw new Error("expected json body");
    expect(fieldNamed(definition.body.root, secretKey).kind).toBe("binding");
    expect(JSON.stringify(definition)).toContain(secretKey);
    expect(compile(definition, "POST").ok).toBe(true);
  });
});
