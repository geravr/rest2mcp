import { AuthForm, AuthScreenShell } from "@/components/auth";
import { useTranslations } from "@/i18n/use-translations";
import { getSafeRedirectUrl } from "@/lib/auth-config";
import {
  inviteValidationQueryOptions,
  registrationStatusQueryOptions,
} from "@/lib/queries/public-auth";
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
  invite: z.string().trim().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/(auth)/signup")({
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
      // Re-throw redirects, show signup form for fetch errors
      if (isRedirect(error)) throw error;
    }

    try {
      const registrationStatus = await context.queryClient.fetchQuery(
        registrationStatusQueryOptions(),
      );

      if (!registrationStatus.registrationEnabled) {
        const inviteToken = search.invite;
        const hasValidInvite = inviteToken
          ? (
              await context.queryClient.fetchQuery(
                inviteValidationQueryOptions(inviteToken),
              )
            ).valid
          : false;

        if (!hasValidInvite) {
          throw redirect({
            to: "/login",
            search: { returnTo: search.returnTo },
          });
        }
      }
    } catch (error) {
      if (isRedirect(error)) throw error;
    }
  },
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const { t } = useTranslations();

  async function handleSuccess() {
    await revalidateSession(queryClient, router);
    await router.navigate({ to: search.returnTo ?? "/" });
  }

  return (
    <AuthScreenShell
      title={t.auth.signupTitle}
      description={t.auth.signupDescription}
    >
      <AuthForm
        mode="signup"
        onSuccess={handleSuccess}
        inviteToken={search.invite}
      />
    </AuthScreenShell>
  );
}
