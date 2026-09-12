// Guards
export { isRecord, isStrictRecord } from "./src/guards.js";

// Application error codes
export {
  APP_ERROR_CODES,
  assertUniqueAppErrorCodes,
  isAppErrorCode,
} from "./src/error-codes.js";
export type { AppErrorCode } from "./src/error-codes.js";

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
