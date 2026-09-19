import { useTranslations } from "@/i18n/use-translations";
import { Badge } from "@repo/ui";

/**
 * Draft/published state line for the server detail header. Never claims a
 * never-published server is callable and surfaces blocking readiness.
 */
export function ServerPublicationStatus({
  publishedRevisionNumber,
  dirty,
  publishReady,
}: {
  publishedRevisionNumber: number | null;
  dirty: boolean;
  publishReady: boolean;
}) {
  const { t } = useTranslations();

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {publishedRevisionNumber === null ? (
        <span>{t.servers.neverPublished}</span>
      ) : (
        <span>
          {t.servers.publishedRevision.replace(
            "{number}",
            String(publishedRevisionNumber),
          )}
        </span>
      )}
      {dirty ? (
        <Badge variant="outline">{t.servers.unpublishedChanges}</Badge>
      ) : null}
      {dirty && !publishReady ? (
        <Badge variant="destructive">{t.servers.publicationBlocked}</Badge>
      ) : null}
    </div>
  );
}
