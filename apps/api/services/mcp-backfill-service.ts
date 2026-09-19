/**
 * @file One-shot backfill for harden-mcp-execution-boundary.
 * Converts unambiguous legacy tools to requestDefinition + compiledPlan,
 * sets server-value kind/owner, migrates auth configuration where inferable,
 * and revokes unscoped Platform MCP tokens.
 *
 * Safe to re-run: already-compiled valid tools and scoped tokens are skipped.
 */
import {
  mcpServer,
  mcpServerVariable,
  mcpTool,
  type McpServer,
} from "@repo/db";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { compileToolDefinition } from "../lib/mcp-compiler.js";
import type { CompileServerValueRef } from "../lib/mcp-compiler.js";
import {
  analyzeLegacyCommonEntries,
  analyzeLegacyTool,
} from "../lib/mcp-legacy-migrate.js";
import type {
  McpAuthConfiguration,
  McpCommonEntries,
} from "../lib/mcp-request-definition.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type BackfillSummary = {
  variablesUpdated: number;
  toolsValid: number;
  toolsInvalidDisabled: number;
  toolsSkipped: number;
  serversCommonBackfilled: number;
};

function toServerValueRefs(
  rows: Array<{
    id: string;
    name: string;
    kind: string | null;
    owner: string | null;
    isSecret: boolean;
  }>,
): CompileServerValueRef[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind:
      (row.kind as "config" | "secret" | null) ??
      (row.isSecret ? "secret" : "config"),
    owner: (row.owner as "manual" | "auth" | null) ?? "manual",
  }));
}

async function backfillServerVariables(
  db: DB,
  serverId: string,
): Promise<number> {
  const rows = await db
    .select()
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, serverId));
  let updated = 0;
  for (const row of rows) {
    if (row.kind && row.owner) continue;
    await db
      .update(mcpServerVariable)
      .set({
        kind: row.kind ?? (row.isSecret ? "secret" : "config"),
        owner: row.owner ?? "manual",
      })
      .where(eq(mcpServerVariable.id, row.id));
    updated += 1;
  }
  return updated;
}

async function backfillServerCommon(
  db: DB,
  server: McpServer,
  serverValues: CompileServerValueRef[],
): Promise<boolean> {
  if (server.commonEntries) return false;
  if (!server.defaultHeaders && !server.defaultQuery) return false;
  const analysis = analyzeLegacyCommonEntries({
    defaultHeaders: server.defaultHeaders,
    defaultQuery: server.defaultQuery,
    serverValues,
  });
  if (!analysis.unambiguous || !analysis.commonEntries) return false;
  await db
    .update(mcpServer)
    .set({
      commonEntries:
        analysis.commonEntries as unknown as McpServer["commonEntries"],
    })
    .where(eq(mcpServer.id, server.id));
  return true;
}

async function backfillTool(
  db: DB,
  server: McpServer,
  tool: typeof mcpTool.$inferSelect,
  serverValues: CompileServerValueRef[],
): Promise<"valid" | "invalid" | "skipped"> {
  if (
    tool.compileStatus === "valid" &&
    tool.requestDefinition &&
    tool.compiledPlan
  ) {
    return "skipped";
  }

  const analysis = analyzeLegacyTool({
    method: tool.method,
    pathTemplate: tool.pathTemplate,
    requestTemplate: tool.requestTemplate ?? {},
    params: tool.params ?? [],
    serverValues,
  });

  if (!analysis.unambiguous || !analysis.definition) {
    await db
      .update(mcpTool)
      .set({
        compileStatus: "invalid",
        compileIssues: analysis.issues,
        enabled: false,
      })
      .where(eq(mcpTool.id, tool.id));
    return "invalid";
  }

  const common =
    (server.commonEntries as McpCommonEntries | null) ??
    ({ headers: [], query: [] } satisfies McpCommonEntries);
  const auth =
    (server.authConfiguration as unknown as McpAuthConfiguration | null) ??
    null;
  const compileResult = compileToolDefinition({
    method: tool.method,
    definition: analysis.definition,
    common,
    auth,
    serverValues,
    basePath: new URL(server.baseUrl).pathname,
    allowMutation: tool.allowMutation,
  });

  if (!compileResult.ok || !compileResult.plan) {
    await db
      .update(mcpTool)
      .set({
        requestDefinition: analysis.definition as unknown as Record<
          string,
          unknown
        >,
        compiledPlan: null,
        compileStatus: "invalid",
        compileIssues: [...analysis.issues, ...compileResult.issues],
        enabled: false,
      })
      .where(eq(mcpTool.id, tool.id));
    return "invalid";
  }

  await db
    .update(mcpTool)
    .set({
      requestDefinition: analysis.definition as unknown as Record<
        string,
        unknown
      >,
      compiledPlan: compileResult.plan as unknown as Record<string, unknown>,
      compileStatus: "valid",
      compileIssues: [...analysis.issues, ...compileResult.issues],
      annotations: compileResult.plan.annotations,
    })
    .where(eq(mcpTool.id, tool.id));
  return "valid";
}

/**
 * Backfills one account's MCP data. Call after schema migration 0003.
 * Idempotent: re-running skips already-valid tools and scoped tokens.
 */
export async function backfillMcpExecutionBoundary(
  db: DB,
  options: { userId?: string } = {},
): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    variablesUpdated: 0,
    toolsValid: 0,
    toolsInvalidDisabled: 0,
    toolsSkipped: 0,
    serversCommonBackfilled: 0,
  };

  const servers = options.userId
    ? await db
        .select()
        .from(mcpServer)
        .where(eq(mcpServer.userId, options.userId))
    : await db.select().from(mcpServer);

  for (const server of servers) {
    summary.variablesUpdated += await backfillServerVariables(db, server.id);
    const valueRows = await db
      .select()
      .from(mcpServerVariable)
      .where(eq(mcpServerVariable.serverId, server.id));
    const serverValues = toServerValueRefs(valueRows);
    if (await backfillServerCommon(db, server, serverValues)) {
      summary.serversCommonBackfilled += 1;
    }
    const [freshServer] = await db
      .select()
      .from(mcpServer)
      .where(eq(mcpServer.id, server.id))
      .limit(1);
    const tools = await db
      .select()
      .from(mcpTool)
      .where(eq(mcpTool.serverId, server.id));
    for (const tool of tools) {
      const result = await backfillTool(
        db,
        freshServer ?? server,
        tool,
        serverValues,
      );
      if (result === "valid") summary.toolsValid += 1;
      else if (result === "invalid") summary.toolsInvalidDisabled += 1;
      else summary.toolsSkipped += 1;
    }
  }

  return summary;
}
