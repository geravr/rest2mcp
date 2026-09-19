/**
 * Canonical Platform MCP authorization policy shared by the API, database
 * schemas, and the SPA. This module is the single source of truth for scope
 * composition, resource modes, risk classification, lifetimes, retention, and
 * control-plane limits. It must stay free of Node/Bun runtime dependencies.
 */

/** Persisted Platform grant semantics version. A mismatch invalidates a PAT. */
export const MCP_PLATFORM_POLICY_VERSION = 1;

export const MCP_PLATFORM_SUPPORTED_POLICY_VERSIONS = [1] as const;

export const MCP_PLATFORM_SCOPES = [
  "read",
  "observe",
  "author",
  "publish",
  "invoke",
  "invoke_mutation",
  "secret_reference",
  "destructive",
] as const;

export type McpPlatformScope = (typeof MCP_PLATFORM_SCOPES)[number];

export const MCP_PLATFORM_READ_SCOPE = "read" as const;

/**
 * Direct scope dependencies. Satisfying every direct dependency transitively
 * yields the full closure, so validation only needs to check direct deps.
 */
export const MCP_PLATFORM_SCOPE_DEPENDENCIES: Record<
  McpPlatformScope,
  readonly McpPlatformScope[]
> = {
  read: [],
  observe: ["read"],
  author: ["read"],
  publish: ["author"],
  invoke: ["read"],
  invoke_mutation: ["invoke"],
  secret_reference: ["read"],
  destructive: ["read"],
};

/** Default preset grants only `read`; broader authority is opt-in. */
export const MCP_DEFAULT_PLATFORM_SCOPES: readonly McpPlatformScope[] = [
  "read",
];

/**
 * Scopes that make a grant high-risk on their own. Account-wide resource mode
 * is additionally high-risk regardless of scope.
 */
export const MCP_PLATFORM_HIGH_RISK_SCOPES: readonly McpPlatformScope[] = [
  "publish",
  "invoke_mutation",
  "secret_reference",
  "destructive",
];

export const MCP_PLATFORM_RESOURCE_MODES = ["selected", "account"] as const;

export type McpPlatformResourceMode =
  (typeof MCP_PLATFORM_RESOURCE_MODES)[number];

export type McpPlatformPreset =
  "inspect" | "build_drafts" | "operate_read_only";

export const MCP_PLATFORM_PRESETS: Record<
  McpPlatformPreset,
  readonly McpPlatformScope[]
> = {
  inspect: ["read"],
  build_drafts: ["read", "author"],
  operate_read_only: ["read", "invoke"],
};

export const MCP_PLATFORM_PRESET_IDS = [
  "inspect",
  "build_drafts",
  "operate_read_only",
] as const;

/** Maximum concurrently active Platform PATs per owner. */
export const MCP_MAX_ACTIVE_PLATFORM_TOKENS = 10;

export const MCP_PLATFORM_LOW_RISK_TTL_DEFAULT_DAYS = 30;
export const MCP_PLATFORM_LOW_RISK_TTL_MAX_DAYS = 90;
export const MCP_PLATFORM_HIGH_RISK_TTL_DEFAULT_DAYS = 7;
export const MCP_PLATFORM_HIGH_RISK_TTL_MAX_DAYS = 30;

/** Platform security-event retention window. */
export const MCP_PLATFORM_SECURITY_EVENT_RETENTION_DAYS = 90;

/** Lifetime of a single-use step-up grant after successful OTP verification. */
export const MCP_PLATFORM_STEP_UP_TTL_MS = 5 * 60 * 1000;

/** Per-PAT control-plane request budget (all Platform MCP requests). */
export const MCP_PLATFORM_REQUEST_CAPACITY = 120;
export const MCP_PLATFORM_REQUEST_REFILL_PER_SEC = 2;

/** Stricter per-PAT budget for control-plane writes. */
export const MCP_PLATFORM_WRITE_CAPACITY = 30;
export const MCP_PLATFORM_WRITE_REFILL_PER_SEC = 0.5;

/** Max in-flight Platform control-plane requests per PAT. */
export const MCP_PLATFORM_CONCURRENCY_LIMIT = 8;

