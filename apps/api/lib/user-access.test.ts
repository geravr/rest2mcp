import { describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => ({
  user: {
    id: "user.id",
    bannedAt: "user.banned_at",
  },
}));

const eqMock = vi.hoisted(() =>
  vi.fn((left: unknown, right: unknown) => ({ left, right })),
);

vi.mock("@repo/db", () => tables);
vi.mock("drizzle-orm", () => ({
  eq: eqMock,
}));

import { isUserBanned } from "./user-access.js";

function makeChain<T>(result: T) {
  const handler: ProxyHandler<object> = {
    get(_, prop: string | symbol) {
      if (prop === "then") {
        return (
          resolve: (value: T) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

describe("isUserBanned", () => {
  it("returns true when bannedAt is set", async () => {
    const db = {
      select: vi.fn(() => makeChain([{ bannedAt: new Date() }])),
    };

    await expect(isUserBanned(db as never, "usr_1")).resolves.toBe(true);
  });

  it("returns false when bannedAt is null", async () => {
    const db = {
      select: vi.fn(() => makeChain([{ bannedAt: null }])),
    };

    await expect(isUserBanned(db as never, "usr_1")).resolves.toBe(false);
  });
});
