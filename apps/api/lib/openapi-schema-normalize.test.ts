import { describe, expect, it } from "vitest";
import { MCP_OPENAPI_ISSUE_CODES } from "@repo/core";
import {
  isLocallyResolvedUnion,
  normalizeOpenApiSchema,
  unionHasForbiddenTransport,
} from "./openapi-schema-normalize.js";

describe("normalizeOpenApiSchema", () => {
  it("unwraps a single-entry allOf", () => {
    const result = normalizeOpenApiSchema({
      allOf: [{ type: "string", minLength: 1 }],
    });
    expect(result).toEqual({
      ok: true,
      schema: { type: "string", minLength: 1 },
    });
  });

  it("merges compatible object allOf branches and unions required keys", () => {
    const result = normalizeOpenApiSchema({
      allOf: [
        {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
        },
        {
          type: "object",
          properties: { count: { type: "integer" } },
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schema).toMatchObject({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
      },
    });
    expect(result.schema.allOf).toBeUndefined();
  });

  it("blocks allOf branches that assign incompatible schemas to the same property", () => {
    const result = normalizeOpenApiSchema({
      allOf: [
        {
          type: "object",
          properties: { id: { type: "string" } },
        },
        {
          type: "object",
          properties: { id: { type: "number" } },
        },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      code: MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
    });
  });

  it("blocks contradictory composition without guessing", () => {
    const result = normalizeOpenApiSchema({
      allOf: [{ type: "string" }, { type: "integer" }],
    });
    expect(result).toMatchObject({
      ok: false,
      code: MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
    });
  });

  it("reports a cycle instead of looping", () => {
    const cyclic: Record<string, unknown> = { type: "object", properties: {} };
    (cyclic.properties as Record<string, unknown>).self = cyclic;
    const result = normalizeOpenApiSchema(cyclic);
    expect(result).toMatchObject({
      ok: false,
      code: MCP_OPENAPI_ISSUE_CODES.CYCLIC_REFERENCE,
    });
  });
});

describe("opaque union helpers", () => {
  it("accepts locally resolved oneOf branches", () => {
    expect(
      isLocallyResolvedUnion(
        { oneOf: [{ type: "string" }, { type: "integer" }] },
        "oneOf",
      ),
    ).toBe(true);
    expect(
      isLocallyResolvedUnion(
        { oneOf: [{ $ref: "#/components/schemas/A" }] },
        "oneOf",
      ),
    ).toBe(false);
  });

  it("flags forbidden transport in union branches", () => {
    expect(
      unionHasForbiddenTransport({
        oneOf: [{ type: "string", format: "binary" }],
      }),
    ).toBe(true);
    expect(
      unionHasForbiddenTransport({
        oneOf: [{ type: "string" }, { type: "object" }],
      }),
    ).toBe(false);
  });
});
