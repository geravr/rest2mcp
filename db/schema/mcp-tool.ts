import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";

export type McpParamMap = {
  path?: Record<string, string>;
  query?: Record<string, string>;
  header?: Record<string, string>;
  body?: Record<string, string> | string[] | null;
  staticQuery?: Record<string, string>;
  staticHeaders?: Record<string, string>;
  staticBody?: string | null;
};

export const mcpTool = pgTable(
  "mcp_tool",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mct")),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
    name: text().notNull(),
    description: text(),
    method: text().notNull(),
    pathTemplate: text().notNull(),
    paramMap: jsonb().$type<McpParamMap>().notNull(),
    allowMutation: boolean().notNull().default(false),
    enabled: boolean().notNull().default(true),
    /** "manual" | "curl" */
    source: text().default("manual").notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("mcp_tool_server_name_unique").on(table.serverId, table.name),
    index("mcp_tool_server_id_idx").on(table.serverId),
  ],
);

export type McpTool = typeof mcpTool.$inferSelect;
export type NewMcpTool = typeof mcpTool.$inferInsert;
