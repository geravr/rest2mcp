import { AuthErrorBoundary, SessionLoadingScreen } from "@/components/auth";
import { TopNavLayout } from "@/components/layout-top";
import { ObservabilityConsentBanner } from "@/components/observability/observability-consent-banner";
import { buildProtectedRouteReturnTo } from "@/lib/auth-redirect";
import { getCachedSession, sessionQueryOptions } from "@/lib/queries/session";
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

export const Route = createFileRoute("/(app)")({
  // Route-level authentication guard (blocking, no flash).
  beforeLoad: async ({ context, location }) => {
    let session = getCachedSession(context.queryClient);

    if (session === undefined) {
      session = await context.queryClient.fetchQuery(sessionQueryOptions());
    }

    // Both user and session must exist for valid auth state
    if (!session?.user || !session?.session) {
      throw redirect({
        to: "/login",
        search: {
          returnTo: buildProtectedRouteReturnTo(location),
        },
      });
    }

    return { user: session.user, session };
  },
  pendingComponent: ProtectedAppPending,
  component: AppLayout,
});

function ProtectedAppPending() {
  return <SessionLoadingScreen />;
}

function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdmin = pathname.startsWith("/admin");

  // Admin panel uses its own layout — skip TopNavLayout.
  if (isAdmin) {
    return (
      <AuthErrorBoundary>
        <Outlet />
        <ObservabilityConsentBanner />
      </AuthErrorBoundary>
    );
  }

  return (
    <AuthErrorBoundary>
      <TopNavLayout>
        <Outlet />
      </TopNavLayout>
      <ObservabilityConsentBanner />
    </AuthErrorBoundary>
  );
}
