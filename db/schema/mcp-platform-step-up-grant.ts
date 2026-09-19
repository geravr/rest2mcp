import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { user } from "./user";

/**
 * Session-bound, expiring, single-use Platform step-up approval. The
 * `fingerprint` binds the approval to the exact canonical scope/resource grant
 * it authorizes so it cannot be replayed for broader access.
 */
export const mcpPlatformStepUpGrant = pgTable(
  "mcp_platform_step_up_grant",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("psg")),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sessionId: text().notNull(),
    fingerprint: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("mcp_platform_step_up_grant_user_id_idx").on(table.userId),
    index("mcp_platform_step_up_grant_session_id_idx").on(table.sessionId),
    index("mcp_platform_step_up_grant_expires_at_idx").on(table.expiresAt),
  ],
);

export type McpPlatformStepUpGrant = typeof mcpPlatformStepUpGrant.$inferSelect;
export type NewMcpPlatformStepUpGrant =
  typeof mcpPlatformStepUpGrant.$inferInsert;
