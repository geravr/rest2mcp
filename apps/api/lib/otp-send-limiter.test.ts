import { describe, expect, it } from "vitest";
import {
  assertOtpSendAllowed,
  resetOtpSendLimiter,
} from "./otp-send-limiter.js";

describe("assertOtpSendAllowed", () => {
  it("limits by email and by IP", () => {
    resetOtpSendLimiter();

    expect(assertOtpSendAllowed("a@example.com", "1.1.1.1")).toBe(true);
    expect(assertOtpSendAllowed("A@Example.com", "1.1.1.1")).toBe(false);

    for (let i = 0; i < 10; i += 1) {
      expect(assertOtpSendAllowed(`user${i}@example.com`, "2.2.2.2")).toBe(
        true,
      );
    }
    expect(assertOtpSendAllowed("last@example.com", "2.2.2.2")).toBe(false);
  });

  it("rolls back the email bucket when the IP ceiling blocks a send", () => {
    resetOtpSendLimiter();

    for (let i = 0; i < 10; i += 1) {
      expect(assertOtpSendAllowed(`seed${i}@example.com`, "3.3.3.3")).toBe(
        true,
      );
    }

    expect(assertOtpSendAllowed("fresh@example.com", "3.3.3.3")).toBe(false);
    // Email bucket must be rolled back so a later send from another IP can proceed.
    expect(assertOtpSendAllowed("fresh@example.com", "4.4.4.4")).toBe(true);
  });
});
