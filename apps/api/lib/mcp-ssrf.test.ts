import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "./app-error.js";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import {
  assertSameHostRedirect,
  assertUpstreamUrlSafe,
  isBlockedIpAddress,
} from "./mcp-ssrf.js";

function expectHostRejected(fn: () => unknown) {
  expect(fn).toThrow(AppError);
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).appCode).toBe(
      APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
    );
  }
}

describe("mcp-ssrf", () => {
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

  it("rejects cross-host redirects", () => {
    expectHostRejected(() =>
      assertSameHostRedirect(
        new URL("https://api.example.com/a"),
        "https://evil.example/b",
      ),
    );
  });

  it("allows same-host redirects", () => {
    const next = assertSameHostRedirect(
      new URL("https://api.example.com/a"),
      "/b",
    );
    expect(next.toString()).toBe("https://api.example.com/b");
  });
});
