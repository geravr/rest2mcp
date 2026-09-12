import { describe, expect, it } from "vitest";
import {
  extractBearerToken,
  generateAgentToken,
  hashAgentToken,
  verifyAgentToken,
} from "./mcp-agent-token.js";

describe("mcp-agent-token", () => {
  it("generates a raw token, hash, and display prefix", () => {
    const token = generateAgentToken();

    expect(token.raw.startsWith("rmcp_")).toBe(true);
    expect(token.raw).not.toBe(token.hash);
    expect(token.prefix).toBe(token.raw.slice(0, 12));
    expect(token.hash).toBe(hashAgentToken(token.raw));
  });

  it("verifies the generated token and rejects a different one", () => {
    const token = generateAgentToken();
    const other = generateAgentToken();

    expect(verifyAgentToken(token.raw, token.hash)).toBe(true);
    expect(verifyAgentToken(other.raw, token.hash)).toBe(false);
    expect(verifyAgentToken(token.raw, "abcd")).toBe(false);
  });

  it("extracts a Bearer token and ignores other schemes", () => {
    expect(extractBearerToken("Bearer abc.def")).toBe("abc.def");
    expect(extractBearerToken("bearer abc.def")).toBe("abc.def");
    expect(extractBearerToken("Basic abc")).toBeNull();
    expect(extractBearerToken(null)).toBeNull();
  });
});
