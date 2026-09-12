import { useTranslations } from "@/i18n/use-translations";
import { Card, CardContent, Skeleton } from "@repo/ui";

export function ServerCardsSkeleton({ cards = 6 }: { cards?: number }) {
  const { t } = useTranslations();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t.common.loading}
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: cards }, (_, index) => (
        <Card key={`server-card-skeleton-${index + 1}`}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="h-9 w-9 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex gap-2 border-t border-border pt-3">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
