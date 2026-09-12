import { APP_ERROR_CODES } from "@repo/core";
import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { extractAppCodeFromTrpcCause } from "./app-error.js";
import { createCallerFactory, router } from "./trpc.js";
import { protectedProcedure } from "./trpc.js";

vi.mock("./user-access.js", () => ({
  isUserBanned: vi.fn(),
}));

import { isUserBanned } from "./user-access.js";

const createCaller = createCallerFactory(
  router({
    ping: protectedProcedure.query(() => ({ ok: true })),
  }),
);

describe("protectedProcedure ban enforcement", () => {
  it("rejects callers without a session as tRPC UNAUTHORIZED", async () => {
    const caller = createCaller({
      db: {},
      user: null,
      session: null,
    } as never);

    await expect(caller.ping()).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof TRPCError)) return false;
      return (
        error.code === "UNAUTHORIZED" &&
        extractAppCodeFromTrpcCause(error.cause) ===
          APP_ERROR_CODES.AUTHENTICATION_REQUIRED
      );
    });
  });

  it("rejects banned callers before the handler runs", async () => {
    vi.mocked(isUserBanned).mockResolvedValueOnce(true);

    const caller = createCaller({
      db: {},
      user: { id: "usr_banned", role: "user" },
      session: { id: "ses_1" },
    } as never);

    await expect(caller.ping()).rejects.toSatisfy((error: unknown) => {
      if (!(error instanceof TRPCError)) return false;
      return (
        error.code === "FORBIDDEN" &&
        extractAppCodeFromTrpcCause(error.cause) ===
          APP_ERROR_CODES.ACCOUNT_SUSPENDED
      );
    });
  });

  it("allows callers that are not banned", async () => {
    vi.mocked(isUserBanned).mockResolvedValueOnce(false);

    const caller = createCaller({
      db: {},
      user: { id: "usr_ok", role: "user" },
      session: { id: "ses_1" },
    } as never);

    await expect(caller.ping()).resolves.toEqual({ ok: true });
  });
});
