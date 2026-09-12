import { describe, expect, it } from "vitest";
import {
  isDistinctOtpVerifyOutcome,
  otpSoftHintCopy,
  otpVerifyFailedMessage,
} from "./otp-recovery-copy";

const copy = {
  otpSoftHintLogin: "Don't have an account yet?",
  otpSoftHintSignup: "Already have an account?",
  otpVerifyFailedLogin:
    "Couldn't verify that code. Double-check it, or sign up if you don't have an account yet.",
  otpVerifyFailedSignup:
    "Couldn't verify that code. Double-check it, or log in if you already have an account.",
} as const;

describe("otp recovery copy", () => {
  it("uses the same login verify failure class for every OTP_VERIFY_FAILED case", () => {
    const wrongOtp = otpVerifyFailedMessage("login", copy);
    const unknownEmail = otpVerifyFailedMessage("login", copy);

    expect(wrongOtp).toBe(copy.otpVerifyFailedLogin);
    expect(unknownEmail).toBe(wrongOtp);
    expect(wrongOtp.toLowerCase()).not.toContain("no account found");
    expect(wrongOtp.toLowerCase()).not.toContain("does not exist");
  });

  it("maps INVALID_OTP and OTP_VERIFY_FAILED to the same soft-hybrid class", () => {
    expect(isDistinctOtpVerifyOutcome("INVALID_OTP")).toBe(false);
    expect(isDistinctOtpVerifyOutcome("OTP_VERIFY_FAILED")).toBe(false);
    expect(otpVerifyFailedMessage("login", copy)).toBe(
      copy.otpVerifyFailedLogin,
    );
  });

  it("keeps attempts, expiry, and suspension outside the soft-hybrid class", () => {
    expect(isDistinctOtpVerifyOutcome("TOO_MANY_ATTEMPTS")).toBe(true);
    expect(isDistinctOtpVerifyOutcome("OTP_EXPIRED")).toBe(true);
    expect(isDistinctOtpVerifyOutcome("ACCOUNT_SUSPENDED")).toBe(true);
  });

  it("uses signup verify failure copy without asserting existence", () => {
    const message = otpVerifyFailedMessage("signup", copy);

    expect(message).toBe(copy.otpVerifyFailedSignup);
    expect(message.toLowerCase()).not.toContain("already exists");
    expect(message.toLowerCase()).toContain("log in");
  });

  it("selects mode-specific soft hints without existence claims", () => {
    expect(otpSoftHintCopy("login", copy)).toBe(copy.otpSoftHintLogin);
    expect(otpSoftHintCopy("signup", copy)).toBe(copy.otpSoftHintSignup);
    expect(copy.otpSoftHintLogin.toLowerCase()).not.toContain("unregistered");
    expect(copy.otpSoftHintSignup.toLowerCase()).not.toContain(
      "already registered",
    );
  });
});
