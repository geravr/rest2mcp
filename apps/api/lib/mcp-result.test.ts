import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { appError } from "./app-error.js";
import {
  buildMcpToolResult,
  errorEnvelope,
  invalidArgumentsEnvelope,
  internalErrorEnvelope,
  isRetryableFailure,
  mcpToolEnvelopeSchema,
  toMcpToolError,
  upstreamHttpToolError,
  zodErrorToIssues,
} from "./mcp-result.js";

describe("toMcpToolError", () => {
  it("maps policy failures to non-retryable", () => {
    const error = toMcpToolError(
      appError({
        appCode: APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
        message: "Mutations are not allowed.",
        status: 403,
      }),
    );
    expect(error).toMatchObject({
      category: "policy",
      code: APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
      retryable: false,
    });
  });

  it("maps rate limits to retryable with a delay", () => {
    const error = toMcpToolError(
      appError({
        appCode: APP_ERROR_CODES.MCP_RATE_LIMITED,
        message: "Too many requests.",
        status: 429,
        details: { retryAfterSeconds: 12 },
      }),
    );
    expect(error).toMatchObject({
      category: "rate_limit",
      retryable: true,
      retryAfterSeconds: 12,
    });
  });

  it("marks an indeterminate mutation as not safe to retry", () => {
    const error = toMcpToolError(
      appError({
        appCode: APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE,
        message: "The mutation may have completed.",
        status: 504,
      }),
      { indeterminate: true },
    );
    expect(error).toMatchObject({
      indeterminate: true,
      retryable: false,
    });
  });

  it("exposes missing scopes as an issue without revealing existence", () => {
    const error = toMcpToolError(
      appError({
        appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
        message:
          "This operation is not permitted with the current token scopes.",
        status: 403,
        details: { scopes: ["secret_reference"] },
      }),
    );
    expect(error.category).toBe("policy");
    expect(error.issues?.[0]).toMatchObject({
      path: "scope",
      code: APP_ERROR_CODES.MCP_SCOPE_DENIED,
    });
  });
});

describe("upstreamHttpToolError", () => {
  it("maps 401 to auth and 429 to a retryable rate limit", () => {
    expect(upstreamHttpToolError(401, { method: "GET" })).toMatchObject({
      category: "auth",
      retryable: false,
    });
    expect(
      upstreamHttpToolError(429, { method: "GET", retryAfterSeconds: 3 }),
    ).toMatchObject({
      category: "rate_limit",
      retryable: true,
      retryAfterSeconds: 3,
    });
  });

  it("only retries upstream 500 for idempotent reads", () => {
    expect(upstreamHttpToolError(500, { method: "POST" }).retryable).toBe(
      false,
    );
    expect(upstreamHttpToolError(500, { method: "GET" }).retryable).toBe(true);
  });

  it("marks a completed timeout on a mutation as indeterminate and non-retryable", () => {
    expect(upstreamHttpToolError(504, { method: "POST" })).toMatchObject({
      category: "timeout",
      retryable: false,
      indeterminate: true,
    });
    expect(upstreamHttpToolError(504, { method: "GET" })).toMatchObject({
      category: "timeout",
      retryable: true,
    });
  });
});

describe("isRetryableFailure", () => {
  it("defaults to non-retryable", () => {
    expect(isRetryableFailure("policy")).toBe(false);
    expect(isRetryableFailure("invalid_arguments")).toBe(false);
    expect(isRetryableFailure("internal")).toBe(false);
    expect(isRetryableFailure("upstream", { idempotent: true })).toBe(true);
    expect(
      isRetryableFailure("upstream", { idempotent: true, indeterminate: true }),
    ).toBe(false);
  });
});

describe("argument diagnostics", () => {
  it("normalizes Zod issues to corrective paths without echoing values", () => {
    const schema = z.object({ contact_id: z.number() }).strict();
    const parsed = schema.safeParse({ contact_id: "abc" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = zodErrorToIssues(
      parsed.error,
      new Map([["contact_id", "ain_1"]]),
    );
    expect(issues[0]).toMatchObject({
      path: "contact_id",
      id: "ain_1",
      code: APP_ERROR_CODES.INVALID_INPUT,
    });
    expect(JSON.stringify(issues)).not.toContain("abc");

    const envelope = invalidArgumentsEnvelope(
      parsed.error,
      new Map([["contact_id", "ain_1"]]),
    );
    expect(envelope.error).toMatchObject({
      category: "invalid_arguments",
      retryable: false,
    });
  });
});

describe("buildMcpToolResult", () => {
  it("serializes content text and structuredContent from the same envelope", () => {
    const envelope = {
      ok: true,
      status: 200,
      contentType: "application/json",
      headers: {},
      truncated: false,
      data: { hello: "world" },
    };
    const result = buildMcpToolResult(envelope);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(envelope);
    expect(JSON.parse(result.content[0]!.text)).toEqual(envelope);
  });

  it("marks error envelopes as isError", () => {
    const result = buildMcpToolResult(internalErrorEnvelope());
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { category: "internal", retryable: false },
    });
  });

  it("emits the schema projection so undeclared fields never reach the agent", () => {
    const validator = z.strictObject({
      ok: z.literal(true),
      status: z.number().int().nullable(),
      contentType: z.string().nullable(),
      headers: z.record(z.string(), z.string()),
      truncated: z.boolean(),
      data: z.object({ id: z.string() }).optional(),
    });
    const result = buildMcpToolResult(
      {
        ok: true,
        status: 200,
        contentType: null,
        headers: {},
        truncated: false,
        data: { id: "mct_1", requestTemplate: { secret: "leak" } },
      },
      { validator: validator as unknown as z.ZodType<Record<string, unknown>> },
    );
    expect(result.structuredContent.data).toEqual({ id: "mct_1" });
    expect(JSON.stringify(result.structuredContent)).not.toContain("leak");
  });

  it("falls back to a schema-valid internal error and reports the defect", () => {
    const onDefect = vi.fn();
    const invalid = {
      ...errorEnvelope({
        category: "internal",
        code: APP_ERROR_CODES.INTERNAL_ERROR,
        message: "bad",
        retryable: false,
      }),
      unexpected: true,
    };
    const result = buildMcpToolResult(invalid, { onDefect });
    expect(onDefect).toHaveBeenCalled();
    expect(
      mcpToolEnvelopeSchema.safeParse(result.structuredContent).success,
    ).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { category: "internal" },
    });
  });
});
