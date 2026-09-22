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
  /** Stale `expectedRevision`: the aggregate changed elsewhere; reread before retrying. */
  MCP_WRITE_CONFLICT: "MCP_WRITE_CONFLICT",
  /** A known fully-rolled-back transient database failure after retries were exhausted. */
  MCP_TRANSIENT_WRITE_FAILURE: "MCP_TRANSIENT_WRITE_FAILURE",

  /** The draft contains blocking readiness errors and cannot be published. */
  MCP_PUBLISH_NOT_READY: "MCP_PUBLISH_NOT_READY",
  /** The draft changed after the caller observed it; re-preview before publishing. */
  MCP_PUBLISH_STALE_DRAFT: "MCP_PUBLISH_STALE_DRAFT",
  /** The active published revision changed after the caller observed it. */
  MCP_PUBLISH_STALE_REVISION: "MCP_PUBLISH_STALE_REVISION",
  /** The candidate fingerprint no longer matches the draft that was previewed. */
  MCP_PUBLISH_CANDIDATE_CHANGED: "MCP_PUBLISH_CANDIDATE_CHANGED",
  /** Preview warnings for the exact candidate fingerprint were not acknowledged. */
  MCP_PUBLISH_WARNINGS_UNACKNOWLEDGED: "MCP_PUBLISH_WARNINGS_UNACKNOWLEDGED",
  /** The canonical candidate is identical to the active revision. */
  MCP_PUBLISH_NO_CHANGES: "MCP_PUBLISH_NO_CHANGES",
  /** A `publishRequestId` was already committed with different content. */
  MCP_PUBLISH_IDEMPOTENCY_CONFLICT: "MCP_PUBLISH_IDEMPOTENCY_CONFLICT",
  /** A referenced secret slot is missing or structurally incompatible. */
  MCP_PUBLISH_MISSING_SECRET: "MCP_PUBLISH_MISSING_SECRET",
  /** The requested published revision id does not exist for the owner server. */
  MCP_REVISION_NOT_FOUND: "MCP_REVISION_NOT_FOUND",
  /** The requested revision cannot be restored to the draft as-is. */
  MCP_REVISION_NOT_RESTORABLE: "MCP_REVISION_NOT_RESTORABLE",
  /** Deleting this secret slot would break the active published revision. */
  MCP_ACTIVE_SECRET_IN_USE: "MCP_ACTIVE_SECRET_IN_USE",

  /** A Studio tool group id does not exist on the owner server. */
  MCP_TOOL_GROUP_NOT_FOUND: "MCP_TOOL_GROUP_NOT_FOUND",
  /** A Studio tool group name collides after normalization on the same server. */
  MCP_TOOL_GROUP_NAME_CONFLICT: "MCP_TOOL_GROUP_NAME_CONFLICT",
  /** The server already holds the maximum number of Studio tool groups. */
  MCP_TOOL_GROUP_LIMIT_REACHED: "MCP_TOOL_GROUP_LIMIT_REACHED",
  /** The server already holds the maximum number of draft tools. */
  MCP_TOOL_LIMIT_REACHED: "MCP_TOOL_LIMIT_REACHED",

  /** The submitted OpenAPI source is not bounded, well-formed JSON. */
  MCP_OPENAPI_INVALID: "MCP_OPENAPI_INVALID",
  /** The document declares a version this build cannot import. */
  MCP_OPENAPI_VERSION_UNSUPPORTED: "MCP_OPENAPI_VERSION_UNSUPPORTED",
  /** The document or its operation inventory exceeds a bounded limit. */
  MCP_OPENAPI_LIMIT_EXCEEDED: "MCP_OPENAPI_LIMIT_EXCEEDED",
  /** A document URL failed the dedicated safe-retrieval policy. */
  MCP_OPENAPI_SOURCE_UNAVAILABLE: "MCP_OPENAPI_SOURCE_UNAVAILABLE",
  /** The resubmitted source no longer matches the previewed fingerprint. */
  MCP_OPENAPI_STALE_PREVIEW: "MCP_OPENAPI_STALE_PREVIEW",
  /** The selection is empty, unknown, blocked, or breaks name/capacity rules. */
  MCP_OPENAPI_INVALID_SELECTION: "MCP_OPENAPI_INVALID_SELECTION",

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

  /** The provider kind is not in the supported registry; no outbound call was made. */
  AI_PROVIDER_UNSUPPORTED: "AI_PROVIDER_UNSUPPORTED",
  /** The addressed AI provider connection does not exist for the calling owner. */
  AI_CONNECTION_NOT_FOUND: "AI_CONNECTION_NOT_FOUND",
  /** Stale `expectedConfigRevision` or `expectedCredentialRevision` on a connection mutation. */
  AI_CONNECTION_REVISION_CONFLICT: "AI_CONNECTION_REVISION_CONFLICT",
  /** The provider rejected the credential as unauthorized; nothing was persisted. */
  AI_PROVIDER_CREDENTIAL_INVALID: "AI_PROVIDER_CREDENTIAL_INVALID",
  /** The provider rejected the request for a reason other than authentication. Retrying the same call will not succeed. */
  AI_PROVIDER_REQUEST_REJECTED: "AI_PROVIDER_REQUEST_REJECTED",
  /** A provider call failed transiently (rate limit, outage); retry may succeed. */
  AI_PROVIDER_TRANSIENT_FAILURE: "AI_PROVIDER_TRANSIENT_FAILURE",
  /** A provider call exceeded its operation deadline. */
  AI_PROVIDER_TIMEOUT: "AI_PROVIDER_TIMEOUT",
  /** A provider redirect left the registered approved origins; the credential was not forwarded. */
  AI_PROVIDER_REDIRECT_BLOCKED: "AI_PROVIDER_REDIRECT_BLOCKED",
  /** A provider response exceeded the bounded response-size limit. */
  AI_PROVIDER_RESPONSE_TOO_LARGE: "AI_PROVIDER_RESPONSE_TOO_LARGE",
  /** Live model discovery failed and no same-revision cached snapshot could be served. */
  AI_DISCOVERY_UNAVAILABLE: "AI_DISCOVERY_UNAVAILABLE",
  /** The model is not selectable for the requested capability profile. */
  AI_MODEL_NOT_SELECTABLE: "AI_MODEL_NOT_SELECTABLE",
  /** The bounded structured-output smoke test did not produce schema-conforming output. */
  AI_MODEL_VERIFICATION_FAILED: "AI_MODEL_VERIFICATION_FAILED",
  /** No current verified selection satisfies the requested capability profile. */
  AI_FEATURE_NOT_READY: "AI_FEATURE_NOT_READY",
  /** AI credential key material is unavailable or cannot open the stored envelope. */
  AI_CREDENTIAL_UNAVAILABLE: "AI_CREDENTIAL_UNAVAILABLE",

  /** The addressed optimization run does not exist for the calling owner. */
  AI_OPTIMIZATION_RUN_NOT_FOUND: "AI_OPTIMIZATION_RUN_NOT_FOUND",
  /** The addressed optimization item does not exist for the run. */
  AI_OPTIMIZATION_ITEM_NOT_FOUND: "AI_OPTIMIZATION_ITEM_NOT_FOUND",
  /** The optimization plan expired before authorization; request a new preflight. */
  AI_OPTIMIZATION_PLAN_EXPIRED: "AI_OPTIMIZATION_PLAN_EXPIRED",
  /** A referenced server, tool, source, or model fingerprint changed after preflight. */
  AI_OPTIMIZATION_PLAN_STALE: "AI_OPTIMIZATION_PLAN_STALE",
  /** The run is not in the state required by the requested transition. */
  AI_OPTIMIZATION_STATE_INVALID: "AI_OPTIMIZATION_STATE_INVALID",
  /** The stored run references a policy or prompt version this build cannot evaluate. */
  AI_OPTIMIZATION_POLICY_UNSUPPORTED: "AI_OPTIMIZATION_POLICY_UNSUPPORTED",
  /** A tool or candidate cannot be safely snapshotted for optimization. */
  AI_OPTIMIZATION_INELIGIBLE: "AI_OPTIMIZATION_INELIGIBLE",
  /** The OpenAPI source no longer matches the fingerprint bound to the run. */
  AI_OPTIMIZATION_SOURCE_STALE: "AI_OPTIMIZATION_SOURCE_STALE",
  /** The verified model readiness fingerprint changed after authorization. */
  AI_OPTIMIZATION_MODEL_DRIFT: "AI_OPTIMIZATION_MODEL_DRIFT",
  /** Selected recommendations cannot apply because a tool or revision drifted. */
  AI_OPTIMIZATION_APPLY_STALE: "AI_OPTIMIZATION_APPLY_STALE",
  /** Selected recommendations failed current policy, compile, security, or uniqueness checks. */
  AI_OPTIMIZATION_APPLY_INVALID: "AI_OPTIMIZATION_APPLY_INVALID",
  /** The apply idempotency key was already committed with different operations. */
  AI_OPTIMIZATION_IDEMPOTENCY_CONFLICT: "AI_OPTIMIZATION_IDEMPOTENCY_CONFLICT",

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
  /** Observed publishable draft revision at the time of a publication conflict. */
  draftRevision?: number;
  /** Active published revision id at the time of a publication conflict. */
  publishedRevisionId?: string | null;
  /** Active published revision number at the time of a publication conflict. */
  publishedRevisionNumber?: number | null;
  /** Canonical aggregate fingerprint of the current draft candidate. */
  candidateFingerprint?: string;
  /** Canonical aggregate fingerprint of the active published revision. */
  currentFingerprint?: string;
  /** Warning codes that must be acknowledged for the candidate fingerprint. */
  warningCodes?: string[];
  /** Safe tool names affected by a conflict, readiness error, or destructive change. */
  toolNames?: string[];
  /** Whether the client should refresh published contract metadata before retrying. */
  refreshRequired?: boolean;
  /** Whether a fully-rolled-back infrastructure failure may be retried safely. */
  retryable?: boolean;
  /** Platform policy version involved in a grant validation failure. */
  policyVersion?: number;
  /** Platform resource mode involved in a grant validation failure. */
  resourceMode?: string;
  /** Studio tool group involved in a conflict, when known and owner-scoped. */
  groupId?: string;
  /** Normalized Studio tool group name involved in a conflict. */
  groupName?: string;
  /** Stable OpenAPI operation keys affected by a selection or fingerprint conflict. */
  operationKeys?: string[];
  /** Canonical fingerprint of the source document the caller submitted. */
  documentFingerprint?: string;
  /** Configured ceiling involved in a capacity failure. */
  limit?: number;
  /** Observed count at the time of a capacity failure. */
  observed?: number;
  /** AI provider kind involved in the failure, when known. */
  providerKind?: string;
  /** Capability profile involved in an AI readiness or qualification failure. */
  capabilityProfile?: string;
  /** Public model ID involved in an AI failure, when known. */
  modelId?: string;
  /** Why a catalog entry does not satisfy a capability profile. */
  unsupportedReason?: string;
  /** Optimization run involved in the failure, when known and owner-scoped. */
  runId?: string;
  /** Optimization item involved in the failure, when known and owner-scoped. */
  itemId?: string;
  /** Why an optimization plan, source, model, or apply target is stale. */
  staleReason?: string;
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
