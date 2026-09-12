import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestLoginOtp,
  requestSignupOtp,
  verifyLoginOtp,
  verifySignupOtp,
} from "./auth-otp";

describe("login OTP requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts the email to the login send endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await requestLoginOtp("user@test.dev");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/otp/login/send"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@test.dev" }),
      }),
    );
  });

  it("posts email and otp to the login verify endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "session-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await verifyLoginOtp("user@test.dev", "123456");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/otp/login/verify"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@test.dev", otp: "123456" }),
      }),
    );
  });
});

describe("signup OTP requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends the invite token when sending a signup OTP", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await requestSignupOtp("invitee@test.dev", "token with spaces");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/auth/otp/signup/send?invite=token%20with%20spaces",
      ),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("keeps the invite token in the signup verification request URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "session-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await verifySignupOtp({
      email: "invitee@test.dev",
      otp: "123456",
      name: "Invitee",
      inviteToken: "invite-token",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/auth/otp/signup/verify?invite=invite-token",
      ),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "invitee@test.dev",
          otp: "123456",
          name: "Invitee",
        }),
      }),
    );
  });
});
