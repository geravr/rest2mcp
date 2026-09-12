import { AuthForm, AuthScreenShell } from "@/components/auth";
import { useTranslations } from "@/i18n/use-translations";
import { getSafeRedirectUrl } from "@/lib/auth-config";
import { capturePostHogEvent } from "@/lib/posthog";
import { registrationStatusQueryOptions } from "@/lib/queries/public-auth";
import { revalidateSession, sessionQueryOptions } from "@/lib/queries/session";
import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  isRedirect,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { z } from "zod";

// Sanitize returnTo at parse time - consumers get a safe value or undefined
const searchSchema = z.object({
  returnTo: z
    .string()
    .optional()
    .transform((val) => {
      const safe = getSafeRedirectUrl(val);
      return safe === "/" ? undefined : safe;
    })
    .catch(undefined),
});

export const Route = createFileRoute("/(auth)/login")({
  validateSearch: searchSchema,
  beforeLoad: async ({ context, search }) => {
    try {
      const session = await context.queryClient.fetchQuery(
        sessionQueryOptions(),
      );

      // Redirect authenticated users to their destination
      if (session?.user && session?.session) {
        throw redirect({ to: search.returnTo ?? "/" });
      }
    } catch (error) {
      // Re-throw redirects, show login form for fetch errors
      if (isRedirect(error)) throw error;
    }

    try {
      await context.queryClient.fetchQuery(registrationStatusQueryOptions());
    } catch {
      // Allow login even if public auth status cannot be loaded.
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const { t } = useTranslations();

  async function handleSuccess() {
    await revalidateSession(queryClient, router);
    capturePostHogEvent("auth.login.succeeded", {
      return_to: search.returnTo ?? "/",
    });
    await router.navigate({ to: search.returnTo ?? "/" });
  }

  return (
    <AuthScreenShell
      title={t.auth.loginTitle}
      description={t.auth.loginDescription}
    >
      <AuthForm mode="login" onSuccess={handleSuccess} />
    </AuthScreenShell>
  );
}
