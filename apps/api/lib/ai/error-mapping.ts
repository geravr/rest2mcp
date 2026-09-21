/**
 * Normalizes bounded provider failures into stable `AI_*` application
 * errors. Provider response bodies, headers, and credentials never reach
 * these errors — only the failure code, HTTP status, and provider kind.
 */
import { APP_ERROR_CODES, type AiProviderKind } from "@repo/core";
import { appError } from "../app-error.js";
import { AiCredentialEnvelopeError } from "../ai-crypto.js";
import { AiProviderRequestError } from "./provider-http.js";

export type AiProviderOperation = "discovery" | "verification" | "execution";

const RETRYABLE_STATUS = 503;

export function mapAiProviderRequestError(input: {
  error: unknown;
  operation: AiProviderOperation;
  providerKind: AiProviderKind;
}): ReturnType<typeof appError> {
  const { error, operation, providerKind } = input;
  if (error instanceof AiProviderRequestError) {
    const details = { providerKind, retryable: error.retryable };
    switch (error.code) {
      case "unauthorized":
      case "forbidden":
        return appError({
          appCode: APP_ERROR_CODES.AI_PROVIDER_CREDENTIAL_INVALID,
          message: "The provider rejected the credential.",
          status: 400,
          cause: error,
          details,
        });
      case "rejected":
        return appError({
          appCode: APP_ERROR_CODES.AI_PROVIDER_REQUEST_REJECTED,
          message: "The provider rejected the request.",
          status: 400,
          cause: error,
          details,
        });
      case "rate_limited":
        return appError({
          appCode:
            operation === "discovery"
              ? APP_ERROR_CODES.AI_DISCOVERY_UNAVAILABLE
              : APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE,
          message:
            operation === "discovery"
              ? "The model catalog could not be refreshed right now."
              : "The provider is rate limiting requests.",
          status: 429,
          cause: error,
          details: {
            providerKind,
            retryable: true,
            retryAfterSeconds: error.retryAfterSeconds,
          },
        });
      case "timeout":
        return appError({
          appCode:
            operation === "discovery"
              ? APP_ERROR_CODES.AI_DISCOVERY_UNAVAILABLE
              : APP_ERROR_CODES.AI_PROVIDER_TIMEOUT,
          message:
            operation === "discovery"
              ? "The model catalog could not be retrieved in time."
              : "The provider did not respond in time.",
          status: RETRYABLE_STATUS,
          cause: error,
          details: { providerKind, retryable: true },
        });
      case "redirect_blocked":
        return appError({
          appCode: APP_ERROR_CODES.AI_PROVIDER_REDIRECT_BLOCKED,
          message: "The provider redirect targeted a non-approved origin.",
          status: 502,
          cause: error,
          details,
        });
      case "response_too_large":
        return appError({
          appCode: APP_ERROR_CODES.AI_PROVIDER_RESPONSE_TOO_LARGE,
          message: "The provider response exceeded the size limit.",
          status: 502,
          cause: error,
          details,
        });
      case "not_found":
      case "malformed_response":
      case "transient":
      default:
        return appError({
          appCode:
            operation === "discovery"
              ? APP_ERROR_CODES.AI_DISCOVERY_UNAVAILABLE
              : APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE,
          message:
            operation === "discovery"
              ? "The model catalog could not be retrieved."
              : "The provider returned an unusable response.",
          status: 502,
          cause: error,
          details,
        });
    }
  }
  return appError({
    appCode: APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE,
    message: "The provider call failed.",
    status: RETRYABLE_STATUS,
    cause: error,
    details: { providerKind, retryable: true },
  });
}

/** Stable failure when a stored AI envelope cannot be opened. */
export function aiCredentialUnavailableError(
  cause: unknown,
): ReturnType<typeof appError> {
  return appError({
    appCode: APP_ERROR_CODES.AI_CREDENTIAL_UNAVAILABLE,
    message: "The stored AI credential could not be opened.",
    status: RETRYABLE_STATUS,
    cause,
  });
}

export function isAiCredentialEnvelopeError(
  error: unknown,
): error is AiCredentialEnvelopeError {
  return error instanceof AiCredentialEnvelopeError;
}
