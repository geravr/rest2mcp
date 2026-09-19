import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpAgentToken } from "./mcp-agent-token";
import { mcpServer } from "./mcp-server";
import { user } from "./user";

export const MCP_PLATFORM_SECURITY_EVENT_TYPES = [
  "token_issued",
  "token_rotated",
  "token_revoked",
  "scope_denied",
  "resource_denied",
  "step_up_failed",
  "destructive_action",
  "mutating_invocation",
] as const;

export type McpPlatformSecurityEventType =
  (typeof MCP_PLATFORM_SECURITY_EVENT_TYPES)[number];

export const MCP_PLATFORM_SECURITY_EVENT_OUTCOMES = [
  "success",
  "denied",
  "failure",
] as const;

export type McpPlatformSecurityEventOutcome =
  (typeof MCP_PLATFORM_SECURITY_EVENT_OUTCOMES)[number];

/**
 * Bounded, non-sensitive Platform security metadata. Writers validate this
 * shape and must never include tokens, headers, bodies, value ids, or secrets.
 */
export type McpPlatformSecurityEventMetadata = Record<
  string,
  string | number | boolean
>;

/**
 * Owner-scoped Platform security-event ledger. Retained for a bounded window
 * and inaccessible through Platform MCP.
 */
export const mcpPlatformSecurityEvent = pgTable(
  "mcp_platform_security_event",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("pse")),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenId: text().references(() => mcpAgentToken.id, {
      onDelete: "set null",
    }),
    tokenPrefix: text(),
    eventType: text().notNull().$type<McpPlatformSecurityEventType>(),
    outcome: text().notNull().$type<McpPlatformSecurityEventOutcome>(),
    scopes: jsonb().$type<string[]>(),
    serverId: text().references(() => mcpServer.id, {
      onDelete: "set null",
    }),
    metadata: jsonb().$type<McpPlatformSecurityEventMetadata>(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("mcp_platform_security_event_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("mcp_platform_security_event_created_idx").on(table.createdAt),
    index("mcp_platform_security_event_token_id_idx").on(table.tokenId),
    check(
      "mcp_platform_security_event_type_check",
      sql`${table.eventType} in (${sql.raw(
        MCP_PLATFORM_SECURITY_EVENT_TYPES.map((value) => `'${value}'`).join(
          ", ",
        ),
      )})`,
    ),
    check(
      "mcp_platform_security_event_outcome_check",
      sql`${table.outcome} in (${sql.raw(
        MCP_PLATFORM_SECURITY_EVENT_OUTCOMES.map((value) => `'${value}'`).join(
          ", ",
        ),
      )})`,
    ),
  ],
);

export type McpPlatformSecurityEvent =
  typeof mcpPlatformSecurityEvent.$inferSelect;
export type NewMcpPlatformSecurityEvent =
  typeof mcpPlatformSecurityEvent.$inferInsert;
