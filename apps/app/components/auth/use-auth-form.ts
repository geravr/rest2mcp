import { useTranslations } from "@/i18n/use-translations";
import { requestLoginOtp, requestSignupOtp } from "@/lib/auth-otp";
import { useCallback, useRef, useState } from "react";
import {
  canTransitionAuthStep,
  defaultAuthStep,
  type AuthStep,
} from "./auth-steps";

export type { AuthStep };

interface UseAuthFormOptions {
  /**
   * Called after successful authentication. Caller is responsible for
   * cache invalidation and navigation. Awaited before form state resets.
   */
  onSuccess: () => Promise<void>;
  isExternallyLoading?: boolean;
  /**
   * UI mode affecting copy, ToS display, and available methods.
   * Login and signup both use OTP; the API does not reveal whether
   * the email is registered on send (anti-enumeration).
   */
  mode?: "login" | "signup";
  initialStep?: AuthStep;
  inviteToken?: string;
}

interface SendOtpInput {
  email?: string;
  name?: string;
}

export function useAuthForm({
  onSuccess,
  isExternallyLoading,
  mode = "login",
  initialStep,
  inviteToken,
}: UseAuthFormOptions) {
  const { t } = useTranslations();
  const [step, setStep] = useState<AuthStep>(() =>
    defaultAuthStep(initialStep),
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pendingOps, setPendingOps] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const hasSucceededRef = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  const setChildBusy = useCallback((busy: boolean) => {
    setPendingOps((c) => (busy ? c + 1 : Math.max(0, c - 1)));
  }, []);

  const isDisabled = isLoading || pendingOps > 0 || !!isExternallyLoading;

  const onAuthSuccess = async () => {
    if (hasSucceededRef.current) return;
    hasSucceededRef.current = true;

    try {
      setIsLoading(true);
      await onSuccess();
    } catch (err) {
      console.error("Post-auth error:", err);
      setError(t.auth.somethingWentWrong);
      hasSucceededRef.current = false;
    } finally {
      setIsLoading(false);
    }
  };

  const transitionTo = useCallback((next: AuthStep, clearErr = true) => {
    const current = stepRef.current;
    if (!canTransitionAuthStep(current, next)) {
      return;
    }
    setStep(next);
    if (clearErr) setError(null);
  }, []);

  const resetToEmail = () => {
    hasSucceededRef.current = false;
    transitionTo("email", false);
  };

  const sendOtp = async (input?: SendOtpInput) => {
    const normalizedEmail = (input?.email ?? email).trim().toLowerCase();
    const normalizedName = (input?.name ?? name).trim();

    if (!normalizedEmail) return;

    if (mode === "signup" && !normalizedName) return;

    setEmail(normalizedEmail);
    setName(normalizedName);

    try {
      setIsLoading(true);
      setError(null);

      const result =
        mode === "login"
          ? await requestLoginOtp(normalizedEmail)
          : await requestSignupOtp(normalizedEmail, inviteToken);

      if (result.data) {
        transitionTo("otp");
      } else if (result.error) {
        setError(result.error.message || t.auth.failedToSendOtp);
      }
    } catch (err) {
      console.error("Email OTP error:", err);
      setError(t.auth.failedToSendVerificationCode);
    } finally {
      setIsLoading(false);
    }
  };

  const changeEmail = (value: string) => {
    setEmail(value);
  };

  const changeName = (value: string) => {
    setName(value);
  };

  return {
    step,
    name,
    email,
    isLoading,
    isDisabled,
    error,
    mode,

    changeName,
    changeEmail,
    onAuthSuccess,
    setError,
    sendOtp,
    resetToEmail,
    setChildBusy,
  };
}
