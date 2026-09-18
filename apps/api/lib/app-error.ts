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
  const placeholder = (details as { placeholder?: unknown }).placeholder;
  if (typeof placeholder === "string") {
    return { placeholder };
  }
  return undefined;
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
