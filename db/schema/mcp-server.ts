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

export type McpNamedEntryRow = {
  id: string;
  name: string;
  value: Record<string, unknown>;
  omitWhenAbsent?: boolean;
};

export type McpAuthConfigurationRow = {
  kind: "none" | "bearer" | "header" | "query" | "basic" | "custom";
  bindings: Array<{
    location: "header" | "query";
    key: string;
    serverValueId: string;
    prefix?: string;
    suffix?: string;
  }>;
  queryExposureAcknowledged?: boolean;
  basicUsernameValueId?: string;
  basicPasswordValueId?: string;
};

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
    /** User-uploaded icon URL from scoped storage, or null for automatic rings fallback. */
    iconImage: text(),
    baseUrl: text().notNull(),
    /** Hostnames allowed for upstream fetch. Default: host derived from baseUrl. */
    allowedHosts: jsonb().$type<string[]>().notNull(),
    /** Legacy template-aware headers; dual-written during migration. */
    defaultHeaders: jsonb().$type<Record<string, string>>(),
    /** Legacy template-aware query params; dual-written during migration. */
    defaultQuery: jsonb().$type<Record<string, string>>(),
    /** Explicit common header/query bindings (literal or server-value). */
    commonEntries: jsonb().$type<{
      headers: McpNamedEntryRow[];
      query: McpNamedEntryRow[];
    }>(),
    /** Explicit auth configuration referencing auth-owned secret value ids. */
    authConfiguration: jsonb().$type<McpAuthConfigurationRow>(),
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
