import { index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpAgentToken } from "./mcp-agent-token";

/** Canonical Platform scope names; values mirror `@repo/core`. */
export type McpPlatformTokenScopeRow =
  | "read"
  | "observe"
  | "author"
  | "publish"
  | "invoke"
  | "invoke_mutation"
  | "secret_reference"
  | "destructive";

/**
 * Normalized Platform PAT scopes. These rows are the only authoritative scope
 * storage; a PAT without a valid, dependency-closed scope row set fails closed.
 */
export const mcpPlatformTokenScope = pgTable(
  "mcp_platform_token_scope",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("pts")),
    tokenId: text()
      .notNull()
      .references(() => mcpAgentToken.id, { onDelete: "cascade" }),
    scope: text().notNull().$type<McpPlatformTokenScopeRow>(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("mcp_platform_token_scope_token_scope_unique").on(
      table.tokenId,
      table.scope,
    ),
    index("mcp_platform_token_scope_token_id_idx").on(table.tokenId),
  ],
);

export type McpPlatformTokenScope = typeof mcpPlatformTokenScope.$inferSelect;
export type NewMcpPlatformTokenScope =
  typeof mcpPlatformTokenScope.$inferInsert;
