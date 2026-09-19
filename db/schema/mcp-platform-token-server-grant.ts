import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpAgentToken } from "./mcp-agent-token";
import { mcpServer } from "./mcp-server";

/**
 * Immutable selected-server grants for a `selected`-mode Platform PAT. A PAT
 * either has no rows (account-wide) or a non-empty set of owned server ids;
 * cascading deletion of a server removes its grant without promoting the PAT
 * to account-wide mode.
 */
export const mcpPlatformTokenServerGrant = pgTable(
  "mcp_platform_token_server_grant",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("ptg")),
    tokenId: text()
      .notNull()
      .references(() => mcpAgentToken.id, { onDelete: "cascade" }),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("mcp_platform_token_server_grant_token_server_unique").on(
      table.tokenId,
      table.serverId,
    ),
    index("mcp_platform_token_server_grant_token_id_idx").on(table.tokenId),
    index("mcp_platform_token_server_grant_server_id_idx").on(table.serverId),
  ],
);

export type McpPlatformTokenServerGrant =
  typeof mcpPlatformTokenServerGrant.$inferSelect;
export type NewMcpPlatformTokenServerGrant =
  typeof mcpPlatformTokenServerGrant.$inferInsert;
