import { describe, expect, it } from "vitest";
import {
  MCP_MAX_TOOLS_PER_SERVER_BOUNDS,
  MCP_MAX_TOOLS_PER_SERVER_DEFAULT,
} from "./mcp-limits.js";

describe("MCP_MAX_TOOLS_PER_SERVER_DEFAULT", () => {
  it("falls inside the accepted configured range", () => {
    expect(MCP_MAX_TOOLS_PER_SERVER_DEFAULT).toBeGreaterThanOrEqual(
      MCP_MAX_TOOLS_PER_SERVER_BOUNDS.min,
    );
    expect(MCP_MAX_TOOLS_PER_SERVER_DEFAULT).toBeLessThanOrEqual(
      MCP_MAX_TOOLS_PER_SERVER_BOUNDS.max,
    );
  });
});
