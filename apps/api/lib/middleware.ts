/**
 * @file Shared Hono middleware for both production and development entrypoints.
 */

import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { APP_ERROR_CODES, AppError, appJsonError } from "./app-error.js";
import {
  captureServerException,
  extractRequestTelemetryDetails,
} from "./posthog.js";

const REQUEST_ID_HEADER_NAMES = ["x-request-id", "x-correlation-id"] as const;
const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function sanitizeRequestId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();

  if (!trimmed || trimmed.length > REQUEST_ID_MAX_LENGTH) {
    return null;
  }

  return REQUEST_ID_RE.test(trimmed) ? trimmed : null;
}

export function getTrustedRequestId(headers: Headers): string | null {
  for (const name of REQUEST_ID_HEADER_NAMES) {
    const requestId = sanitizeRequestId(headers.get(name));

    if (requestId) {
      return requestId;
    }
  }

  return null;
}

export function getRequestIdForTelemetry(
  responseHeaders: Headers,
  requestHeaders: Headers,
): string | null {
  return (
    responseHeaders.get("x-request-id") ?? getTrustedRequestId(requestHeaders)
  );
}

/**
 * Global error handler for top-level Hono apps.
 *
 * Serializes AppError as `{ code, message }`, handles HTTPException,
 * and maps unexpected errors to INTERNAL_ERROR.
 */
export const errorHandler: ErrorHandler = async (err, c) => {
  const requestTelemetry = extractRequestTelemetryDetails(c.req.raw);
  const runtimeEnv = c.get("env") ?? c.env;
  const user = c.get("user");

  if (err instanceof AppError) {
    if (err.status >= 500) {
      await captureServerException(err, {
        additionalProperties: {
          hasTracingHeaders: requestTelemetry.hasTracingHeaders,
          origin: requestTelemetry.origin,
          referer: requestTelemetry.referer,
          userAgent: requestTelemetry.userAgent,
        },
        db: c.get("db"),
        distinctId: requestTelemetry.distinctId,
        method: c.req.method,
        path: c.req.path,
        requestId: getRequestIdForTelemetry(c.res.headers, c.req.raw.headers),
        runtimeEnv,
        sessionId: requestTelemetry.sessionId,
        source: "hono.app_error",
        statusCode: err.status,
        userId: user?.id ?? null,
        windowId: requestTelemetry.windowId,
      });
    }

    return c.json(
      appJsonError(err.appCode, err.message),
      err.status as ContentfulStatusCode,
    );
  }

  if (err instanceof HTTPException) {
    // getResponse() is not context-aware; merge headers from middleware
    const res = err.getResponse();

    if (res.status >= 500) {
      await captureServerException(err, {
        additionalProperties: {
          hasTracingHeaders: requestTelemetry.hasTracingHeaders,
          origin: requestTelemetry.origin,
          referer: requestTelemetry.referer,
          userAgent: requestTelemetry.userAgent,
        },
        db: c.get("db"),
        distinctId: requestTelemetry.distinctId,
        method: c.req.method,
        path: c.req.path,
        requestId: getRequestIdForTelemetry(c.res.headers, c.req.raw.headers),
        runtimeEnv,
        sessionId: requestTelemetry.sessionId,
        source: "hono.http_exception",
        statusCode: res.status,
        userId: user?.id ?? null,
        windowId: requestTelemetry.windowId,
      });
    }

    const headers = new Headers(res.headers);
    c.res.headers.forEach((v, k) => headers.set(k, v));
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  }

  await captureServerException(err, {
    additionalProperties: {
      hasTracingHeaders: requestTelemetry.hasTracingHeaders,
      origin: requestTelemetry.origin,
      referer: requestTelemetry.referer,
      userAgent: requestTelemetry.userAgent,
    },
    db: c.get("db"),
    distinctId: requestTelemetry.distinctId,
    method: c.req.method,
    path: c.req.path,
    requestId: getRequestIdForTelemetry(c.res.headers, c.req.raw.headers),
    runtimeEnv,
    sessionId: requestTelemetry.sessionId,
    source: "hono.error_handler",
    statusCode: 500,
    userId: user?.id ?? null,
    windowId: requestTelemetry.windowId,
  });

  console.error(`[${c.req.method}] ${c.req.path}:`, err);
  return c.json(
    appJsonError(APP_ERROR_CODES.INTERNAL_ERROR, "Internal Server Error"),
    500,
  );
};

/**
 * 404 handler for unmatched routes.
 *
 * Must be registered on top-level app (notFound on mounted sub-apps is ignored).
 */
export const notFoundHandler: NotFoundHandler = (c) => {
  return c.json(
    appJsonError(APP_ERROR_CODES.ROUTE_NOT_FOUND, "Not Found"),
    404,
  );
};

/**
 * Request ID generator that preserves only sanitized upstream request IDs.
 */
export function requestIdGenerator(c: Context): string {
  return getTrustedRequestId(c.req.raw.headers) ?? crypto.randomUUID();
}
