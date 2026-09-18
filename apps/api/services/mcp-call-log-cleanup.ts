/**
 * @file Call-log retention cleanup for MCP observability.
 */
import { mcpCallLog } from "@repo/db";
import { lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { MCP_CALL_LOG_RETENTION_DAYS } from "../lib/mcp-policy.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

/**
 * Deletes call-log rows older than the configured retention window.
 * Account/server deletion already cascades or nulls FKs; this job only ages out history.
 */
export async function cleanupExpiredCallLogs(
  db: DB,
  retentionDays = MCP_CALL_LOG_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(mcpCallLog)
    .where(lt(mcpCallLog.createdAt, cutoff))
    .returning({ id: mcpCallLog.id });
  return deleted.length;
}
