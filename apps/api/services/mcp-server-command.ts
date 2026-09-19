/**
 * Server-scoped write command boundary.
 *
 * Every mutation of an existing MCP server aggregate runs through
 * `withOwnedServerWrite`. It owns the transaction, locks the owned server row,
 * enforces revision compare-and-swap, and increments `configRevision` exactly
 * once per committed command. Command callbacks receive only the transaction
 * handle (`tx`); they must never fall back to the global database client.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mcpServer, type McpServer } from "@repo/db";
import { APP_ERROR_CODES, AppError, appError } from "../lib/app-error.js";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
} from "../lib/mcp-telemetry.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

/** Database handle scoped to one aggregate command transaction. */
export type McpWriteTx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** A post-commit side effect (telemetry, object cleanup) buffered until commit. */
export type PostCommitHook = () => void | Promise<void>;

const MAX_TRANSACTION_ATTEMPTS = 3;

/** PostgreSQL SQLSTATEs documented as fully rolled back and safe to retry. */
const RETRYABLE_PG_CODES = new Set(["40001", "40003", "40P01"]);
const UNIQUE_VIOLATION_CODE = "23505";

export function pgErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION_CODE;
}

export function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof AppError) return false;
  const code = pgErrorCode(error);
  return code !== undefined && RETRYABLE_PG_CODES.has(code);
}

export type ServerWriteContext = {
  /** Transaction-scoped database handle; never the global client. */
  tx: McpWriteTx;
  /** Owned server row locked with `SELECT ... FOR UPDATE`. */
  server: McpServer;
  /** The matched expected revision. */
  revision: number;
  /** Buffer a side effect that runs only after the transaction commits. */
  onCommit: (hook: PostCommitHook) => void;
};

export type ServerWriteResult<T> = {
  result: T;
  /** The new committed revision. */
  revision: number;
  serverId: string;
};

/**
 * Translate low-level database failures into stable `AppError` codes without
 * leaking SQL text or row contents. Unknown errors pass through untouched.
 */
export function translateWriteError(
  error: unknown,
  serverId?: string,
): unknown {
  if (error instanceof AppError) return error;
  const code = pgErrorCode(error);
  if (code === "40001" || code === "40003" || code === "40P01") {
    return appError({
      appCode: APP_ERROR_CODES.MCP_TRANSIENT_WRITE_FAILURE,
      message:
        "The write failed after retries with no partial change. It is safe to retry.",
      status: 503,
      cause: error,
      details: { ...(serverId ? { serverId } : {}), retryable: true },
    });
  }
  if (code === UNIQUE_VIOLATION_CODE) {
    return appError({
      appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
      message: "A conflicting configuration already exists.",
      status: 409,
      cause: error,
      ...(serverId ? { details: { serverId } } : {}),
    });
  }
  return error;
}

/**
 * Run one server-scoped command inside a single transaction. Locks the owned
 * server, rejects stale revisions, retries only fully-rolled-back transient
 * database failures, and runs buffered hooks strictly after commit.
 */
export async function withOwnedServerWrite<T>(
  db: DB,
  input: { userId: string; serverId: string; expectedRevision: number },
  command: (ctx: ServerWriteContext) => Promise<T>,
  options: { finalizeRevision?: boolean } = {},
): Promise<ServerWriteResult<T>> {
  const finalizeRevision = options.finalizeRevision ?? true;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
      message: "The current server configuration revision is required.",
      status: 409,
      details: { serverId: input.serverId },
    });
  }

  for (let attempt = 1; ; attempt += 1) {
    const attemptStartedAt = Date.now();
    let lockWaitMs = 0;
    let committed:
      | {
          outcome: ServerWriteResult<T>;
          hooks: PostCommitHook[];
        }
      | undefined;

    try {
      committed = await db.transaction(async (tx) => {
        const lockStartedAt = Date.now();
        const [server] = await tx
          .select()
          .from(mcpServer)
          .where(
            and(
              eq(mcpServer.id, input.serverId),
              eq(mcpServer.userId, input.userId),
            ),
          )
          .for("update")
          .limit(1);
        lockWaitMs = Date.now() - lockStartedAt;

        if (!server) {
          throw appError({
            appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
            message: "MCP server not found.",
            status: 404,
          });
        }

        if (server.configRevision !== input.expectedRevision) {
          throw appError({
            appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
            message:
              "The server configuration changed elsewhere. Reload before retrying.",
            status: 409,
            details: {
              serverId: server.id,
              currentRevision: server.configRevision,
            },
          });
        }

        const hooks: PostCommitHook[] = [];
        const result = await command({
          tx,
          server,
          revision: input.expectedRevision,
          onCommit: (hook) => hooks.push(hook),
        });

        if (!finalizeRevision) {
          return {
            outcome: {
              result,
              revision: input.expectedRevision + 1,
              serverId: server.id,
            },
            hooks,
          };
        }

        const [updated] = await tx
          .update(mcpServer)
          .set({
            configRevision: input.expectedRevision + 1,
            updatedAt: new Date(),
          })
          .where(eq(mcpServer.id, server.id))
          .returning({ configRevision: mcpServer.configRevision });

        if (!updated) {
          throw appError({
            appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
            message: "MCP server not found.",
            status: 404,
          });
        }

        return {
          outcome: {
            result,
            revision: updated.configRevision,
            serverId: server.id,
          },
          hooks,
        };
      });
    } catch (error) {
      if (
        isRetryableTransactionError(error) &&
        attempt < MAX_TRANSACTION_ATTEMPTS
      ) {
        captureMcpTelemetry(MCP_TELEMETRY_EVENTS.aggregateRetry, {
          db,
          userId: input.userId,
          properties: { serverId: input.serverId, attempt },
        });
        continue;
      }
      const translated = translateWriteError(error, input.serverId);
      if (
        translated instanceof AppError &&
        translated.appCode === APP_ERROR_CODES.MCP_WRITE_CONFLICT
      ) {
        captureMcpTelemetry(MCP_TELEMETRY_EVENTS.aggregateConflict, {
          db,
          userId: input.userId,
          properties: {
            serverId: input.serverId,
            expectedRevision: input.expectedRevision,
            ...(translated.details?.currentRevision !== undefined
              ? { currentRevision: translated.details.currentRevision }
              : {}),
          },
        });
      }
      throw translated;
    }

    for (const hook of committed.hooks) {
      try {
        await hook();
      } catch {
        // Cleanup and telemetry must never fail a committed command.
      }
    }

    captureMcpTelemetry(MCP_TELEMETRY_EVENTS.aggregateWrite, {
      db,
      userId: input.userId,
      properties: {
        serverId: committed.outcome.serverId,
        attempts: attempt,
        lockWaitMs,
        durationMs: Date.now() - attemptStartedAt,
        revision: committed.outcome.revision,
      },
    });

    return committed.outcome;
  }
}
