import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "./app-error.js";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import {
  assertPathWithinBase,
  assertSameOriginRedirect,
  assertUpstreamUrlSafe,
  isBlockedIpAddress,
} from "./mcp-ssrf.js";

function expectAppCode(fn: () => unknown, appCode: string) {
  try {
    fn();
    throw new Error("expected function to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).appCode).toBe(appCode);
  }
}

describe("mcp-ssrf: address policy", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("classifies loopback, private, link-local, and metadata IPs as blocked", () => {
    expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("10.0.0.4")).toBe(true);
    expect(isBlockedIpAddress("192.168.1.10")).toBe(true);
    expect(isBlockedIpAddress("169.254.169.254")).toBe(true);
    expect(isBlockedIpAddress("172.16.5.1")).toBe(true);
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("fe80::1")).toBe(true);
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
  });

  it("rejects hosts outside the allowlist", async () => {
    await expect(
      assertUpstreamUrlSafe("https://evil.example/x", ["api.example.com"]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
    );
  });

  it("rejects private DNS answers for an allowed hostname", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1" }]);

    await expect(
      assertUpstreamUrlSafe("https://api.example.com/x", ["api.example.com"]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
    );
  });

  it("allows a public resolved host on the allowlist", async () => {
    lookupMock.mockResolvedValue([{ address: "8.8.8.8" }]);

    const url = await assertUpstreamUrlSafe(
      "https://api.example.com/v1/items",
      ["api.example.com"],
    );
    expect(url.hostname).toBe("api.example.com");
  });
});

describe("assertSameOriginRedirect", () => {
  it("allows a same-origin relative redirect", () => {
    const next = assertSameOriginRedirect(
      new URL("https://api.example.com/a"),
      "/b",
    );
    expect(next.toString()).toBe("https://api.example.com/b");
  });

  it("allows an explicit same-origin absolute redirect", () => {
    const next = assertSameOriginRedirect(
      new URL("https://api.example.com/a"),
      "https://api.example.com/b",
    );
    expect(next.pathname).toBe("/b");
  });

  it("rejects a cross-host redirect", () => {
    expectAppCode(
      () =>
        assertSameOriginRedirect(
          new URL("https://api.example.com/a"),
          "https://evil.example/b",
        ),
      APP_ERROR_CODES.MCP_REDIRECT_REJECTED,
    );
  });

  it("rejects a port change even on the same hostname", () => {
    expectAppCode(
      () =>
        assertSameOriginRedirect(
          new URL("https://api.example.com/a"),
          "https://api.example.com:8443/a",
        ),
      APP_ERROR_CODES.MCP_REDIRECT_REJECTED,
    );
  });

  it("rejects an HTTPS-to-HTTP downgrade", () => {
    expectAppCode(
      () =>
        assertSameOriginRedirect(
          new URL("https://api.example.com/a"),
          "http://api.example.com/a",
        ),
      APP_ERROR_CODES.MCP_REDIRECT_REJECTED,
    );
  });

  it("rejects a redirect target carrying userinfo", () => {
    expectAppCode(
      () =>
        assertSameOriginRedirect(
          new URL("https://api.example.com/a"),
          "https://user:pass@api.example.com/a",
        ),
      APP_ERROR_CODES.MCP_REDIRECT_REJECTED,
    );
  });

  it("rejects a non-HTTP(S) redirect scheme", () => {
    expectAppCode(
      () =>
        assertSameOriginRedirect(
          new URL("https://api.example.com/a"),
          "file:///etc/passwd",
        ),
      APP_ERROR_CODES.MCP_REDIRECT_REJECTED,
    );
  });

  it("allows an explicit default port matching an implicit one", () => {
    const next = assertSameOriginRedirect(
      new URL("https://api.example.com/a"),
      "https://api.example.com:443/b",
    );
    expect(next.pathname).toBe("/b");
  });
});

describe("assertPathWithinBase", () => {
  it("allows a path confined under the base path", () => {
    expect(() => assertPathWithinBase("/v1", "/v1/contacts/1")).not.toThrow();
  });

  it("allows the base path itself", () => {
    expect(() => assertPathWithinBase("/v1", "/v1")).not.toThrow();
  });

  it("rejects a literal dot-segment escape above the base path", () => {
    expectAppCode(
      () => assertPathWithinBase("/v1", "/v1/../../secret"),
      APP_ERROR_CODES.MCP_PATH_ESCAPE,
    );
  });

  it("rejects a percent-encoded dot-segment escape", () => {
    expectAppCode(
      () => assertPathWithinBase("/v1", "/v1/%2e%2e/%2e%2e/secret"),
      APP_ERROR_CODES.MCP_PATH_ESCAPE,
    );
  });

  it("allows a path that dot-segments back into the base path", () => {
    expect(() =>
      assertPathWithinBase("/v1", "/v1/contacts/../items"),
    ).not.toThrow();
  });

  it("treats an empty base path as root, allowing any absolute path", () => {
    expect(() => assertPathWithinBase("", "/anything/here")).not.toThrow();
  });
});
