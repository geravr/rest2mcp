import { describe, expect, it } from "vitest";
import {
  canTransitionAuthStep,
  defaultAuthStep,
  type AuthStep,
} from "./auth-steps";

describe("auth step machine", () => {
  it("defaults to the email step", () => {
    expect(defaultAuthStep()).toBe("email");
    expect(defaultAuthStep("otp")).toBe("otp");
  });

  it("allows email → otp and otp → email only", () => {
    expect(canTransitionAuthStep("email", "otp")).toBe(true);
    expect(canTransitionAuthStep("otp", "email")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    const steps: AuthStep[] = ["email", "otp"];
    for (const current of steps) {
      for (const next of steps) {
        if (current === next) {
          expect(canTransitionAuthStep(current, next)).toBe(false);
        }
      }
    }
  });
});
