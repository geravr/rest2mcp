import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import {
  analyzeLegacyCommonEntries,
  analyzeLegacyTool,
  legacyDefaultsFromCommonEntries,
  legacyTemplateFromDefinition,
  type LegacyServerValueRef,
  type LegacyToolInput,
} from "./mcp-legacy-migrate.js";
import type { McpToolParam } from "@repo/db";

function baseInput(overrides: Partial<LegacyToolInput> = {}): LegacyToolInput {
  return {
    method: "GET",
    pathTemplate: "/items",
    requestTemplate: null,
    params: null,
    serverValues: [],
    ...overrides,
  };
}

function param(overrides: Partial<McpToolParam> = {}): McpToolParam {
  return { name: "contact_id", required: true, type: "string", ...overrides };
}

function serverValue(
  overrides: Partial<LegacyServerValueRef> = {},
): LegacyServerValueRef {
  return {
    id: "sv_1",
    name: "api_token",
    kind: "secret",
    owner: "manual",
    ...overrides,
  };
}

function errorCodes(issues: { severity: string; code: string }[]): string[] {
  return issues.filter((i) => i.severity === "error").map((i) => i.code);
}

describe("analyzeLegacyTool: unambiguous migration", () => {
  it("converts a path placeholder matching a declared param into an agent input binding", () => {
    const result = analyzeLegacyTool(
      baseInput({
        pathTemplate: "/contacts/{{contact_id}}/notes",
        params: [param({ name: "contact_id", required: true })],
      }),
    );
    expect(result.unambiguous).toBe(true);
    expect(result.definition).not.toBeNull();
    expect(result.definition?.pathSegments).toEqual([
      { id: "path_0", value: { kind: "literal", value: "/contacts/" } },
      {
        id: "path_1",
        value: { kind: "agentInput", agentInputId: "contact_id" },
      },
      { id: "path_2", value: { kind: "literal", value: "/notes" } },
    ]);
    expect(result.definition?.agentInputs).toEqual([
      {
        id: "contact_id",
        name: "contact_id",
        required: true,
        sensitive: false,
        type: "string",
      },
    ]);
  });

  it("converts a placeholder matching a server value into a serverValue binding", () => {
    const result = analyzeLegacyTool(
      baseInput({
        pathTemplate: "/orgs/{{org_id}}",
        serverValues: [
          serverValue({ id: "sv_org", name: "org_id", kind: "config" }),
        ],
      }),
    );
    expect(result.unambiguous).toBe(true);
    expect(result.definition?.pathSegments).toEqual([
      { id: "path_0", value: { kind: "literal", value: "/orgs/" } },
      { id: "path_1", value: { kind: "serverValue", serverValueId: "sv_org" } },
    ]);
  });

  it("converts a header with a static prefix around a server value into prefix binding", () => {
    const result = analyzeLegacyTool(
      baseInput({
        requestTemplate: { headers: { Authorization: "Bearer {{api_token}}" } },
        serverValues: [serverValue({ id: "sv_1", name: "api_token" })],
      }),
    );
    expect(result.unambiguous).toBe(true);
    expect(result.definition?.headers).toEqual([
      {
        id: "requestTemplate.headers_0",
        name: "Authorization",
        value: {
          kind: "serverValue",
          serverValueId: "sv_1",
          prefix: "Bearer ",
        },
      },
    ]);
  });

  it("keeps literal query/header values with no placeholders untouched", () => {
    const result = analyzeLegacyTool(
      baseInput({
        requestTemplate: {
          headers: { Accept: "application/json" },
          query: { format: "json" },
        },
      }),
    );
    expect(result.unambiguous).toBe(true);
    expect(result.definition?.headers[0]?.value).toEqual({
      kind: "literal",
      value: "application/json",
    });
    expect(result.definition?.query[0]?.value).toEqual({
      kind: "literal",
      value: "json",
    });
  });

  it("converts an exact query placeholder for a param into an agent input binding", () => {
    const result = analyzeLegacyTool(
      baseInput({
        requestTemplate: { query: { limit: "{{limit}}" } },
        params: [param({ name: "limit", required: false, type: "number" })],
      }),
    );
    expect(result.unambiguous).toBe(true);
    expect(result.definition?.query).toEqual([
      {
        id: "requestTemplate.query_0",
        name: "limit",
        value: { kind: "agentInput", agentInputId: "limit" },
      },
    ]);
    expect(result.definition?.agentInputs).toEqual([
      {
        id: "limit",
        name: "limit",
        required: false,
        sensitive: false,
        type: "number",
      },
    ]);
  });

  it("converts a JSON body template with quoted and bare placeholders", () => {
    const result = analyzeLegacyTool(
      baseInput({
        method: "POST",
        requestTemplate: {
          bodyType: "json",
          body: '{"name": "{{full_name}}", "age": {{age}}, "active": true}',
        },
        params: [
          param({ name: "full_name", required: true, type: "string" }),
          param({ name: "age", required: false, type: "number" }),
        ],
      }),
    );
    expect(result.unambiguous).toBe(true);
    expect(result.definition?.body).toEqual({
      bodyType: "json",
      root: {
        kind: "object",
        fields: [
          {
            id: "body_field_0",
            key: "name",
            value: {
              kind: "binding",
              binding: { kind: "agentInput", agentInputId: "full_name" },
              jsonType: "string",
            },
          },
          {
            id: "body_field_1",
            key: "age",
            value: {
              kind: "binding",
              binding: { kind: "agentInput", agentInputId: "age" },
              jsonType: "any",
            },
          },
          {
            id: "body_field_2",
            key: "active",
            value: { kind: "literal", jsonType: "boolean", value: true },
          },
        ],
      },
    });
  });

  it("migrates a form body onto the raw escape hatch using namespaced tokens", () => {
    const result = analyzeLegacyTool(
      baseInput({
        method: "POST",
        requestTemplate: {
          bodyType: "form",
          body: "name={{full_name}}&static=1",
        },
        params: [param({ name: "full_name", required: true })],
      }),
    );
    expect(result.unambiguous).toBe(true);
    expect(result.definition?.body).toEqual({
      bodyType: "raw",
      bindings: [
        {
          id: "raw_0",
          binding: { kind: "agentInput", agentInputId: "full_name" },
        },
      ],
      template: "name={{raw_0}}&static=1",
    });
  });
});

