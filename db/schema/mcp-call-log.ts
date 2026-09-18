import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";
import { mcpTool } from "./mcp-tool";
import { user } from "./user";

export const mcpCallLog = pgTable(
  "mcp_call_log",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mcl")),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    serverId: text().references(() => mcpServer.id, { onDelete: "set null" }),
    toolId: text().references(() => mcpTool.id, { onDelete: "set null" }),
    /** "playground" | "agent" | "platform" */
    source: text().notNull(),
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
  ],
);

export type McpCallLog = typeof mcpCallLog.$inferSelect;
export type NewMcpCallLog = typeof mcpCallLog.$inferInsert;
