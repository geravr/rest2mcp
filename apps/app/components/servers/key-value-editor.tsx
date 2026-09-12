import { useTranslations } from "@/i18n/use-translations";
import { Button, Input } from "@repo/ui";
import { Plus, X } from "lucide-react";
import { useId, useRef, useState } from "react";

export type KeyValuePair = { key: string; value: string };

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

const PARTIAL_VARIABLE = /\{\{([A-Za-z0-9_]*)$/;

/** Input that autocompletes server variables after typing `{{`. */
export function TemplateValueInput({
  id,
  value,
  onChange,
  variableNames,
  placeholder,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  variableNames: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [suggestionQuery, setSuggestionQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions =
    suggestionQuery === null
      ? []
      : variableNames
          .filter(
            (name) =>
              name.includes(suggestionQuery) && name !== suggestionQuery,
          )
          .slice(0, 6);
  const activeName =
    activeIndex < suggestions.length ? suggestions[activeIndex] : undefined;

  const insertVariable = (name: string) => {
    const caret = inputRef.current?.selectionStart ?? value.length;
    const before = value
      .slice(0, caret)
      .replace(PARTIAL_VARIABLE, `{{${name}}}`);
    onChange(before + value.slice(caret));
    setSuggestionQuery(null);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeName ? `${listId}-${activeName}` : undefined
        }
        onChange={(event) => {
          onChange(event.target.value);
          const caret =
            event.target.selectionStart ?? event.target.value.length;
          const match = event.target.value
            .slice(0, caret)
            .match(PARTIAL_VARIABLE);
          setSuggestionQuery(match ? match[1] : null);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (suggestions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % suggestions.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(
              (index) => (index - 1 + suggestions.length) % suggestions.length,
            );
          } else if (event.key === "Enter" && activeName) {
            event.preventDefault();
            insertVariable(activeName);
          } else if (event.key === "Escape") {
            setSuggestionQuery(null);
          }
        }}
        onBlur={() => setSuggestionQuery(null)}
      />
      {suggestions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-40 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {suggestions.map((name, index) => (
            <li key={name} role="presentation">
              <button
                type="button"
                id={`${listId}-${name}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`flex w-full items-center rounded-sm px-2 py-1 text-left font-mono text-xs hover:bg-accent ${
                  index === activeIndex ? "bg-accent" : ""
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertVariable(name);
                }}
              >
                {`{{${name}}}`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
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
