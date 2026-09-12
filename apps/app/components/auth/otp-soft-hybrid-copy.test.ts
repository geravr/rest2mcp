import { describe, expect, it } from "vitest";
import { enAuth } from "@/i18n/locales/en/auth";
import { esAuth } from "@/i18n/locales/es/auth";

describe("auth OTP soft-hybrid locale strings", () => {
  it("provides neutral send acknowledgement in en and es", () => {
    expect(enAuth.auth.codeIfUsableSentTo.toLowerCase()).toContain(
      "if this email can be used",
    );
    expect(esAuth.auth.codeIfUsableSentTo.toLowerCase()).toContain(
      "si este email puede usarse",
    );
    expect(enAuth.auth).not.toHaveProperty("codeSentTo");
    expect(esAuth.auth).not.toHaveProperty("codeSentTo");
  });

  it("provides soft hints and enriched verify copy without assertive keys", () => {
    expect(enAuth.auth.otpSoftHintLogin.length).toBeGreaterThan(0);
    expect(enAuth.auth.otpSoftHintSignup.length).toBeGreaterThan(0);
    expect(enAuth.auth.otpVerifyFailedLogin.toLowerCase()).toContain("sign up");
    expect(enAuth.auth.otpVerifyFailedSignup.toLowerCase()).toContain("log in");
    expect(esAuth.auth.otpVerifyFailedLogin.toLowerCase()).toContain(
      "reg\u00edstrate",
    );
    expect(esAuth.auth.otpVerifyFailedSignup.toLowerCase()).toContain(
      "inicia sesi\u00f3n",
    );
    expect(enAuth.auth).not.toHaveProperty("noAccountFound");
    expect(enAuth.auth).not.toHaveProperty("accountAlreadyExists");
    expect(esAuth.auth).not.toHaveProperty("noAccountFound");
    expect(esAuth.auth).not.toHaveProperty("accountAlreadyExists");
  });
});
