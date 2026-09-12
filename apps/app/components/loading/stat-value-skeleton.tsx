import { useTranslations } from "@/i18n/use-translations";
import { cn, Skeleton } from "@repo/ui";

export function StatValueSkeleton({ className }: { className?: string }) {
  const { t } = useTranslations();

  return (
    <div role="status" aria-busy="true" aria-label={t.common.loading}>
      <Skeleton className={cn("h-7 w-16", className)} />
    </div>
  );
}
