/**
 * @file Platform PAT lifecycle: normalized, versioned, resource-bound tokens.
 *
 * Scope and resource grants are immutable; changing them requires rotation.
 * Lifecycle writes lock the owner row so active-token limits, same-name
 * issuance, rotation, and revocation serialize per owner without a singleton
 * active-token constraint.
 */
import {
  mcpAgentToken,
  mcpPlatformTokenScope,
  mcpPlatformTokenServerGrant,
  mcpServer,
  user,
} from "@repo/db";
import { and, count, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  isMcpPlatformResourceMode,
  MCP_MAX_ACTIVE_PLATFORM_TOKENS,
  type McpPlatformResourceMode,
  type McpPlatformScope,
  type Paginated,
  type PaginationInput,
  validatePlatformScopes,
} from "@repo/core";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import { generateAgentToken, hashAgentToken } from "../lib/mcp-agent-token.js";
import {
  buildPlatformPrincipal,
  invalidPlatformTokenError,
  isPlatformPrincipalPolicySupported,
  platformGrantTtlDays,
  validatePlatformGrantRequest,
  type PlatformPrincipal,
  type ValidatedPlatformGrant,
} from "../lib/mcp-platform-principal.js";
import { clearPlatformRateLimitState } from "../lib/mcp-rate-limit.js";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
} from "../lib/mcp-telemetry.js";
import { paginate } from "../lib/paginate.js";
import { isUserBanned } from "../lib/user-access.js";
import {
  isUniqueViolation,
  translateWriteError,
} from "./mcp-server-command.js";
import { recordPlatformSecurityEvent } from "./mcp-platform-security-event-service.js";
import { consumePlatformStepUpGrant } from "./mcp-platform-step-up-service.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;
type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Persist `lastUsedAt` at most once per window instead of on every request. */
export const MCP_PLATFORM_LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export type PlatformPatSummary = {
  id: string;
  name: string;
  prefix: string;
  policyVersion: number | null;
  scopes: McpPlatformScope[];
  resourceMode: McpPlatformResourceMode | null;
  selectedServerIds: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  replacesTokenId: string | null;
  replacedByTokenId: string | null;
};

export type CreatePlatformPatInput = {
  name: string;
  scopes: readonly string[];
  resourceMode: string;
  serverIds?: readonly string[];
  expiresInDays?: number;
  /** Authenticated first-party session id; required for high-risk step-up. */
  sessionId: string;
};

export type RotatePlatformPatInput = CreatePlatformPatInput & {
  tokenId: string;
};

export type CreatedPlatformPat = PlatformPatSummary & { token: string };

function isActiveRow(row: {
  revokedAt: Date | null;
  expiresAt: Date | null;
}): boolean {
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

function resolveTtl(
  grant: ValidatedPlatformGrant,
  requestedDays: number | undefined,
): number {
  const { defaultDays, maxDays } = platformGrantTtlDays(
    grant.scopes,
    grant.resourceMode,
  );
  if (requestedDays === undefined) return defaultDays;
  if (requestedDays > maxDays) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_POLICY_CONFLICT,
      message: `This Platform token grants high-risk or long-lived authority; the maximum lifetime is ${maxDays} days.`,
      status: 400,
      details: {
        policyVersion: grant.policyVersion,
        resourceMode: grant.resourceMode,
      },
    });
  }
  return requestedDays;
}

async function assertOwnedServers(
  tx: Tx,
  userId: string,
  serverIds: readonly string[],
): Promise<void> {
  if (serverIds.length === 0) return;
  const owned = await tx
    .select({ id: mcpServer.id })
    .from(mcpServer)
    .where(
      and(eq(mcpServer.userId, userId), inArray(mcpServer.id, [...serverIds])),
    );
  if (owned.length !== new Set(serverIds).size) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_RESOURCE_DENIED,
      message: "One or more selected servers are not available.",
      status: 403,
    });
  }
}

async function insertGrant(
  tx: Tx,
  input: {
    userId: string;
    name: string;
    grant: ValidatedPlatformGrant;
    expiresAt: Date;
    replacesTokenId: string | null;
  },
): Promise<{ row: typeof mcpAgentToken.$inferSelect; token: string }> {
  const generated = generateAgentToken();
  const [row] = await tx
    .insert(mcpAgentToken)
    .values({
      userId: input.userId,
      serverId: null,
      kind: "platform",
      name: input.name,
      tokenHash: generated.hash,
      prefix: generated.prefix,
      policyVersion: input.grant.policyVersion,
      resourceMode: input.grant.resourceMode,
      replacesTokenId: input.replacesTokenId,
      expiresAt: input.expiresAt,
      rotationMeta: input.replacesTokenId ? { operation: "rotation" } : null,
    })
    .returning();

  await tx.insert(mcpPlatformTokenScope).values(
    input.grant.scopes.map((scope) => ({
      tokenId: row.id,
      scope,
    })),
  );

  if (input.grant.resourceMode === "selected") {
    await tx.insert(mcpPlatformTokenServerGrant).values(
      input.grant.serverIds.map((serverId) => ({
        tokenId: row.id,
        serverId,
      })),
    );
  }

  return { row, token: generated.raw };
}

