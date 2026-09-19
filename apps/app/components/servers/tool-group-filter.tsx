import type { McpToolGroupSummary } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";

/** Mirrors the API `toolGroupFilterSchema` sentinels. */
const ALL_FILTER = "all";
const UNGROUPED_FILTER = "ungrouped";

/**
 * Controlled, presentation-only group filter. `value` is `undefined` for All,
 * `"ungrouped"` for Ungrouped, or a group id. Changing the filter only reports
 * the next value; the parent owns the pagination reset that must accompany it.
 */
export function ToolGroupFilter({
  groups,
  value,
  onChange,
  total,
  disabled,
}: {
  groups: McpToolGroupSummary[];
  /** `undefined` means All. */
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  /** Tool total for the All entry; group counts never sum to it. */
  total?: number;
  disabled?: boolean;
}) {
  const { t } = useTranslations();
  const countLabel = (count: number) =>
    count === 1
      ? t.servers.groups.toolCountOne
      : t.servers.groups.toolCount.replace("{count}", String(count));

  return (
    <Select
      value={value ?? ALL_FILTER}
      disabled={disabled}
      onValueChange={(next) => onChange(next === ALL_FILTER ? undefined : next)}
    >
      <SelectTrigger className="w-56" aria-label={t.servers.groups.filterLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_FILTER}>
          {total === undefined
            ? t.servers.groups.all
            : `${t.servers.groups.all} · ${countLabel(total)}`}
        </SelectItem>
        <SelectItem value={UNGROUPED_FILTER}>
          {t.servers.groups.ungrouped}
        </SelectItem>
        {groups.map((group) => (
          <SelectItem key={group.id} value={group.id}>
            {`${group.name} · ${countLabel(group.toolCount)}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
