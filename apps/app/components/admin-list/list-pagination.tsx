import { useTranslations } from "@/i18n/use-translations";
import type { PageSize } from "@repo/core";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@repo/ui";
import { PageSizeSelect } from "./page-size-select";

type AdminListPaginationProps = {
  page: number;
  pageSize: PageSize;
  total: number;
  itemCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
};

export function AdminListPagination({
  page,
  pageSize,
  total,
  itemCount,
  onPageChange,
  onPageSizeChange,
}: AdminListPaginationProps) {
  const { t } = useTranslations();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = itemCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = itemCount === 0 ? 0 : Math.min(page * pageSize, total);
  const canPrevious = page > 1;
  const canNext = page < pageCount;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {t.common.pagination.range
          .replace("{from}", String(from))
          .replace("{to}", String(to))
          .replace("{total}", String(total))}
      </p>
      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        <PageSizeSelect
          pageSize={pageSize}
          onPageSizeChange={onPageSizeChange}
        />
        <Pagination
          className="mx-0 w-auto justify-start sm:justify-end"
          aria-label={t.common.pagination.navLabel}
        >
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                text={t.common.pagination.previous}
                aria-label={t.common.pagination.previousPage}
                aria-disabled={!canPrevious}
                tabIndex={canPrevious ? undefined : -1}
                className={
                  canPrevious ? undefined : "pointer-events-none opacity-50"
                }
                onClick={(event) => {
                  event.preventDefault();
                  if (canPrevious) onPageChange(page - 1);
                }}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                text={t.common.pagination.next}
                aria-label={t.common.pagination.nextPage}
                aria-disabled={!canNext}
                tabIndex={canNext ? undefined : -1}
                className={
                  canNext ? undefined : "pointer-events-none opacity-50"
                }
                onClick={(event) => {
                  event.preventDefault();
                  if (canNext) onPageChange(page + 1);
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
