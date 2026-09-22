import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("mcp router lifecycle procedures", () => {
  const source = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");

  it("exposes server and tool delete procedures", () => {
    expect(source).toContain("deleteServer: protectedProcedure");
    expect(source).toContain("deleteTools: protectedProcedure");
  });

  it("exposes the curl dry-run preview and the connectivity probe", () => {
    expect(source).toContain("parseCurlPreview: protectedProcedure");
    expect(source).toContain("testConnection: protectedProcedure");
  });

  it("uses the shared safe curl-import command schema for value markings", () => {
    expect(source).toContain("createToolFromCurl: protectedProcedure");
    expect(source).toMatch(
      /createToolFromCurl:[\s\S]*?studioCurlConfirmCommandSchema/,
    );
  });

  it("keeps Studio-only group placement derived from the shared authoring schemas", () => {
    // The Studio schemas may only ADD group placement; they must not restate the
    // shared limits, so the Platform contract and Studio stay in lockstep.
    const studio = readFileSync(
      new URL("../lib/mcp-studio-commands.ts", import.meta.url),
      "utf8",
    );
    expect(studio).toMatch(
      /studioCurlConfirmCommandSchema\s*=\s*curlConfirmCommandSchema\.extend/,
    );
    expect(studio).toMatch(
      /studioCreateToolCommandSchema\s*=\s*createToolCommandSchema\.extend/,
    );
  });

  it("keeps group placement out of the shared Platform authoring schemas", () => {
    const shared = readFileSync(
      new URL("../lib/mcp-domain-commands.ts", import.meta.url),
      "utf8",
    );
    const create = shared.slice(
      shared.indexOf("export const createToolCommandSchema"),
      shared.indexOf("export const updateToolCommandSchema"),
    );
    const curl = shared.slice(
      shared.indexOf("export const curlConfirmCommandSchema"),
      shared.indexOf("export const platformPatGrantInputSchema"),
    );
    expect(create).not.toContain("groupId");
    expect(curl).not.toContain("groupId");
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
