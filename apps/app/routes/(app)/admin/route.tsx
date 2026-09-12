import { AdminLayout } from "@/components/admin-layout";
import { getCachedSession, sessionQueryOptions } from "@/lib/queries/session";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/admin")({
  beforeLoad: async ({ context }) => {
    let session = getCachedSession(context.queryClient);
    if (session === undefined) {
      session = await context.queryClient.fetchQuery(sessionQueryOptions());
    }

    if (!session?.user || !session?.session) {
      throw redirect({ to: "/login" });
    }

    // Only super_admin can access admin routes
    if (session.user.role !== "super_admin") {
      throw redirect({ to: "/" });
    }
  },
  component: AdminLayoutWrapper,
});

function AdminLayoutWrapper() {
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}
