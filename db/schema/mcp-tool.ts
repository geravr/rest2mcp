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

export type McpBodyType = "json" | "form" | "raw";

export type McpRequestTemplate = {
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string | null;
  bodyType?: McpBodyType;
};

export type McpToolParamType = "string" | "number" | "boolean" | "json";

export type McpToolParam = {
  name: string;
  description?: string;
  required: boolean;
  type: McpToolParamType;
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
    /** Request template (query/headers/body) with {{placeholder}} interpolation. */
    requestTemplate: jsonb().$type<McpRequestTemplate>(),
    /** Declared agent params used to derive the gateway input schema. */
    params: jsonb().$type<McpToolParam[]>(),
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
