import { describe, expect, it } from "vitest";
import {
  collectAgentParams,
  compileFormBody,
  compileOrigin,
  compileStructuredJson,
  defaultAgentMeta,
  inferFormRows,
  inferJsonRows,
  inferOrigin,
  isFlatJsonTemplate,
  compactPathParts,
  joinPath,
  removePathPart,
  slugifyAgentName,
  splitPath,
  templateReferencesName,
  templatesReferenceName,
  type AgentMeta,
} from "./value-origin";

const params = (entries: AgentMeta[]) =>
  new Map(entries.map((param) => [param.name, param]));

describe("inferOrigin", () => {
  it("infers a prefixed Variable from a known name", () => {
    expect(inferOrigin("Bearer {{api_token}}", ["api_token"])).toEqual({
      origin: "variable",
      name: "api_token",
      prefix: "Bearer ",
    });
  });

  it("infers an exact Agent and reuses stored param metadata", () => {
    expect(
      inferOrigin(
        "{{search}}",
        ["api_token"],
        params([
          {
            name: "search",
            description: "Free-text query",
            type: "string",
            required: true,
          },
        ]),
      ),
    ).toEqual({
      origin: "agent",
      name: "search",
      description: "Free-text query",
      type: "string",
      required: true,
    });
  });

  it("keeps mixed leftover syntax as Fixed", () => {
    expect(inferOrigin("{{foo}} and {{bar}}", ["foo"])).toEqual({
      origin: "fixed",
      value: "{{foo}} and {{bar}}",
    });
  });
});

describe("compileOrigin", () => {
  it("joins a Variable prefix and placeholder", () => {
    expect(
      compileOrigin({
        origin: "variable",
        name: "api_token",
        prefix: "Bearer ",
      }),
    ).toBe("Bearer {{api_token}}");
  });

  it("compiles Agent to a placeholder", () => {
    expect(
      compileOrigin({
        origin: "agent",
        name: "location_id",
        type: "string",
        required: true,
      }),
    ).toBe("{{location_id}}");
  });
});

describe("splitPath / joinPath", () => {
  it("splits text and tokens then joins them back", () => {
    const parts = splitPath(
      "/contacts/{{contactId}}/edit",
      ["api_token"],
      params([
        {
          name: "contactId",
          description: "Contact id",
          type: "string",
          required: true,
        },
      ]),
    );
    expect(parts).toEqual([
      { kind: "text", value: "/contacts/" },
      {
        kind: "agent",
        name: "contactId",
        description: "Contact id",
        type: "string",
        required: true,
      },
      { kind: "text", value: "/edit" },
    ]);
    expect(joinPath(parts)).toBe("/contacts/{{contactId}}/edit");
  });

  it("treats a known variable token as Variable", () => {
    expect(splitPath("/{{api_version}}", ["api_version"])).toEqual([
      { kind: "text", value: "/" },
      { kind: "variable", name: "api_version" },
    ]);
  });

  it("merges adjacent text segments when compacting path parts", () => {
    const parts = compactPathParts([
      { kind: "text", value: "/a/" },
      { kind: "variable", name: "v" },
      { kind: "text", value: "" },
      { kind: "text", value: "/b" },
    ]);
    expect(parts).toEqual([
      { kind: "text", value: "/a/" },
      { kind: "variable", name: "v" },
      { kind: "text", value: "/b" },
    ]);
    expect(joinPath(parts)).toBe("/a/{{v}}/b");
  });

  it("removes a token without leaving a double slash", () => {
    const parts = removePathPart(
      [
        { kind: "text", value: "/contacts/" },
        { kind: "variable", name: "api_version" },
        { kind: "text", value: "/notes" },
      ],
      1,
    );
    expect(joinPath(parts)).toBe("/contacts/notes");
  });
});

