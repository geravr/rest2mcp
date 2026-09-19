/**
 * @file Typed, secret-safe Platform security-event writers.
 *
 * Events record identity, outcome, public scope names, and bounded
 * non-sensitive metadata only. Raw tokens, authorization headers, request
 * arguments or bodies, server-value ids, secret metadata, ciphertext, and
 * decrypted values are rejected before persistence.
 */
import {
  mcpPlatformSecurityEvent,
  type McpPlatformSecurityEventMetadata,
  type McpPlatformSecurityEventOutcome,
  type McpPlatformSecurityEventType,
} from "@repo/db";
import { count, desc, eq, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Paginated, PaginationInput } from "@repo/core";
import { MCP_PLATFORM_SECURITY_EVENT_RETENTION_DAYS } from "@repo/core";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
} from "../lib/mcp-telemetry.js";
import { paginate } from "../lib/paginate.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type EventDb = DB | Tx;

const FORBIDDEN_METADATA_KEY_PATTERN =
  /(token|secret|value|body|header|argument|credential|ciphertext|prefix|resource)/i;
const METADATA_STRING_MAX = 120;

/** Allowlisted metadata keys; anything else is dropped or rejected. */
const ALLOWED_METADATA_KEYS = new Set([
  "reason",
  "operation",
  "scope",
  "tool",
  "method",
  "upstream_status",
  "resource_type",
  "policy_version",
  "resource_mode",
  "count",
  "outcome_code",
]);

export type PlatformSecurityEventInput = {
  userId: string;
  eventType: McpPlatformSecurityEventType;
  outcome: McpPlatformSecurityEventOutcome;
  tokenId?: string | null;
  tokenPrefix?: string | null;
  serverId?: string | null;
  scopes?: readonly string[] | null;
  metadata?: Record<string, unknown> | null;
};

export class ForbiddenSecurityEventMetadataError extends Error {
  constructor(key: string) {
    super(`Forbidden Platform security-event metadata key: "${key}".`);
    this.name = "ForbiddenSecurityEventMetadataError";
  }
}

/**
 * Validates and bounds event metadata. Unknown non-sensitive keys are dropped;
 * explicitly sensitive or unbounded keys throw so a caller cannot persist them.
 */
export function sanitizePlatformSecurityEventMetadata(
  metadata: Record<string, unknown> | null | undefined,
): McpPlatformSecurityEventMetadata | null {
  if (!metadata) return null;
  const result: McpPlatformSecurityEventMetadata = {};
  for (const [key, raw] of Object.entries(metadata)) {
    if (raw === undefined || raw === null) continue;
    // Allowlisted safe keys are accepted even when their name contains a
    // forbidden substring (e.g. `resource_mode`). Unknown keys that look
    // sensitive are rejected rather than silently dropped.
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      if (FORBIDDEN_METADATA_KEY_PATTERN.test(key)) {
        throw new ForbiddenSecurityEventMetadataError(key);
      }
      continue;
    }
    if (typeof raw === "number") {
      if (Number.isFinite(raw)) result[key] = raw;
      continue;
    }
    if (typeof raw === "boolean") {
      result[key] = raw;
      continue;
    }
    if (typeof raw === "string") {
      if (raw.length > METADATA_STRING_MAX) {
        throw new ForbiddenSecurityEventMetadataError(key);
      }
      result[key] = raw;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function buildRow(input: PlatformSecurityEventInput) {
  return {
    userId: input.userId,
    eventType: input.eventType,
    outcome: input.outcome,
    tokenId: input.tokenId ?? null,
    tokenPrefix: input.tokenPrefix ?? null,
    serverId: input.serverId ?? null,
    scopes: input.scopes ? [...input.scopes] : null,
    metadata: sanitizePlatformSecurityEventMetadata(input.metadata),
  };
}

/**
 * Persists an event inside the caller's transaction; failures propagate so
 * lifecycle operations roll back rather than commit an unaudited grant change.
 */
export async function recordPlatformSecurityEvent(
  tx: EventDb,
  input: PlatformSecurityEventInput,
): Promise<void> {
  await (tx as DB).insert(mcpPlatformSecurityEvent).values(buildRow(input));
}

/**
 * Best-effort runtime audit. Persistence failure is reported through
 * secret-safe telemetry and never changes the already-determined outcome.
 */
export async function recordPlatformSecurityEventBestEffort(
  db: DB,
  input: PlatformSecurityEventInput,
): Promise<void> {
  try {
    await recordPlatformSecurityEvent(db, input);
  } catch {
    captureMcpTelemetry(MCP_TELEMETRY_EVENTS.securityEventPersistFailed, {
      db,
      userId: input.userId,
      properties: {
        eventType: input.eventType,
        outcome: input.outcome,
      },
    });
  }
}

export type PlatformSecurityEventSummary = {
  id: string;
  eventType: McpPlatformSecurityEventType;
  outcome: McpPlatformSecurityEventOutcome;
  scopes: string[] | null;
  serverId: string | null;
  tokenPrefix: string | null;
  createdAt: Date;
};

export async function listPlatformSecurityEvents(
  db: DB,
  userId: string,
  input: PaginationInput,
): Promise<Paginated<PlatformSecurityEventSummary>> {
  const where = eq(mcpPlatformSecurityEvent.userId, userId);
  return paginate({
    page: input.page,
    pageSize: input.pageSize,
    list: (offset, limit) =>
      db
        .select({
          id: mcpPlatformSecurityEvent.id,
          eventType: mcpPlatformSecurityEvent.eventType,
          outcome: mcpPlatformSecurityEvent.outcome,
          scopes: mcpPlatformSecurityEvent.scopes,
          serverId: mcpPlatformSecurityEvent.serverId,
          tokenPrefix: mcpPlatformSecurityEvent.tokenPrefix,
          createdAt: mcpPlatformSecurityEvent.createdAt,
        })
        .from(mcpPlatformSecurityEvent)
        .where(where)
        .orderBy(desc(mcpPlatformSecurityEvent.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ count: count() })
        .from(mcpPlatformSecurityEvent)
        .where(where);
      return row?.count ?? 0;
    },
  });
}

/** Deletes events older than the retention window; never touches PATs. */
export async function cleanupExpiredPlatformSecurityEvents(
  db: DB,
  retentionDays: number = MCP_PLATFORM_SECURITY_EVENT_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(mcpPlatformSecurityEvent)
    .where(lt(mcpPlatformSecurityEvent.createdAt, cutoff))
    .returning({ id: mcpPlatformSecurityEvent.id });
  return deleted.length;
}
