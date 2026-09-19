import { APP_ERROR_CODES, isAppErrorCode, type AppErrorCode } from "@repo/core";
import type { UI } from "@/i18n";

// Extract HTTP status from various error shapes (with cycle guard)
export function getErrorStatus(
  error: unknown,
  seen = new WeakSet<object>(),
): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  if (seen.has(error)) return undefined;
  seen.add(error);

  const err = error as Record<string, unknown>;
  // Direct status (tRPC, Better Auth)
  if (typeof err.status === "number") return err.status;
  // Nested in response (axios-style)
  if (
    err.response &&
    typeof (err.response as Record<string, unknown>).status === "number"
  ) {
    return (err.response as Record<string, unknown>).status as number;
  }
  // Error cause chain
  if (err.cause) return getErrorStatus(err.cause, seen);
  return undefined;
}

// Check if error indicates unauthenticated state (401).
// Maps tRPC UNAUTHORIZED code and HTTP 401 status to a semantic boolean.
// Does not match 403 (forbidden) - that means authenticated but lacking permission.
export function isUnauthenticatedError(error: unknown): boolean {
  // tRPC errors expose typed code
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { code?: string } }).data;
    if (data?.code === "UNAUTHORIZED") return true;
  }
  return getErrorStatus(error) === 401;
}

function extractAppCode(error: unknown): AppErrorCode | undefined {
  if (!error || typeof error !== "object") return undefined;

  const err = error as Record<string, unknown>;

  const data = err.data;
  if (data && typeof data === "object") {
    const appCode = (data as { appCode?: unknown }).appCode;
    if (isAppErrorCode(appCode)) return appCode;
  }

  const shape = err.shape;
  if (shape && typeof shape === "object") {
    const shapeData = (shape as { data?: { appCode?: unknown } }).data;
    if (shapeData && isAppErrorCode(shapeData.appCode)) {
      return shapeData.appCode;
    }
  }

  const code = err.code;
  if (isAppErrorCode(code)) return code;

  return undefined;
}

/** Public accessor for the stable application code behind any thrown error. */
export function getAppCode(error: unknown): AppErrorCode | undefined {
  return extractAppCode(error);
}

function extractErrorDetails(
  error: unknown,
): { placeholder?: string } | undefined {
  if (!error || typeof error !== "object") return undefined;

  const err = error as Record<string, unknown>;

  const readDetails = (
    value: unknown,
  ): { placeholder?: string } | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const placeholder = (value as { placeholder?: unknown }).placeholder;
    if (typeof placeholder === "string") return { placeholder };
    return undefined;
  };

  const data = err.data;
  if (data && typeof data === "object") {
    const fromData = readDetails((data as { details?: unknown }).details);
    if (fromData) return fromData;
  }

  const shape = err.shape;
  if (shape && typeof shape === "object") {
    const shapeData = (shape as { data?: { details?: unknown } }).data;
    const fromShape = readDetails(shapeData?.details);
    if (fromShape) return fromShape;
  }

  return undefined;
}

// Safely extract message from any thrown value
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  // Response objects (fetch API)
  if (error && typeof error === "object" && "statusText" in error) {
    const statusText = (error as { statusText?: string }).statusText;
    if (statusText) return statusText;
  }
  return "An unexpected error occurred";
}

export function resolveErrorMessage(error: unknown, t: UI): string {
  const appCode = extractAppCode(error);
  if (appCode) {
    const localized = t.errors.codes[appCode];
    if (localized) {
      if (appCode === APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED) {
        const placeholder = extractErrorDetails(error)?.placeholder;
        if (placeholder) {
          return localized.replaceAll("{name}", placeholder);
        }
        return localized
          .replaceAll("{name} ", "")
          .replaceAll(" {name}", "")
          .replaceAll("{name}", "");
      }
      return localized;
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && message !== "An unexpected error occurred") {
      return message;
    }
  }

  return t.errors.unexpected;
}