async function retireExpiredPlatformPats(
  tx: Tx,
  userId: string,
): Promise<void> {
  await tx
    .update(mcpAgentToken)
    .set({ revokedAt: new Date(), rotationMeta: { operation: "expired" } })
    .where(
      and(
        eq(mcpAgentToken.userId, userId),
        eq(mcpAgentToken.kind, "platform"),
        isNull(mcpAgentToken.revokedAt),
        lt(mcpAgentToken.expiresAt, new Date()),
      ),
    );
}

async function countActivePlatformPats(
  tx: Tx,
  userId: string,
  excludeTokenId?: string,
): Promise<number> {
  const rows = await tx
    .select({ id: mcpAgentToken.id })
    .from(mcpAgentToken)
    .where(
      and(
        eq(mcpAgentToken.userId, userId),
        eq(mcpAgentToken.kind, "platform"),
        isNull(mcpAgentToken.revokedAt),
        or(
          isNull(mcpAgentToken.expiresAt),
          gt(mcpAgentToken.expiresAt, new Date()),
        ),
      ),
    );
  return excludeTokenId
    ? rows.filter((row) => row.id !== excludeTokenId).length
    : rows.length;
}

async function maybeConsumeStepUp(
  tx: Tx,
  input: {
    grant: ValidatedPlatformGrant;
    userId: string;
    sessionId: string;
  },
): Promise<void> {
  if (!input.grant.highRisk) return;
  await consumePlatformStepUpGrant(tx, {
    userId: input.userId,
    sessionId: input.sessionId,
    fingerprint: input.grant.fingerprint,
  });
}

function summaryFromRow(
  row: typeof mcpAgentToken.$inferSelect,
  scopes: McpPlatformScope[],
  selectedServerIds: string[],
): PlatformPatSummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    policyVersion: row.policyVersion ?? null,
    scopes,
    resourceMode:
      row.resourceMode === "selected" || row.resourceMode === "account"
        ? row.resourceMode
        : null,
    selectedServerIds,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacesTokenId: row.replacesTokenId,
    replacedByTokenId: row.replacedByTokenId,
  };
}

async function loadSummaries(
  db: DB | Tx,
  tokenIds: string[],
): Promise<Map<string, { scopes: McpPlatformScope[]; serverIds: string[] }>> {
  const result = new Map<
    string,
    { scopes: McpPlatformScope[]; serverIds: string[] }
  >();
  for (const id of tokenIds) result.set(id, { scopes: [], serverIds: [] });
  if (tokenIds.length === 0) return result;

  const scopeRows = await (db as DB)
    .select({
      tokenId: mcpPlatformTokenScope.tokenId,
      scope: mcpPlatformTokenScope.scope,
    })
    .from(mcpPlatformTokenScope)
    .where(inArray(mcpPlatformTokenScope.tokenId, tokenIds));
  for (const row of scopeRows) {
    result.get(row.tokenId)?.scopes.push(row.scope as McpPlatformScope);
  }

  const grantRows = await (db as DB)
    .select({
      tokenId: mcpPlatformTokenServerGrant.tokenId,
      serverId: mcpPlatformTokenServerGrant.serverId,
    })
    .from(mcpPlatformTokenServerGrant)
    .where(inArray(mcpPlatformTokenServerGrant.tokenId, tokenIds));
  for (const row of grantRows) {
    result.get(row.tokenId)?.serverIds.push(row.serverId);
  }
  return result;
}

/**
 * Owner-scoped Platform PAT inventory: active and recently revoked tokens with
 * scopes, safe prefix, resource mode, selected-server count, and rotation
 * relationships. Never returns a raw token.
 */
export async function listPlatformPats(
  db: DB,
  userId: string,
  input: PaginationInput,
): Promise<Paginated<PlatformPatSummary>> {
  const where = and(
    eq(mcpAgentToken.userId, userId),
    eq(mcpAgentToken.kind, "platform"),
  );
  const page = await paginate({
    page: input.page,
    pageSize: input.pageSize,
    list: (offset, limit) =>
      db
        .select()
        .from(mcpAgentToken)
        .where(where)
        .orderBy(desc(mcpAgentToken.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ count: count() })
        .from(mcpAgentToken)
        .where(where);
      return row?.count ?? 0;
    },
  });

  const grants = await loadSummaries(
    db,
    page.items.map((row) => row.id),
  );
  captureMcpTelemetry(MCP_TELEMETRY_EVENTS.platformTokenInventory, {
    db,
    userId,
    properties: {
      total: page.total,
      active: page.items.filter((row) => row.revokedAt === null).length,
    },
  });
  return {
    ...page,
    items: page.items.map((row) => {
      const grant = grants.get(row.id) ?? { scopes: [], serverIds: [] };
      return summaryFromRow(row, grant.scopes, grant.serverIds);
    }),
  };
}

