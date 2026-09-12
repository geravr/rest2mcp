import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
    /** "server" | "platform" */
    kind: text().notNull(),
    name: text().notNull(),
    tokenHash: text().notNull(),
    prefix: text().notNull(),
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
  ],
);

export type McpAgentToken = typeof mcpAgentToken.$inferSelect;
export type NewMcpAgentToken = typeof mcpAgentToken.$inferInsert;
