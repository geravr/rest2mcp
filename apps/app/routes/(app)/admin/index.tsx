import { StatValueSkeleton } from "@/components/loading";
import { useAdminStats } from "@/hooks/use-admin";
import { useTranslations } from "@/i18n/use-translations";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Mail, Shield, Users } from "lucide-react";

export const Route = createFileRoute("/(app)/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const { t } = useTranslations();
  const { data: stats, isLoading } = useAdminStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t.admin.dashboard.title}
        </h1>
        <p className="text-muted-foreground">{t.admin.dashboard.description}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t.admin.dashboard.totalUsers}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          isLoading={isLoading}
          value={stats?.totalUsers}
          link="/admin/users"
          viewAllLabel={t.admin.dashboard.viewAllLink}
        />
        <StatCard
          title={t.admin.dashboard.newUsersLast7Days}
          icon={<Shield className="h-4 w-4 text-muted-foreground" />}
          isLoading={isLoading}
          value={stats?.newUsersLast7Days}
        />
        <StatCard
          title={t.admin.dashboard.pendingInvitations}
          icon={<Mail className="h-4 w-4 text-muted-foreground" />}
          isLoading={isLoading}
          value={stats?.pendingInvitations}
          link="/admin/invitations"
          viewAllLabel={t.admin.dashboard.viewAllLink}
        />
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t.admin.dashboard.publicRegistration}
            </CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading && !stats ? (
              <StatValueSkeleton className="w-24" />
            ) : (
              <Badge
                variant={stats?.registrationEnabled ? "default" : "destructive"}
              >
                {stats?.registrationEnabled
                  ? t.admin.settings.enabledBadge
                  : t.admin.settings.disabledBadge}
              </Badge>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              <Link
                to="/admin/settings"
                className="font-semibold text-primary hover:underline"
              >
                {t.admin.dashboard.changeLink}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  title,
  icon,
  isLoading,
  value,
  link,
  viewAllLabel,
}: {
  title: string;
  icon: React.ReactNode;
  isLoading: boolean;
  value?: number;
  link?: string;
  viewAllLabel?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {isLoading && value === undefined ? (
          <StatValueSkeleton />
        ) : (
          <div className="text-2xl font-bold text-foreground">{value ?? 0}</div>
        )}
        {link && (
          <p className="mt-2 text-xs text-muted-foreground">
            <Link
              to={link}
              className="font-semibold text-primary hover:underline"
            >
              {viewAllLabel}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