async function createOrRotate(
  db: DB,
  userId: string,
  input: CreatePlatformPatInput & { replacesTokenId: string | null },
): Promise<CreatedPlatformPat> {
  const name = input.name.trim();
  if (!name) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "A Platform token name is required.",
      status: 400,
    });
  }
  const grant = validatePlatformGrantRequest({
    scopes: input.scopes,
    resourceMode: input.resourceMode,
    serverIds: input.serverIds,
  });
  const ttlDays = resolveTtl(grant, input.expiresInDays);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  let rotatedPredecessorId: string | null = null;
  try {
    const created = await db.transaction(async (tx) => {
      await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for("update")
        .limit(1);

      await retireExpiredPlatformPats(tx, userId);

      let predecessorId: string | null = null;
      if (input.replacesTokenId) {
        const [observed] = await tx
          .select()
          .from(mcpAgentToken)
          .where(
            and(
              eq(mcpAgentToken.id, input.replacesTokenId),
              eq(mcpAgentToken.userId, userId),
              eq(mcpAgentToken.kind, "platform"),
            ),
          )
          .limit(1);
        if (!observed || !isActiveRow(observed)) {
          throw appError({
            appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
            message:
              "The selected Platform token is no longer active. Reload and retry.",
            status: 409,
            details: { retryable: false },
          });
        }
        predecessorId = observed.id;
        rotatedPredecessorId = observed.id;
      }

      const activeCount = await countActivePlatformPats(
        tx,
        userId,
        predecessorId ?? undefined,
      );
      if (activeCount >= MCP_MAX_ACTIVE_PLATFORM_TOKENS) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_PAT_LIMIT_REACHED,
          message: `A user cannot have more than ${MCP_MAX_ACTIVE_PLATFORM_TOKENS} active Platform tokens.`,
          status: 400,
        });
      }

      await assertOwnedServers(tx, userId, grant.serverIds);
      await maybeConsumeStepUp(tx, {
        grant,
        userId,
        sessionId: input.sessionId,
      });

      // Revoke the predecessor first so its name slot is released before the
      // successor insert; the whole change still rolls back as one unit.
      if (predecessorId) {
        await tx
          .update(mcpAgentToken)
          .set({
            revokedAt: new Date(),
            rotationMeta: { operation: "rotated" },
          })
          .where(eq(mcpAgentToken.id, predecessorId));
      }

      const { row, token } = await insertGrant(tx, {
        userId,
        name,
        grant,
        expiresAt,
        replacesTokenId: predecessorId,
      });

      if (predecessorId) {
        await tx
          .update(mcpAgentToken)
          .set({ replacedByTokenId: row.id })
          .where(eq(mcpAgentToken.id, predecessorId));
      }

      await recordPlatformSecurityEvent(tx, {
        userId,
        eventType: predecessorId ? "token_rotated" : "token_issued",
        outcome: "success",
        tokenId: row.id,
        tokenPrefix: row.prefix,
        scopes: grant.scopes,
        metadata: {
          operation: predecessorId ? "rotate" : "create",
          policy_version: grant.policyVersion,
          resource_mode: grant.resourceMode,
          count: grant.serverIds.length,
        },
      });

      return { row, token, grant };
    });

    if (rotatedPredecessorId) {
      clearPlatformRateLimitState(rotatedPredecessorId);
    }
    if (created.grant.highRisk) {
      captureMcpTelemetry(MCP_TELEMETRY_EVENTS.platformHighRiskGrant, {
        db,
        userId,
        properties: {
          resourceMode: created.grant.resourceMode,
          scopeCount: created.grant.scopes.length,
        },
      });
    }
    return {
      ...summaryFromRow(
        created.row,
        created.grant.scopes,
        created.grant.serverIds,
      ),
      token: created.token,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
        message:
          "An active Platform token with this name already exists. Choose another name.",
        status: 409,
        cause: error,
        details: { retryable: false },
      });
    }
    throw translateWriteError(error);
  }
}

export async function createPlatformPat(
  db: DB,
  userId: string,
  input: CreatePlatformPatInput,
): Promise<CreatedPlatformPat> {
  return createOrRotate(db, userId, { ...input, replacesTokenId: null });
}

