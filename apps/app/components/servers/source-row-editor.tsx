import { VariablePicker } from "@/components/servers/variable-picker";
import { useTranslations } from "@/i18n/use-translations";
import {
  emptyFixedRow,
  slugifyAgentName,
  type AgentParamType,
  type SourceRow,
} from "@/lib/value-origin";
import {
  Button,
  Field,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@repo/ui";
import { Plus, X } from "lucide-react";

const PARAM_TYPES: AgentParamType[] = ["string", "number", "boolean", "json"];

export type SourceOriginMode = "tool" | "defaults";

function AgentTypeSelect({
  type,
  disabled,
  onChange,
}: {
  type: AgentParamType;
  disabled?: boolean;
  onChange: (type: AgentParamType) => void;
}) {
  const { t } = useTranslations();
  return (
    <Select
      value={type}
      disabled={disabled}
      onValueChange={(next) => onChange(next as AgentParamType)}
    >
      <SelectTrigger className="w-full" aria-label={t.servers.paramType}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PARAM_TYPES.map((item) => (
          <SelectItem key={item} value={item}>
            {t.servers.paramTypes[item]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function agentNameFollowsKey(row: SourceRow): boolean {
  if (row.origin !== "agent") return false;
  return row.name === "" || row.name === slugifyAgentName(row.key);
}

export function AgentParamCard({
  title,
  name,
  paramKey,
  onNameChange,
  description,
  onDescriptionChange,
  descriptionAriaLabel,
  type,
  onTypeChange,
  required,
  onRequiredChange,
  disabled,
  nested = false,
}: {
  title: string;
  name?: string;
  paramKey?: string;
  onNameChange?: (name: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  descriptionAriaLabel?: string;
  type: AgentParamType;
  onTypeChange: (type: AgentParamType) => void;
  required: boolean;
  onRequiredChange: (required: boolean) => void;
  disabled?: boolean;
  nested?: boolean;
}) {
  const { t } = useTranslations();
  const legacyAgentName =
    !onNameChange && name && paramKey && name !== slugifyAgentName(paramKey);

  return (
    <div
      className={
        nested
          ? "space-y-4 border-t border-border pt-3"
          : "space-y-4 rounded-md border border-border bg-muted/30 p-4"
      }
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {legacyAgentName ? (
          <p className="font-mono text-xs text-muted-foreground">
            {t.servers.agentParamNameSaved.replace("{name}", name)}
          </p>
        ) : null}
      </div>
      <div
        className={
          nested
            ? "grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end"
            : "grid gap-4 sm:grid-cols-2"
        }
      >
        {onNameChange ? (
          <Field className={nested ? "sm:col-span-full" : undefined}>
            <Label className="text-xs">{t.servers.markingName}</Label>
            <Input
              value={name ?? ""}
              disabled={disabled}
              placeholder={t.servers.markingNamePlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
              aria-label={t.servers.markingName}
              onChange={(event) => onNameChange(event.target.value)}
            />
          </Field>
        ) : null}
        <Field
          className={!nested && !onNameChange ? "sm:col-span-2" : undefined}
        >
          <Label className="text-xs">{t.servers.paramDescription}</Label>
          <Input
            value={description}
            disabled={disabled}
            placeholder={t.servers.paramDescriptionPlaceholder}
            aria-label={descriptionAriaLabel ?? t.servers.paramDescription}
            onChange={(event) => onDescriptionChange(event.target.value)}
          />
        </Field>
        <Field>
          <Label className="text-xs">{t.servers.paramType}</Label>
          <AgentTypeSelect
            type={type}
            disabled={disabled}
            onChange={onTypeChange}
          />
        </Field>
        <Field>
          <Label className="text-xs">{t.servers.paramRequired}</Label>
          <div className="flex h-10 items-center">
            <Switch
              checked={required}
              disabled={disabled}
              aria-label={t.servers.paramRequired}
              onCheckedChange={onRequiredChange}
            />
          </div>
        </Field>
      </div>
    </div>
  );
}

function defaultVariablePrefix(key: string): string {
  return /^(authorization|proxy-authorization)$/i.test(key.trim())
    ? "Bearer "
    : "";
}

function switchOrigin(row: SourceRow, origin: SourceRow["origin"]): SourceRow {
  if (origin === "fixed") {
    return { key: row.key, origin: "fixed", value: "" };
  }
  if (origin === "variable") {
    return {
      key: row.key,
      origin: "variable",
      name: "",
      prefix: defaultVariablePrefix(row.key),
    };
  }
  return {
    key: row.key,
    origin: "agent",
    name: slugifyAgentName(row.key),
    description: "",
    type: "string",
    required: true,
  };
}

export function SourceRowEditor({
  rows,
  onChange,
  variableNames,
  mode = "tool",
  disabled,
  emptyLabel,
}: {
  rows: SourceRow[];
  onChange: (rows: SourceRow[]) => void;
  variableNames: string[];
  mode?: SourceOriginMode;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const { t } = useTranslations();
  const origins =
    mode === "defaults"
      ? (["fixed", "variable"] as const)
      : (["fixed", "variable", "agent"] as const);

  const update = (index: number, next: SourceRow) =>
    onChange(rows.map((row, position) => (position === index ? next : row)));

  return (
    <div className="space-y-4">
      {rows.length === 0 && emptyLabel ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : null}
      {rows.map((row, index) => (
        <div
          // Rows are positional drafts; keying by content remounts on type.
          // eslint-disable-next-line @eslint-react/no-array-index-key
          key={index}
          className="space-y-3 rounded-md border border-border bg-muted/20 p-3"
        >
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <Input
              value={row.key}
              disabled={disabled}
              placeholder={t.servers.kvKeyPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 font-mono text-xs sm:min-w-28 sm:flex-1"
              aria-label={t.servers.kvKeyPlaceholder}
              onChange={(event) => {
                const newKey = event.target.value;
                if (row.origin === "agent" && agentNameFollowsKey(row)) {
                  update(index, {
                    ...row,
                    key: newKey,
                    name: slugifyAgentName(newKey),
                  });
                  return;
                }
                update(index, { ...row, key: newKey });
              }}
            />
            <Select
              value={row.origin}
              disabled={disabled}
              onValueChange={(value) =>
                update(index, switchOrigin(row, value as SourceRow["origin"]))
              }
            >
              <SelectTrigger
                className="w-full sm:w-28"
                aria-label={t.servers.originSelect}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {origins.map((origin) => (
                  <SelectItem key={origin} value={origin}>
                    {origin === "fixed"
                      ? t.servers.originFixed
                      : origin === "variable"
                        ? t.servers.originVariable
                        : t.servers.originAgent}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {row.origin === "fixed" ? (
              <Input
                value={row.value}
                disabled={disabled}
                placeholder={t.servers.kvValuePlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 font-mono text-xs sm:min-w-28 sm:flex-1"
                aria-label={t.servers.kvValuePlaceholder}
                onChange={(event) =>
                  update(index, { ...row, value: event.target.value })
                }
              />
            ) : null}
            {row.origin === "variable" && row.prefix.length > 0 ? (
              <Input
                value={row.prefix}
                disabled={disabled}
                placeholder={t.servers.originPrefixPlaceholder}
                title={t.servers.originPrefixHint}
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 font-mono text-xs sm:w-28"
                aria-label={t.servers.originPrefix}
                onChange={(event) =>
                  update(index, { ...row, prefix: event.target.value })
                }
              />
            ) : null}
            {row.origin === "variable" ? (
              <div className="min-w-0 flex-1">
                <VariablePicker
                  value={row.name}
                  variableNames={variableNames}
                  disabled={disabled}
                  onChange={(name) => update(index, { ...row, name })}
                />
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              className="shrink-0 self-end sm:self-auto"
              aria-label={t.servers.kvRemoveRow}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {row.origin === "agent" ? (
            <AgentParamCard
              nested
              title={t.servers.agentParamTitle}
              name={row.name}
              paramKey={row.key}
              description={row.description ?? ""}
              onDescriptionChange={(nextDescription) =>
                update(index, { ...row, description: nextDescription })
              }
              type={row.type}
              onTypeChange={(nextType) =>
                update(index, { ...row, type: nextType })
              }
              required={row.required}
              onRequiredChange={(nextRequired) =>
                update(index, { ...row, required: nextRequired })
              }
              disabled={disabled}
            />
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...rows, emptyFixedRow()])}
      >
        <Plus className="h-4 w-4" />
        {t.servers.kvAddRow}
      </Button>
    </div>
  );
}

export function AgentLeftoverFields({
  params,
  onChange,
  disabled,
}: {
  params: Array<{
    name: string;
    description?: string;
    type: AgentParamType;
    required: boolean;
  }>;
  onChange: (
    params: Array<{
      name: string;
      description?: string;
      type: AgentParamType;
      required: boolean;
    }>,
  ) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslations();
  if (params.length === 0) return null;

  const update = (name: string, patch: Partial<(typeof params)[number]>) =>
    onChange(
      params.map((param) =>
        param.name === name ? { ...param, ...patch } : param,
      ),
    );

  return (
    <div className="space-y-3">
      {params.map((param) => (
        <AgentParamCard
          key={param.name}
          title={param.name}
          description={param.description ?? ""}
          onDescriptionChange={(description) =>
            update(param.name, { description })
          }
          descriptionAriaLabel={`${t.servers.paramDescription} (${param.name})`}
          type={param.type}
          onTypeChange={(type) => update(param.name, { type })}
          required={param.required}
          onRequiredChange={(required) => update(param.name, { required })}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
