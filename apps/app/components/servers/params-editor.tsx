import { useTranslations } from "@/i18n/use-translations";
import {
  Alert,
  AlertDescription,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@repo/ui";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { KeyValuePair } from "./key-value-editor";

export type ToolParamDraft = {
  name: string;
  description?: string;
  required: boolean;
  type: "string" | "number" | "boolean" | "json";
};

export type TemplateWarning = {
  type: "placeholder_without_param" | "param_without_placeholder";
  name: string;
};

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

/** Placeholder names found across every templated field, minus variable names. */
export function detectPlaceholders(
  fields: Array<string | null | undefined>,
  variableNames: string[],
): string[] {
  const variables = new Set(variableNames);
  const found = new Set<string>();
  for (const field of fields) {
    if (!field) continue;
    for (const match of field.matchAll(PLACEHOLDER)) {
      if (!variables.has(match[1])) found.add(match[1]);
    }
  }
  return [...found];
}

const PARAM_TYPES: Array<ToolParamDraft["type"]> = [
  "string",
  "number",
  "boolean",
  "json",
];

/**
 * Param declarations driven by live `{{placeholder}}` detection. New
 * placeholders auto-declare a param; orphaned declarations stay listed with
 * a warning so the author can remove them explicitly.
 */
export function ParamsEditor({
  pathTemplate,
  query,
  headers,
  body,
  params,
  onChange,
  variableNames,
  warnings = [],
  disabled,
}: {
  pathTemplate: string;
  query: KeyValuePair[];
  headers: KeyValuePair[];
  body: string;
  params: ToolParamDraft[];
  onChange: (params: ToolParamDraft[]) => void;
  variableNames: string[];
  warnings?: TemplateWarning[];
  disabled?: boolean;
}) {
  const { t } = useTranslations();

  const detected = useMemo(
    () =>
      detectPlaceholders(
        [
          pathTemplate,
          ...query.map((pair) => pair.value),
          ...headers.map((pair) => pair.value),
          body,
        ],
        variableNames,
      ),
    [pathTemplate, query, headers, body, variableNames],
  );

  useEffect(() => {
    const declared = new Set(params.map((param) => param.name));
    const missing = detected.filter((name) => !declared.has(name));
    if (missing.length > 0) {
      onChange([
        ...params,
        ...missing.map((name) => ({
          name,
          required: true,
          type: "string" as const,
        })),
      ]);
    }
  }, [detected, params, onChange]);

  const update = (name: string, patch: Partial<ToolParamDraft>) =>
    onChange(
      params.map((param) =>
        param.name === name ? { ...param, ...patch } : param,
      ),
    );

  const warningFor = (name: string) =>
    warnings.find((warning) => warning.name === name);

  if (params.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{t.servers.paramsEmpty}</p>
    );
  }

  return (
    <div className="space-y-3">
      {params.map((param) => {
        const warning = warningFor(param.name);
        const orphaned = !detected.includes(param.name);
        return (
          <div
            key={param.name}
            className="space-y-2 rounded-md border border-border p-3"
          >
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {`{{${param.name}}}`}
              </code>
              <Select
                value={param.type}
                disabled={disabled}
                onValueChange={(type) =>
                  update(param.name, {
                    type: type as ToolParamDraft["type"],
                  })
                }
              >
                <SelectTrigger
                  className="w-28"
                  aria-label={t.servers.paramType}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARAM_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t.servers.paramTypes[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={param.required}
                  disabled={disabled}
                  onCheckedChange={(required) =>
                    update(param.name, { required })
                  }
                />
                {t.servers.paramRequired}
              </label>
              {orphaned ? (
                <button
                  type="button"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  aria-label={t.servers.paramRemove}
                  disabled={disabled}
                  onClick={() =>
                    onChange(params.filter((p) => p.name !== param.name))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <Input
              value={param.description ?? ""}
              disabled={disabled}
              placeholder={t.servers.paramDescriptionPlaceholder}
              aria-label={`${t.servers.paramDescription} (${param.name})`}
              onChange={(event) =>
                update(param.name, { description: event.target.value })
              }
            />
            {warning || orphaned ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {orphaned
                    ? t.servers.warningParamWithoutPlaceholder.replace(
                        "{name}",
                        param.name,
                      )
                    : t.servers.warningPlaceholderWithoutParam.replace(
                        "{name}",
                        warning?.name ?? param.name,
                      )}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
