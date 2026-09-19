import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { APP_ERROR_CODES, MCP_OPENAPI_LIMITS } from "@repo/core";
import { AppError } from "./app-error.js";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import {
  fetchOpenApiDocument,
  sanitizeOpenApiSourceLabel,
} from "./openapi-fetch.js";

const DOCUMENT_URL = "https://docs.example.com/spec.json";
const PUBLIC_ADDRESS = "93.184.216.34";

type FetchCall = Parameters<typeof fetch>;

/** The recorded calls of a fetch mock, without assertion-level casts at each use. */
function callsOf(fetchImpl: Mock<typeof fetch>): FetchCall[] {
  return fetchImpl.mock.calls;
}

async function captureAppError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected the retrieval to reject");
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function publicGuard(): Promise<void> {
  return Promise.resolve();
}

describe("fetchOpenApiDocument: public retrieval", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns document text, sanitized label, and content type for a public HTTPS source", async () => {
    const resolveGuard = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"openapi":"3.1.0"}', {
        status: 200,
        headers: { "content-type": "Application/JSON; charset=utf-8" },
      }),
    );

    const document = await fetchOpenApiDocument({
      url: "https://docs.example.com/spec.json?token=abc#section",
      fetchImpl,
      resolveGuard,
    });

    expect(document.text).toBe('{"openapi":"3.1.0"}');
    expect(document.finalUrl).toBe(
      "https://docs.example.com/spec.json?token=abc",
    );
    expect(document.sourceLabel).toBe(DOCUMENT_URL);
    expect(document.contentType).toBe("application/json; charset=utf-8");

    expect(resolveGuard).toHaveBeenCalledTimes(1);
    expect(resolveGuard).toHaveBeenCalledWith("docs.example.com");
    expect(callsOf(fetchImpl)).toHaveLength(1);
    const [target, init] = callsOf(fetchImpl)[0];
    expect(target.toString()).toBe(
      "https://docs.example.com/spec.json?token=abc",
    );
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
  });

  it("drops the submitted fragment from the requested url", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse('{"openapi":"3.1.0"}'));

    const document = await fetchOpenApiDocument({
      url: "https://docs.example.com/spec.json#/paths/~1items",
      fetchImpl,
      resolveGuard: publicGuard,
    });

    expect(callsOf(fetchImpl)[0][0].toString()).toBe(DOCUMENT_URL);
    expect(document.finalUrl).toBe(DOCUMENT_URL);
    expect(document.sourceLabel).toBe(DOCUMENT_URL);
  });

  it("accepts a response without a content type", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new TextEncoder().encode('{"ok":true}')));

    const document = await fetchOpenApiDocument({
      url: DOCUMENT_URL,
      fetchImpl,
      resolveGuard: publicGuard,
    });

    expect(document.text).toBe('{"ok":true}');
    expect(document.contentType).toBeUndefined();
  });

  it("accepts non-binary YAML and plain-text content types", async () => {
    for (const type of ["text/yaml", "application/yaml", "text/plain"]) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response("openapi: 3.1.0", {
          status: 200,
          headers: { "content-type": type },
        }),
      );

      const document = await fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      });

      expect(document.text).toBe("openapi: 3.1.0");
      expect(document.contentType).toBe(type);
    }
  });

  it("sends exactly the accept and user-agent headers and never credentials", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirectResponse("/v2/spec.json"))
      .mockResolvedValueOnce(jsonResponse("{}"));

    await fetchOpenApiDocument({
      url: DOCUMENT_URL,
      fetchImpl,
      resolveGuard: publicGuard,
    });

    expect(callsOf(fetchImpl)).toHaveLength(2);
    for (const [, init] of callsOf(fetchImpl)) {
      const headers = init?.headers as Record<string, string>;
      expect(Object.keys(headers).sort()).toEqual(["accept", "user-agent"]);
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
      expect(headers["proxy-authorization"]).toBeUndefined();
    }
  });

  it("does not consult any server allowlist", async () => {
    lookupMock.mockResolvedValue([{ address: PUBLIC_ADDRESS }]);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse("{}"));

    const document = await fetchOpenApiDocument({
      url: "https://cdn.other-example.net/spec.json",
      fetchImpl,
    });

    expect(document.text).toBe("{}");
    expect(callsOf(fetchImpl)).toHaveLength(1);
  });
});

