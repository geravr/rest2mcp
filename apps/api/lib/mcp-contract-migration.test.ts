import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { mcpTool } from "@repo/db";
import { assertCompileSuccess, compileToolDefinition } from "./mcp-compiler.js";
import { compileAgentToolContract } from "./mcp-contract.js";
import type { McpAgentInput } from "./mcp-request-definition.js";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../db/migrations", import.meta.url),
);

function allMigrationsSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
}

const input: McpAgentInput = {
  id: "ain_1",
  name: "q",
  description: "Search query.",
  required: true,
  sensitive: false,
  type: "string",
};

function planFor(agentInputs: McpAgentInput[]) {
  return assertCompileSuccess(
    compileToolDefinition({
      method: "GET",
      definition: {
        version: 2,
        pathSegments: [
          { id: "seg0", value: { kind: "literal", value: "/items" } },
        ],
        query: agentInputs.map((agentInput) => ({
          id: "query_0",
          name: agentInput.name,
          value: { kind: "agentInput", agentInputId: agentInput.id },
        })),
        headers: [],
        body: { bodyType: "none" },
        agentInputs,
      },
      common: { headers: [], query: [] },
      auth: null,
      serverValues: [],
      basePath: "/v1",
      allowMutation: false,
    }),
  );
}

describe("contract persistence migration", () => {
  it("adds a nullable product-tool title column through a generated migration", () => {
    expect(allMigrationsSql()).toContain(
      'ALTER TABLE "mcp_tool" ADD COLUMN "title" text;',
    );
    const columns = getTableColumns(mcpTool);
    expect(columns.title).toBeDefined();
    expect(columns.title.notNull).toBe(false);
  });

  it("treats an incomplete enabled tool as unavailable until copy is authored", () => {
    const incomplete = compileAgentToolContract({
      name: "list_items",
      title: null,
      description: null,
      method: "GET",
      plan: planFor([{ ...input, description: undefined }]),
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.contract).toBeNull();
    expect(incomplete.issues.some((issue) => issue.path === "title")).toBe(
      true,
    );
    expect(
      incomplete.issues.some((issue) => issue.path === "description"),
    ).toBe(true);
    expect(
      incomplete.issues.some((issue) => issue.path === "agentInputs.q"),
    ).toBe(true);
  });

  it("becomes available once explicit copy is supplied", () => {
    const complete = compileAgentToolContract({
      name: "list_items",
      title: "List items",
      description: "List upstream items.",
      method: "GET",
      plan: planFor([input]),
    });
    expect(complete.ok).toBe(true);
    expect(complete.contract?.fingerprint).toMatch(/^sha256:/);
  });
});
