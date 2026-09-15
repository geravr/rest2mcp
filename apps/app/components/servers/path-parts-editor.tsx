import { AgentParamCard } from "@/components/servers/source-row-editor";
import { VariablePicker } from "@/components/servers/variable-picker";
import { useTranslations } from "@/i18n/use-translations";
import {
  removePathPart,
  slugifyAgentName,
  type AgentMeta,
  type PathPart,
} from "@/lib/value-origin";
import { Button, Input } from "@repo/ui";
import { Plus, X } from "lucide-react";

function insertAfterLastText(parts: PathPart[], token: PathPart): PathPart[] {
  const next = [...parts];
  if (next.length === 0 || next[next.length - 1]?.kind !== "text") {
    next.push({ kind: "text", value: "" });
  }
  next.push(token);
  next.push({ kind: "text", value: "" });
  return next;
}

function isPathEmpty(parts: PathPart[]): boolean {
  return (
    parts.length === 0 ||
    parts.every((part) => part.kind === "text" && part.value === "")
  );
}

function textInputWidth(value: string, placeholder?: string): number {
  const length = value.length || placeholder?.length || 0;
  return Math.max(2, length + 1);
}

function TrackTextInput({
  value,
  placeholder,
  disabled,
  id,
  ariaLabel,
  caret = false,
  onChange,
}: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  caret?: boolean;
  onChange: (value: string) => void;
}) {
  const width = caret && value === "" ? 2 : textInputWidth(value, placeholder);
  return (
    <Input
      id={id}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      spellCheck={false}
      size={width}
      aria-label={ariaLabel}
      className="h-7 min-w-[2ch] border-0 bg-transparent px-0 font-mono text-xs shadow-none focus-visible:ring-0"
      style={{ width: `${width}ch` }}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function PathPartsEditor({
  parts,
  onChange,
  variableNames,
  disabled,
  pathInputId,
}: {
  parts: PathPart[];
  onChange: (parts: PathPart[]) => void;
  variableNames: string[];
  disabled?: boolean;
  pathInputId?: string;
}) {
  const { t } = useTranslations();

  const update = (index: number, next: PathPart) =>
    onChange(parts.map((part, position) => (position === index ? next : part)));

  const firstTextIndex = parts.findIndex((part) => part.kind === "text");
  const empty = isPathEmpty(parts);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1">
        {empty ? (
          <TrackTextInput
            id={pathInputId}
            value={parts[0]?.kind === "text" ? parts[0].value : ""}
            disabled={disabled}
            placeholder={t.servers.pathPlaceholder}
            onChange={(value) => onChange([{ kind: "text", value }])}
          />
        ) : (
          /* eslint-disable @eslint-react/no-array-index-key */
          parts.map((part, index) => {
            if (part.kind === "text") {
              return (
                <TrackTextInput
                  key={`text-${index}`}
                  id={index === firstTextIndex ? pathInputId : undefined}
                  value={part.value}
                  disabled={disabled}
                  caret={part.value === ""}
                  ariaLabel={
                    index === firstTextIndex
                      ? undefined
                      : `${t.servers.pathTemplate} ${index + 1}`
                  }
                  onChange={(value) => update(index, { kind: "text", value })}
                />
              );
            }

            if (part.kind === "variable") {
              return (
                <span
                  key={`variable-${part.name}-${index}`}
                  className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/50 px-1.5 py-0.5"
                >
                  <VariablePicker
                    value={part.name}
                    variableNames={variableNames}
                    disabled={disabled}
                    compact
                    onChange={(name) =>
                      update(index, { kind: "variable", name })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={disabled}
                    aria-label={t.servers.pathTokenRemove}
                    onClick={() => onChange(removePathPart(parts, index))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </span>
              );
            }

            return (
              <span
                key={`agent-${part.name}-${index}`}
                className="inline-flex items-center gap-0.5 rounded-md border border-border bg-muted/50 px-1.5 py-0.5"
              >
                <Input
                  value={part.name}
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  size={Math.max(2, part.name.length + 1)}
                  aria-label={t.servers.markingName}
                  className="h-6 min-w-[2ch] border-0 bg-transparent px-0 font-mono text-xs shadow-none focus-visible:ring-0"
                  style={{
                    width: `${Math.max(2, part.name.length + 1)}ch`,
                  }}
                  onChange={(event) =>
                    update(index, { ...part, name: event.target.value })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={disabled}
                  aria-label={t.servers.pathTokenRemove}
                  onClick={() => onChange(removePathPart(parts, index))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </span>
            );
          })
          /* eslint-enable @eslint-react/no-array-index-key */
        )}
      </div>
      {parts.some((part) => part.kind === "agent") ? (
        <div className="space-y-2">
          {/* eslint-disable @eslint-react/no-array-index-key */}
          {parts.map((part, index) =>
            part.kind === "agent" ? (
              <AgentParamCard
                key={`agent-meta-${index}`}
                title={part.name}
                description={part.description ?? ""}
                onDescriptionChange={(description) =>
                  update(index, { ...part, description })
                }
                type={part.type}
                onTypeChange={(type) => update(index, { ...part, type })}
                required={part.required}
                onRequiredChange={(required) =>
                  update(index, { ...part, required })
                }
                disabled={disabled}
              />
            ) : null,
          )}
          {/* eslint-enable @eslint-react/no-array-index-key */}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || variableNames.length === 0}
          onClick={() =>
            onChange(
              insertAfterLastText(parts, {
                kind: "variable",
                name: variableNames[0]!,
              }),
            )
          }
        >
          <Plus className="h-4 w-4" />
          {t.servers.pathInsertVariable}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() =>
            onChange(
              insertAfterLastText(parts, {
                kind: "agent",
                name: slugifyAgentName("id"),
                description: "",
                type: "string",
                required: true,
              } satisfies AgentMeta & { kind: "agent" }),
            )
          }
        >
          <Plus className="h-4 w-4" />
          {t.servers.pathInsertAgent}
        </Button>
      </div>
    </div>
  );
}
