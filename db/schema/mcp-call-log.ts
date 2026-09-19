import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";
import { user } from "./user";

export const mcpCallLog = pgTable(
  "mcp_call_log",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mcl")),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    serverId: text().references(() => mcpServer.id, { onDelete: "set null" }),
    /**
     * Denormalized draft tool id for attribution. Deliberately not a foreign
     * key: a draft tool row may be deleted after publication while historical
     * call attribution must survive.
     */
    toolId: text(),
    /** "playground" | "agent" | "platform" */
    source: text().notNull(),
    /** Active published revision id; null for draft-playground calls. */
    publishedRevisionId: text(),
    /** Denormalized revision number so attribution survives revision cleanup. */
    revisionNumber: integer(),
    /** Denormalized aggregate contract fingerprint of the pinned revision. */
    aggregateFingerprint: text(),
    /** Denormalized per-tool contract fingerprint used by this call. */
    toolFingerprint: text(),
    /** "published" | "draft"; distinguishes draft-preview testing. */
    revisionMode: text(),
    /** Observed draft revision for draft-preview calls. */
    draftRevision: integer(),
    status: text().notNull(),
    httpStatus: integer(),
    durationMs: integer(),
    appCode: text(),
    /** Execution phase when the outcome was recorded. */
    phase: text(),
    /** "success" | "upstream_error" | "policy" | "timeout" | "indeterminate" */
    outcome: text(),
    requestSummary: text(),
    responseSummary: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("mcp_call_log_user_id_idx").on(table.userId),
    index("mcp_call_log_server_id_idx").on(table.serverId),
    index("mcp_call_log_tool_id_idx").on(table.toolId),
    index("mcp_call_log_created_at_idx").on(table.createdAt),
    index("mcp_call_log_revision_idx").on(table.serverId, table.revisionNumber),
    index("mcp_call_log_published_revision_idx").on(table.publishedRevisionId),
  ],
);

export type McpCallLog = typeof mcpCallLog.$inferSelect;
export type NewMcpCallLog = typeof mcpCallLog.$inferInsert;