describe("fetchOpenApiDocument: target policy", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it.each([
    ["loopback literal", "https://127.0.0.1/spec.json"],
    ["private literal", "https://192.168.4.10/spec.json"],
    ["link-local literal", "https://169.254.169.254/latest/meta-data"],
    ["IPv6 loopback literal", "https://[::1]/spec.json"],
    ["metadata host", "https://metadata.google.internal/x"],
    ["internal-suffix host", "https://specs.internal/spec.json"],
  ])("rejects a %s before any request", async (_label, url) => {
    lookupMock.mockResolvedValue([{ address: PUBLIC_ADDRESS }]);
    const fetchImpl = vi.fn<typeof fetch>();
    const resolveGuard = vi.fn();

    const error = await captureAppError(
      fetchOpenApiDocument({ url, fetchImpl, resolveGuard }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolveGuard).not.toHaveBeenCalled();
  });

  it("rejects a hostname whose DNS answers include a private address", async () => {
    lookupMock.mockResolvedValue([
      { address: PUBLIC_ADDRESS },
      { address: "10.0.0.5" },
    ]);
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await captureAppError(
      fetchOpenApiDocument({ url: DOCUMENT_URL, fetchImpl }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a hostname whose DNS lookup fails", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await captureAppError(
      fetchOpenApiDocument({ url: DOCUMENT_URL, fetchImpl }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("allows a hostname resolving only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: PUBLIC_ADDRESS }]);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse("{}"));

    const document = await fetchOpenApiDocument({
      url: DOCUMENT_URL,
      fetchImpl,
    });

    expect(document.text).toBe("{}");
  });

  it("rejects a plain HTTP url", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: "http://docs.example.com/spec.json",
        fetchImpl,
        resolveGuard: vi.fn(),
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a url carrying userinfo", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: "https://owner:secret@docs.example.com/spec.json",
        fetchImpl,
        resolveGuard: vi.fn(),
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unparseable url", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: "not a url",
        fetchImpl,
        resolveGuard: vi.fn(),
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a failed DNS guard without echoing the query", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const resolveGuard = vi
      .fn()
      .mockRejectedValue(new Error("blocked docs.example.com?token=abc"));

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: "https://docs.example.com/spec.json?token=abc",
        fetchImpl,
        resolveGuard,
      }),
    );

    expect(error.message).not.toContain("token=abc");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("fetchOpenApiDocument: redirects", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("rejects a cross-origin redirect without issuing a second request", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(redirectResponse("https://evil.example/spec.json"));

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_REDIRECT_REJECTED);
    expect(callsOf(fetchImpl)).toHaveLength(1);
  });

  it("rejects an HTTPS-to-HTTP downgrade", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(redirectResponse("http://docs.example.com/spec.json"));

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_REDIRECT_REJECTED);
    expect(callsOf(fetchImpl)).toHaveLength(1);
  });

  it("rejects a redirect carrying userinfo", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        redirectResponse("https://owner:secret@docs.example.com/spec.json"),
      );

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_REDIRECT_REJECTED);
    expect(callsOf(fetchImpl)).toHaveLength(1);
  });

  it("rejects more than three redirects", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(redirectResponse("/next.json"));

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_REDIRECT_REJECTED);
    expect(callsOf(fetchImpl)).toHaveLength(
      MCP_OPENAPI_LIMITS.maxRedirects + 1,
    );
  });

  it("follows same-origin redirects and reports the final label and DNS checks", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirectResponse("/v2/spec.json?revision=7"))
      .mockResolvedValueOnce(jsonResponse('{"openapi":"3.0.0"}'));
    const resolveGuard = vi.fn().mockResolvedValue(undefined);

    const document = await fetchOpenApiDocument({
      url: DOCUMENT_URL,
      fetchImpl,
      resolveGuard,
    });

    expect(document.finalUrl).toBe(
      "https://docs.example.com/v2/spec.json?revision=7",
    );
    expect(document.sourceLabel).toBe("https://docs.example.com/v2/spec.json");
    expect(callsOf(fetchImpl)).toHaveLength(2);
    expect(resolveGuard.mock.calls).toEqual([
      ["docs.example.com"],
      ["docs.example.com"],
    ]);
  });

  it("validates the resolved address of a redirect target before requesting it", async () => {
    const lookups: string[][] = [];
    const resolveGuard = vi.fn(async (hostname: string) => {
      lookups.push([hostname]);
      if (lookups.length === 2) throw new Error("blocked");
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirectResponse("/moved/spec.json"))
      .mockResolvedValueOnce(jsonResponse("{}"));

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard,
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE);
    expect(lookups).toEqual([["docs.example.com"], ["docs.example.com"]]);
    expect(callsOf(fetchImpl)).toHaveLength(1);
  });
});

