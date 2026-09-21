/**
 * Bounded HTTP client for AI provider traffic. All provider requests go
 * through here so every call shares one policy: fixed HTTPS origins, a total
 * deadline, manual redirect handling restricted to approved origins,
 * response-size caps, and normalized failure classes.
 *
 * The client never logs or includes provider response bodies, request
 * headers, or credentials in errors — errors carry only a stable code and an
 * optional HTTP status.
 */

export type AiProviderFailureCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "transient"
  | "rejected"
  | "timeout"
  | "redirect_blocked"
  | "response_too_large"
  | "malformed_response"
  | "invalid_request_url";

export class AiProviderRequestError extends Error {
  readonly code: AiProviderFailureCode;
  readonly httpStatus?: number;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(input: {
    code: AiProviderFailureCode;
    message: string;
    httpStatus?: number;
    retryable: boolean;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "AiProviderRequestError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.retryable = input.retryable;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

export type AiHttpPolicy = {
  /** Exact HTTPS origins the request and any redirects may target. */
  allowedOrigins: readonly string[];
  /** Total wall-clock budget for the whole call including redirects. */
  deadlineMs: number;
  /** Maximum accepted response body size in bytes. */
  maxResponseBytes: number;
  /** Maximum redirect hops within approved origins. */
  maxRedirects?: number;
};

const MAX_REDIRECTS_DEFAULT = 3;

function assertAllowedOrigin(rawUrl: string, policy: AiHttpPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AiProviderRequestError({
      code: "invalid_request_url",
      message: "Provider request URL could not be parsed.",
      retryable: false,
    });
  }
  if (url.protocol !== "https:") {
    throw new AiProviderRequestError({
      code: "invalid_request_url",
      message: "Provider requests must use HTTPS.",
      retryable: false,
    });
  }
  if (!policy.allowedOrigins.includes(url.origin)) {
    throw new AiProviderRequestError({
      code: "invalid_request_url",
      message: "Provider request origin is not approved.",
      retryable: false,
    });
  }
  return url;
}

function deadlineError(): AiProviderRequestError {
  return new AiProviderRequestError({
    code: "timeout",
    message: "Provider request exceeded its deadline.",
    retryable: true,
  });
}

async function readBoundedBody(
  response: Response,
  policy: AiHttpPolicy,
  signal: AbortSignal,
): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      if (signal.aborted) throw deadlineError();
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > policy.maxResponseBytes) {
        throw new AiProviderRequestError({
          code: "response_too_large",
          message: "Provider response exceeded the size limit.",
          retryable: false,
        });
      }
      text += decoder.decode(value, { stream: true });
      if (text.length > policy.maxResponseBytes) {
        throw new AiProviderRequestError({
          code: "response_too_large",
          message: "Provider response exceeded the size limit.",
          retryable: false,
        });
      }
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function mapHttpStatus(
  status: number,
  retryAfterSeconds: number | undefined,
): AiProviderRequestError {
  if (status === 401) {
    return new AiProviderRequestError({
      code: "unauthorized",
      message: "The provider rejected the credential.",
      httpStatus: status,
      retryable: false,
    });
  }
  if (status === 403) {
    return new AiProviderRequestError({
      code: "forbidden",
      message: "The provider denied access to this resource.",
      httpStatus: status,
      retryable: false,
    });
  }
  if (status === 404) {
    return new AiProviderRequestError({
      code: "not_found",
      message: "The provider resource does not exist.",
      httpStatus: status,
      retryable: false,
    });
  }
  if (status === 429) {
    return new AiProviderRequestError({
      code: "rate_limited",
      message: "The provider is rate limiting requests.",
      httpStatus: status,
      retryable: true,
      retryAfterSeconds,
    });
  }
  if (status >= 500) {
    return new AiProviderRequestError({
      code: "transient",
      message: "The provider is temporarily unavailable.",
      httpStatus: status,
      retryable: true,
    });
  }
  return new AiProviderRequestError({
    code: "rejected",
    message: "The provider rejected the request.",
    httpStatus: status,
    retryable: false,
  });
}

export type AiProviderJsonRequest = {
  url: string;
  method?: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  policy: AiHttpPolicy;
  signal?: AbortSignal;
};

/**
 * Performs one bounded provider JSON request. Redirects are followed only
 * within the approved origin set; credentials are only forwarded to
 * approved origins.
 */
export async function aiProviderFetchJson(
  input: AiProviderJsonRequest,
): Promise<{ status: number; json: unknown }> {
  const policy = input.policy;
  const maxRedirects = policy.maxRedirects ?? MAX_REDIRECTS_DEFAULT;
  const deadlineAt = Date.now() + policy.deadlineMs;
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    let url = assertAllowedOrigin(input.url, policy);
    let redirectsLeft = maxRedirects;

    for (;;) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) throw deadlineError();
      const timer = setTimeout(() => controller.abort(), remainingMs);
      let response: Response;
      try {
        response = await fetch(url, {
          method: input.method ?? "GET",
          headers: input.headers,
          body: input.body,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        if (controller.signal.aborted) throw deadlineError();
        throw new AiProviderRequestError({
          code: "transient",
          message: "Provider request failed before a response was received.",
          retryable: true,
          cause: error instanceof Error ? error : undefined,
        });
      }
      clearTimeout(timer);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new AiProviderRequestError({
            code: "malformed_response",
            message: "Provider returned a redirect without a target.",
            httpStatus: response.status,
            retryable: false,
          });
        }
        if (redirectsLeft <= 0) {
          throw new AiProviderRequestError({
            code: "redirect_blocked",
            message: "Provider redirect chain exceeded the allowed length.",
            httpStatus: response.status,
            retryable: false,
          });
        }
        let target: URL;
        try {
          target = new URL(location, url);
        } catch {
          throw new AiProviderRequestError({
            code: "redirect_blocked",
            message: "Provider redirect target could not be parsed.",
            httpStatus: response.status,
            retryable: false,
          });
        }
        // Redirects must stay on the provider's own origin. Cross-origin
        // hops are rejected before any credential could be forwarded.
        if (target.origin !== url.origin) {
          throw new AiProviderRequestError({
            code: "redirect_blocked",
            message: "Provider redirect targeted a non-approved origin.",
            httpStatus: response.status,
            retryable: false,
          });
        }
        assertAllowedOrigin(target.toString(), policy);
        redirectsLeft -= 1;
        url = target;
        continue;
      }

      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds =
        retryAfterHeader && /^\d+$/.test(retryAfterHeader)
          ? Number(retryAfterHeader)
          : undefined;

      if (response.status >= 400) {
        throw mapHttpStatus(response.status, retryAfterSeconds);
      }

      const text = await readBoundedBody(response, policy, controller.signal);
      try {
        return { status: response.status, json: JSON.parse(text) as unknown };
      } catch {
        throw new AiProviderRequestError({
          code: "malformed_response",
          message: "Provider response was not valid JSON.",
          httpStatus: response.status,
          retryable: false,
        });
      }
    }
  } finally {
    input.signal?.removeEventListener("abort", onOuterAbort);
    controller.abort();
  }
}
