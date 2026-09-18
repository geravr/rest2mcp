import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "./app-error.js";
import {
  extractPlaceholders,
  renderQueryMap,
  renderTemplate,
  type RenderScope,
} from "./mcp-template.js";

function makeScope(
  overrides: Partial<RenderScope> = {},
): RenderScope & { secretsUsed: Set<string> } {
  return {
    args: {},
    variables: {},
    secretsUsed: new Set<string>(),
    ...overrides,
  };
}

describe("extractPlaceholders", () => {
  it("extracts unique placeholder names", () => {
    expect(
      extractPlaceholders(
        "/contacts/{{contactId}}/notes/{{noteId}}/{{contactId}}",
      ),
    ).toEqual(["contactId", "noteId"]);
  });

  it("ignores single-brace and malformed placeholders", () => {
    expect(extractPlaceholders("/contacts/{id}/{{valid}}/{{1bad}}")).toEqual([
      "valid",
    ]);
  });
});

describe("renderTemplate resolution", () => {
  it("resolves args before variables", () => {
    const scope = makeScope({
      args: { limit: 50 },
      variables: { limit: { value: "10", isSecret: false } },
    });
    expect(renderTemplate("?limit={{limit}}", "raw", scope)).toBe("?limit=50");
  });

  it("falls back to variables when no arg matches", () => {
    const scope = makeScope({
      variables: { region: { value: "us", isSecret: false } },
    });
    expect(renderTemplate("/{{region}}/items", "path", scope)).toBe(
      "/us/items",
    );
  });

  it("fails unresolved placeholders with MCP_TEMPLATE_UNRESOLVED", () => {
    const scope = makeScope();
    try {
      renderTemplate("/{{missing}}", "path", scope);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).appCode).toBe(
        APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
      );
      expect((error as AppError).details).toEqual({ placeholder: "missing" });
    }
  });

  it("collects secret values used in the render", () => {
    const scope = makeScope({
      variables: {
        api_token: { value: "sk_live_123", isSecret: true },
        region: { value: "us", isSecret: false },
      },
    });
    renderTemplate("Bearer {{api_token}} {{region}}", "header", scope);
    expect([...scope.secretsUsed]).toEqual(["sk_live_123"]);
  });
});

describe("renderQueryMap optional omission", () => {
  const optionalParams = [
    { name: "email", required: false },
    { name: "phone", required: false },
    { name: "limit", required: false },
    { name: "region", required: false },
    { name: "id", required: false },
    { name: "contactId", required: false },
  ];

  it("omits optional exact query keys when unresolved", () => {
    const scope = makeScope({ args: { email: "a@b.com" } });
    expect(
      renderQueryMap(
        {
          email: "{{email}}",
          phone: "{{phone}}",
          limit: "{{limit}}",
        },
        scope,
        optionalParams,
      ),
    ).toEqual({ email: "a%40b.com" });
  });

  it("keeps optional query keys that resolve from variables", () => {
    const scope = makeScope({
      variables: { region: { value: "us", isSecret: false } },
    });
    expect(
      renderQueryMap({ region: "{{region}}" }, scope, optionalParams),
    ).toEqual({ region: "us" });
  });

  it("fails required query placeholders", () => {
    const scope = makeScope();
    try {
      renderQueryMap({ email: "{{email}}" }, scope, [
        { name: "email", required: true },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).appCode).toBe(
        APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
      );
      expect((error as AppError).details).toEqual({ placeholder: "email" });
    }
  });

  it("fails undeclared exact query placeholders", () => {
    const scope = makeScope();
    try {
      renderQueryMap({ foo: "{{foo}}" }, scope, optionalParams);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).appCode).toBe(
        APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
      );
      expect((error as AppError).details).toEqual({ placeholder: "foo" });
    }
  });

  it("fails prefixed query values even when the param is optional", () => {
    const scope = makeScope();
    try {
      renderQueryMap({ q: "id:{{id}}" }, scope, optionalParams);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toEqual({ placeholder: "id" });
    }
  });

  it("does not omit unresolved optional path placeholders", () => {
    const scope = makeScope();
    try {
      renderTemplate("/contacts/{{contactId}}", "path", scope);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toEqual({
        placeholder: "contactId",
      });
    }
  });
});

