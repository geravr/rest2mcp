import { APP_ERROR_CODES } from "@repo/core";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import {
  AppError,
  appError,
  appJsonError,
  appTrpcError,
  extractAppCodeFromTrpcCause,
  extractDetailsFromTrpcCause,
  resolveRequestLocale,
  toTrpcError,
  trpcCodeFromHttpStatus,
} from "./app-error.js";

describe("AppError", () => {
  it("constructs a transport-neutral error", () => {
    const cause = new Error("db miss");
    const error = appError({
      appCode: APP_ERROR_CODES.USER_NOT_FOUND,
      message: "User not found.",
      status: 404,
      cause,
    });

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.appCode).toBe(APP_ERROR_CODES.USER_NOT_FOUND);
    expect(error.status).toBe(404);
    expect(error.message).toBe("User not found.");
    expect(error.cause).toBe(cause);
  });

  it("stores optional details", () => {
    const error = appError({
      appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
      message:
        'Template placeholder "limit" has no matching argument or server variable.',
      status: 400,
      details: { placeholder: "limit" },
    });

    expect(error.details).toEqual({ placeholder: "limit" });
  });
});

describe("appTrpcError", () => {
  it("embeds appCode in cause", () => {
    const error = appTrpcError({
      code: "NOT_FOUND",
      message: "User not found.",
      appCode: APP_ERROR_CODES.USER_NOT_FOUND,
    });

    expect(error).toBeInstanceOf(TRPCError);
    expect(extractAppCodeFromTrpcCause(error.cause)).toBe(
      APP_ERROR_CODES.USER_NOT_FOUND,
    );
  });

  it("preserves an original cause next to appCode", () => {
    const cause = new Error("upstream");
    const error = appTrpcError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to upload file.",
      appCode: APP_ERROR_CODES.FILE_UPLOAD_FAILED,
      cause,
    });

    expect(extractAppCodeFromTrpcCause(error.cause)).toBe(
      APP_ERROR_CODES.FILE_UPLOAD_FAILED,
    );
    expect((error.cause as unknown as { error: unknown }).error).toBe(cause);
  });

  it("embeds details in cause", () => {
    const error = appTrpcError({
      code: "BAD_REQUEST",
      message:
        'Template placeholder "limit" has no matching argument or server variable.',
      appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
      details: { placeholder: "limit" },
    });

    expect(extractDetailsFromTrpcCause(error.cause)).toEqual({
      placeholder: "limit",
    });
  });
});

describe("toTrpcError", () => {
  it("maps AppError status to a tRPC code and keeps appCode", () => {
    const error = toTrpcError(
      appError({
        appCode: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
        message: "Your account has been suspended.",
        status: 403,
      }),
    );

    expect(error).toBeInstanceOf(TRPCError);
    expect(error.code).toBe("FORBIDDEN");
    expect(extractAppCodeFromTrpcCause(error.cause)).toBe(
      APP_ERROR_CODES.ACCOUNT_SUSPENDED,
    );
  });

  it("forwards details onto the tRPC cause", () => {
    const error = toTrpcError(
      appError({
        appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
        message:
          'Template placeholder "email" has no matching argument or server variable.',
        status: 400,
        details: { placeholder: "email" },
      }),
    );

    expect(extractDetailsFromTrpcCause(error.cause)).toEqual({
      placeholder: "email",
    });
  });
});

describe("trpcCodeFromHttpStatus", () => {
  it("maps known statuses and falls back by class", () => {
    expect(trpcCodeFromHttpStatus(401)).toBe("UNAUTHORIZED");
    expect(trpcCodeFromHttpStatus(403)).toBe("FORBIDDEN");
    expect(trpcCodeFromHttpStatus(404)).toBe("NOT_FOUND");
    expect(trpcCodeFromHttpStatus(409)).toBe("CONFLICT");
    expect(trpcCodeFromHttpStatus(412)).toBe("PRECONDITION_FAILED");
    expect(trpcCodeFromHttpStatus(429)).toBe("TOO_MANY_REQUESTS");
    expect(trpcCodeFromHttpStatus(400)).toBe("BAD_REQUEST");
    expect(trpcCodeFromHttpStatus(422)).toBe("BAD_REQUEST");
    expect(trpcCodeFromHttpStatus(500)).toBe("INTERNAL_SERVER_ERROR");
    expect(trpcCodeFromHttpStatus(503)).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("extractAppCodeFromTrpcCause", () => {
  it("returns undefined for invalid causes", () => {
    expect(extractAppCodeFromTrpcCause(null)).toBeUndefined();
    expect(
      extractAppCodeFromTrpcCause({ appCode: "NOT_REAL" }),
    ).toBeUndefined();
  });
});

describe("appJsonError", () => {
  it("returns stable code and message shape", () => {
    expect(
      appJsonError(
        APP_ERROR_CODES.INVALID_EMAIL,
        "Enter a valid email address.",
      ),
    ).toEqual({
      code: APP_ERROR_CODES.INVALID_EMAIL,
      message: "Enter a valid email address.",
    });
  });
});

describe("resolveRequestLocale", () => {
  it("reads saas-lang cookie when present", () => {
    expect(resolveRequestLocale("saas-lang=es; other=1")).toBe("es");
    expect(resolveRequestLocale("saas-lang=en")).toBe("en");
  });

  it("defaults to en for missing or unknown values", () => {
    expect(resolveRequestLocale(undefined)).toBe("en");
    expect(resolveRequestLocale("saas-lang=fr")).toBe("en");
  });
});
