import { TableRowsSkeleton } from "@/components/loading";
import { auth } from "@/lib/auth";
import { useTranslations } from "@/i18n/use-translations";
import { Alert, AlertDescription, Badge, Button } from "@repo/ui";
import { useState } from "react";

type SessionSummary = {
  id?: string;
  token?: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt?: string | Date | null;
  expiresAt?: string | Date | null;
};

type StatusFeedback = {
  tone: "error" | "success";
  message: string;
};

function StatusAlert({ feedback }: { feedback: StatusFeedback }) {
  return (
    <Alert variant={feedback.tone === "error" ? "destructive" : "default"}>
      <AlertDescription>{feedback.message}</AlertDescription>
    </Alert>
  );
}

export function VerifiedEmailSection({
  emailVerified,
  email,
  onVerificationRequested,
}: {
  emailVerified: boolean;
  email: string;
  onVerificationRequested: () => Promise<void>;
}) {
  const { t } = useTranslations();
  const [feedback, setFeedback] = useState<StatusFeedback | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium">
            {t.settings.security.verifiedEmail}
          </h3>
          <Badge variant={emailVerified ? "outline" : "secondary"}>
            {emailVerified
              ? t.settings.profile.verifiedBadge
              : t.settings.profile.unverifiedBadge}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {emailVerified
            ? t.settings.security.verifiedEmailDescription
            : t.settings.security.unverifiedEmailDescription}
        </p>
      </div>

      {!emailVerified ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t.settings.security.sendVerificationTo.replace("{email}", email)}
          </p>

          {feedback ? <StatusAlert feedback={feedback} /> : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSubmitting || !email}
            onClick={() => {
              void (async () => {
                setFeedback(null);
                setIsSubmitting(true);

                const result = await auth.sendVerificationEmail({
                  email,
                  callbackURL: `${window.location.origin}/verify-email?returnTo=${encodeURIComponent("/settings")}`,
                });

                if (result.error) {
                  setFeedback({
                    tone: "error",
                    message:
                      result.error.message ||
                      t.settings.security.verificationEmailFailed,
                  });
                  setIsSubmitting(false);
                  return;
                }

                setFeedback({
                  tone: "success",
                  message: t.settings.security.verificationEmailSent,
                });
                await onVerificationRequested();
                setIsSubmitting(false);
              })();
            }}
          >
            {isSubmitting
              ? t.settings.security.sendingVerification
              : t.settings.security.sendVerificationEmail}
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function SessionsSection({
  sessions,
  sessionsLoading,
  sessionsError,
  currentSessionToken,
  onRefreshAccountState,
}: {
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  currentSessionToken?: string;
  onRefreshAccountState: () => Promise<void>;
}) {
  const { t, locale } = useTranslations();
  const [feedback, setFeedback] = useState<StatusFeedback | null>(null);
  const [isRevokingOtherSessions, setIsRevokingOtherSessions] = useState(false);
  const [revokingSessionToken, setRevokingSessionToken] = useState<
    string | null
  >(null);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            {t.settings.security.sessionActions}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t.settings.security.sessionActionsDescription}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isRevokingOtherSessions}
          onClick={() => {
            void (async () => {
              setFeedback(null);
              setIsRevokingOtherSessions(true);
              const result = await auth.revokeOtherSessions();
              if (result.error) {
                setFeedback({
                  tone: "error",
                  message:
                    result.error.message ||
                    t.settings.security.revokeOtherSessionsFailed,
                });
                setIsRevokingOtherSessions(false);
                return;
              }

              setFeedback({
                tone: "success",
                message: t.settings.security.otherSessionsRevoked,
              });
              await onRefreshAccountState();
              setIsRevokingOtherSessions(false);
            })();
          }}
        >
          {isRevokingOtherSessions
            ? t.settings.security.revokingButton
            : t.settings.security.revokeOtherSessionsButton}
        </Button>
      </div>

      {sessionsError ? (
        <StatusAlert feedback={{ tone: "error", message: sessionsError }} />
      ) : null}

      {feedback ? <StatusAlert feedback={feedback} /> : null}

      {sessionsLoading && sessions.length === 0 ? (
        <TableRowsSkeleton rows={3} />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t.settings.security.noSessions}
        </p>
      ) : (
        <div className="space-y-2">
          {sessions.map((session, index) => {
            const isCurrentSession =
              !!session.token && session.token === currentSessionToken;

            return (
              <div
                key={session.id ?? `${session.userAgent ?? "session"}-${index}`}
                className="flex items-start justify-between gap-4 rounded-md border border-border p-3"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {session.userAgent || t.settings.security.unknownDevice}
                    {isCurrentSession ? (
                      <>
                        {" "}
                        <Badge variant="outline">
                          {t.settings.security.currentSession}
                        </Badge>
                      </>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {session.ipAddress ? `${session.ipAddress} · ` : ""}
                    {session.createdAt
                      ? t.settings.security.sessionCreatedAt.replace(
                          "{date}",
                          new Date(session.createdAt).toLocaleString(
                            locale === "es" ? "es-ES" : "en-US",
                          ),
                        )
                      : t.settings.security.sessionCreatedRecently}
                  </p>
                  {session.expiresAt ? (
                    <p className="text-sm text-muted-foreground">
                      {t.settings.security.sessionExpiresAt.replace(
                        "{date}",
                        new Date(session.expiresAt).toLocaleString(
                          locale === "es" ? "es-ES" : "en-US",
                        ),
                      )}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    !session.token ||
                    isCurrentSession ||
                    revokingSessionToken === session.token
                  }
                  onClick={() => {
                    void (async () => {
                      if (!session.token || isCurrentSession) {
                        return;
                      }

                      setFeedback(null);
                      setRevokingSessionToken(session.token);
                      const result = await auth.revokeSession({
                        token: session.token,
                      });
                      if (result.error) {
                        setFeedback({
                          tone: "error",
                          message:
                            result.error.message ||
                            t.settings.security.sessionRevokeFailed,
                        });
                        setRevokingSessionToken(null);
                        return;
                      }

                      setFeedback({
                        tone: "success",
                        message: t.settings.security.sessionRevoked,
                      });
                      await onRefreshAccountState();
                      setRevokingSessionToken(null);
                    })();
                  }}
                >
                  {revokingSessionToken === session.token
                    ? t.settings.security.revokingButton
                    : t.settings.security.revokeButton}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
