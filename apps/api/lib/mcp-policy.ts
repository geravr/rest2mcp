/**
 * @file Operational defaults for the hardened MCP execution boundary.
 * Single-process VPS assumptions: rate/concurrency counters are in-memory only.
 */

/** Call-log retention before cleanup jobs may delete rows. */
export const MCP_CALL_LOG_RETENTION_DAYS = 14;

/**
 * Upstream response headers eligible for the structured result envelope.
 * Values are still redacted when they contain secrets.
 */
export const MCP_SAFE_RESPONSE_HEADERS = [
  "content-type",
  "location",
  "link",
  "etag",
  "retry-after",
  "cache-control",
  "vary",
  "x-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
] as const;

export type McpSafeResponseHeader = (typeof MCP_SAFE_RESPONSE_HEADERS)[number];

/**
 * Query-secret placement for newly configured auth.
 * `acknowledge` = allowed only with explicit exposure acknowledgement.
 */
export const MCP_QUERY_AUTH_POLICY = "acknowledge" as const;

/** Per-token token-bucket capacity (invocations). */
export const MCP_RATE_LIMIT_TOKEN_CAPACITY = 60;

/** Per-token refill rate (tokens per second). */
export const MCP_RATE_LIMIT_TOKEN_REFILL_PER_SEC = 1;

/** Stricter mutation budget relative to the shared capacity. */
export const MCP_RATE_LIMIT_MUTATION_CAPACITY = 20;

export const MCP_RATE_LIMIT_MUTATION_REFILL_PER_SEC = 1 / 3;

/** Max in-flight upstream calls per server. */
export const MCP_SERVER_CONCURRENCY_LIMIT = 10;

/** Max JSON-RPC / HTTP body size accepted at MCP endpoints (bytes). */
export const MCP_GATEWAY_REQUEST_SIZE_LIMIT = 256 * 1024;

/** Full-request deadline covering DNS, connect, redirects, and body read. */
export const MCP_UPSTREAM_DEADLINE_MS = 15_000;

/** Max upstream response body bytes retained for the agent. */
export const MCP_RESPONSE_BYTE_LIMIT = 256 * 1024;

/** Max bytes retained in call-log request/response previews. */
export const MCP_LOG_PREVIEW_BYTE_LIMIT = 8 * 1024;

/** Bounded in-process audit queue depth before drops are counted. */
export const MCP_AUDIT_QUEUE_CAPACITY = 256;

export const MCP_REQUEST_DEFINITION_VERSION = 1 as const;

export {
  canonicalPlatformGrant,
  defaultPlatformTtlDays,
  isHighRiskPlatformGrant,
  isMcpPlatformResourceMode,
  isMcpPlatformScope,
  maxPlatformTtlDays,
  MCP_DEFAULT_PLATFORM_SCOPES,
  MCP_MAX_ACTIVE_PLATFORM_TOKENS,
  MCP_PLATFORM_CONCURRENCY_LIMIT,
  MCP_PLATFORM_HIGH_RISK_SCOPES,
  MCP_PLATFORM_HIGH_RISK_TTL_DEFAULT_DAYS,
  MCP_PLATFORM_HIGH_RISK_TTL_MAX_DAYS,
  MCP_PLATFORM_LOW_RISK_TTL_DEFAULT_DAYS,
  MCP_PLATFORM_LOW_RISK_TTL_MAX_DAYS,
  MCP_PLATFORM_POLICY_VERSION,
  MCP_PLATFORM_PRESETS,
  MCP_PLATFORM_PRESET_IDS,
  MCP_PLATFORM_READ_SCOPE,
  MCP_PLATFORM_REQUEST_CAPACITY,
  MCP_PLATFORM_REQUEST_REFILL_PER_SEC,
  MCP_PLATFORM_RESOURCE_MODES,
  MCP_PLATFORM_SCOPE_DEPENDENCIES,
  MCP_PLATFORM_SCOPES,
  MCP_PLATFORM_SECURITY_EVENT_RETENTION_DAYS,
  MCP_PLATFORM_STEP_UP_TTL_MS,
  MCP_PLATFORM_SUPPORTED_POLICY_VERSIONS,
  MCP_PLATFORM_WRITE_CAPACITY,
  MCP_PLATFORM_WRITE_REFILL_PER_SEC,
  sortPlatformScopes,
  validatePlatformScopes,
} from "@repo/core";
export type {
  McpPlatformPreset,
  McpPlatformResourceMode,
  McpPlatformScope,
  PlatformGrantFingerprintInput,
  PlatformScopeValidationFailure,
} from "@repo/core";

/**
 * Transport headers reserved for the fetch layer. Never settable per-request
 * by tool definitions, curl imports, or auth configuration.
 */
export const MCP_FORBIDDEN_TRANSPORT_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "cookie",
]);

export function isForbiddenTransportHeaderName(lowerName: string): boolean {
  return (
    MCP_FORBIDDEN_TRANSPORT_HEADERS.has(lowerName) ||
    lowerName.startsWith("proxy-")
  );
}
