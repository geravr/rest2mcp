import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GATEWAY_PATH = join(API_ROOT, "lib", "mcp-gateway.ts");
const EXECUTOR_PATH = join(API_ROOT, "services", "mcp-executor-service.ts");

const DRAFT_RUNTIME_HELPERS = [
  "loadDraftExecutionSnapshot",
  "compilePlanForTool",
  "loadToolCompileInputs",
  "loadServerValues",
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

/** Extracts a function body by brace matching from its declaration. */
function functionBody(source: string, name: string): string {
  const declaration = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b`,
  );
  const match = declaration.exec(source);
  if (!match) throw new Error(`Function ${name} was not found.`);
  const open = source.indexOf("{", match.index);
  if (open === -1) throw new Error(`Function ${name} has no body.`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`Function ${name} body was not terminated.`);
}

function references(source: string, identifier: string): boolean {
  return new RegExp(`\\b${identifier}\\b`).test(source);
}

describe("published runtime architecture boundaries", () => {
  const gateway = readFileSync(GATEWAY_PATH, "utf8");
  const executor = readFileSync(EXECUTOR_PATH, "utf8");

  it("keeps the gateway free of mutable draft loaders", () => {
    const offenders = DRAFT_RUNTIME_HELPERS.filter((helper) =>
      references(gateway, helper),
    );
    expect(offenders).toEqual([]);
    expect(references(gateway, "mcpTool")).toBe(false);
  });

  it("keeps the published snapshot loader off mutable rows", () => {
    const body = functionBody(executor, "loadExecutionSnapshot");
    const offenders = DRAFT_RUNTIME_HELPERS.filter((helper) =>
      references(body, helper),
    );
    expect(offenders).toEqual([]);
    expect(body.includes(".from(mcpTool)")).toBe(false);
  });

  it("keeps published materialization off the draft compiler and mutable rows", () => {
    const body = functionBody(executor, "materializePublishedSnapshot");
    const offenders = DRAFT_RUNTIME_HELPERS.filter((helper) =>
      references(body, helper),
    );
    expect(offenders).toEqual([]);
    expect(body.includes(".from(mcpTool)")).toBe(false);
  });

  it("allows the owner-playground draft loader only inside executeMappedTool", () => {
    for (const file of productionSources(API_ROOT)) {
      const content = readFileSync(file, "utf8");
      if (!references(content, "loadDraftExecutionSnapshot")) continue;
      expect(relative(API_ROOT, file)).toBe(
        join("services", "mcp-executor-service.ts"),
      );
    }
    const loaderBody = functionBody(executor, "loadExecutionSnapshot");
    expect(references(loaderBody, "loadDraftExecutionSnapshot")).toBe(false);
    const executorBody = functionBody(executor, "executeMappedTool");
    expect(references(executorBody, "loadDraftExecutionSnapshot")).toBe(true);
  });
});
