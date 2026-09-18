import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";

export const mcpServerVariable = pgTable(
  "mcp_server_variable",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("msv")),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
    /** [a-z][a-z0-9_]*, unique per server. */
    name: text().notNull(),
    /** Legacy boolean; prefer `kind`. Kept for rollback readers. */
    isSecret: boolean().notNull().default(false),
    /** "config" | "secret" — nullable during compatibility backfill. */
    kind: text(),
    /** "manual" | "auth" — nullable during compatibility backfill. */
    owner: text(),
    description: text(),
    /** Plaintext value when kind/config (or legacy isSecret=false). */
    value: text(),
    /** AES-256-GCM envelope when kind/secret (or legacy isSecret=true). */
    ciphertext: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("mcp_server_variable_server_name_unique").on(
      table.serverId,
      table.name,
    ),
    index("mcp_server_variable_server_id_idx").on(table.serverId),
  ],
);

export type McpServerVariable = typeof mcpServerVariable.$inferSelect;
export type NewMcpServerVariable = typeof mcpServerVariable.$inferInsert;