export function isMcpPlatformScope(value: unknown): value is McpPlatformScope {
  return (
    typeof value === "string" &&
    (MCP_PLATFORM_SCOPES as readonly string[]).includes(value)
  );
}

export function isMcpPlatformResourceMode(
  value: unknown,
): value is McpPlatformResourceMode {
  return (
    typeof value === "string" &&
    (MCP_PLATFORM_RESOURCE_MODES as readonly string[]).includes(value)
  );
}

/** Deterministic canonical ordering used for persistence and fingerprints. */
export function sortPlatformScopes(
  scopes: readonly McpPlatformScope[],
): McpPlatformScope[] {
  return [...scopes].sort(
    (a, b) => MCP_PLATFORM_SCOPES.indexOf(a) - MCP_PLATFORM_SCOPES.indexOf(b),
  );
}

export function isHighRiskPlatformGrant(
  scopes: readonly McpPlatformScope[],
  resourceMode: McpPlatformResourceMode,
): boolean {
  if (resourceMode === "account") return true;
  return scopes.some((scope) => MCP_PLATFORM_HIGH_RISK_SCOPES.includes(scope));
}

export function maxPlatformTtlDays(
  scopes: readonly McpPlatformScope[],
  resourceMode: McpPlatformResourceMode,
): number {
  return isHighRiskPlatformGrant(scopes, resourceMode)
    ? MCP_PLATFORM_HIGH_RISK_TTL_MAX_DAYS
    : MCP_PLATFORM_LOW_RISK_TTL_MAX_DAYS;
}

export function defaultPlatformTtlDays(
  scopes: readonly McpPlatformScope[],
  resourceMode: McpPlatformResourceMode,
): number {
  return isHighRiskPlatformGrant(scopes, resourceMode)
    ? MCP_PLATFORM_HIGH_RISK_TTL_DEFAULT_DAYS
    : MCP_PLATFORM_LOW_RISK_TTL_DEFAULT_DAYS;
}

export type PlatformScopeValidationFailure =
  | { reason: "unknown_scope"; scope: string }
  | { reason: "duplicate_scope"; scope: McpPlatformScope }
  | {
      reason: "missing_dependency";
      scope: McpPlatformScope;
      requires: McpPlatformScope;
    };

/**
 * Validates a persisted or requested scope set: every scope known, no
 * duplicates, and every direct dependency present. Returns a canonical sorted
 * copy on success.
 */
export function validatePlatformScopes(
  scopes: readonly string[],
):
  | { ok: true; scopes: McpPlatformScope[] }
  | { ok: false; failure: PlatformScopeValidationFailure } {
  const seen = new Set<McpPlatformScope>();
  for (const scope of scopes) {
    if (!isMcpPlatformScope(scope)) {
      return { ok: false, failure: { reason: "unknown_scope", scope } };
    }
    if (seen.has(scope)) {
      return { ok: false, failure: { reason: "duplicate_scope", scope } };
    }
    seen.add(scope);
  }
  for (const scope of seen) {
    for (const dependency of MCP_PLATFORM_SCOPE_DEPENDENCIES[scope]) {
      if (!seen.has(dependency)) {
        return {
          ok: false,
          failure: {
            reason: "missing_dependency",
            scope,
            requires: dependency,
          },
        };
      }
    }
  }
  return { ok: true, scopes: sortPlatformScopes([...seen]) };
}

/**
 * Stable, non-secret fingerprint material for a requested grant. Used to bind
 * a step-up approval to the exact scope/resource request it authorizes.
 */
export type PlatformGrantFingerprintInput = {
  policyVersion: number;
  scopes: readonly McpPlatformScope[];
  resourceMode: McpPlatformResourceMode;
  serverIds?: readonly string[];
};

export function canonicalPlatformGrant(
  input: PlatformGrantFingerprintInput,
): string {
  const scopes = sortPlatformScopes(input.scopes);
  const serverIds =
    input.resourceMode === "selected"
      ? [...(input.serverIds ?? [])].sort()
      : [];
  return JSON.stringify({
    policyVersion: input.policyVersion,
    scopes,
    resourceMode: input.resourceMode,
    serverIds,
  });
}
