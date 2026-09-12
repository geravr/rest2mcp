import { useTranslations } from "@/i18n/use-translations";
import { cn, Skeleton } from "@repo/ui";

export function TableRowsSkeleton({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  const { t } = useTranslations();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={t.common.loading}
      className="space-y-3"
    >
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={`table-row-skeleton-${index + 1}`}
          className={cn("h-14 w-full", className)}
        />
      ))}
    </div>
  );
}
