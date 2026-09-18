import { afterEach, describe, expect, it } from "vitest";
import {
  releaseServerSlot,
  resetRateLimitState,
  tryAcquireInvocation,
} from "./mcp-rate-limit.js";
import {
  MCP_RATE_LIMIT_MUTATION_CAPACITY,
  MCP_RATE_LIMIT_TOKEN_CAPACITY,
  MCP_SERVER_CONCURRENCY_LIMIT,
} from "./mcp-policy.js";

afterEach(() => {
  resetRateLimitState();
});

describe("tryAcquireInvocation: per-token bucket", () => {
  it("allows invocations up to capacity then rate-limits", () => {
    const tokenId = "tok_1";
    for (let i = 0; i < MCP_RATE_LIMIT_TOKEN_CAPACITY; i += 1) {
      const result = tryAcquireInvocation({
        tokenId,
        serverId: "srv_1",
        mutating: false,
      });
      expect(result.ok).toBe(true);
      releaseServerSlot("srv_1");
    }

    const exhausted = tryAcquireInvocation({
      tokenId,
      serverId: "srv_1",
      mutating: false,
    });
    expect(exhausted.ok).toBe(false);
    expect(exhausted.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks separate buckets per token", () => {
    for (let i = 0; i < MCP_RATE_LIMIT_TOKEN_CAPACITY; i += 1) {
      tryAcquireInvocation({
        tokenId: "tok_a",
        serverId: "srv_1",
        mutating: false,
      });
      releaseServerSlot("srv_1");
    }
    expect(
      tryAcquireInvocation({
        tokenId: "tok_a",
        serverId: "srv_1",
        mutating: false,
      }).ok,
    ).toBe(false);
    expect(
      tryAcquireInvocation({
        tokenId: "tok_b",
        serverId: "srv_1",
        mutating: false,
      }).ok,
    ).toBe(true);
  });
});

describe("tryAcquireInvocation: mutation bucket", () => {
  it("applies a stricter budget for mutating invocations", () => {
    const tokenId = "tok_mut";
    for (let i = 0; i < MCP_RATE_LIMIT_MUTATION_CAPACITY; i += 1) {
      const result = tryAcquireInvocation({
        tokenId,
        serverId: "srv_1",
        mutating: true,
      });
      expect(result.ok).toBe(true);
      releaseServerSlot("srv_1");
    }

    const exhausted = tryAcquireInvocation({
      tokenId,
      serverId: "srv_1",
      mutating: true,
    });
    expect(exhausted.ok).toBe(false);
  });

  it("does not deplete the mutation bucket for non-mutating calls", () => {
    const tokenId = "tok_mixed";
    for (let i = 0; i < MCP_RATE_LIMIT_MUTATION_CAPACITY + 5; i += 1) {
      const result = tryAcquireInvocation({
        tokenId,
        serverId: "srv_1",
        mutating: false,
      });
      expect(result.ok).toBe(true);
      releaseServerSlot("srv_1");
    }
  });

  it("refunds the invocation token when the mutation bucket rejects", () => {
    const tokenId = "tok_refund";
    for (let i = 0; i < MCP_RATE_LIMIT_MUTATION_CAPACITY; i += 1) {
      tryAcquireInvocation({ tokenId, serverId: "srv_1", mutating: true });
      releaseServerSlot("srv_1");
    }
    const rejected = tryAcquireInvocation({
      tokenId,
      serverId: "srv_1",
      mutating: true,
    });
    expect(rejected.ok).toBe(false);

    // The refunded invocation token should still allow a non-mutating call.
    const nonMutating = tryAcquireInvocation({
      tokenId,
      serverId: "srv_1",
      mutating: false,
    });
    expect(nonMutating.ok).toBe(true);
  });
});

describe("tryAcquireInvocation: per-server concurrency", () => {
  it("caps concurrent in-flight invocations per server", () => {
    const acquired: string[] = [];
    for (let i = 0; i < MCP_SERVER_CONCURRENCY_LIMIT; i += 1) {
      const result = tryAcquireInvocation({
        tokenId: `tok_${i}`,
        serverId: "srv_concurrency",
        mutating: false,
      });
      expect(result.ok).toBe(true);
      acquired.push(`tok_${i}`);
    }

    const overflow = tryAcquireInvocation({
      tokenId: "tok_overflow",
      serverId: "srv_concurrency",
      mutating: false,
    });
    expect(overflow.ok).toBe(false);

    releaseServerSlot("srv_concurrency");
    const afterRelease = tryAcquireInvocation({
      tokenId: "tok_after_release",
      serverId: "srv_concurrency",
      mutating: false,
    });
    expect(afterRelease.ok).toBe(true);
  });

  it("tracks concurrency independently per server", () => {
    for (let i = 0; i < MCP_SERVER_CONCURRENCY_LIMIT; i += 1) {
      tryAcquireInvocation({
        tokenId: `tok_${i}`,
        serverId: "srv_a",
        mutating: false,
      });
    }
    const otherServer = tryAcquireInvocation({
      tokenId: "tok_other",
      serverId: "srv_b",
      mutating: false,
    });
    expect(otherServer.ok).toBe(true);
  });
});

describe("resetRateLimitState", () => {
  it("clears buckets and concurrency counters", () => {
    tryAcquireInvocation({
      tokenId: "tok_x",
      serverId: "srv_x",
      mutating: false,
    });
    resetRateLimitState();
    const result = tryAcquireInvocation({
      tokenId: "tok_x",
      serverId: "srv_x",
      mutating: false,
    });
    expect(result.ok).toBe(true);
  });
});
