import { isIP } from "node:net";
import { APP_ERROR_CODES, MCP_OPENAPI_LIMITS } from "@repo/core";
import { AppError, appError } from "./app-error.js";
import {
  assertHttpUrl,
  assertResolvedAddressesSafe,
  assertSameOriginRedirect,
  isBlockedIpAddress,
} from "./mcp-ssrf.js";

export type FetchOpenApiDocumentInput = {
  url: string;
  /** Injectable for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable DNS guard for tests; defaults to `assertResolvedAddressesSafe`. */
  resolveGuard?: (hostname: string) => Promise<void>;
};

export type FetchedOpenApiDocument = {
  /** Response body text, decoded as UTF-8 and bounded. */
  text: string;
  /** Final URL after same-origin redirects. */
  finalUrl: string;
  /** Sanitized label safe to persist: no query, fragment, userinfo. */
  sourceLabel: string;
  /** `content-type` header value, lowercased, when present. */
  contentType?: string;
};

/** Deterministic label for inputs that cannot be reduced to an origin and path. */
const INVALID_SOURCE_LABEL = "invalid-url";

/** Mirrors the upstream SSRF policy's metadata hosts without requiring an allowlist entry. */
const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

/** Media types that are unambiguously binary; their bodies are never decoded as text. */
const BINARY_CONTENT_TYPE_PATTERN =
  /^(image\/|audio\/|video\/|font\/|application\/(pdf|octet-stream|zip|gzip|x-gzip|x-tar|x-7z-compressed|wasm|vnd\.|msword|rtf))/;

/** The complete request header set this fetcher may send to a document origin. */
const DOCUMENT_REQUEST_HEADERS: Readonly<Record<string, string>> =
  Object.freeze({
    accept:
      "application/json, application/yaml, text/yaml, text/plain;q=0.9, */*;q=0.5",
    "user-agent": "rest2mcp-openapi-import/1.0",
  });

/** Preserved AppErrors describe the target policy; anything else is one opaque retrieval failure. */
function asRetrievalError(error: unknown): AppError {
  if (error instanceof AppError) {
    if (
      error.appCode === APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED ||
      error.appCode === APP_ERROR_CODES.MCP_REDIRECT_REJECTED ||
      error.appCode === APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE
    ) {
      return error;
    }
  }
  return sourceUnavailable(
    "The OpenAPI document source could not be retrieved.",
    error,
  );
}

function sourceUnavailable(message: string, cause?: unknown): AppError {
  return appError({
    appCode: APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE,
    message,
    status: 502,
    cause,
  });
}

function hostNotAllowed(): AppError {
  return appError({
    appCode: APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
    message: "The document target is not allowed.",
    status: 403,
  });
}

/**
 * Public-HTTPS-only target policy for document retrieval. Runs before every
 * hop, including redirect targets; resolved names are additionally vetted by
 * the DNS guard.
 */
function assertDocumentTargetAllowed(url: URL): void {
  if (url.protocol !== "https:") {
    throw hostNotAllowed();
  }
  // `URL.hostname` keeps the brackets of an IPv6 literal, which `isIP` rejects as a name.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (METADATA_HOSTS.has(hostname) || hostname.endsWith(".internal")) {
    throw hostNotAllowed();
  }
  if (isIP(hostname) && isBlockedIpAddress(hostname)) {
    throw hostNotAllowed();
  }
}

function parseDocumentUrl(rawUrl: string): URL {
  const url = assertHttpUrl(rawUrl);
  // Fragments never reach the network; dropping one keeps `finalUrl` equal to the requested target.
  url.hash = "";
  assertDocumentTargetAllowed(url);
  return url;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);

  const limit = MCP_OPENAPI_LIMITS.maxDocumentBytes;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw sourceUnavailable(
          "The OpenAPI document exceeds the accepted size.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw sourceUnavailable(
      "The OpenAPI document response could not be read.",
      error,
    );
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readDocument(
  response: Response,
  finalUrl: URL,
): Promise<FetchedOpenApiDocument> {
  const contentType = response.headers
    .get("content-type")
    ?.trim()
    .toLowerCase();

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw sourceUnavailable(
      "The OpenAPI document source returned an unsuccessful status.",
    );
  }
  if (contentType && BINARY_CONTENT_TYPE_PATTERN.test(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    throw sourceUnavailable(
      "The OpenAPI document source returned a binary content type.",
    );
  }

  const bytes = await readBoundedBody(response);
  const finalUrlText = finalUrl.toString();
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
    finalUrl: finalUrlText,
    sourceLabel: sanitizeOpenApiSourceLabel(finalUrlText),
    contentType,
  };
}

type RetrieveDocumentInput = {
  url: URL;
  fetchImpl: typeof fetch;
  resolveGuard: (hostname: string) => Promise<void>;
  signal: AbortSignal;
};

async function retrieveDocument(
  input: RetrieveDocumentInput,
): Promise<FetchedOpenApiDocument> {
  let currentUrl = input.url;

  for (let redirects = 0; ; redirects += 1) {
    if (redirects > MCP_OPENAPI_LIMITS.maxRedirects) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_REDIRECT_REJECTED,
        message: "Too many redirects.",
        status: 502,
      });
    }

    assertDocumentTargetAllowed(currentUrl);
    await input.resolveGuard(currentUrl.hostname);

    let response: Response;
    try {
      response = await input.fetchImpl(currentUrl, {
        method: "GET",
        headers: DOCUMENT_REQUEST_HEADERS,
        redirect: "manual",
        signal: input.signal,
      });
    } catch (error) {
      throw sourceUnavailable(
        "The OpenAPI document source could not be reached.",
        error,
      );
    }

    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return readDocument(response, currentUrl);
    }

    await response.body?.cancel().catch(() => undefined);
    currentUrl = assertSameOriginRedirect(currentUrl, location);
    currentUrl.hash = "";
  }
}

/** Retrieves a public OpenAPI document under a dedicated SSRF-safe policy. Throws AppError. */
export async function fetchOpenApiDocument(
  input: FetchOpenApiDocumentInput,
): Promise<FetchedOpenApiDocument> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const resolveGuard = input.resolveGuard ?? assertResolvedAddressesSafe;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("mcp-openapi-document-deadline-exceeded"));
  }, MCP_OPENAPI_LIMITS.fetchDeadlineMs);

  try {
    return await retrieveDocument({
      url: parseDocumentUrl(input.url),
      fetchImpl,
      resolveGuard,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw sourceUnavailable(
        "The OpenAPI document source did not respond before the deadline.",
        error,
      );
    }
    throw asRetrievalError(error);
  } finally {
    clearTimeout(timer);
  }
}

/** Removes query, fragment, and userinfo from a document URL for persistence. */
export function sanitizeOpenApiSourceLabel(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return INVALID_SOURCE_LABEL;
  }
  if (!url.hostname) return INVALID_SOURCE_LABEL;

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
