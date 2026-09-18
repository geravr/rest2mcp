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

  it("uses the shared safe curl-import command schema for value markings", () => {
    expect(source).toContain("createToolFromCurl: protectedProcedure");
    expect(source).toMatch(
      /createToolFromCurl:[\s\S]*?curlConfirmCommandSchema/,
    );
  });

  it("accepts optional isSecret on updateVariable", () => {
    expect(source).toContain("updateVariable: protectedProcedure");
    expect(source).toMatch(
      /updateVariable:[\s\S]*?isSecret:\s*z\.boolean\(\)\.optional\(\)/,
    );
    expect(source).toMatch(
      /updateVariable:[\s\S]*?value:\s*z\.string\(\)\.max\(8_000\)\.optional\(\)/,
    );
  });
});