describe("analyzeLegacyTool: name collisions", () => {
  it("marks a placeholder ambiguous when it matches both a param and a server value", () => {
    const result = analyzeLegacyTool(
      baseInput({
        pathTemplate: "/items/{{name}}",
        params: [param({ name: "name", required: true })],
        serverValues: [
          serverValue({ id: "sv_1", name: "name", kind: "config" }),
        ],
      }),
    );
    expect(result.unambiguous).toBe(false);
    expect(result.definition).toBeNull();
    expect(errorCodes(result.issues)).toContain(
      APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
    );
  });
});

describe("analyzeLegacyTool: ambiguous placeholders", () => {
  it("marks a placeholder unresolved when it matches neither a param nor a server value", () => {
    const result = analyzeLegacyTool(
      baseInput({ pathTemplate: "/items/{{mystery}}" }),
    );
    expect(result.unambiguous).toBe(false);
    expect(result.definition).toBeNull();
    expect(errorCodes(result.issues)).toContain(
      APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
    );
  });

  it("rejects an agent input placeholder embedded in surrounding literal text", () => {
    const result = analyzeLegacyTool(
      baseInput({
        requestTemplate: { headers: { "X-Custom": "v-{{version}}" } },
        params: [param({ name: "version", required: true })],
      }),
    );
    expect(result.unambiguous).toBe(false);
    expect(result.definition).toBeNull();
  });

  it("rejects an optional param used in a path segment", () => {
    const result = analyzeLegacyTool(
      baseInput({
        pathTemplate: "/items/{{id}}",
        params: [param({ name: "id", required: false })],
      }),
    );
    expect(result.unambiguous).toBe(false);
  });

  it("rejects a value with more than one placeholder", () => {
    const result = analyzeLegacyTool(
      baseInput({
        requestTemplate: { query: { q: "{{a}}-{{b}}" } },
        params: [
          param({ name: "a", required: true }),
          param({ name: "b", required: true }),
        ],
      }),
    );
    expect(result.unambiguous).toBe(false);
  });
});

