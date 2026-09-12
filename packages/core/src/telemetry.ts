import { z } from "zod";

export const REDACTED_TELEMETRY_VALUE = "[REDACTED]";

export const telemetryConsentStatusSchema = z.enum([
  "pending",
  "granted",
  "denied",
]);
export type TelemetryConsentStatus = z.infer<
  typeof telemetryConsentStatusSchema
>;

export const observabilitySettingsSchema = z.object({
  consentStatus: telemetryConsentStatusSchema,
  sessionReplayEnabled: z.boolean(),
  errorTrackingEnabled: z.boolean(),
  consentUpdatedAt: z.string().nullable(),
});
export type ObservabilitySettings = z.infer<typeof observabilitySettingsSchema>;

export const updateObservabilitySettingsSchema = z
  .object({
    consentStatus: telemetryConsentStatusSchema.optional(),
    sessionReplayEnabled: z.boolean().optional(),
    errorTrackingEnabled: z.boolean().optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    {
      message: "At least one observability setting must be provided.",
    },
  );
export type UpdateObservabilitySettingsInput = z.infer<
  typeof updateObservabilitySettingsSchema
>;

export const TELEMETRY_SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-forwarded-access-token",
];

export const TELEMETRY_SENSITIVE_QUERY_PARAMS = [
  "access_token",
  "api_key",
  "auth",
  "authorization",
  "code",
  "cookie",
  "key",
  "otp",
  "password",
  "refresh_token",
  "secret",
  "session",
  "signature",
  "state",
  "token",
];

export const TELEMETRY_MASK_TEXT_SELECTORS = [
  "[data-sensitive]",
  "[data-private]",
  "[data-secret]",
  "[data-mask]",
  "[data-posthog-mask]",
  "[name*='token' i]",
  "[name*='secret' i]",
  "[name*='password' i]",
  "[name*='key' i]",
  "[id*='token' i]",
  "[id*='secret' i]",
  "[id*='password' i]",
  "[id*='key' i]",
];

export const TELEMETRY_BLOCK_SELECTORS = [
  "[data-sensitive-block]",
  "[data-posthog-block]",
  "iframe[src*='stripe.com']",
  "iframe[src*='checkout']",
];

const SENSITIVE_KEY_PATTERN =
  /api[-_]?key|auth|authorization|cookie|credential|cvv|key|otp|pass(word)?|secret|session|signature|token/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const PLACEHOLDER_ORIGIN = "https://telemetry.invalid";

export function isTelemetrySensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function sanitizeTelemetryText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, REDACTED_TELEMETRY_VALUE)
    .replace(BEARER_TOKEN_PATTERN, REDACTED_TELEMETRY_VALUE)
    .replace(JWT_PATTERN, REDACTED_TELEMETRY_VALUE);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeTelemetryArray(values: unknown[], depth: number): unknown[] {
  return values.map((value) =>
    sanitizeTelemetryValue(value, undefined, depth + 1),
  );
}

export function sanitizeTelemetryValue(
  value: unknown,
  key?: string,
  depth = 0,
): unknown {
  if (key && isTelemetrySensitiveKey(key)) {
    return REDACTED_TELEMETRY_VALUE;
  }

  if (value == null) {
    return value;
  }

  if (depth > 5) {
    return "[Truncated]";
  }

  if (typeof value === "string") {
    return sanitizeTelemetryText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return sanitizeTelemetryArray(value, depth);
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeTelemetryValue(entryValue, entryKey, depth + 1),
    ]),
  );
}

export function sanitizeTelemetryProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      sanitizeTelemetryValue(value, key),
    ]),
  );
}

export function sanitizeTelemetryUrl(
  rawUrl: string,
  options?: { allowQueryParams?: string[] },
): string {
  try {
    const parsed = new URL(rawUrl, PLACEHOLDER_ORIGIN);
    const allowQueryParams = new Set(
      (options?.allowQueryParams ?? []).map((value) => value.toLowerCase()),
    );

    const sanitizedSearch = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (TELEMETRY_SENSITIVE_QUERY_PARAMS.includes(normalizedKey)) {
        continue;
      }
      if (allowQueryParams.size > 0 && !allowQueryParams.has(normalizedKey)) {
        continue;
      }
      sanitizedSearch.set(key, sanitizeTelemetryText(value));
    }

    const search = sanitizedSearch.toString();
    const origin = parsed.origin === PLACEHOLDER_ORIGIN ? "" : parsed.origin;
    return `${origin}${parsed.pathname}${search ? `?${search}` : ""}`;
  } catch {
    const [pathOnly] = rawUrl.split("?");
    return sanitizeTelemetryText(pathOnly);
  }
}

export function buildTelemetrySelectorList(selectors: string[]): string {
  return selectors.join(", ");
}
