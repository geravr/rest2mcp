import { getEmailCopy } from "@repo/email";
import { describe, expect, it } from "vitest";

describe("getEmailCopy", () => {
  it("returns Spanish OTP subjects for es locale", () => {
    const copy = getEmailCopy("es");
    expect(copy.otp.subjectSignIn).toContain("sesi");
  });

  it("defaults to English", () => {
    const copy = getEmailCopy(undefined);
    expect(copy.otp.subjectSignIn).toBe("Your Sign In code");
  });
});
