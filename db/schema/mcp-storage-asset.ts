import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { user } from "./user";

/** Durable lifecycle of an object-storage asset owned by one user. */
export type McpStorageAssetState =
  "staging" | "ready" | "attached" | "delete_pending" | "deleted";

export const mcpStorageAsset = pgTable(
  "mcp_storage_asset",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("msa")),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Object key under the owner scope, e.g. `users/{userId}/server-icons/...`. */
    objectKey: text().notNull(),
    /** Stable consumer purpose, e.g. `server_icon`. */
    purpose: text().default("server_icon").notNull(),
    state: text().$type<McpStorageAssetState>().default("staging").notNull(),
    contentType: text(),
    byteSize: integer(),
    /**
     * Non-secret descriptive metadata only; never credential material. Durable
     * cleanup stores bounded retry counters here so failures stay retryable.
     */
    metadata: jsonb().$type<Record<string, unknown>>(),
    /** GC deadline for unattached staging/ready assets; null once attached. */
    expiresAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("mcp_storage_asset_object_key_unique").on(table.objectKey),
    index("mcp_storage_asset_user_id_idx").on(table.userId),
    index("mcp_storage_asset_state_idx").on(table.state),
    index("mcp_storage_asset_expires_at_idx").on(table.expiresAt),
    check(
      "mcp_storage_asset_state_check",
      sql`${table.state} in ('staging', 'ready', 'attached', 'delete_pending', 'deleted')`,
    ),
  ],
);

export type McpStorageAsset = typeof mcpStorageAsset.$inferSelect;
export type NewMcpStorageAsset = typeof mcpStorageAsset.$inferInsert;
