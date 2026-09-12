import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { capturePostHogException } from "@/lib/posthog";
import { Alert, AlertDescription, AlertTitle, Button } from "@repo/ui";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

function FeatureErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const { t } = useTranslations();

  return (
    <Alert variant="destructive" className="max-w-md">
      <AlertCircle />
      <AlertTitle>{t.errors.errorBoundary.title}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{resolveErrorMessage(error, t)}</p>
        <Button variant="outline" size="sm" onClick={resetErrorBoundary}>
          {t.errors.errorBoundary.tryAgain}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

interface FeatureErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<FallbackProps>;
}

/**
 * Lightweight error boundary for feature sections.
 * A crash inside the boundary shows inline error UI instead of bringing down the whole page.
 */
export function FeatureErrorBoundary({
  children,
  fallback: FallbackComponent = FeatureErrorFallback,
}: FeatureErrorBoundaryProps) {
  const { reset } = useQueryErrorResetBoundary();

  return (
    <ErrorBoundary
      FallbackComponent={FallbackComponent}
      onReset={reset}
      onError={(error, info) => {
        capturePostHogException(error, {
          boundary: "feature",
          component_stack: info.componentStack,
        });
        console.error("[FeatureErrorBoundary]", error);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
