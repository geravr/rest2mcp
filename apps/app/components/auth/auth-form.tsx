import {
  createAuthEmailWithOptionalNameSchema,
  createAuthSignupEmailSchema,
} from "@/components/auth/schemas";
import { useTranslations } from "@/i18n/use-translations";
import { useRegistrationStatusQuery } from "@/lib/queries/public-auth";
import { Alert, Button, Field, FieldError, Input, Label, cn } from "@repo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ComponentProps } from "react";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { OtpVerification } from "./otp-verification";
import { useAuthForm, type AuthStep } from "./use-auth-form";

function SignupTerms() {
  const { t } = useTranslations();

  return (
    <p className="text-center text-xs leading-6 text-muted-foreground text-balance">
      {t.auth.termsText}{" "}
      <Link
        to="/terms"
        className="underline underline-offset-4 hover:text-primary"
      >
        {t.auth.termsOfService}
      </Link>{" "}
      {t.auth.and}{" "}
      <Link
        to="/privacy"
        className="underline underline-offset-4 hover:text-primary"
      >
        {t.auth.privacyPolicy}
      </Link>
      .
    </p>
  );
}

interface AuthFormProps extends ComponentProps<"div"> {
  mode?: "login" | "signup";
  onSuccess: () => Promise<void>;
  isLoading?: boolean;
  initialStep?: AuthStep;
  inviteToken?: string;
}

function RegistrationClosedState({ message }: { message?: string | null }) {
  const { t } = useTranslations();

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-2 text-center">
        <h2 className="text-lg font-semibold text-foreground">
          {t.auth.publicSignupUnavailable}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {message ?? t.auth.invitationRequired}
        </p>
      </div>

      <Alert className="text-sm">
        <span>{t.auth.invitationNote}</span>
      </Alert>

      <Button variant="link" className="h-auto p-0" asChild>
        <Link to="/login">{t.auth.goToLogin}</Link>
      </Button>
    </div>
  );
}

export function AuthForm({
  className,
  onSuccess,
  isLoading,
  mode = "login",
  initialStep,
  inviteToken,
  ...props
}: AuthFormProps) {
  const registrationStatus = useRegistrationStatusQuery();
  const {
    step,
    name,
    email,
    isDisabled,
    error,
    changeName,
    changeEmail,
    onAuthSuccess,
    setError,
    sendOtp,
    resetToEmail,
    setChildBusy,
    mode: formMode,
  } = useAuthForm({
    onSuccess,
    isExternallyLoading: isLoading,
    mode,
    initialStep,
    inviteToken,
  });

  const handleEmailChange = (value: string) => {
    if (error) setError(null);
    changeEmail(value);
  };

  const handleNameChange = (value: string) => {
    if (error) setError(null);
    changeName(value);
  };

  const handleOtpBack = () => {
    setError(null);
    resetToEmail();
  };

  const isSignup = formMode === "signup";
  const publicRegistrationEnabled =
    registrationStatus.data?.registrationEnabled;
  const signupAllowed = publicRegistrationEnabled !== false || !!inviteToken;
  const showSignupLink = registrationStatus.isError
    ? true
    : publicRegistrationEnabled === true;

  if (isSignup && publicRegistrationEnabled === false && !inviteToken) {
    return (
      <RegistrationClosedState message={registrationStatus.data?.message} />
    );
  }

  return (
    <div className={cn("flex w-full flex-col gap-5", className)} {...props}>
      {error && (
        <Alert variant="destructive" className="text-sm">
          <span>{error}</span>
        </Alert>
      )}

      {step === "email" && (
        <EmailInput
          name={name}
          email={email}
          isSignup={isSignup}
          isDisabled={isDisabled || (isSignup && !signupAllowed)}
          showSignupLink={showSignupLink}
          onNameChange={handleNameChange}
          onEmailChange={handleEmailChange}
          onSubmit={sendOtp}
        />
      )}

      {step === "otp" && (
        <OtpStep
          mode={formMode}
          name={name}
          email={email}
          inviteToken={inviteToken}
          isDisabled={isDisabled}
          onSuccess={onAuthSuccess}
          onError={setError}
          onLoadingChange={setChildBusy}
          onBack={handleOtpBack}
          onCancel={resetToEmail}
        />
      )}
    </div>
  );
}

interface EmailInputProps {
  name: string;
  email: string;
  isSignup: boolean;
  isDisabled: boolean;
  showSignupLink: boolean;
  onNameChange: (name: string) => void;
  onEmailChange: (email: string) => void;
  onSubmit: (input: { email: string; name?: string }) => Promise<void>;
}

