import { AuthScreenShell } from "@/components/auth/auth-screen-shell";
import { useTranslations } from "@/i18n/use-translations";
import { auth } from "@/lib/auth";
import { getSafeRedirectUrl } from "@/lib/auth-config";
import { revalidateSession } from "@/lib/queries/session";
import { api } from "@/lib/trpc";
import { Alert, AlertDescription, Button } from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

const searchSchema = z.object({
  token: z.string().min(1).optional().catch(undefined),
  error: z.string().min(1).optional().catch(undefined),
  returnTo: z
    .string()
    .optional()
    .transform((val) => {
      const safe = getSafeRedirectUrl(val);
      return safe === "/" ? undefined : safe;
    })
    .catch(undefined),
});

export const Route = createFileRoute("/(auth)/verify-email")({
  validateSearch: searchSchema,
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const search = Route.useSearch();
  const { t } = useTranslations();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    search.error ? "error" : search.token ? "loading" : "error",
  );
  const [serverErrorMessage, setServerErrorMessage] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!search.token || search.error) {
      return;
    }

    const token = search.token;
    let cancelled = false;

    void (async () => {
      const result = await auth.verifyEmail({
        query: {
          token,
        },
      });

      if (cancelled) {
        return;
      }

      if (result.error) {
        setStatus("error");
        setServerErrorMessage(result.error.message || null);
        return;
      }

      setStatus("success");
      setServerErrorMessage(null);

      await Promise.all([
        revalidateSession(queryClient, router),
        queryClient.invalidateQueries(api.user.me.pathFilter()),
      ]);
    })();

    return () => {
      cancelled = true;
    };
  }, [queryClient, router, search.error, search.token, t.verifyEmail]);

  const message = useMemo(() => {
    if (status === "success") {
      return t.verifyEmail.success;
    }

    if (status === "loading") {
      return t.verifyEmail.verifying;
    }

    if (serverErrorMessage) {
      return serverErrorMessage;
    }

    return search.error
      ? t.verifyEmail.invalidOrExpired
      : t.verifyEmail.missingInfo;
  }, [search.error, serverErrorMessage, status, t.verifyEmail]);

  const destination = search.returnTo ?? "/login";

  return (
    <AuthScreenShell
      title={t.verifyEmail.shellTitle}
      description={t.verifyEmail.shellDescription}
    >
      <div className="flex flex-col gap-6 text-center">
        {status === "error" ? (
          <Alert variant="destructive" className="text-left">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {status === "success" ? (
              <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
            ) : null}

            <p className="text-lg font-semibold text-foreground">
              {t.verifyEmail.innerTitle}
            </p>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {status === "loading" ? (
            <Button className="w-full" disabled>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {t.verifyEmail.buttonVerifying}
            </Button>
          ) : (
            <Button asChild className="w-full">
              <Link to={destination}>
                {status === "success"
                  ? t.verifyEmail.buttonContinue
                  : t.verifyEmail.buttonGoToLogin}
              </Link>
            </Button>
          )}

          <Button
            variant="ghost"
            className="h-auto justify-center gap-1 text-muted-foreground"
            asChild
          >
            <Link to="/login">
              <ArrowLeft className="h-4 w-4" />
              {t.verifyEmail.backToLogin}
            </Link>
          </Button>
        </div>
      </div>
    </AuthScreenShell>
  );
}
