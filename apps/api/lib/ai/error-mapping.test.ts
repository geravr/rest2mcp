import { APP_ERROR_CODES } from "@repo/core";
import { describe, expect, it } from "vitest";
import { AiCredentialEnvelopeError } from "../ai-crypto.js";
import {
  aiCredentialUnavailableError,
  isAiCredentialEnvelopeError,
  mapAiProviderRequestError,
} from "./error-mapping.js";
import { AiProviderRequestError } from "./provider-http.js";

describe("mapAiProviderRequestError", () => {
  it("maps a rejected provider request to a non-retryable application error", () => {
    const mapped = mapAiProviderRequestError({
      error: new AiProviderRequestError({
        code: "rejected",
        message: "The provider rejected the request.",
        httpStatus: 400,
        retryable: false,
      }),
      operation: "verification",
      providerKind: "opencode_go",
    });

    expect(mapped.appCode).toBe(APP_ERROR_CODES.AI_PROVIDER_REQUEST_REJECTED);
    expect(mapped.status).toBe(400);
    expect(mapped.details).toMatchObject({ retryable: false });
  });

  it("does not treat an envelope failure as a transient provider error", () => {
    const error = new AiCredentialEnvelopeError("authentication_failed");
    expect(isAiCredentialEnvelopeError(error)).toBe(true);
    const mapped = aiCredentialUnavailableError(error);
    expect(mapped.appCode).toBe(APP_ERROR_CODES.AI_CREDENTIAL_UNAVAILABLE);
    expect(mapped.appCode).not.toBe(
      APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE,
    );
  });
});
