import { sql } from "drizzle-orm";
import {
  index,
  integer,
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
    /** "server" | "platform" — distinct credential audiences. */
    kind: text().notNull(),
    name: text().notNull(),
    tokenHash: text().notNull(),
    prefix: text().notNull(),
    /**
     * Platform PAT policy version. Authoritative scope/resource storage lives
     * in normalized grant rows; a version mismatch invalidates the PAT.
     */
    policyVersion: integer(),
    /** "selected" | "account" (Platform PATs only). */
    resourceMode: text(),
    /** Predecessor PAT id when this Platform PAT replaced another by rotation. */
    replacesTokenId: text().references((): AnyPgColumn => mcpAgentToken.id, {
      onDelete: "set null",
    }),
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
    // Owner inventory (active + recently revoked Platform PATs).
    index("mcp_agent_token_platform_owner_idx")
      .on(table.userId, table.kind, table.revokedAt)
      .where(sql`${table.kind} = 'platform'`),
    // Expiration cleanup and revocation queries.
    index("mcp_agent_token_expires_at_idx").on(table.expiresAt),
  ],
);

export type McpAgentToken = typeof mcpAgentToken.$inferSelect;
export type NewMcpAgentToken = typeof mcpAgentToken.$inferInsert;
