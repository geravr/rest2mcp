import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";
import { user } from "./user";

/** "read" | "author" | "invoke" | "secret_reference" | "destructive" */
export type McpPlatformScopeRow =
  "read" | "author" | "invoke" | "secret_reference" | "destructive";

export const mcpAgentToken = pgTable(
  "mcp_agent_token",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mtk")),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    serverId: text().references(() => mcpServer.id, { onDelete: "cascade" }),
    /** "server" | "platform" */
    kind: text().notNull(),
    name: text().notNull(),
    tokenHash: text().notNull(),
    prefix: text().notNull(),
    /** Platform-token scopes; nullable for legacy tokens issued before scoping. */
    scopes: jsonb().$type<McpPlatformScopeRow[]>(),
    /** Successor token id when this Platform PAT was rotated (lineage metadata). */
    replacedByTokenId: text().references((): AnyPgColumn => mcpAgentToken.id, {
      onDelete: "set null",
    }),
    /** Safe, non-secret rotation metadata (e.g. reason/label); never token material. */
    rotationMeta: jsonb().$type<Record<string, unknown>>(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }),
    revokedAt: timestamp({ withTimezone: true, mode: "date" }),
    lastUsedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("mcp_agent_token_user_id_idx").on(table.userId),
    index("mcp_agent_token_server_id_idx").on(table.serverId),
    index("mcp_agent_token_token_hash_idx").on(table.tokenHash),
    unique("mcp_agent_token_hash_unique").on(table.tokenHash),
    // Multiple platform PATs may stay active; names only need to be unique
    // among non-revoked platform tokens so rotation cannot create two
    // same-named actives. Server tokens keep their free-form names.
    uniqueIndex("mcp_agent_token_active_name_unique")
      .on(table.userId, table.kind, table.name)
      .where(sql`${table.kind} = 'platform' and ${table.revokedAt} is null`),
  ],
);

export type McpAgentToken = typeof mcpAgentToken.$inferSelect;
export type NewMcpAgentToken = typeof mcpAgentToken.$inferInsert;
