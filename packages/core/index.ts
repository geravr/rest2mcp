// Guards
export { isRecord, isStrictRecord } from "./src/guards.js";

// Application error codes
export {
  APP_ERROR_CODES,
  assertUniqueAppErrorCodes,
  isAppErrorCode,
} from "./src/error-codes.js";
export type { AppErrorCode, AppErrorDetails } from "./src/error-codes.js";

// Platform MCP authorization policy
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
  MCP_PLATFORM_PRESET_IDS,
  MCP_PLATFORM_PRESETS,
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
} from "./src/mcp-platform.js";
export type {
  McpPlatformPreset,
  McpPlatformResourceMode,
  McpPlatformScope,
  PlatformGrantFingerprintInput,
  PlatformScopeValidationFailure,
} from "./src/mcp-platform.js";

// MCP Studio limits
export {
  MCP_MAX_TOOLS_PER_SERVER_BOUNDS,
  MCP_MAX_TOOLS_PER_SERVER_DEFAULT,
} from "./src/mcp-limits.js";

// OpenAPI import and Studio tool groups
export {
  assertUniqueMcpOpenApiIssueCodes,
  isMcpOpenApiBlockingIssueCode,
  isMcpOpenApiIssueCode,
  MCP_OPENAPI_BLOCKING_ISSUE_CODES,
  MCP_OPENAPI_ISSUE_CODES,
  MCP_OPENAPI_LIMITS,
  MCP_OPENAPI_VERSIONS,
  MCP_TOOL_GROUP_LIMITS,
} from "./src/openapi-import.js";
export type {
  McpOpenApiIssueCode,
  McpOpenApiVersion,
} from "./src/openapi-import.js";

// Pagination
export {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  pageSizeSchema,
  paginationInputSchema,
} from "./src/pagination.js";
export type { PageSize, Paginated, PaginationInput } from "./src/pagination.js";

// Telemetry & Observability Settings
export {
  buildTelemetrySelectorList,
  isTelemetrySensitiveKey,
  observabilitySettingsSchema,
  REDACTED_TELEMETRY_VALUE,
  sanitizeTelemetryProperties,
  sanitizeTelemetryText,
  sanitizeTelemetryUrl,
  sanitizeTelemetryValue,
  TELEMETRY_BLOCK_SELECTORS,
  TELEMETRY_MASK_TEXT_SELECTORS,
  TELEMETRY_SENSITIVE_HEADERS,
  TELEMETRY_SENSITIVE_QUERY_PARAMS,
  telemetryConsentStatusSchema,
  updateObservabilitySettingsSchema,
} from "./src/telemetry.js";

export type {
  ObservabilitySettings,
  TelemetryConsentStatus,
  UpdateObservabilitySettingsInput,
} from "./src/telemetry.js";
