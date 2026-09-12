import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { Hono } from "hono";
import type { AppContext } from "../lib/context.js";
import { resetOtpSendLimiter } from "../lib/otp-send-limiter.js";

const tables = vi.hoisted(() => ({
  platformSettings: {
    id: "platform_settings.id",
    registrationEnabled: "platform_settings.registration_enabled",
    registrationDisabledMessage:
      "platform_settings.registration_disabled_message",
  },
  user: {
    id: "user.id",
    email: "user.email",
  },
}));

const eqMock = vi.hoisted(() =>
  vi.fn((left: unknown, right: unknown) => ({ left, right })),
);
const validateInvitationTokenMock = vi.hoisted(() => vi.fn());
const markInvitationAcceptedMock = vi.hoisted(() => vi.fn());
const sendOTPMock = vi.hoisted(() => vi.fn());
const isSignInOtpValidMock = vi.hoisted(() => vi.fn());
const isUserBannedMock = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => tables);
vi.mock("drizzle-orm", () => ({
  eq: eqMock,
}));
vi.mock("../services/admin-service.js", () => ({
  validateInvitationToken: validateInvitationTokenMock,
  markInvitationAccepted: markInvitationAcceptedMock,
}));
vi.mock("../lib/email.js", () => ({
  sendOTP: sendOTPMock,
}));
vi.mock("../lib/otp-peek.js", () => ({
  isSignInOtpValid: isSignInOtpValidMock,
  clearSignInOtps: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/user-access.js", () => ({
  isUserBanned: isUserBannedMock,
}));

import {
  OTP_SEND_SUCCESS,
  OTP_VERIFY_FAILURE,
  publicAuthRoutes,
} from "./public-auth.js";

function makeChain<T>(result: T) {
  const handler: ProxyHandler<object> = {
    get(_, prop: string | symbol) {
      if (prop === "then") {
        return (
          resolve: (value: T) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject);
      }

      if (prop === "catch") {
        return (fn: (reason: unknown) => unknown) =>
          Promise.resolve(result).catch(fn);
      }

      if (prop === "finally") {
        return (fn: () => void) => Promise.resolve(result).finally(fn);
      }

      return () => new Proxy({}, handler);
    },
  };

  return new Proxy({}, handler);
}

function makeDb(selectResults: unknown[]) {
  const queue = [...selectResults];
  const insertValues: unknown[] = [];

  return {
    select: vi.fn(() => makeChain(queue.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        insertValues.push(values);
        return {
          returning: vi.fn(() => makeChain([{ id: "usr_new" }])),
        };
      }),
    })),
    delete: vi.fn(() => makeChain([])),
    insertValues,
  };
}

function createApp(
  selectResults: unknown[],
  authHandler?: (request: Request) => Promise<Response>,
  createVerificationOTP?: () => Promise<string>,
) {
  const app = new Hono<AppContext>();
  const db = makeDb(selectResults);
  const auth = {
    handler: vi.fn(authHandler),
    api: {
      createVerificationOTP: vi.fn(
        createVerificationOTP ?? (async () => "123456"),
      ),
    },
  };

  app.use("*", async (c, next) => {
    c.set("db", db as never);
    c.set("auth", auth as never);
    c.set("env", {
      ENVIRONMENT: "development",
      RESEND_API_KEY: "test",
      RESEND_EMAIL_FROM: "test@example.com",
      APP_NAME: "Test",
      APP_ORIGIN: "http://localhost:5173",
    } as never);
    await next();
  });
  app.route("/", publicAuthRoutes);

  return { app, db, auth };
}

beforeEach(() => {
  isUserBannedMock.mockResolvedValue(false);
  isSignInOtpValidMock.mockResolvedValue(true);
});

afterEach(() => {
  resetOtpSendLimiter();
  vi.clearAllMocks();
});

describe("publicAuthRoutes catalog codes", () => {
  it("rejects invalid emails with the catalog constant", async () => {
    const { app, auth } = createApp([[]]);

    const response = await app.request("/otp/login/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.INVALID_EMAIL,
      message: "Enter a valid email address.",
    });
    expect(auth.handler).not.toHaveBeenCalled();
  });
});

