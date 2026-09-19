import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";

/**
 * Studio-only organization for draft tools. Groups are a bounded presentation
 * projection: they never enter publication candidates, immutable revisions,
 * agent contracts, or runtime execution, so a group-only change can never
 * change what connected agents observe.
 *
 * Tools are grouped one-to-one (see `mcpTool.groupId`), and every group belongs
 * to exactly one server.
 */
export const mcpToolGroup = pgTable(
  "mcp_tool_group",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mtg")),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
    /** Owner-facing display name; preserved exactly as written. */
    name: text().notNull(),
    /** Folded display name; unique per server and used for conflict checks. */
    normalizedName: text().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("mcp_tool_group_server_normalized_name_unique").on(
      table.serverId,
      table.normalizedName,
    ),
    /**
     * Referenced by the composite tool membership foreign key so a tool can
     * only ever point at a group of its own server.
     */
    unique("mcp_tool_group_id_server_unique").on(table.id, table.serverId),
    index("mcp_tool_group_server_id_idx").on(table.serverId),
  ],
);

export type McpToolGroup = typeof mcpToolGroup.$inferSelect;
export type NewMcpToolGroup = typeof mcpToolGroup.$inferInsert;
