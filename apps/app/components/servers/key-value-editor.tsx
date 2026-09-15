import { TemplateValueInput } from "@/components/servers/template-value-input";
import { useTranslations } from "@/i18n/use-translations";
import { Button, Input } from "@repo/ui";
import { Plus, X } from "lucide-react";

export type KeyValuePair = { key: string; value: string };

export { TemplateValueInput } from "@/components/servers/template-value-input";

export function recordToPairs(
  record: Record<string, string> | null | undefined,
): KeyValuePair[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value }));
}

export function pairsToRecord(pairs: KeyValuePair[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const trimmed = key.trim();
    if (trimmed) record[trimmed] = value;
  }
  return record;
}

/** Row editor for `Record<string, string>` template maps. */
export function KeyValueEditor({
  pairs,
  onChange,
  variableNames = [],
  keyPlaceholder,
  valuePlaceholder,
  disabled,
}: {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  variableNames?: string[];
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslations();

  const update = (index: number, patch: Partial<KeyValuePair>) =>
    onChange(
      pairs.map((pair, position) =>
        position === index ? { ...pair, ...patch } : pair,
      ),
    );

  return (
    <div className="space-y-2">
      {pairs.map((pair, index) => (
        // Rows are positional drafts without a stable identity; keying by
        // row content would remount the inputs on every keystroke.
        // eslint-disable-next-line @eslint-react/no-array-index-key
        <div key={index} className="flex items-center gap-2">
          <Input
            value={pair.key}
            disabled={disabled}
            placeholder={keyPlaceholder ?? t.servers.kvKeyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            onChange={(event) => update(index, { key: event.target.value })}
          />
          <TemplateValueInput
            value={pair.value}
            disabled={disabled}
            variableNames={variableNames}
            placeholder={valuePlaceholder ?? t.servers.kvValuePlaceholder}
            onChange={(value) => update(index, { value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label={t.servers.kvRemoveRow}
            onClick={() => onChange(pairs.filter((_, i) => i !== index))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...pairs, { key: "", value: "" }])}
      >
        <Plus className="h-4 w-4" />
        {t.servers.kvAddRow}
      </Button>
    </div>
  );
}
