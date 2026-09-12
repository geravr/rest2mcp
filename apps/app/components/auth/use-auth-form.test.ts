import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAuthForm } from "./use-auth-form";

vi.mock("@/i18n/use-translations", () => ({
  useTranslations: () => ({
    t: {
      auth: {
        somethingWentWrong: "Something went wrong",
        failedToSendOtp: "Failed to send OTP",
        failedToSendVerificationCode: "Failed to send verification code",
      },
    },
  }),
}));

const requestLoginOtp = vi.fn();
const requestSignupOtp = vi.fn();

vi.mock("@/lib/auth-otp", () => ({
  requestLoginOtp: (...args: unknown[]) => requestLoginOtp(...args),
  requestSignupOtp: (...args: unknown[]) => requestSignupOtp(...args),
}));

describe("useAuthForm OTP step transitions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts on email and advances to otp after a successful send", async () => {
    requestLoginOtp.mockResolvedValue({ data: { success: true } });

    const { result } = renderHook(() =>
      useAuthForm({
        onSuccess: async () => undefined,
        mode: "login",
      }),
    );

    expect(result.current.step).toBe("email");

    await act(async () => {
      await result.current.sendOtp({ email: "user@test.dev" });
    });

    expect(requestLoginOtp).toHaveBeenCalledWith("user@test.dev");
    expect(result.current.step).toBe("otp");
  });

  it("returns from otp to email via resetToEmail", async () => {
    requestLoginOtp.mockResolvedValue({ data: { success: true } });

    const { result } = renderHook(() =>
      useAuthForm({
        onSuccess: async () => undefined,
        mode: "login",
      }),
    );

    await act(async () => {
      await result.current.sendOtp({ email: "user@test.dev" });
    });
    expect(result.current.step).toBe("otp");

    act(() => {
      result.current.resetToEmail();
    });

    expect(result.current.step).toBe("email");
  });
});
