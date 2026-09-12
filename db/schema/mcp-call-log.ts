import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";
import { mcpTool } from "./mcp-tool";

export const mcpCallLog = pgTable(
  "mcp_call_log",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mcl")),
    serverId: text().references(() => mcpServer.id, { onDelete: "set null" }),
    toolId: text().references(() => mcpTool.id, { onDelete: "set null" }),
    /** "playground" | "agent" | "platform" */
    source: text().notNull(),
    status: text().notNull(),
    httpStatus: integer(),
    durationMs: integer(),
    appCode: text(),
    requestSummary: text(),
    responseSummary: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("mcp_call_log_server_id_idx").on(table.serverId),
    index("mcp_call_log_tool_id_idx").on(table.toolId),
    index("mcp_call_log_created_at_idx").on(table.createdAt),
  ],
);

export type McpCallLog = typeof mcpCallLog.$inferSelect;
export type NewMcpCallLog = typeof mcpCallLog.$inferInsert;
