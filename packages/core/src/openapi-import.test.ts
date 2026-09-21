import { describe, expect, it } from "vitest";
import {
  assertUniqueMcpOpenApiIssueCodes,
  MCP_OPENAPI_ISSUE_CODES,
  MCP_OPENAPI_LIMITS,
} from "./openapi-import.js";

describe("MCP_OPENAPI_LIMITS", () => {
  it("bounds documents by operation count and has no independent selection cap", () => {
    expect(MCP_OPENAPI_LIMITS.maxOperations).toBe(200);
    expect("maxSelection" in MCP_OPENAPI_LIMITS).toBe(false);
  });
});

describe("MCP_OPENAPI_ISSUE_CODES", () => {
  it("has unique values including composition and reduced-validation codes", () => {
    expect(() => assertUniqueMcpOpenApiIssueCodes()).not.toThrow();
    expect(MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT).toBe(
      "OPENAPI_COMPOSITION_CONFLICT",
    );
    expect(MCP_OPENAPI_ISSUE_CODES.REDUCED_VALIDATION).toBe(
      "OPENAPI_REDUCED_VALIDATION",
    );
  });
});
