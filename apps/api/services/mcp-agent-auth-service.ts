/**
 * @file Server-scoped gateway token authentication.
 *
 * Platform PAT authentication lives in `mcp-platform-token-service.ts`; each
 * path validates only its own audience and authoritative storage.
 */
import { mcpAgentToken } from "@repo/db";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import { hashAgentToken } from "../lib/mcp-agent-token.js";
import { isUserBanned } from "../lib/user-access.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export async function authenticateServerToken(
  db: DB,
  rawToken: string,
  serverId: string,
) {
  const tokenHash = hashAgentToken(rawToken);
  const [token] = await db
    .select()
    .from(mcpAgentToken)
    .where(eq(mcpAgentToken.tokenHash, tokenHash))
    .limit(1);

  const reject = (): never => {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
      message: "Agent token is invalid.",
      status: 401,
    });
  };

  if (!token || token.revokedAt) reject();
  if (token.expiresAt && token.expiresAt.getTime() < Date.now()) reject();
  if (token.kind !== "server" || token.serverId !== serverId) reject();
  if (await isUserBanned(db, token.userId)) {
    throw appError({
      appCode: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
      message: "Your account has been suspended.",
      status: 403,
    });
  }

  await db
    .update(mcpAgentToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpAgentToken.id, token.id));

  return token;
}
