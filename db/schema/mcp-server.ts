import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { user } from "./user";

export const mcpServer = pgTable(
  "mcp_server",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mcs")),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    description: text(),
    baseUrl: text().notNull(),
    /** Hostnames allowed for upstream fetch. Default: host derived from baseUrl. */
    allowedHosts: jsonb().$type<string[]>().notNull(),
    /** Template-aware headers applied to every tool call; tool headers win on conflict. */
    defaultHeaders: jsonb().$type<Record<string, string>>(),
    /** Template-aware query params applied to every tool call; tool query wins on conflict. */
    defaultQuery: jsonb().$type<Record<string, string>>(),
    /** "draft" | "live" | "paused" */
    status: text().default("draft").notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("mcp_server_user_slug_unique").on(table.userId, table.slug),
    index("mcp_server_user_id_idx").on(table.userId),
    index("mcp_server_status_idx").on(table.status),
  ],
);

export type McpServer = typeof mcpServer.$inferSelect;
export type NewMcpServer = typeof mcpServer.$inferInsert;
