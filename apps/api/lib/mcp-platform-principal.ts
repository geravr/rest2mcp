/**
 * @file Platform PAT grant validation and the immutable Platform principal.
 *
 * A Platform PAT's authority is the intersection of its policy version, its
 * normalized scope rows, and its immutable resource boundary. Every failure
 * mode (unknown policy, malformed composition, missing grant rows, expired or
 * revoked token) fails closed as the same invalid-token contract; no alternate
 * scope representation is consulted.
 */
import { createHash } from "node:crypto";
import {
  APP_ERROR_CODES,
  canonicalPlatformGrant,
  defaultPlatformTtlDays,
  isHighRiskPlatformGrant,
  isMcpPlatformResourceMode,
  maxPlatformTtlDays,
  MCP_MAX_ACTIVE_PLATFORM_TOKENS,
  MCP_PLATFORM_POLICY_VERSION,
  MCP_PLATFORM_SUPPORTED_POLICY_VERSIONS,
  sortPlatformScopes,
  validatePlatformScopes,
  type McpPlatformResourceMode,
  type McpPlatformScope,
} from "@repo/core";
import { appError } from "./app-error.js";

export { MCP_MAX_ACTIVE_PLATFORM_TOKENS };

/** Immutable, validated authorization identity for one Platform MCP request. */
export type PlatformPrincipal = {
  readonly tokenId: string;
  readonly userId: string;
  readonly tokenName: string;
  readonly tokenPrefix: string;
  readonly policyVersion: number;
  readonly scopes: readonly McpPlatformScope[];
  readonly resourceMode: McpPlatformResourceMode;
  /** Non-empty for `selected`; empty for `account`. */
  readonly allowedServerIds: readonly string[];
  readonly expiresAt: Date | null;
};

export type PlatformGrantRequest = {
  scopes: unknown;
  resourceMode: unknown;
  serverIds?: unknown;
};

export type ValidatedPlatformGrant = {
  scopes: McpPlatformScope[];
  resourceMode: McpPlatformResourceMode;
  serverIds: string[];
  highRisk: boolean;
  fingerprint: string;
  policyVersion: number;
};

/** Uniform invalid-credential error: never distinguishes the failure reason. */
export function invalidPlatformTokenError(cause?: unknown) {
  return appError({
    appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    message: "Agent token is invalid.",
    status: 401,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function platformGrantFingerprint(input: {
  policyVersion: number;
  scopes: readonly McpPlatformScope[];
  resourceMode: McpPlatformResourceMode;
  serverIds: readonly string[];
}): string {
  const canonical = canonicalPlatformGrant({
    policyVersion: input.policyVersion,
    scopes: input.scopes,
    resourceMode: input.resourceMode,
    serverIds: input.serverIds,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

/**
 * Validates a requested grant into a canonical form, enforcing the scope
 * dependency graph and the resource-mode/server-set invariant. Throws a stable
 * `MCP_PAT_SCOPE_INVALID` / `MCP_POLICY_CONFLICT` error with safe details.
 */
export function validatePlatformGrantRequest(
  request: PlatformGrantRequest,
  policyVersion: number = MCP_PLATFORM_POLICY_VERSION,
): ValidatedPlatformGrant {
  const scopeInput = Array.isArray(request.scopes) ? request.scopes : [];
  const validation = validatePlatformScopes(scopeInput.map(String));
  if (!validation.ok) {
    const failure = validation.failure;
    throw appError({
      appCode: APP_ERROR_CODES.MCP_PAT_SCOPE_INVALID,
      message:
        failure.reason === "missing_dependency"
          ? `Scope "${failure.scope}" requires "${failure.requires}".`
          : "The requested Platform token scopes are invalid.",
      status: 400,
      details: {
        policyVersion,
        ...(failure.reason === "missing_dependency"
          ? { scopes: [failure.requires] }
          : {}),
      },
    });
  }

  if (!isMcpPlatformResourceMode(request.resourceMode)) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_POLICY_CONFLICT,
      message: "A valid Platform resource mode is required.",
      status: 400,
      details: { policyVersion },
    });
  }
  const resourceMode = request.resourceMode;

  const serverIds = Array.isArray(request.serverIds)
    ? [
        ...new Set(
          request.serverIds.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
        ),
      ]
    : [];

  if (resourceMode === "selected" && serverIds.length === 0) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_POLICY_CONFLICT,
      message: "A selected-server token requires at least one server.",
      status: 400,
      details: { resourceMode, policyVersion },
    });
  }
  if (resourceMode === "account" && serverIds.length > 0) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_POLICY_CONFLICT,
      message: "An account-wide token cannot declare selected servers.",
      status: 400,
      details: { resourceMode, policyVersion },
    });
  }

  const scopes = sortPlatformScopes(validation.scopes);
  return {
    scopes,
    resourceMode,
    serverIds,
    highRisk: isHighRiskPlatformGrant(scopes, resourceMode),
    fingerprint: platformGrantFingerprint({
      policyVersion,
      scopes,
      resourceMode,
      serverIds,
    }),
    policyVersion,
  };
}

export function platformGrantTtlDays(
  scopes: readonly McpPlatformScope[],
  resourceMode: McpPlatformResourceMode,
): { defaultDays: number; maxDays: number } {
  return {
    defaultDays: defaultPlatformTtlDays(scopes, resourceMode),
    maxDays: maxPlatformTtlDays(scopes, resourceMode),
  };
}

/** Builds a frozen principal from already-validated persisted grant state. */
export function buildPlatformPrincipal(input: {
  tokenId: string;
  userId: string;
  tokenName: string;
  tokenPrefix: string;
  policyVersion: number;
  scopes: readonly McpPlatformScope[];
  resourceMode: McpPlatformResourceMode;
  allowedServerIds: readonly string[];
  expiresAt: Date | null;
}): PlatformPrincipal {
  return Object.freeze({
    tokenId: input.tokenId,
    userId: input.userId,
    tokenName: input.tokenName,
    tokenPrefix: input.tokenPrefix,
    policyVersion: input.policyVersion,
    scopes: Object.freeze([...sortPlatformScopes(input.scopes)]),
    resourceMode: input.resourceMode,
    allowedServerIds: Object.freeze(
      input.resourceMode === "selected"
        ? [...new Set(input.allowedServerIds)]
        : [],
    ),
    expiresAt: input.expiresAt,
  });
}

export function platformHasScope(
  principal: PlatformPrincipal,
  scope: McpPlatformScope,
): boolean {
  return principal.scopes.includes(scope);
}

export function platformHasEveryScope(
  principal: PlatformPrincipal,
  scopes: readonly McpPlatformScope[],
): boolean {
  return scopes.every((scope) => principal.scopes.includes(scope));
}

export function missingPlatformScopes(
  principal: PlatformPrincipal,
  scopes: readonly McpPlatformScope[],
): McpPlatformScope[] {
  return scopes.filter((scope) => !principal.scopes.includes(scope));
}

export function isPlatformPrincipalPolicySupported(
  policyVersion: number,
): boolean {
  return (MCP_PLATFORM_SUPPORTED_POLICY_VERSIONS as readonly number[]).includes(
    policyVersion,
  );
}
