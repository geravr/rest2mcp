import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProviderFetchJson, type AiHttpPolicy } from "./provider-http.js";

const ALLOWED_ORIGIN = "https://api.example.com";
const REQUEST_URL = "https://api.example.com/v1/models";
const SECRET_HEADER_VALUE = "Bearer secret-token-abc123";

const POLICY: AiHttpPolicy = {
  allowedOrigins: [ALLOWED_ORIGIN],
  deadlineMs: 1_000,
  maxResponseBytes: 64,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function chunkedResponse(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

type FetchInit = { method?: string; body?: unknown; signal?: AbortSignal };
type FetchLike = (
  url: unknown,
  init?: FetchInit,
) => Response | Promise<Response>;

function stubFetch(implementation: FetchLike) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestJson(
  overrides: Partial<{
    url: string;
    method: "GET" | "POST";
    body: string;
    policy: AiHttpPolicy;
    signal: AbortSignal;
  }> = {},
) {
  return aiProviderFetchJson({
    url: REQUEST_URL,
    headers: { authorization: SECRET_HEADER_VALUE },
    ...overrides,
    policy: overrides.policy ?? POLICY,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aiProviderFetchJson fixed origins", () => {
  it("rejects a disallowed origin without contacting the provider", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }));

    await expect(
      requestJson({ url: "https://evil.example.com/v1/models" }),
    ).rejects.toMatchObject({ code: "invalid_request_url", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects plain HTTP URLs without contacting the provider", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }));

    await expect(
      requestJson({ url: "http://api.example.com/v1/models" }),
    ).rejects.toMatchObject({ code: "invalid_request_url", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects relative and unparseable URLs without contacting the provider", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }));

    for (const url of ["/v1/models", "not a url at all"]) {
      await expect(requestJson({ url })).rejects.toMatchObject({
        code: "invalid_request_url",
        retryable: false,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("aiProviderFetchJson strict success", () => {
  it("parses a JSON payload from an approved origin", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ models: ["model-a"] }));

    await expect(requestJson()).resolves.toEqual({
      status: 200,
      json: { models: ["model-a"] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(REQUEST_URL);
    expect(init?.method).toBe("GET");
  });

  it("passes the POST method and body through to the provider", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ok: true }));

    await requestJson({ method: "POST", body: '{"prompt":"hi"}' });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(REQUEST_URL);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"prompt":"hi"}');
  });
});

describe("aiProviderFetchJson redirect handling", () => {
  it("blocks a redirect to a foreign origin after exactly one fetch", async () => {
    const fetchMock = stubFetch(() =>
      redirectResponse("https://evil.example.com/steal"),
    );

    await expect(requestJson()).rejects.toMatchObject({
      code: "redirect_blocked",
      retryable: false,
      httpStatus: 302,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect response without a location target", async () => {
    stubFetch(() => new Response(null, { status: 302 }));

    await expect(requestJson()).rejects.toMatchObject({
      code: "malformed_response",
      httpStatus: 302,
      retryable: false,
    });
  });

  it("blocks a same-origin redirect chain that exceeds maxRedirects", async () => {
    const fetchMock = stubFetch(() =>
      redirectResponse("https://api.example.com/v1/models?page=2"),
    );

    await expect(
      requestJson({ policy: { ...POLICY, maxRedirects: 2 } }),
    ).rejects.toMatchObject({
      code: "redirect_blocked",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("follows an approved same-origin redirect", async () => {
    const fetchMock = stubFetch((input) =>
      String(input).endsWith("/v2/models")
        ? jsonResponse({ models: ["model-a"] })
        : redirectResponse("/v2/models"),
    );

    await expect(requestJson()).resolves.toEqual({
      status: 200,
      json: { models: ["model-a"] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondUrl] = fetchMock.mock.calls[1] ?? [];
    expect(String(secondUrl)).toBe("https://api.example.com/v2/models");
  });
});

describe("aiProviderFetchJson deadline and size limits", () => {
  it("rejects a response body larger than maxResponseBytes", async () => {
    stubFetch(() => chunkedResponse([new Uint8Array(48), new Uint8Array(48)]));

    await expect(requestJson()).rejects.toMatchObject({
      code: "response_too_large",
      retryable: false,
    });
  });

  it("maps a network failure to a retryable transient error", async () => {
    stubFetch(() => Promise.reject(new Error("connection refused")));

    await expect(requestJson()).rejects.toMatchObject({
      code: "transient",
      retryable: true,
    });
  });

  it("maps an aborted in-flight request to the timeout code", async () => {
    const fetchMock = stubFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            },
            { once: true },
          );
        }),
    );
    const outer = new AbortController();
    const pending = aiProviderFetchJson({
      url: REQUEST_URL,
      headers: { authorization: SECRET_HEADER_VALUE },
      policy: POLICY,
      signal: outer.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    });
    outer.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("aiProviderFetchJson status mapping", () => {
  it.each([
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [404, "not_found", false],
    [402, "rejected", false],
    [500, "transient", true],
  ] as const)(
    "maps HTTP %i to %s (retryable: %s)",
    async (status, code, retryable) => {
      stubFetch(() => new Response(null, { status }));

      await expect(requestJson()).rejects.toMatchObject({
        code,
        httpStatus: status,
        retryable,
      });
    },
  );

  it("maps HTTP 429 with retry-after to a retryable rate limit", async () => {
    stubFetch(
      () =>
        new Response(null, {
          status: 429,
          headers: { "retry-after": "12" },
        }),
    );

    await expect(requestJson()).rejects.toMatchObject({
      code: "rate_limited",
      httpStatus: 429,
      retryable: true,
      retryAfterSeconds: 12,
    });
  });
});

describe("aiProviderFetchJson response validation", () => {
  it("rejects a non-JSON success body as malformed", async () => {
    stubFetch(() => new Response("<html>oops</html>", { status: 200 }));

    await expect(requestJson()).rejects.toMatchObject({
      code: "malformed_response",
      httpStatus: 200,
      retryable: false,
    });
  });
});

describe("aiProviderFetchJson secret safety", () => {
  it("keeps the credential header value out of error messages", async () => {
    stubFetch(() => new Response(null, { status: 401 }));
    await expect(requestJson()).rejects.toHaveProperty(
      "message",
      expect.not.stringContaining(SECRET_HEADER_VALUE),
    );

    stubFetch(() => redirectResponse("https://evil.example.com/steal"));
    await expect(requestJson()).rejects.toHaveProperty(
      "message",
      expect.not.stringContaining(SECRET_HEADER_VALUE),
    );

    stubFetch(() => Promise.reject(new Error("connection refused")));
    await expect(requestJson()).rejects.toHaveProperty(
      "message",
      expect.not.stringContaining(SECRET_HEADER_VALUE),
    );
  });
});