describe("publicAuthRoutes invitation gating", () => {
  it("rejects signup send when a valid invite token is used with another email even if registration is open", async () => {
    validateInvitationTokenMock.mockResolvedValueOnce({
      email: "invitee@example.com",
    });
    const { app, auth } = createApp([[{ registrationEnabled: true }]]);

    const response = await app.request("/otp/signup/send?invite=token-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "other@example.com" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: "This invitation is for a different email address.",
      code: "INVITATION_EMAIL_MISMATCH",
    });
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("rejects signup send when registration is closed without invite", async () => {
    const { app, auth } = createApp([[{ registrationEnabled: false }]]);

    const response = await app.request("/otp/signup/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.com" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "REGISTRATION_DISABLED",
    });
    expect(auth.handler).not.toHaveBeenCalled();
    expect(auth.api.createVerificationOTP).not.toHaveBeenCalled();
  });

  it("allows signup send when the invite email matches and registration is closed", async () => {
    validateInvitationTokenMock.mockResolvedValueOnce({
      email: "invitee@example.com",
    });
    const { app, auth } = createApp([[{ registrationEnabled: false }], []]);

    const response = await app.request("/otp/signup/send?invite=token-1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Invitee@Example.com" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(OTP_SEND_SUCCESS);
    expect(auth.api.createVerificationOTP).toHaveBeenCalledTimes(1);
    expect(sendOTPMock).toHaveBeenCalledTimes(1);
  });
});

describe("publicAuthRoutes OTP privacy and throttle", () => {
  it("returns the same send success for login unknown email and signup known email", async () => {
    const login = createApp([[]]);
    const signup = createApp([
      [{ registrationEnabled: true }],
      [{ id: "usr_existing" }],
    ]);

    const loginResponse = await login.app.request("/otp/login/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "missing@example.com" }),
    });
    const signupResponse = await signup.app.request("/otp/signup/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "existing@example.com" }),
    });

    expect(loginResponse.status).toBe(200);
    expect(signupResponse.status).toBe(200);
    expect(await loginResponse.json()).toEqual(OTP_SEND_SUCCESS);
    expect(await signupResponse.json()).toEqual(OTP_SEND_SUCCESS);
    expect(login.auth.handler).not.toHaveBeenCalled();
    expect(signup.auth.api.createVerificationOTP).not.toHaveBeenCalled();
  });

  it("returns the same verify failure for login unknown and signup existing", async () => {
    const login = createApp([[]]);
    const signup = createApp([
      [{ registrationEnabled: true }],
      [{ id: "usr_existing" }],
    ]);

    const loginResponse = await login.app.request("/otp/login/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "missing@example.com", otp: "123456" }),
    });
    const signupResponse = await signup.app.request("/otp/signup/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "existing@example.com",
        otp: "123456",
        name: "Existing User",
      }),
    });

    expect(loginResponse.status).toBe(400);
    expect(signupResponse.status).toBe(400);
    expect(await loginResponse.json()).toEqual(OTP_VERIFY_FAILURE);
    expect(await signupResponse.json()).toEqual(OTP_VERIFY_FAILURE);
  });

  it("throttles a second OTP send for the same email", async () => {
    const { app, auth } = createApp([[{ id: "usr_1" }]]);
    auth.handler.mockResolvedValue(new Response(null, { status: 200 }));

    const first = await app.request("/otp/login/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });
    const second = await app.request("/otp/login/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(auth.handler).toHaveBeenCalledTimes(1);
  });

  it("rejects login verify for banned users without establishing a session", async () => {
    isUserBannedMock.mockResolvedValueOnce(true);
    const { app, auth } = createApp([[{ id: "usr_banned" }]]);

    const response = await app.request("/otp/login/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "banned@example.com", otp: "123456" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
      message: "Your account has been suspended. Contact an administrator.",
    });
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("returns generic send success for banned users without emailing OTP", async () => {
    isUserBannedMock.mockResolvedValueOnce(true);
    const { app, auth } = createApp([[{ id: "usr_banned" }]]);

    const response = await app.request("/otp/login/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "banned@example.com" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(OTP_SEND_SUCCESS);
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("creates signup users with role user only after a valid OTP peek", async () => {
    const { app, db, auth } = createApp([[{ registrationEnabled: true }], []]);
    auth.handler.mockResolvedValue(new Response(null, { status: 200 }));

    const response = await app.request("/otp/signup/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@example.com",
        otp: "123456",
        name: "New User",
        role: "super_admin",
        bannedAt: new Date().toISOString(),
      }),
    });

    expect(response.status).toBe(200);
    expect(isSignInOtpValidMock).toHaveBeenCalledWith(
      expect.anything(),
      "new@example.com",
      "123456",
    );
    expect(db.insertValues).toEqual([
      {
        email: "new@example.com",
        name: "New User",
        emailVerified: true,
        role: "user",
      },
    ]);
    const authBody = JSON.parse(
      await (auth.handler.mock.calls[0]?.[0] as Request).clone().text(),
    );
    expect(authBody).toEqual({
      email: "new@example.com",
      otp: "123456",
    });
  });

  it("does not create a user when the OTP peek fails", async () => {
    isSignInOtpValidMock.mockResolvedValueOnce(false);
    const { app, db, auth } = createApp([[{ registrationEnabled: true }], []]);

    const response = await app.request("/otp/signup/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@example.com",
        otp: "000000",
        name: "New User",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(OTP_VERIFY_FAILURE);
    expect(db.insert).not.toHaveBeenCalled();
    expect(auth.handler).not.toHaveBeenCalled();
  });

  it("rolls back the created user when session establishment fails", async () => {
    const { app, db, auth } = createApp([[{ registrationEnabled: true }], []]);
    auth.handler.mockResolvedValue(new Response(null, { status: 400 }));

    const response = await app.request("/otp/signup/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new@example.com",
        otp: "123456",
        name: "New User",
      }),
    });

    expect(response.status).toBe(400);
    expect(db.delete).toHaveBeenCalled();
  });
});
