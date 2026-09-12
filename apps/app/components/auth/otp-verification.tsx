import { createAuthOtpSchema } from "@/components/auth/schemas";
import { otpVerifyFailedMessage } from "@/components/auth/otp-recovery-copy";
import { useTranslations } from "@/i18n/use-translations";
import {
  requestLoginOtp,
  requestSignupOtp,
  verifyLoginOtp,
  verifySignupOtp,
} from "@/lib/auth-otp";
import {
  Button,
  Field,
  FieldError,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
} from "@repo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";

const RESEND_COOLDOWN_SECONDS = 30;

const OTP_ERROR_CODES = {
  TOO_MANY_ATTEMPTS: "TOO_MANY_ATTEMPTS",
  OTP_EXPIRED: "OTP_EXPIRED",
  INVALID_OTP: "INVALID_OTP",
} as const;

interface OtpVerificationProps {
  mode: "login" | "signup";
  name?: string;
  email: string;
  inviteToken?: string;
  onSuccess: () => void;
  onError: (error: string | null) => void;
  onLoadingChange?: (loading: boolean) => void;
  onCancel: () => void;
  isDisabled?: boolean;
}

export function OtpVerification({
  mode,
  name,
  email,
  inviteToken,
  onSuccess,
  onError,
  onLoadingChange,
  onCancel,
  isDisabled,
}: OtpVerificationProps) {
  const { t } = useTranslations();
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const schema = useMemo(() => createAuthOtpSchema(t), [t]);
  const form = useForm<z.input<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      otp: "",
    },
  });

  const setLoading = useCallback(
    (loading: boolean) => {
      setIsLoading(loading);
      onLoadingChange?.(loading);
    },
    [onLoadingChange],
  );

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const otp = form.watch("otp") ?? "";

  const handleOtpVerification = async ({ otp }: z.output<typeof schema>) => {
    if (!email) return;

    try {
      setLoading(true);
      onError(null);

      const result =
        mode === "signup"
          ? await verifySignupOtp({
              email,
              otp,
              name: name?.trim() || "",
              inviteToken,
            })
          : await verifyLoginOtp(email, otp);

      if (result.data) {
        onSuccess();
      } else if (result.error) {
        const code = "code" in result.error ? result.error.code : undefined;
        if (code === OTP_ERROR_CODES.TOO_MANY_ATTEMPTS) {
          onError(t.auth.tooManyAttempts);
          onCancel();
        } else if (code === OTP_ERROR_CODES.OTP_EXPIRED) {
          onError(t.auth.codeExpired);
          onCancel();
        } else if (code === "ACCOUNT_SUSPENDED") {
          onError(result.error.message || t.auth.failedToVerify);
        } else {
          // OTP_VERIFY_FAILED, INVALID_OTP, and other verify failures share one
          // client messaging class so wrong OTP on a real account matches the
          // unknown-email path (anti-enumeration).
          onError(
            otpVerifyFailedMessage(mode, {
              otpVerifyFailedLogin: t.auth.otpVerifyFailedLogin,
              otpVerifyFailedSignup: t.auth.otpVerifyFailedSignup,
            }),
          );
        }
      }
    } catch (err) {
      console.error("OTP verification error:", err);
      onError(t.auth.failedToVerify);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;

    form.reset({ otp: "" });
    onError(null);

    try {
      setLoading(true);

      const result =
        mode === "signup"
          ? await requestSignupOtp(email, inviteToken)
          : await requestLoginOtp(email);

      if (result.error) {
        onError(result.error.message || t.auth.failedToSendOtp);
      } else {
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch (err) {
      console.error("Email OTP error:", err);
      onError(t.auth.failedToSendVerificationCode);
    } finally {
      setLoading(false);
    }
  };

  const disabled = isDisabled || isLoading;

  return (
    <form
      onSubmit={form.handleSubmit(handleOtpVerification)}
      className="flex flex-col gap-4"
    >
      <Field>
        <Label htmlFor="auth-otp">{t.auth.otpLabel}</Label>
        <InputOTP
          id="auth-otp"
          maxLength={6}
          value={otp}
          onChange={(value) => {
            form.setValue("otp", value, { shouldValidate: true });
          }}
          disabled={disabled}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          containerClassName="justify-center"
        >
          <InputOTPGroup>
            {Array.from({ length: 6 }, (_, index) => (
              <InputOTPSlot key={index} index={index} />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <FieldError>{form.formState.errors.otp?.message}</FieldError>
      </Field>
      <Button
        type="submit"
        className="w-full"
        disabled={disabled || form.formState.isSubmitting || otp.length !== 6}
      >
        {t.auth.verifyCode}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={handleResendOtp}
        disabled={disabled || resendCooldown > 0}
      >
        {resendCooldown > 0
          ? `${t.auth.resendCodeIn} ${resendCooldown}${t.auth.resendCodeSeconds}`
          : t.auth.resendCode}
      </Button>
    </form>
  );
}