describe("renderTemplate escaping", () => {
  it("URL-encodes path values", () => {
    const scope = makeScope({ args: { contactId: "a/b c" } });
    expect(renderTemplate("/contacts/{{contactId}}", "path", scope)).toBe(
      "/contacts/a%2Fb%20c",
    );
  });

  it("URL-encodes query values", () => {
    const scope = makeScope({ args: { q: "a&b=c" } });
    expect(renderTemplate("{{q}}", "query", scope)).toBe("a%26b%3Dc");
  });

  it("URL-encodes literal segments of query values", () => {
    const scope = makeScope({ args: { q: "a&b" } });
    expect(renderTemplate("foo&bar", "query", scope)).toBe("foo%26bar");
    expect(renderTemplate("prefix {{q}}", "query", scope)).toBe(
      "prefix%20a%26b",
    );
  });

  it("strips CRLF from header values", () => {
    const scope = makeScope({ args: { value: "one\r\ntwo\nthree" } });
    expect(renderTemplate("{{value}}", "header", scope)).toBe("one two three");
  });

  it("JSON string-escapes quoted placeholders", () => {
    const scope = makeScope({ args: { note: 'say "hi"\n' } });
    expect(renderTemplate('{"note": "{{note}}"}', "json", scope)).toBe(
      '{"note": "say \\"hi\\"\\n"}',
    );
  });

  it("injects raw JSON values for bare placeholders", () => {
    const scope = makeScope({
      args: {
        address: { street: "Main", zip: 12345 },
        count: 3,
        active: true,
      },
    });
    expect(
      renderTemplate(
        '{"address": {{address}}, "count": {{count}}, "active": {{active}}}',
        "json",
        scope,
      ),
    ).toBe(
      '{"address": {"street":"Main","zip":12345}, "count": 3, "active": true}',
    );
  });

  it("injects string values verbatim for bare placeholders", () => {
    const scope = makeScope({
      variables: { payload: { value: '{"nested":true}', isSecret: false } },
    });
    expect(renderTemplate('{"data": {{payload}}}', "json", scope)).toBe(
      '{"data": {"nested":true}}',
    );
  });

  it("stringifies non-string values inside quoted placeholders", () => {
    const scope = makeScope({ args: { limit: 50 } });
    expect(renderTemplate('{"limit": "{{limit}}"}', "json", scope)).toBe(
      '{"limit": "50"}',
    );
  });

  it("escapes placeholders embedded in JSON strings", () => {
    const scope = makeScope({
      variables: { token: { value: 'to"ken\nx', isSecret: true } },
    });
    const rendered = renderTemplate(
      '{"auth": "Bearer {{token}}"}',
      "json",
      scope,
    );
    expect(rendered).toBe('{"auth": "Bearer to\\"ken\\nx"}');
    expect(JSON.parse(rendered)).toEqual({ auth: 'Bearer to"ken\nx' });
    expect([...scope.secretsUsed]).toEqual(['to"ken\nx']);
  });

  it("keeps typed injection for placeholders outside JSON strings", () => {
    const scope = makeScope({ args: { count: 3, label: 'a"b' } });
    expect(
      renderTemplate(
        '{"count": {{count}}, "label": "x{{label}}y"}',
        "json",
        scope,
      ),
    ).toBe('{"count": 3, "label": "xa\\"by"}');
  });

  it("treats placeholders after escaped quotes as outside the string", () => {
    const scope = makeScope({ args: { data: { x: 1 } } });
    const rendered = renderTemplate(
      '{"esc": "a\\"b", "data": {{data}}}',
      "json",
      scope,
    );
    expect(rendered).toBe('{"esc": "a\\"b", "data": {"x":1}}');
    expect(JSON.parse(rendered)).toEqual({ esc: 'a"b', data: { x: 1 } });
  });

  it("keeps placeholders inside the string after an escaped backslash and quote", () => {
    const scope = makeScope({ args: { tail: 'T"1' } });
    const rendered = renderTemplate(
      '{"path": "C:\\\\\\"{{tail}}"}',
      "json",
      scope,
    );
    expect(JSON.parse(rendered)).toEqual({ path: 'C:\\"T"1' });
  });

  it("URL-encodes form values", () => {
    const scope = makeScope({ args: { name: "Ada Lovelace" } });
    expect(renderTemplate("name={{name}}", "form", scope)).toBe(
      "name=Ada%20Lovelace",
    );
  });

  it("passes raw values through without escaping", () => {
    const scope = makeScope({ args: { xml: "<a>hello & bye</a>" } });
    expect(renderTemplate("<root>{{xml}}</root>", "raw", scope)).toBe(
      "<root><a>hello & bye</a></root>",
    );
  });
});
