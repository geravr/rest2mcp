import {
  APP_ERROR_CODES,
  type AppErrorCode,
  type AppErrorDetails,
  isAppErrorCode,
} from "@repo/core";
import { TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";

export {
  APP_ERROR_CODES,
  isAppErrorCode,
  type AppErrorCode,
  type AppErrorDetails,
};

export class AppError extends Error {
  readonly appCode: AppErrorCode;
  readonly status: number;
  readonly details?: AppErrorDetails;

  constructor(input: {
    appCode: AppErrorCode;
    message: string;
    status: number;
    cause?: unknown;
    details?: AppErrorDetails;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "AppError";
    this.appCode = input.appCode;
    this.status = input.status;
    this.details = input.details;
  }
}

export function appError(input: {
  appCode: AppErrorCode;
  message: string;
  status: number;
  cause?: unknown;
  details?: AppErrorDetails;
}): AppError {
  return new AppError(input);
}

export function trpcCodeFromHttpStatus(status: number): TRPC_ERROR_CODE_KEY {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 412) return "PRECONDITION_FAILED";
  if (status === 429) return "TOO_MANY_REQUESTS";
  if (status >= 400 && status < 500) return "BAD_REQUEST";
  return "INTERNAL_SERVER_ERROR";
}

export function appTrpcError(input: {
  code: TRPC_ERROR_CODE_KEY;
  message: string;
  appCode: AppErrorCode;
  cause?: unknown;
  details?: AppErrorDetails;
}): TRPCError {
  const causePayload: {
    appCode: AppErrorCode;
    error?: unknown;
    details?: AppErrorDetails;
  } = { appCode: input.appCode };
  if (input.cause !== undefined) causePayload.error = input.cause;
  if (input.details !== undefined) causePayload.details = input.details;
  return new TRPCError({
    code: input.code,
    message: input.message,
    cause: causePayload,
  });
}

export function toTrpcError(error: AppError): TRPCError {
  return appTrpcError({
    code: trpcCodeFromHttpStatus(error.status),
    message: error.message,
    appCode: error.appCode,
    cause: error.cause,
    details: error.details,
  });
}

export function extractAppCodeFromTrpcCause(
  cause: unknown,
): AppErrorCode | undefined {
  if (!cause || typeof cause !== "object") return undefined;
  const appCode = (cause as { appCode?: unknown }).appCode;
  return isAppErrorCode(appCode) ? appCode : undefined;
}

export function extractDetailsFromTrpcCause(
  cause: unknown,
): AppErrorDetails | undefined {
  if (!cause || typeof cause !== "object") return undefined;
  const details = (cause as { details?: unknown }).details;
  if (!details || typeof details !== "object") return undefined;
  const source = details as Record<string, unknown>;
  const result: AppErrorDetails = {};

  if (typeof source.placeholder === "string") {
    result.placeholder = source.placeholder;
  }
  if (typeof source.path === "string") result.path = source.path;
  if (typeof source.nodeId === "string") result.nodeId = source.nodeId;
  if (typeof source.issueCode === "string") result.issueCode = source.issueCode;
  if (typeof source.httpStatus === "number") {
    result.httpStatus = source.httpStatus;
  }
  if (typeof source.retryAfterSeconds === "number") {
    result.retryAfterSeconds = source.retryAfterSeconds;
  }
  if (typeof source.currentRevision === "number") {
    result.currentRevision = source.currentRevision;
  }
  if (typeof source.serverId === "string") result.serverId = source.serverId;
  if (typeof source.retryable === "boolean")
    result.retryable = source.retryable;
  if (Array.isArray(source.references)) {
    result.references = source.references
      .filter(
        (reference): reference is { kind: string; id: string; name?: string } =>
          !!reference &&
          typeof reference === "object" &&
          typeof (reference as { kind?: unknown }).kind === "string" &&
          typeof (reference as { id?: unknown }).id === "string",
      )
      .map((reference) => ({
        kind: reference.kind,
        id: reference.id,
        ...(typeof reference.name === "string" ? { name: reference.name } : {}),
      }));
  }
  if (Array.isArray(source.scopes)) {
    const scopes = source.scopes.filter(
      (scope): scope is string => typeof scope === "string",
    );
    if (scopes.length > 0) result.scopes = scopes;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export const SAAS_LANG_COOKIE = "saas-lang";

export function appJsonError(appCode: AppErrorCode, message: string) {
  return { message, code: appCode } as const;
}

export function resolveRequestLocale(
  cookieHeader: string | null | undefined,
): "en" | "es" {
  if (!cookieHeader) return "en";

  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SAAS_LANG_COOKIE}=([^;]+)`),
  );
  const value = match?.[1]?.trim().toLowerCase();
  return value === "es" ? "es" : "en";
}