function EmailInput({
  name,
  email,
  isSignup,
  isDisabled,
  showSignupLink,
  onNameChange,
  onEmailChange,
  onSubmit,
}: EmailInputProps) {
  const { t } = useTranslations();
  const emailStepSchema = useMemo(
    () =>
      isSignup
        ? createAuthSignupEmailSchema(t)
        : createAuthEmailWithOptionalNameSchema(t),
    [isSignup, t],
  );
  const form = useForm<z.input<typeof emailStepSchema>>({
    resolver: zodResolver(emailStepSchema),
    defaultValues: {
      name,
      email,
    },
  });

  useEffect(() => {
    form.setValue("name", name, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
    form.setValue("email", email, {
      shouldDirty: false,
      shouldTouch: false,
      shouldValidate: false,
    });
  }, [email, form, name]);

  return (
    <div className="flex flex-col gap-5">
      <form
        onSubmit={form.handleSubmit(async ({ email, name }) => {
          onNameChange(name ?? "");
          onEmailChange(email);
          await onSubmit({ email, name });
        })}
        className="flex flex-col gap-4"
      >
        {isSignup && (
          <Field>
            <Label htmlFor="auth-name">{t.auth.fullNameLabel}</Label>
            <Input
              id="auth-name"
              {...form.register("name")}
              type="text"
              placeholder={t.auth.fullNamePlaceholder}
              disabled={isDisabled}
              autoComplete="name"
              autoFocus
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                form.setValue("name", event.target.value);
                onNameChange(event.target.value);
              }}
            />
            <FieldError>{form.formState.errors.name?.message}</FieldError>
          </Field>
        )}
        <Field>
          <Label htmlFor="auth-email">{t.auth.emailLabel}</Label>
          <Input
            id="auth-email"
            {...form.register("email")}
            type="email"
            inputMode="email"
            placeholder={t.auth.emailInputPlaceholder}
            disabled={isDisabled}
            autoComplete="email"
            autoFocus={!isSignup}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              form.setValue("email", event.target.value);
              onEmailChange(event.target.value);
            }}
          />
          <FieldError>{form.formState.errors.email?.message}</FieldError>
        </Field>
        <Button
          type="submit"
          className="w-full"
          disabled={isDisabled || form.formState.isSubmitting}
        >
          {isSignup ? t.common.continue : t.auth.sendCode}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {isSignup ? (
          <>
            {t.auth.alreadyHaveAccount}{" "}
            <Link
              to="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t.auth.logIn}
            </Link>
          </>
        ) : showSignupLink ? (
          <>
            {t.auth.dontHaveAccount}{" "}
            <Link
              to="/signup"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t.auth.signUp}
            </Link>
          </>
        ) : (
          t.auth.signupClosedShort
        )}
      </p>

      {isSignup && <SignupTerms />}
    </div>
  );
}

interface OtpStepProps {
  mode: "login" | "signup";
  name: string;
  email: string;
  inviteToken?: string;
  isDisabled: boolean;
  onSuccess: () => void;
  onError: (error: string | null) => void;
  onLoadingChange: (loading: boolean) => void;
  onBack: () => void;
  onCancel: () => void;
}

function OtpStep({
  mode,
  name,
  email,
  inviteToken,
  isDisabled,
  onSuccess,
  onError,
  onLoadingChange,
  onBack,
  onCancel,
}: OtpStepProps) {
  const { t } = useTranslations();
  const isLogin = mode === "login";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm leading-6 text-muted-foreground">
        {t.auth.codeIfUsableSentTo}{" "}
        <span className="font-medium text-foreground">{email}</span>
      </p>

      <p className="text-sm text-muted-foreground">
        {isLogin ? (
          <>
            {t.auth.otpSoftHintLogin}{" "}
            <Link
              to="/signup"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t.auth.signUp}
            </Link>
          </>
        ) : (
          <>
            {t.auth.otpSoftHintSignup}{" "}
            <Link
              to="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t.auth.logIn}
            </Link>
          </>
        )}
      </p>

      <OtpVerification
        mode={mode}
        name={name}
        email={email}
        inviteToken={inviteToken}
        onSuccess={onSuccess}
        onError={onError}
        onLoadingChange={onLoadingChange}
        onCancel={onCancel}
        isDisabled={isDisabled}
      />

      <Button
        type="button"
        variant="ghost"
        className="h-auto justify-start gap-1 px-0 text-muted-foreground"
        onClick={onBack}
        disabled={isDisabled}
      >
        <ArrowLeft className="h-4 w-4" />
        {t.auth.backToEmail}
      </Button>
    </div>
  );
}
