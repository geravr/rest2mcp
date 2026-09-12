/**
 * Mode-specific OTP verify failure client copy selectors.
 * Kept pure so login and signup share one failure messaging class for
 * OTP_VERIFY_FAILED, INVALID_OTP, and similar verify failures without
 * assertive existence claims (anti-enumeration).
 */
export function otpVerifyFailedMessage(
  mode: "login" | "signup",
  copy: {
    otpVerifyFailedLogin: string;
    otpVerifyFailedSignup: string;
  },
): string {
  return mode === "signup"
    ? copy.otpVerifyFailedSignup
    : copy.otpVerifyFailedLogin;
}

/** Codes that must not share the soft-hybrid verify messaging class. */
export function isDistinctOtpVerifyOutcome(code: string | undefined): boolean {
  return (
    code === "TOO_MANY_ATTEMPTS" ||
    code === "OTP_EXPIRED" ||
    code === "ACCOUNT_SUSPENDED"
  );
}

export function otpSoftHintCopy(
  mode: "login" | "signup",
  copy: {
    otpSoftHintLogin: string;
    otpSoftHintSignup: string;
  },
): string {
  return mode === "signup" ? copy.otpSoftHintSignup : copy.otpSoftHintLogin;
}
