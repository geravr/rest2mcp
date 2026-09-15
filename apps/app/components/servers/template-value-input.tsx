import { useTranslations } from "@/i18n/use-translations";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Textarea,
} from "@repo/ui";
import { Braces } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

const PARTIAL_VARIABLE = /\{\{([A-Za-z0-9_]*)$/;

type ListPosition = { top: number; left: number; width: number };

export function TemplateValueInput({
  id,
  value,
  onChange,
  variableNames,
  placeholder,
  disabled,
  multiline = false,
  rows = 4,
  showInsert = false,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  variableNames: string[];
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
  rows?: number;
  showInsert?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
}) {
  const { t } = useTranslations();
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const listId = useId();
  const [suggestionQuery, setSuggestionQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [positionTick, setPositionTick] = useState(0);

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

  const measureListPosition = (): ListPosition | null => {
    const field = inputRef.current;
    if (!field) return null;
    const rect = field.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    };
  };

  void positionTick;
  const listPosition = suggestions.length > 0 ? measureListPosition() : null;

  useEffect(() => {
    if (suggestions.length === 0) return;
    const handleReposition = () => setPositionTick((tick) => tick + 1);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [suggestions.length]);

  const insertAtCaret = (inserted: string, replacePartial: boolean) => {
    const field = inputRef.current;
    const caret = field?.selectionStart ?? value.length;
    const beforeRaw = value.slice(0, caret);
    const before = replacePartial
      ? beforeRaw.replace(PARTIAL_VARIABLE, inserted)
      : beforeRaw + inserted;
    onChange(before + value.slice(caret));
    setSuggestionQuery(null);
    setPickerOpen(false);
    field?.focus();
  };

  const insertVariable = (name: string) => {
    insertAtCaret(`{{${name}}}`, true);
  };

  const insertFromPicker = (name: string) => {
    insertAtCaret(`{{${name}}}`, false);
  };

  const sharedProps = {
    id,
    value,
    disabled,
    placeholder,
    autoComplete: "off" as const,
    spellCheck: false,
    role: "combobox" as const,
    "aria-expanded": suggestions.length > 0 || pickerOpen,
    "aria-controls": suggestions.length > 0 ? listId : undefined,
    "aria-autocomplete": "list" as const,
    "aria-activedescendant": activeName ? `${listId}-${activeName}` : undefined,
    "aria-describedby": ariaDescribedBy,
    "aria-label": ariaLabel,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(event.target.value);
      const caret = event.target.selectionStart ?? event.target.value.length;
      const match = event.target.value.slice(0, caret).match(PARTIAL_VARIABLE);
      setSuggestionQuery(match ? match[1] : null);
      setActiveIndex(0);
    },
    onKeyDown: (
      event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (suggestions.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index - 1 + suggestions.length) % suggestions.length,
        );
      } else if (event.key === "Enter" && activeName && !multiline) {
        event.preventDefault();
        insertVariable(activeName);
      } else if (
        event.key === "Enter" &&
        activeName &&
        multiline &&
        event.ctrlKey
      ) {
        event.preventDefault();
        insertVariable(activeName);
      } else if (event.key === "Escape") {
        setSuggestionQuery(null);
      }
    },
    onBlur: () => setSuggestionQuery(null),
  };

  const portalRoot =
    inputRef.current?.closest('[role="dialog"]') ?? document.body;

  const suggestionList =
    suggestions.length > 0 && listPosition
      ? createPortal(
          <ul
            id={listId}
            role="listbox"
            style={{
              position: "fixed",
              top: listPosition.top,
              left: listPosition.left,
              width: listPosition.width,
            }}
            className="z-50 max-h-40 overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
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
          </ul>,
          portalRoot,
        )
      : null;

  return (
    <div className="space-y-2">
      <div className={showInsert ? "flex items-start gap-2" : undefined}>
        <div className={showInsert ? "relative min-w-0 flex-1" : "relative"}>
          {multiline ? (
            <Textarea
              ref={inputRef as Ref<HTMLTextAreaElement>}
              rows={rows}
              className="font-mono text-xs"
              {...sharedProps}
            />
          ) : (
            <Input ref={inputRef as Ref<HTMLInputElement>} {...sharedProps} />
          )}
          {suggestionList}
        </div>
        {showInsert ? (
          <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                aria-label={t.servers.insertVariable}
                aria-expanded={pickerOpen}
                className="shrink-0"
              >
                <Braces className="h-4 w-4" />
                {t.servers.insertVariable}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-40 w-56 overflow-auto"
              onEscapeKeyDown={(event) => event.stopPropagation()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              {variableNames.length === 0 ? (
                <DropdownMenuItem
                  disabled
                  className="min-h-10 py-2 text-xs text-muted-foreground"
                >
                  {t.servers.variablePickerEmpty}
                </DropdownMenuItem>
              ) : (
                variableNames.map((name) => (
                  <DropdownMenuItem
                    key={name}
                    className="min-h-10 py-2 font-mono text-xs"
                    onSelect={() => insertFromPicker(name)}
                  >
                    {name}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
