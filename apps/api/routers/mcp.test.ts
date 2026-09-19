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

  it("updates variables by stable id and canonical kind", () => {
    expect(source).toContain("updateVariable: protectedProcedure");
    expect(source).toMatch(
      /updateVariable:[\s\S]*?valueId:\s*z\.string\(\)\.min\(1\)/,
    );
    expect(source).toMatch(
      /updateVariable:[\s\S]*?kind:\s*z\.enum\(\["config",\s*"secret"\]\)\.optional\(\)/,
    );
  });

  it("creates variables with an explicit kind", () => {
    expect(source).toMatch(
      /createVariable:[\s\S]*?kind:\s*z\.enum\(\["config",\s*"secret"\]\)/,
    );
  });
});