describe("structured JSON compile and infer", () => {
  it("stores Fixed strings and raw JSON literals", () => {
    expect(
      compileStructuredJson([
        { key: "label", origin: "fixed", value: "hello" },
        { key: "limit", origin: "fixed", value: "10" },
        { key: "ok", origin: "fixed", value: "true" },
        { key: "empty", origin: "fixed", value: "null" },
      ]),
    ).toBe('{"label":"hello","limit":10,"ok":true,"empty":null}');
  });

  it("quotes Variable and string Agent values, leaves typed Agent bare", () => {
    expect(
      compileStructuredJson([
        {
          key: "token",
          origin: "variable",
          name: "api_token",
          prefix: "Bearer ",
        },
        {
          key: "q",
          origin: "agent",
          name: "search",
          type: "string",
          required: true,
        },
        {
          key: "count",
          origin: "agent",
          name: "limit",
          type: "number",
          required: true,
        },
      ]),
    ).toBe(
      '{"token":"Bearer {{api_token}}","q":"{{search}}","count":{{limit}}}',
    );
  });

  it("detects nested JSON as not flat", () => {
    expect(isFlatJsonTemplate('{"user":{"id":1}}')).toBe(false);
    expect(isFlatJsonTemplate('{"ids":[1,2]}')).toBe(false);
    expect(isFlatJsonTemplate('{"n": {{count}}, "ok": true}')).toBe(true);
  });

  it("infers prefixed Variable and bare Agent number from stored JSON", () => {
    const rows = inferJsonRows(
      '{"Authorization":"Bearer {{api_token}}","count":{{limit}}}',
      ["api_token"],
      params([
        {
          name: "limit",
          description: "Page size",
          type: "number",
          required: true,
        },
      ]),
    );
    expect(rows).toEqual([
      {
        key: "Authorization",
        origin: "variable",
        name: "api_token",
        prefix: "Bearer ",
      },
      {
        key: "count",
        origin: "agent",
        name: "limit",
        description: "Page size",
        type: "number",
        required: true,
      },
    ]);
  });
});

describe("compileFormBody", () => {
  it("keeps placeholders unencoded so the engine can resolve them", () => {
    expect(
      compileFormBody([
        {
          key: "locationId",
          origin: "agent",
          name: "location_id",
          type: "string",
          required: true,
        },
        { key: "note", origin: "fixed", value: "hello world" },
      ]),
    ).toBe("locationId={{location_id}}&note=hello%20world");
  });

  it("round-trips a prefixed Variable through inferFormRows", () => {
    const stored = compileFormBody([
      {
        key: "Authorization",
        origin: "variable",
        name: "api_token",
        prefix: "Bearer ",
      },
    ]);
    expect(inferFormRows(stored, ["api_token"])).toEqual([
      {
        key: "Authorization",
        origin: "variable",
        name: "api_token",
        prefix: "Bearer ",
      },
    ]);
  });
});

describe("slugifyAgentName", () => {
  it("turns camelCase keys into snake_case agent names", () => {
    expect(slugifyAgentName("locationId")).toBe("location_id");
  });
});

describe("templateReferencesName", () => {
  it("matches only exact placeholder names", () => {
    expect(templateReferencesName("api", "Bearer {{api_token}}")).toBe(false);
    expect(templateReferencesName("api_token", "Bearer {{api_token}}")).toBe(
      true,
    );
  });

  it("aggregates templates without substring false positives", () => {
    expect(
      templatesReferenceName("api", ["Bearer {{api_token}}", "{{region}}"]),
    ).toBe(false);
    expect(templatesReferenceName("api_token", ["Bearer {{api_token}}"])).toBe(
      true,
    );
  });
});

describe("agent input format", () => {
  it("preserves format through defaults and collection", () => {
    const meta: AgentMeta = {
      name: "email",
      description: "Email address",
      type: "string",
      format: "email",
      required: true,
    };

    expect(defaultAgentMeta("email", meta).format).toBe("email");
    expect(collectAgentParams([{ origin: "agent", ...meta }])).toEqual([
      expect.objectContaining({ name: "email", format: "email" }),
    ]);
  });
});
