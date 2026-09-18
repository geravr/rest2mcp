/**
 * @file In-memory, single-process rate limiting for the MCP gateway boundary.
 * Token buckets are keyed per agent token; a stricter bucket additionally
 * gates mutating invocations. A per-server counter caps concurrent upstream
 * calls. All state is process-local, matching the current single-VPS
 * deployment (see `openspec/changes/harden-mcp-execution-boundary/design.md`).
 */
import {
  MCP_RATE_LIMIT_MUTATION_CAPACITY,
  MCP_RATE_LIMIT_MUTATION_REFILL_PER_SEC,
  MCP_RATE_LIMIT_TOKEN_CAPACITY,
  MCP_RATE_LIMIT_TOKEN_REFILL_PER_SEC,
  MCP_SERVER_CONCURRENCY_LIMIT,
} from "./mcp-policy.js";

type TokenBucket = {
  tokens: number;
  capacity: number;
  refillPerSec: number;
  lastRefillMs: number;
};

function createBucket(capacity: number, refillPerSec: number): TokenBucket {
  return { tokens: capacity, capacity, refillPerSec, lastRefillMs: Date.now() };
}

function refill(bucket: TokenBucket, now: number): void {
  const elapsedSec = (now - bucket.lastRefillMs) / 1000;
  if (elapsedSec <= 0) return;
  bucket.tokens = Math.min(
    bucket.capacity,
    bucket.tokens + elapsedSec * bucket.refillPerSec,
  );
  bucket.lastRefillMs = now;
}

function tryConsume(
  bucket: TokenBucket,
  now: number,
): { ok: boolean; retryAfterSeconds?: number } {
  refill(bucket, now);
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true };
  }
  const deficit = 1 - bucket.tokens;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(deficit / bucket.refillPerSec),
  );
  return { ok: false, retryAfterSeconds };
}

function refund(bucket: TokenBucket | undefined): void {
  if (!bucket) return;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + 1);
}

const invocationBuckets = new Map<string, TokenBucket>();
const mutationBuckets = new Map<string, TokenBucket>();
const serverConcurrency = new Map<string, number>();

function getOrCreateBucket(
  map: Map<string, TokenBucket>,
  key: string,
  capacity: number,
  refillPerSec: number,
): TokenBucket {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = createBucket(capacity, refillPerSec);
    map.set(key, bucket);
  }
  return bucket;
}

export type AcquireInvocationInput = {
  tokenId: string;
  serverId: string;
  mutating: boolean;
};

export type AcquireInvocationResult = {
  ok: boolean;
  retryAfterSeconds?: number;
};

/**
 * Acquires one invocation slot: the per-token bucket, the stricter mutation
 * bucket when `mutating`, and a per-server concurrency slot. On success the
 * caller MUST call `releaseServerSlot` exactly once when the invocation
 * finishes (success or failure). On failure no slot is held.
 */
export function tryAcquireInvocation(
  input: AcquireInvocationInput,
): AcquireInvocationResult {
  const now = Date.now();

  const invocationBucket = getOrCreateBucket(
    invocationBuckets,
    input.tokenId,
    MCP_RATE_LIMIT_TOKEN_CAPACITY,
    MCP_RATE_LIMIT_TOKEN_REFILL_PER_SEC,
  );
  const invocationResult = tryConsume(invocationBucket, now);
  if (!invocationResult.ok) {
    return invocationResult;
  }

  const mutationBucket = input.mutating
    ? getOrCreateBucket(
        mutationBuckets,
        input.tokenId,
        MCP_RATE_LIMIT_MUTATION_CAPACITY,
        MCP_RATE_LIMIT_MUTATION_REFILL_PER_SEC,
      )
    : undefined;
  if (mutationBucket) {
    const mutationResult = tryConsume(mutationBucket, now);
    if (!mutationResult.ok) {
      refund(invocationBucket);
      return mutationResult;
    }
  }

  const inFlight = serverConcurrency.get(input.serverId) ?? 0;
  if (inFlight >= MCP_SERVER_CONCURRENCY_LIMIT) {
    refund(invocationBucket);
    refund(mutationBucket);
    return { ok: false, retryAfterSeconds: 1 };
  }
  serverConcurrency.set(input.serverId, inFlight + 1);

  return { ok: true };
}

/** Releases one concurrency slot acquired by a successful `tryAcquireInvocation`. */
export function releaseServerSlot(serverId: string): void {
  const current = serverConcurrency.get(serverId) ?? 0;
  if (current <= 1) {
    serverConcurrency.delete(serverId);
  } else {
    serverConcurrency.set(serverId, current - 1);
  }
}

/** Test-only: clears all bucket and concurrency state. */
export function resetRateLimitState(): void {
  invocationBuckets.clear();
  mutationBuckets.clear();
  serverConcurrency.clear();
}
