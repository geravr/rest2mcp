import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_ROOT = fileURLToPath(new URL("..", import.meta.url));

const SUPERSEDED_HELPERS = [
  "jsonToolResult",
  "jsonToolError",
  "structuredToolResult",
  "structuredToolError",
  "deriveInputSchema",
  "mcpExecutionEnvelopeSchema",
  "McpExecutionEnvelope",
];

const IGNORED_DIRS = new Set(["dist", "node_modules", ".turbo"]);

function productionSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...productionSources(full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    if (entry.endsWith(".test.ts") || entry.endsWith(".d.ts")) continue;
    files.push(full);
  }
  return files;
}

describe("MCP architecture boundaries", () => {
  it("has no production imports of superseded result or schema helpers", () => {
    const offenders: Array<{ file: string; helper: string }> = [];
    for (const file of productionSources(API_ROOT)) {
      const content = readFileSync(file, "utf8");
      for (const helper of SUPERSEDED_HELPERS) {
        const pattern = new RegExp(`\\b${helper}\\b`);
        if (pattern.test(content)) {
          offenders.push({ file: relative(API_ROOT, file), helper });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
