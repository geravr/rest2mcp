import { describe, expect, it, vi } from "vitest";

const tables = vi.hoisted(() => ({
  verification: {
    id: "verification.id",
    identifier: "verification.identifier",
    value: "verification.value",
    expiresAt: "verification.expires_at",
    createdAt: "verification.created_at",
  },
}));

const drizzleFns = vi.hoisted(() => ({
  desc: vi.fn((value: unknown) => ({ kind: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
}));

vi.mock("@repo/db", () => tables);
vi.mock("drizzle-orm", () => drizzleFns);

import { clearSignInOtps, isSignInOtpValid } from "./otp-peek.js";

function makeSelectChain(result: unknown) {
  const limit = vi.fn().mockResolvedValue(result);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  return { select: vi.fn(() => ({ from })), limit, orderBy, where };
}

describe("isSignInOtpValid", () => {
  it("accepts the newest matching OTP", async () => {
    const chain = makeSelectChain([
      {
        id: "vfy_1",
        value: "123456:0",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const db = { ...chain, update: vi.fn(), delete: vi.fn() };

    await expect(
      isSignInOtpValid(db as never, "User@Example.com", "123456"),
    ).resolves.toBe(true);
    expect(drizzleFns.eq).toHaveBeenCalledWith(
      tables.verification.identifier,
      "sign-in-otp-user@example.com",
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("increments attempts on mismatch", async () => {
    const chain = makeSelectChain([
      {
        id: "vfy_1",
        value: "123456:1",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    const db = {
      ...chain,
      update: vi.fn(() => ({ set })),
      delete: vi.fn(),
    };

    await expect(
      isSignInOtpValid(db as never, "user@example.com", "000000"),
    ).resolves.toBe(false);
    expect(set).toHaveBeenCalledWith({ value: "123456:2" });
  });

  it("rejects after allowed attempts are exhausted", async () => {
    const chain = makeSelectChain([
      {
        id: "vfy_1",
        value: "123456:3",
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    const db = {
      ...chain,
      update: vi.fn(),
      delete: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    };

    await expect(
      isSignInOtpValid(db as never, "user@example.com", "123456"),
    ).resolves.toBe(false);
    expect(db.delete).toHaveBeenCalled();
  });
});

describe("clearSignInOtps", () => {
  it("deletes the sign-in OTP identifier", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const db = {
      delete: vi.fn(() => ({ where })),
    };

    await clearSignInOtps(db as never, "User@Example.com");
    expect(db.delete).toHaveBeenCalledWith(tables.verification);
    expect(drizzleFns.eq).toHaveBeenCalledWith(
      tables.verification.identifier,
      "sign-in-otp-user@example.com",
    );
  });
});
