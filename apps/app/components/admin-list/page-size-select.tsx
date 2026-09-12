import { useTranslations } from "@/i18n/use-translations";
import { PAGE_SIZE_OPTIONS, type PageSize } from "@repo/core";
import {
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";
import { useId } from "react";

type PageSizeSelectProps = {
  pageSize: PageSize;
  onPageSizeChange: (pageSize: PageSize) => void;
};

export function PageSizeSelect({
  pageSize,
  onPageSizeChange,
}: PageSizeSelectProps) {
  const { t } = useTranslations();
  const pageSizeId = useId();

  return (
    <div className="flex items-center gap-2">
      <Label
        htmlFor={pageSizeId}
        className="text-sm font-normal text-muted-foreground"
      >
        {t.common.pagination.pageSize}
      </Label>
      <Select
        value={String(pageSize)}
        onValueChange={(value) => onPageSizeChange(Number(value) as PageSize)}
      >
        <SelectTrigger
          id={pageSizeId}
          className="h-9 w-[4.75rem]"
          aria-label={t.common.pagination.pageSize}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