describe("fetchOpenApiDocument: bounded retrieval", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects an oversized body and cancels the reader", async () => {
    const megabyte = new Uint8Array(1024 * 1024).fill(97);
    const chunks =
      MCP_OPENAPI_LIMITS.maxDocumentBytes / megabyte.byteLength + 1;
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < chunks; index += 1) {
          controller.enqueue(megabyte);
        }
      },
      cancel() {
        cancelled();
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("rejects a stream that fails while being read", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.error(new Error("socket closed"));
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { status: 200 }));

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE);
  });

  it("rejects a non-2xx status", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("nope", { status: 503, headers: { server: "edge" } }),
      );

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE);
    expect(error.status).toBe(502);
    expect(error.message).not.toContain("edge");
  });

  it("rejects a network failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));

    const error = await captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE);
    expect(error.message).not.toContain("docs.example.com");
  });

  it.each(["application/pdf", "application/octet-stream", "image/png"])(
    "rejects the binary content type %s",
    async (contentType) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { "content-type": contentType },
        }),
      );

      const error = await captureAppError(
        fetchOpenApiDocument({
          url: DOCUMENT_URL,
          fetchImpl,
          resolveGuard: publicGuard,
        }),
      );

      expect(error.appCode).toBe(
        APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE,
      );
    },
  );

  it("aborts the in-flight request when the total deadline expires", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
    );

    const pending = captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    await vi.advanceTimersByTimeAsync(MCP_OPENAPI_LIMITS.fetchDeadlineMs);

    const error = await pending;
    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE);
    expect(error.status).toBe(502);
    expect(callsOf(fetchImpl)).toHaveLength(1);
    expect(callsOf(fetchImpl)[0][1]?.signal?.aborted).toBe(true);
  });

  it("keeps one total deadline across hops instead of resetting per hop", async () => {
    vi.useFakeTimers();
    let secondHopAborted = false;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 8_000));
        return redirectResponse("/next.json");
      })
      .mockImplementationOnce(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              secondHopAborted = true;
              reject(
                new DOMException("The operation was aborted", "AbortError"),
              );
            });
          }),
      );

    const pending = captureAppError(
      fetchOpenApiDocument({
        url: DOCUMENT_URL,
        fetchImpl,
        resolveGuard: publicGuard,
      }),
    );

    await vi.advanceTimersByTimeAsync(9_999);
    expect(callsOf(fetchImpl)).toHaveLength(2);
    expect(secondHopAborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(secondHopAborted).toBe(true);

    const error = await pending;
    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_OPENAPI_SOURCE_UNAVAILABLE);
    expect(error.status).toBe(502);
  });
});

describe("sanitizeOpenApiSourceLabel", () => {
  it("removes query, fragment, and userinfo while keeping scheme, host, port, and path", () => {
    expect(
      sanitizeOpenApiSourceLabel(
        "https://owner:secret@docs.example.com:8443/v1/spec.json?token=abc#schemas",
      ),
    ).toBe("https://docs.example.com:8443/v1/spec.json");
  });

  it("is deterministic for the same input", () => {
    const first = sanitizeOpenApiSourceLabel(
      "https://docs.example.com/spec.json?token=abc",
    );
    const second = sanitizeOpenApiSourceLabel(
      "https://docs.example.com/spec.json?token=abc",
    );

    expect(first).toBe("https://docs.example.com/spec.json");
    expect(second).toBe(first);
  });

  it.each([
    ["an unparseable string", "not a url"],
    ["an empty string", ""],
    ["a host-less scheme", "mailto:owner@example.com"],
    ["a relative path", "/spec.json"],
  ])("returns one fixed fallback for %s", (_label, input) => {
    expect(sanitizeOpenApiSourceLabel(input)).toBe("invalid-url");
  });
});
