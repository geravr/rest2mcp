import { useTranslations } from "@/i18n/use-translations";
import { Card, CardContent, CardHeader, Skeleton } from "@repo/ui";

export function SettingsFormSkeleton({
  cards = 1,
  fields = 3,
}: {
  cards?: number;
  fields?: number;
}) {
  const { t } = useTranslations();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t.common.loading}
      className="space-y-6"
    >
      {Array.from({ length: cards }, (_, cardIndex) => (
        <Card key={`settings-form-skeleton-${cardIndex + 1}`}>
          <CardHeader className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-2/3 max-w-sm" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: fields }, (_, fieldIndex) => (
              <Skeleton
                key={`settings-form-field-skeleton-${cardIndex + 1}-${fieldIndex + 1}`}
                className="h-10 w-full max-w-md"
              />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
