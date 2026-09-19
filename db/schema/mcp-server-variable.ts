import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
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
    /** "config" | "secret" */
    kind: text().notNull(),
    /** "manual" | "auth" */
    owner: text().notNull(),
    description: text(),
    /** Plaintext config storage; used only when kind is "config". */
    value: text(),
    /** AES-256-GCM secret storage; used only when kind is "secret". */
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
