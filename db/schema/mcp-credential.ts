import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";

export const mcpCredential = pgTable(
  "mcp_credential",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mcr")),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" })
      .unique(),
    /** "bearer" | "api_key" | "header" */
    scheme: text().notNull(),
    headerName: text(),
    /** "header" | "query" */
    valueLocation: text().notNull(),
    ciphertext: text().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("mcp_credential_server_id_idx").on(table.serverId)],
);

export type McpCredential = typeof mcpCredential.$inferSelect;
export type NewMcpCredential = typeof mcpCredential.$inferInsert;