describe("analyzeLegacyTool: invalid JSON", () => {
  it("marks the tool ambiguous when the JSON body template is not valid JSON", () => {
    const result = analyzeLegacyTool(
      baseInput({
        method: "POST",
        requestTemplate: { bodyType: "json", body: "{not valid json" },
      }),
    );
    expect(result.unambiguous).toBe(false);
    expect(result.definition).toBeNull();
    expect(errorCodes(result.issues)).toContain(
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
    );
  });

  it("rejects a body declared on a GET tool", () => {
    const result = analyzeLegacyTool(
      baseInput({
        method: "GET",
        requestTemplate: { bodyType: "json", body: "{}" },
      }),
    );
    expect(result.unambiguous).toBe(false);
  });
});

describe("analyzeLegacyTool: duplicate headers", () => {
  it("flags case-insensitive duplicate header keys in requestTemplate.headers", () => {
    const result = analyzeLegacyTool(
      baseInput({
        requestTemplate: {
          headers: {
            "Content-Type": "application/json",
            "content-type": "text/plain",
          },
        },
      }),
    );
    expect(result.unambiguous).toBe(false);
    expect(errorCodes(result.issues)).toContain(
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
    );
  });
});

describe("analyzeLegacyTool: unsafe paths", () => {
  it("flags a literal '..' path segment as unsafe", () => {
    const result = analyzeLegacyTool(
      baseInput({ pathTemplate: "/items/../../etc/passwd" }),
    );
    expect(result.unambiguous).toBe(false);
    expect(result.definition).toBeNull();
    expect(errorCodes(result.issues)).toContain(
      APP_ERROR_CODES.MCP_PATH_ESCAPE,
    );
  });

  it("does not flag a bound path segment even if its value could contain dots at runtime", () => {
    const result = analyzeLegacyTool(
      baseInput({
        pathTemplate: "/items/{{contact_id}}",
        params: [param({ name: "contact_id", required: true })],
      }),
    );
    expect(errorCodes(result.issues)).not.toContain(
      APP_ERROR_CODES.MCP_PATH_ESCAPE,
    );
  });
});

describe("analyzeLegacyTool: idempotent analysis", () => {
  it("returns an identical result across repeated calls with the same input", () => {
    const input = baseInput({
      pathTemplate: "/contacts/{{contact_id}}",
      requestTemplate: {
        headers: { Authorization: "Bearer {{api_token}}" },
        query: { limit: "{{limit}}" },
      },
      params: [
        param({ name: "contact_id", required: true }),
        param({ name: "limit", required: false, type: "number" }),
      ],
      serverValues: [serverValue({ id: "sv_1", name: "api_token" })],
    });

    const first = analyzeLegacyTool(input);
    const second = analyzeLegacyTool(input);
    expect(second).toEqual(first);
  });

  it("is idempotent for ambiguous inputs too", () => {
    const input = baseInput({ pathTemplate: "/items/{{mystery}}" });
    const first = analyzeLegacyTool(input);
    const second = analyzeLegacyTool(input);
    expect(second).toEqual(first);
  });
});

