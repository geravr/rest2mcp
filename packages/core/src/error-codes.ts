/**
 * Stable application error codes for user-facing failures.
 * Used by API services, Hono routes, and client i18n mappers.
 */
export const APP_ERROR_CODES = {
  AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  SUPER_ADMIN_REQUIRED: "SUPER_ADMIN_REQUIRED",
  AUTH_UNAVAILABLE: "AUTH_UNAVAILABLE",

  INVALID_EMAIL: "INVALID_EMAIL",
  INVALID_INPUT: "INVALID_INPUT",
  OTP_SEND_RATE_LIMITED: "OTP_SEND_RATE_LIMITED",
  OTP_VERIFY_FAILED: "OTP_VERIFY_FAILED",

  REGISTRATION_DISABLED: "REGISTRATION_DISABLED",
  INVITATION_EMAIL_MISMATCH: "INVITATION_EMAIL_MISMATCH",
  NO_TOKEN_PROVIDED: "NO_TOKEN_PROVIDED",
  INVALID_INVITATION: "INVALID_INVITATION",
  INVITATION_NOT_FOUND: "INVITATION_NOT_FOUND",
  INVITATION_ALREADY_EXISTS: "INVITATION_ALREADY_EXISTS",
  INVITATION_INVALID_STATUS: "INVITATION_INVALID_STATUS",
  INVITATION_EMAIL_FAILED: "INVITATION_EMAIL_FAILED",

  USER_NOT_FOUND: "USER_NOT_FOUND",
  USER_ALREADY_EXISTS: "USER_ALREADY_EXISTS",
  CANNOT_BAN_SELF: "CANNOT_BAN_SELF",
  CANNOT_BAN_SUPER_ADMIN: "CANNOT_BAN_SUPER_ADMIN",
  USER_NOT_BANNED: "USER_NOT_BANNED",

  S3_NOT_CONFIGURED: "S3_NOT_CONFIGURED",
  FILE_UPLOAD_FAILED: "FILE_UPLOAD_FAILED",
  FILE_REQUIRED: "FILE_REQUIRED",
  INVALID_DIRECTORY: "INVALID_DIRECTORY",
  DIRECTORY_TOO_LONG: "DIRECTORY_TOO_LONG",
  FILE_EMPTY: "FILE_EMPTY",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  STORAGE_KEY_REQUIRED: "STORAGE_KEY_REQUIRED",
  STORAGE_ACCESS_DENIED: "STORAGE_ACCESS_DENIED",

  MCP_SERVER_NOT_FOUND: "MCP_SERVER_NOT_FOUND",
  MCP_TOOL_NOT_FOUND: "MCP_TOOL_NOT_FOUND",
  MCP_HOST_NOT_ALLOWED: "MCP_HOST_NOT_ALLOWED",
  MCP_MUTATION_NOT_ALLOWED: "MCP_MUTATION_NOT_ALLOWED",
  MCP_AGENT_TOKEN_INVALID: "MCP_AGENT_TOKEN_INVALID",
  MCP_UPSTREAM_ERROR: "MCP_UPSTREAM_ERROR",
  MCP_CURL_INVALID: "MCP_CURL_INVALID",
  MCP_TOOL_NAME_CONFLICT: "MCP_TOOL_NAME_CONFLICT",
  MCP_SERVER_SLUG_CONFLICT: "MCP_SERVER_SLUG_CONFLICT",
  MCP_TEMPLATE_UNRESOLVED: "MCP_TEMPLATE_UNRESOLVED",
  MCP_VARIABLE_NAME_CONFLICT: "MCP_VARIABLE_NAME_CONFLICT",
  MCP_PLAINTEXT_SECRET: "MCP_PLAINTEXT_SECRET",
  MCP_COMPILE_INVALID: "MCP_COMPILE_INVALID",
  MCP_TOOL_DISABLED: "MCP_TOOL_DISABLED",
  MCP_SERVER_PAUSED: "MCP_SERVER_PAUSED",
  MCP_RATE_LIMITED: "MCP_RATE_LIMITED",
  MCP_TIMEOUT: "MCP_TIMEOUT",
  MCP_REDIRECT_REJECTED: "MCP_REDIRECT_REJECTED",
  MCP_PATH_ESCAPE: "MCP_PATH_ESCAPE",
  MCP_ORIGIN_INVALID: "MCP_ORIGIN_INVALID",
  MCP_REQUEST_TOO_LARGE: "MCP_REQUEST_TOO_LARGE",
  MCP_SCOPE_DENIED: "MCP_SCOPE_DENIED",
  MCP_DESTRUCTIVE_CONFIRMATION_REQUIRED:
    "MCP_DESTRUCTIVE_CONFIRMATION_REQUIRED",
  MCP_VALUE_IN_USE: "MCP_VALUE_IN_USE",
  MCP_AUTH_ACK_REQUIRED: "MCP_AUTH_ACK_REQUIRED",
  MCP_UPSTREAM_HTTP_ERROR: "MCP_UPSTREAM_HTTP_ERROR",
  MCP_MUTATION_INDETERMINATE: "MCP_MUTATION_INDETERMINATE",
  MCP_BINARY_UNSUPPORTED: "MCP_BINARY_UNSUPPORTED",
  MCP_LEGACY_PROJECTION_UNAVAILABLE: "MCP_LEGACY_PROJECTION_UNAVAILABLE",
  MCP_LEGACY_DOWNGRADE_REJECTED: "MCP_LEGACY_DOWNGRADE_REJECTED",
  /** Stale `expectedRevision`: the aggregate changed elsewhere; reread before retrying. */
  MCP_WRITE_CONFLICT: "MCP_WRITE_CONFLICT",
  /** A known fully-rolled-back transient database failure after retries were exhausted. */
  MCP_TRANSIENT_WRITE_FAILURE: "MCP_TRANSIENT_WRITE_FAILURE",

  /** Requested Platform PAT scopes are unknown, duplicated, or dependency-invalid. */
  MCP_PAT_SCOPE_INVALID: "MCP_PAT_SCOPE_INVALID",
  /** A high-risk Platform grant requires a fresh, matching step-up approval. */
  MCP_STEP_UP_REQUIRED: "MCP_STEP_UP_REQUIRED",
  /** The supplied step-up approval is expired or was already consumed. */
  MCP_STEP_UP_EXPIRED: "MCP_STEP_UP_EXPIRED",
  /** The owner already holds the maximum number of active Platform PATs. */
  MCP_PAT_LIMIT_REACHED: "MCP_PAT_LIMIT_REACHED",
  /** Persisted grant state conflicts with its policy/resource invariants. */
  MCP_POLICY_CONFLICT: "MCP_POLICY_CONFLICT",
  /** A resource is outside the principal's immutable grant. */
  MCP_RESOURCE_DENIED: "MCP_RESOURCE_DENIED",
  /** A PAT stores a policy version this build cannot evaluate. */
  MCP_POLICY_VERSION_UNSUPPORTED: "MCP_POLICY_VERSION_UNSUPPORTED",

  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type AppErrorCode =
  (typeof APP_ERROR_CODES)[keyof typeof APP_ERROR_CODES];

/** Optional structured payload forwarded on AppError / tRPC `data.details`. */
export type AppErrorDetails = {
  placeholder?: string;
  /** Location-aware validation path (e.g. `query[0].value`, `headers.Authorization`). */
  path?: string;
  /** Stable definition-local id of the affected node, when known. */
  nodeId?: string;
  issueCode?: string;
  httpStatus?: number;
  retryAfterSeconds?: number;
  references?: Array<{ kind: string; id: string; name?: string }>;
  scopes?: string[];
  /** Current aggregate revision returned with `MCP_WRITE_CONFLICT`. */
  currentRevision?: number;
  /** Server aggregate affected by a structured conflict, when known. */
  serverId?: string;
  /** Whether a fully-rolled-back infrastructure failure may be retried safely. */
  retryable?: boolean;
  /** Platform policy version involved in a grant validation failure. */
  policyVersion?: number;
  /** Platform resource mode involved in a grant validation failure. */
  resourceMode?: string;
};

const appErrorCodeValues = Object.values(APP_ERROR_CODES);

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return (
    typeof value === "string" &&
    (appErrorCodeValues as readonly string[]).includes(value)
  );
}

export function assertUniqueAppErrorCodes(): void {
  const seen = new Set<string>();
  for (const value of appErrorCodeValues) {
    if (seen.has(value)) {
      throw new Error(`Duplicate AppErrorCode value: ${value}`);
    }
    seen.add(value);
  }
}
