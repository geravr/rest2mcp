import { useTranslations } from "@/i18n/use-translations";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

export function VariablePicker({
  value,
  onChange,
  variableNames,
  disabled,
  id,
  compact = false,
}: {
  value: string;
  onChange: (name: string) => void;
  variableNames: string[];
  disabled?: boolean;
  id?: string;
  compact?: boolean;
}) {
  const { t } = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          disabled={disabled}
          aria-label={
            compact
              ? value
                ? `${t.servers.variablePickerPlaceholder}: ${value}`
                : t.servers.variablePickerPlaceholder
              : undefined
          }
          className={
            compact
              ? "h-7 gap-1 border-0 bg-transparent px-1 font-mono text-xs font-normal shadow-none hover:bg-accent"
              : "h-10 w-full justify-between font-mono text-xs font-normal"
          }
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <span className="truncate">
            {value || t.servers.variablePickerPlaceholder}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 opacity-50"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
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
              onSelect={() => onChange(name)}
            >
              {name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
