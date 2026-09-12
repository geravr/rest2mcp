import { useTranslations } from "@/i18n/use-translations";
import { isUnauthenticatedError, resolveErrorMessage } from "@/lib/errors";
import { capturePostHogException } from "@/lib/posthog";
import { sessionQueryKey } from "@/lib/queries/session";
import { Alert, AlertDescription, AlertTitle, Button } from "@repo/ui";
import {
  useQueryClient,
  useQueryErrorResetBoundary,
} from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { ErrorBoundary } from "react-error-boundary";

interface ResetProps {
  resetErrorBoundary: () => void;
}

function AuthErrorFallback({ resetErrorBoundary }: ResetProps) {
  const queryClient = useQueryClient();
  const { t } = useTranslations();

  const handleRetry = () => {
    queryClient.resetQueries({ queryKey: sessionQueryKey });
    resetErrorBoundary();
  };

  const handleSignIn = () => {
    queryClient.removeQueries({ queryKey: sessionQueryKey });
    const { pathname, search, hash } = window.location;
    const returnTo = encodeURIComponent(pathname + search + hash);
    window.location.href = `/login?returnTo=${returnTo}`;
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-6">
      <div className="mx-auto max-w-md text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-destructive" />
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          {t.auth.authRequired}
        </h1>
        <p className="mb-6 text-muted-foreground">{t.auth.signInToAccess}</p>
        <div className="flex justify-center gap-3">
          <Button variant="outline" onClick={handleRetry}>
            {t.common.tryAgain}
          </Button>
          <Button onClick={handleSignIn}>{t.auth.signIn}</Button>
        </div>
      </div>
    </div>
  );
}

interface ErrorFallbackProps {
  error: unknown;
  resetErrorBoundary: () => void;
}

function GenericErrorFallback({
  error,
  resetErrorBoundary,
}: ErrorFallbackProps) {
  const { t } = useTranslations();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background p-6">
      <Alert variant="destructive" className="mx-auto max-w-md">
        <AlertCircle />
        <AlertTitle>{t.auth.somethingWentWrongTitle}</AlertTitle>
        <AlertDescription className="space-y-4">
          <p>{resolveErrorMessage(error, t)}</p>
          <Button onClick={resetErrorBoundary}>{t.common.tryAgain}</Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

function AuthAwareErrorFallback({
  error,
  resetErrorBoundary,
}: ErrorFallbackProps) {
  return isUnauthenticatedError(error) ? (
    <AuthErrorFallback resetErrorBoundary={resetErrorBoundary} />
  ) : (
    <GenericErrorFallback
      error={error}
      resetErrorBoundary={resetErrorBoundary}
    />
  );
}

export function AuthErrorBoundary({ children }: ErrorBoundaryProps) {
  const queryClient = useQueryClient();
  const { reset } = useQueryErrorResetBoundary();

  return (
    <ErrorBoundary
      FallbackComponent={AuthAwareErrorFallback}
      onReset={reset}
      onError={(error, info) => {
        console.error("Error caught by boundary:", error);
        if (isUnauthenticatedError(error)) {
          queryClient.removeQueries({ queryKey: sessionQueryKey });
          return;
        }

        capturePostHogException(error, {
          boundary: "auth",
          component_stack: info.componentStack,
        });
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

export function AppErrorBoundary({ children }: ErrorBoundaryProps) {
  const { reset } = useQueryErrorResetBoundary();

  return (
    <ErrorBoundary
      FallbackComponent={GenericErrorFallback}
      onReset={reset}
      onError={(error, info) => {
        capturePostHogException(error, {
          boundary: "app",
          component_stack: info.componentStack,
        });
        console.error("Uncaught error:", error);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
