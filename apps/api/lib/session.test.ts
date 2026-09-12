import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import type { AppContext } from "./context.js";
import { errorHandler } from "./middleware.js";

vi.mock("./posthog.js", () => ({
  captureServerException: vi.fn(),
  extractRequestTelemetryDetails: vi.fn(() => ({
    hasTracingHeaders: false,
  })),
}));

const isUserBannedMock = vi.hoisted(() => vi.fn());

vi.mock("./user-access.js", () => ({
  isUserBanned: isUserBannedMock,
}));

import { loadSession, requireActiveUser, requireSession } from "./session.js";

afterEach(() => {
  vi.clearAllMocks();
});

function createGuardedApp(
  session: {
    session: { id: string } | null;
    user: { id: string } | null;
  } | null,
) {
  const app = new Hono<AppContext>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("auth", {
      api: {
        getSession: vi.fn(async () => session),
      },
    } as never);
    c.set("db", {} as never);
    await next();
  });
  app.get("/guarded", requireSession, requireActiveUser, (c) =>
    c.json({ ok: true, userId: c.get("user")?.id }),
  );
  return app;
}

describe("loadSession", () => {
  it("returns null session and user when Better Auth has no session", async () => {
    const auth = {
      api: {
        getSession: vi.fn(async () => null),
      },
    };

    await expect(loadSession(auth as never, new Headers())).resolves.toEqual({
      session: null,
      user: null,
    });
  });

  it("unwraps a populated session payload", async () => {
    const session = { id: "ses_1" };
    const user = { id: "usr_1" };
    const auth = {
      api: {
        getSession: vi.fn(async () => ({ session, user })),
      },
    };

    await expect(loadSession(auth as never, new Headers())).resolves.toEqual({
      session,
      user,
    });
  });
});

describe("requireSession / requireActiveUser", () => {
  it("returns AUTHENTICATION_REQUIRED without a session", async () => {
    const app = createGuardedApp(null);
    const response = await app.request("/guarded");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
      message: "Authentication required",
    });
  });

  it("returns ACCOUNT_SUSPENDED for banned callers", async () => {
    isUserBannedMock.mockResolvedValueOnce(true);
    const app = createGuardedApp({
      session: { id: "ses_1" },
      user: { id: "usr_banned" },
    });

    const response = await app.request("/guarded");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
      message: "Your account has been suspended.",
    });
  });

  it("allows an active session through", async () => {
    isUserBannedMock.mockResolvedValueOnce(false);
    const app = createGuardedApp({
      session: { id: "ses_1" },
      user: { id: "usr_ok" },
    });

    const response = await app.request("/guarded");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      userId: "usr_ok",
    });
  });
});
