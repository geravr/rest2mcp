import { SettingsFormSkeleton } from "@/components/loading";
import {
  SessionsSection,
  VerifiedEmailSection,
} from "@/components/settings/security-sections";
import { useTranslations } from "@/i18n/use-translations";
import { auth } from "@/lib/auth";
import { resolveErrorMessage } from "@/lib/errors";
import { revalidateSession, useSessionQuery } from "@/lib/queries/session";
import { useUserMeQuery } from "@/lib/queries/user";
import { api } from "@/lib/trpc";
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from "@repo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

type SessionSummary = {
  id?: string;
  token?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt?: string | Date | null;
  expiresAt?: string | Date | null;
};

export function SecuritySettingsTab() {
  const { t } = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: sessionData } = useSessionQuery();
  const { data, isLoading, isError, error } = useUserMeQuery();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  async function loadSessions() {
    setSessionsLoading(true);
    setSessionsError(null);
    const result = await auth.listSessions();
    if (result.error) {
      setSessionsError(
        result.error.message || t.settings.security.sessionsLoadFailed,
      );
      setSessions([]);
      setSessionsLoading(false);
      return;
    }
    setSessions((result.data ?? []) as SessionSummary[]);
    setSessionsLoading(false);
  }

  async function refreshAccountState() {
    await revalidateSession(queryClient, router);
    await queryClient.invalidateQueries(api.user.me.pathFilter());
    await loadSessions();
  }

  useEffect(() => {
    void loadSessions();
  }, [t]);

  if (isLoading && !data) {
    return <SettingsFormSkeleton cards={1} fields={3} />;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {resolveErrorMessage(error, t) ||
            t.settings.security.errorDescription}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.security.title}</CardTitle>
        <CardDescription>
          {t.settings.security.sessionActionsDescription}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <VerifiedEmailSection
          emailVerified={data?.emailVerified ?? false}
          email={data?.email ?? sessionData?.user.email ?? ""}
          onVerificationRequested={async () => {
            await queryClient.invalidateQueries(api.user.me.pathFilter());
          }}
        />

        <Separator />

        <SessionsSection
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          sessionsError={sessionsError}
          currentSessionToken={sessionData?.session.token}
          onRefreshAccountState={refreshAccountState}
        />
      </CardContent>
    </Card>
  );
}