describe("analyzeLegacyCommonEntries", () => {
  it("resolves server defaults against server values only, never params", () => {
    const result = analyzeLegacyCommonEntries({
      defaultHeaders: { "X-Version": "{{api_version}}" },
      defaultQuery: null,
      serverValues: [
        serverValue({ id: "sv_v", name: "api_version", kind: "config" }),
      ],
    });
    expect(result.unambiguous).toBe(true);
    expect(result.commonEntries?.headers).toEqual([
      {
        id: "common.headers_0",
        name: "X-Version",
        value: { kind: "serverValue", serverValueId: "sv_v" },
      },
    ]);
  });

  it("flags an unresolved placeholder in a server default (no param fallback)", () => {
    const result = analyzeLegacyCommonEntries({
      defaultHeaders: { "X-Version": "{{api_version}}" },
      defaultQuery: null,
      serverValues: [],
    });
    expect(result.unambiguous).toBe(false);
    expect(result.commonEntries).toBeNull();
    expect(errorCodes(result.issues)).toContain(
      APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
    );
  });

  it("flags duplicate query keys in server defaults", () => {
    const result = analyzeLegacyCommonEntries({
      defaultHeaders: null,
      defaultQuery: { limit: "10" },
      serverValues: [],
    });
    expect(result.unambiguous).toBe(true);
    expect(result.commonEntries?.query).toEqual([
      {
        id: "common.query_0",
        name: "limit",
        value: { kind: "literal", value: "10" },
      },
    ]);
  });
});

describe("legacyTemplateFromDefinition", () => {
  it("round-trips path, header, query, and JSON body bindings", () => {
    const template = legacyTemplateFromDefinition(
      {
        version: 1,
        pathSegments: [
          { id: "p0", value: { kind: "literal", value: "/contacts/" } },
          {
            id: "p1",
            value: { kind: "agentInput", agentInputId: "contact_id" },
          },
        ],
        query: [
          {
            id: "q0",
            name: "limit",
            value: { kind: "agentInput", agentInputId: "limit" },
          },
        ],
        headers: [
          {
            id: "h0",
            name: "Authorization",
            value: {
              kind: "serverValue",
              serverValueId: "sv_1",
              prefix: "Bearer ",
            },
          },
        ],
        body: {
          bodyType: "json",
          root: {
            kind: "object",
            fields: [
              {
                id: "f0",
                key: "name",
                value: {
                  kind: "binding",
                  binding: { kind: "agentInput", agentInputId: "contact_id" },
                  jsonType: "string",
                },
              },
            ],
          },
        },
        agentInputs: [
          {
            id: "contact_id",
            name: "contact_id",
            required: true,
            sensitive: false,
            type: "string",
          },
          {
            id: "limit",
            name: "limit",
            required: false,
            sensitive: false,
            type: "number",
          },
        ],
      },
      "POST",
      { sv_1: "api_token" },
    );

    expect(template.pathTemplate).toBe("/contacts/{{contact_id}}");
    expect(template.requestTemplate.query).toEqual({ limit: "{{limit}}" });
    expect(template.requestTemplate.headers).toEqual({
      Authorization: "Bearer {{api_token}}",
    });
    expect(template.requestTemplate.bodyType).toBe("json");
    expect(JSON.parse(template.requestTemplate.body as string)).toEqual({
      name: "{{contact_id}}",
    });
    expect(template.params).toEqual([
      { name: "contact_id", required: true, type: "string" },
      { name: "limit", required: false, type: "number" },
    ]);
  });

  it("falls back to the raw server value id when no name mapping is supplied", () => {
    const template = legacyTemplateFromDefinition(
      {
        version: 1,
        pathSegments: [],
        query: [],
        headers: [
          {
            id: "h0",
            name: "X-Key",
            value: { kind: "serverValue", serverValueId: "sv_unknown" },
          },
        ],
        body: { bodyType: "none" },
        agentInputs: [],
      },
      "GET",
    );
    expect(template.requestTemplate.headers).toEqual({
      "X-Key": "{{sv_unknown}}",
    });
  });
});

describe("legacyDefaultsFromCommonEntries", () => {
  it("renders common entries back into legacy default maps", () => {
    const result = legacyDefaultsFromCommonEntries(
      {
        headers: [
          {
            id: "h0",
            name: "X-Version",
            value: { kind: "serverValue", serverValueId: "sv_v" },
          },
        ],
        query: [
          { id: "q0", name: "region", value: { kind: "literal", value: "us" } },
        ],
      },
      { sv_v: "api_version" },
    );
    expect(result.defaultHeaders).toEqual({ "X-Version": "{{api_version}}" });
    expect(result.defaultQuery).toEqual({ region: "us" });
  });
});
