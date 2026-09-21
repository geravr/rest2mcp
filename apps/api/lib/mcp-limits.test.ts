import { MCP_MAX_TOOLS_PER_SERVER_DEFAULT } from "@repo/core";
import { afterEach, describe, expect, it } from "vitest";
import { getMcpMaxToolsPerServer } from "./mcp-limits.js";

const original = process.env.MCP_MAX_TOOLS_PER_SERVER;

afterEach(() => {
  if (original === undefined) {
    delete process.env.MCP_MAX_TOOLS_PER_SERVER;
  } else {
    process.env.MCP_MAX_TOOLS_PER_SERVER = original;
  }
});

describe("getMcpMaxToolsPerServer", () => {
  it("returns the configured cap", () => {
    process.env.MCP_MAX_TOOLS_PER_SERVER = "7";

    expect(getMcpMaxToolsPerServer()).toBe(7);
  });

  it("falls back to the shared default when unset", () => {
    delete process.env.MCP_MAX_TOOLS_PER_SERVER;

    expect(getMcpMaxToolsPerServer()).toBe(MCP_MAX_TOOLS_PER_SERVER_DEFAULT);
  });

  it("falls back to the shared default when blank", () => {
    process.env.MCP_MAX_TOOLS_PER_SERVER = "";

    expect(getMcpMaxToolsPerServer()).toBe(MCP_MAX_TOOLS_PER_SERVER_DEFAULT);
  });
});
