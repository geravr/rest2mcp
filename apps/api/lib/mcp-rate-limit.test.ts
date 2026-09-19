import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPlatformRateLimitState,
  releasePlatformRequest,
  releaseServerSlot,
  resetRateLimitState,
  sweepIdlePlatformRateLimitState,
  tryAcquirePlatformRequest,
  tryAcquirePlatformWrite,
  tryAcquireInvocation,
} from "./mcp-rate-limit.js";
import {
  MCP_PLATFORM_CONCURRENCY_LIMIT,
  MCP_PLATFORM_REQUEST_CAPACITY,
  MCP_PLATFORM_REQUEST_REFILL_PER_SEC,
  MCP_PLATFORM_WRITE_CAPACITY,
  MCP_RATE_LIMIT_MUTATION_CAPACITY,
  MCP_RATE_LIMIT_TOKEN_CAPACITY,
  MCP_RATE_LIMIT_TOKEN_REFILL_PER_SEC,
  MCP_SERVER_CONCURRENCY_LIMIT,
} from "./mcp-policy.js";

afterEach(() => {
  resetRateLimitState();
  vi.useRealTimers();
});

describe("platform control-plane budgets", () => {
  it("caps concurrent requests per PAT and refunds on release", () => {
    for (let i = 0; i < MCP_PLATFORM_CONCURRENCY_LIMIT; i += 1) {
      expect(tryAcquirePlatformRequest("mtk_a").ok).toBe(true);
    }
    expect(tryAcquirePlatformRequest("mtk_a").ok).toBe(false);

    releasePlatformRequest("mtk_a");
    expect(tryAcquirePlatformRequest("mtk_a").ok).toBe(true);
    for (let i = 0; i < MCP_PLATFORM_CONCURRENCY_LIMIT; i += 1) {
      releasePlatformRequest("mtk_a");
    }
  });

  it("isolates budgets per token", () => {
    for (let i = 0; i < MCP_PLATFORM_CONCURRENCY_LIMIT; i += 1) {
      tryAcquirePlatformRequest("mtk_a");
    }
    expect(tryAcquirePlatformRequest("mtk_a").ok).toBe(false);
    expect(tryAcquirePlatformRequest("mtk_b").ok).toBe(true);
  });

  it("caps writes more strictly than requests", () => {
    for (let i = 0; i < MCP_PLATFORM_WRITE_CAPACITY; i += 1) {
      expect(tryAcquirePlatformWrite("mtk_a").ok).toBe(true);
    }
    expect(tryAcquirePlatformWrite("mtk_a").ok).toBe(false);
    // Request capacity is larger and untouched by write consumption.
    expect(MCP_PLATFORM_REQUEST_CAPACITY).toBeGreaterThan(
      MCP_PLATFORM_WRITE_CAPACITY,
    );
  });

  it("clears state on revocation and sweeps idle buckets", () => {
    tryAcquirePlatformRequest("mtk_revoked");
    clearPlatformRateLimitState("mtk_revoked");
    expect(tryAcquirePlatformRequest("mtk_revoked").ok).toBe(true);
    releasePlatformRequest("mtk_revoked");

    tryAcquirePlatformRequest("mtk_idle");
    releasePlatformRequest("mtk_idle");
    expect(sweepIdlePlatformRateLimitState(0)).toBeGreaterThanOrEqual(1);
  });

  it("refills the request bucket over time after exhaustion", () => {
    vi.useFakeTimers();
    const token = "mtk_refill";

    for (let i = 0; i < MCP_PLATFORM_REQUEST_CAPACITY; i += 1) {
      expect(tryAcquirePlatformRequest(token).ok).toBe(true);
      releasePlatformRequest(token);
    }
    expect(tryAcquirePlatformRequest(token).ok).toBe(false);

    const refillWindowMs = Math.ceil(
      (1 / MCP_PLATFORM_REQUEST_REFILL_PER_SEC) * 1000,
    );

    vi.advanceTimersByTime(refillWindowMs - 100);
    expect(tryAcquirePlatformRequest(token).ok).toBe(false);

    vi.advanceTimersByTime(200);
    expect(tryAcquirePlatformRequest(token).ok).toBe(true);
    releasePlatformRequest(token);
  });

  it("caps writes independently per token without requiring a refund", () => {
    const tokenA = "mtk_write_a";
    const tokenB = "mtk_write_b";

    for (let i = 0; i < MCP_PLATFORM_WRITE_CAPACITY; i += 1) {
      expect(tryAcquirePlatformWrite(tokenA).ok).toBe(true);
    }
    expect(tryAcquirePlatformWrite(tokenA).ok).toBe(false);

    // Write buckets are per token: exhausting one leaves the other untouched.
    expect(tryAcquirePlatformWrite(tokenB).ok).toBe(true);

    // No release API exists for writes; request activity neither refunds nor
    // further consumes the already exhausted write bucket.
    for (let i = 0; i < MCP_PLATFORM_REQUEST_CAPACITY; i += 1) {
      tryAcquirePlatformRequest(tokenA);
      releasePlatformRequest(tokenA);
    }
    expect(tryAcquirePlatformRequest(tokenA).ok).toBe(false);
    expect(tryAcquirePlatformWrite(tokenA).ok).toBe(false);
  });

  it("refunds a concurrency slot exactly once and never goes negative", () => {
    const token = "mtk_concurrency";

    expect(tryAcquirePlatformRequest(token).ok).toBe(true);
    releasePlatformRequest(token);
    releasePlatformRequest(token);

    // Exactly MCP_PLATFORM_CONCURRENCY_LIMIT slots are available: a negative
    // counter would have granted extra concurrency.
    for (let i = 0; i < MCP_PLATFORM_CONCURRENCY_LIMIT; i += 1) {
      expect(tryAcquirePlatformRequest(token).ok).toBe(true);
    }
    expect(tryAcquirePlatformRequest(token).ok).toBe(false);

    for (let i = 0; i < MCP_PLATFORM_CONCURRENCY_LIMIT; i += 1) {
      releasePlatformRequest(token);
    }
    expect(tryAcquirePlatformRequest(token).ok).toBe(true);
    releasePlatformRequest(token);
  });

  it("drops request, write, and concurrency state on revocation", () => {
    const token = "mtk_revoked";

    for (let i = 0; i < MCP_PLATFORM_REQUEST_CAPACITY; i += 1) {
      tryAcquirePlatformRequest(token);
      releasePlatformRequest(token);
    }
    for (let i = 0; i < MCP_PLATFORM_WRITE_CAPACITY; i += 1) {
      tryAcquirePlatformWrite(token);
    }
    expect(tryAcquirePlatformRequest(token).ok).toBe(false);
    expect(tryAcquirePlatformWrite(token).ok).toBe(false);

    clearPlatformRateLimitState(token);

    expect(tryAcquirePlatformRequest(token).ok).toBe(true);
    releasePlatformRequest(token);
    expect(tryAcquirePlatformWrite(token).ok).toBe(true);

    for (let i = 0; i < MCP_PLATFORM_CONCURRENCY_LIMIT; i += 1) {
      expect(tryAcquirePlatformRequest(token).ok).toBe(true);
    }
    expect(tryAcquirePlatformRequest(token).ok).toBe(false);
  });

  it("sweeps idle tokens but preserves tokens with in-flight concurrency", () => {
    vi.useFakeTimers();
    const idle = "mtk_idle";
    const busy = "mtk_busy";

    for (let i = 0; i < MCP_PLATFORM_WRITE_CAPACITY; i += 1) {
      tryAcquirePlatformWrite(idle);
      tryAcquirePlatformWrite(busy);
    }
    expect(tryAcquirePlatformWrite(idle).ok).toBe(false);
    expect(tryAcquirePlatformWrite(busy).ok).toBe(false);

    expect(tryAcquirePlatformRequest(busy).ok).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(sweepIdlePlatformRateLimitState(500)).toBe(1);

    // Cleared token starts with a full write bucket.
    expect(tryAcquirePlatformWrite(idle).ok).toBe(true);
    // In-flight token keeps its still-depleted bucket across the idle window.
    expect(tryAcquirePlatformWrite(busy).ok).toBe(false);

    releasePlatformRequest(busy);
  });

  it("keeps Platform and invocation buckets from interfering", () => {
    vi.useFakeTimers();
    const token = "tok_shared";
    const server = "srv_shared";

    for (let i = 0; i < MCP_PLATFORM_REQUEST_CAPACITY; i += 1) {
      tryAcquirePlatformRequest(token);
      releasePlatformRequest(token);
    }
    expect(tryAcquirePlatformRequest(token).ok).toBe(false);

    // Exhausted Platform budget does not touch the invocation budget.
    expect(
      tryAcquireInvocation({
        tokenId: token,
        serverId: server,
        mutating: false,
      }).ok,
    ).toBe(true);
    releaseServerSlot(server);

    for (let i = 1; i < MCP_RATE_LIMIT_TOKEN_CAPACITY; i += 1) {
      expect(
        tryAcquireInvocation({
          tokenId: token,
          serverId: server,
          mutating: false,
        }).ok,
      ).toBe(true);
      releaseServerSlot(server);
    }
    expect(
      tryAcquireInvocation({
        tokenId: token,
        serverId: server,
        mutating: false,
      }).ok,
    ).toBe(false);

    // Advance to where only the faster Platform bucket has refilled.
    const requestWindowMs = Math.ceil(
      (1 / MCP_PLATFORM_REQUEST_REFILL_PER_SEC) * 1000,
    );
    const invocationWindowMs = Math.ceil(
      (1 / MCP_RATE_LIMIT_TOKEN_REFILL_PER_SEC) * 1000,
    );
    expect(requestWindowMs).toBeLessThan(invocationWindowMs);
    vi.advanceTimersByTime(requestWindowMs + 1);

    expect(tryAcquirePlatformRequest(token).ok).toBe(true);
    releasePlatformRequest(token);
    expect(
      tryAcquireInvocation({
        tokenId: token,
        serverId: server,
        mutating: false,
      }).ok,
    ).toBe(false);
  });
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