/** Rotates only the selected active PAT, atomically replacing its grants. */
export async function rotatePlatformPat(
  db: DB,
  userId: string,
  input: RotatePlatformPatInput,
): Promise<CreatedPlatformPat> {
  return createOrRotate(db, userId, {
    ...input,
    replacesTokenId: input.tokenId,
  });
}

/** Revokes exactly one owned active Platform PAT under the owner-row lock. */
export async function revokePlatformPat(
  db: DB,
  userId: string,
  tokenId: string,
): Promise<{ id: string; revoked: true }> {
  const revoked = await db.transaction(async (tx) => {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update")
      .limit(1);

    const [row] = await tx
      .update(mcpAgentToken)
      .set({ revokedAt: new Date(), rotationMeta: { operation: "revoked" } })
      .where(
        and(
          eq(mcpAgentToken.id, tokenId),
          eq(mcpAgentToken.userId, userId),
          eq(mcpAgentToken.kind, "platform"),
          isNull(mcpAgentToken.revokedAt),
        ),
      )
      .returning({
        id: mcpAgentToken.id,
        prefix: mcpAgentToken.prefix,
      });

    if (!row) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
        message: "Platform token not found.",
        status: 404,
      });
    }

    await recordPlatformSecurityEvent(tx, {
      userId,
      eventType: "token_revoked",
      outcome: "success",
      tokenId: row.id,
      tokenPrefix: row.prefix,
      metadata: { operation: "revoke" },
    });

    return row;
  });

  clearPlatformRateLimitState(revoked.id);
  return { id: revoked.id, revoked: true };
}

/**
 * Authenticates a Platform PAT against normalized authoritative storage and
 * returns an immutable principal. Every malformed/unknown/expired/revoked state
 * fails uniformly; server gateway tokens are rejected by audience.
 */
export async function authenticatePlatformPat(
  db: DB,
  rawToken: string,
): Promise<PlatformPrincipal> {
  const tokenHash = hashAgentToken(rawToken);
  const [token] = await db
    .select()
    .from(mcpAgentToken)
    .where(eq(mcpAgentToken.tokenHash, tokenHash))
    .limit(1);

  if (!token || token.kind !== "platform" || !isActiveRow(token)) {
    // Revoked/expired tokens release their in-memory limiter state.
    if (token) clearPlatformRateLimitState(token.id);
    throw invalidPlatformTokenError();
  }
  if (
    token.policyVersion === null ||
    !isPlatformPrincipalPolicySupported(token.policyVersion) ||
    token.resourceMode === null
  ) {
    throw invalidPlatformTokenError();
  }

  if (!isMcpPlatformResourceMode(token.resourceMode)) {
    throw invalidPlatformTokenError();
  }

  const scopeRows = await db
    .select({ scope: mcpPlatformTokenScope.scope })
    .from(mcpPlatformTokenScope)
    .where(eq(mcpPlatformTokenScope.tokenId, token.id));
  const scopeValidation = validatePlatformScopes(
    scopeRows.map((row) => row.scope),
  );
  if (!scopeValidation.ok || scopeRows.length === 0) {
    throw invalidPlatformTokenError();
  }

  const grantRows = await db
    .select({ serverId: mcpPlatformTokenServerGrant.serverId })
    .from(mcpPlatformTokenServerGrant)
    .where(eq(mcpPlatformTokenServerGrant.tokenId, token.id));
  const allowedServerIds = grantRows.map((row) => row.serverId);

  // Resource-mode consistency: `selected` needs non-empty grants and `account`
  // must not carry selected rows. Never fall back to account-wide access.
  if (token.resourceMode === "selected" && allowedServerIds.length === 0) {
    throw invalidPlatformTokenError();
  }
  if (token.resourceMode === "account" && allowedServerIds.length > 0) {
    throw invalidPlatformTokenError();
  }

  if (await isUserBanned(db, token.userId)) {
    throw appError({
      appCode: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
      message: "Your account has been suspended.",
      status: 403,
    });
  }

  const cutoff = new Date(Date.now() - MCP_PLATFORM_LAST_USED_THROTTLE_MS);
  await db
    .update(mcpAgentToken)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(mcpAgentToken.id, token.id),
        or(
          isNull(mcpAgentToken.lastUsedAt),
          lt(mcpAgentToken.lastUsedAt, cutoff),
        ),
      ),
    );

  return buildPlatformPrincipal({
    tokenId: token.id,
    userId: token.userId,
    tokenName: token.name,
    tokenPrefix: token.prefix,
    policyVersion: token.policyVersion,
    scopes: scopeValidation.scopes,
    resourceMode: token.resourceMode,
    allowedServerIds,
    expiresAt: token.expiresAt,
  });
}
