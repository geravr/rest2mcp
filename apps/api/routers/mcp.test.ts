import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mcp router lifecycle procedures", () => {
  const source = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");

  it("exposes server and tool delete procedures", () => {
    expect(source).toContain("deleteServer: protectedProcedure");
    expect(source).toContain("deleteTool: protectedProcedure");
  });

  it("exposes the curl dry-run preview and the connectivity probe", () => {
    expect(source).toContain("parseCurlPreview: protectedProcedure");
    expect(source).toContain("testConnection: protectedProcedure");
  });

  it("accepts value markings on curl imports", () => {
    expect(source).toContain("markings");
    expect(source).toMatch(/as:\s*z\.enum\(\["param", "variable"\]\)/);
  });
});
