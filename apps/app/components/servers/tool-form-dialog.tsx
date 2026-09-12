import {
  KeyValueEditor,
  pairsToRecord,
  recordToPairs,
  type KeyValuePair,
} from "@/components/servers/key-value-editor";
import {
  detectPlaceholders,
  ParamsEditor,
  type TemplateWarning,
  type ToolParamDraft,
} from "@/components/servers/params-editor";
import { useCreateMcpTool, useUpdateMcpTool } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

type BodyType = "none" | "json" | "form" | "raw";

export type ToolFormTool = {
  id: string;
  name: string;
  description: string | null;
  method: string;
  pathTemplate: string;
  requestTemplate: {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string | null;
    bodyType?: "json" | "form" | "raw";
  } | null;
  params: ToolParamDraft[] | null;
  allowMutation: boolean;
  enabled: boolean;
};

/**
 * Shared create/edit/duplicate tool form. Mount conditionally so state
 * initializes from `tool`. When a save returns template warnings the dialog
 * stays open and switches to editing the just-saved tool, so a second submit
 * updates instead of duplicating.
 */
export function ToolFormDialog({
  serverId,
  variableNames,
  tool,
  duplicate = false,
  onClose,
}: {
  serverId: string;
  variableNames: string[];
  tool?: ToolFormTool;
  duplicate?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const createTool = useCreateMcpTool();
  const updateTool = useUpdateMcpTool();
  const isEdit = Boolean(tool) && !duplicate;

  const [name, setName] = useState(
    tool ? (duplicate ? `${tool.name}_copy` : tool.name) : "",
  );
  const [method, setMethod] = useState<(typeof METHODS)[number]>(
    (METHODS as readonly string[]).includes(tool?.method ?? "")
      ? (tool?.method as (typeof METHODS)[number])
      : "GET",
  );
  const [pathTemplate, setPathTemplate] = useState(tool?.pathTemplate ?? "");
  const [description, setDescription] = useState(tool?.description ?? "");
  const [query, setQuery] = useState<KeyValuePair[]>(() =>
    recordToPairs(tool?.requestTemplate?.query),
  );
  const [headers, setHeaders] = useState<KeyValuePair[]>(() =>
    recordToPairs(tool?.requestTemplate?.headers),
  );
  const [bodyType, setBodyType] = useState<BodyType>(
    tool?.requestTemplate?.bodyType ??
      (tool?.requestTemplate?.body ? "raw" : "none"),
  );
  const [body, setBody] = useState(tool?.requestTemplate?.body ?? "");
  const [params, setParams] = useState<ToolParamDraft[]>(tool?.params ?? []);
  const [allowMutation, setAllowMutation] = useState(
    tool?.allowMutation ?? false,
  );
  const [enabled, setEnabled] = useState(tool?.enabled ?? true);
  const [warnings, setWarnings] = useState<TemplateWarning[]>([]);
  const [savedToolId, setSavedToolId] = useState<string | null>(
    isEdit && tool ? tool.id : null,
  );

  const isPending = createTool.isPending || updateTool.isPending;
  const pathPlaceholders = detectPlaceholders([pathTemplate], variableNames);
  // After a create-with-warnings the dialog edits the just-saved tool.
  const effectiveEdit = isEdit || savedToolId !== null;

  const submit = () => {
    const requestTemplate = {
      query: pairsToRecord(query),
      headers: pairsToRecord(headers),
      body: bodyType === "none" ? null : body,
      ...(bodyType === "none" ? {} : { bodyType }),
    };
    const payload = {
      serverId,
      name,
      description: description.trim() ? description.trim() : null,
      method,
      pathTemplate,
      requestTemplate,
      params,
      allowMutation,
      enabled,
    };
    const onSuccess = (result: {
      id: string;
      warnings?: TemplateWarning[];
    }) => {
      if (result.warnings && result.warnings.length > 0) {
        setWarnings(result.warnings);
        setSavedToolId(result.id);
        return;
      }
      onClose();
    };
    if (savedToolId) {
      updateTool.mutate({ ...payload, toolId: savedToolId }, { onSuccess });
    } else {
      createTool.mutate(payload, { onSuccess });
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          // Radix listens for Escape at the document capture phase, before
          // the input handler that closes an open variable listbox. Keep the
          // key local so it cannot dismiss the dialog and lose the draft.
          if (document.querySelector('[role="listbox"]')) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {effectiveEdit ? t.servers.editToolTitle : t.servers.addTool}
          </DialogTitle>
          <DialogDescription>{t.servers.paramsDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tool-form-name">{t.servers.toolName}</Label>
              <Input
                id="tool-form-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t.servers.toolNamePlaceholder}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t.servers.method}</Label>
              <Select
                value={method}
                onValueChange={(value) =>
                  setMethod(value as (typeof METHODS)[number])
                }
              >
                <SelectTrigger aria-label={t.servers.method}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tool-form-path">{t.servers.pathTemplate}</Label>
            <Input
              id="tool-form-path"
              value={pathTemplate}
              onChange={(event) => setPathTemplate(event.target.value)}
              placeholder={t.servers.pathPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
              required
            />
            {pathPlaceholders.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {pathPlaceholders.map((placeholder) => (
                  <Badge
                    key={placeholder}
                    variant="secondary"
                    className="font-mono text-xs"
                  >
                    {`{{${placeholder}}}`}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tool-form-description">
              {t.servers.toolDescription}
            </Label>
            <Input
              id="tool-form-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t.servers.toolDescriptionPlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label>{t.servers.queryParams}</Label>
            <KeyValueEditor
              pairs={query}
              onChange={setQuery}
              variableNames={variableNames}
            />
          </div>

          <div className="space-y-2">
            <Label>{t.servers.headers}</Label>
            <KeyValueEditor
              pairs={headers}
              onChange={setHeaders}
              variableNames={variableNames}
            />
          </div>

          <div className="space-y-2">
            <Label>{t.servers.bodyType}</Label>
            <Select
              value={bodyType}
              onValueChange={(value) => setBodyType(value as BodyType)}
            >
              <SelectTrigger className="w-40" aria-label={t.servers.bodyType}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["none", "json", "form", "raw"] as const).map((type) => (
                  <SelectItem key={type} value={type}>
                    {t.servers.bodyTypes[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bodyType !== "none" ? (
              <Textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={
                  bodyType === "json"
                    ? t.servers.bodyJsonPlaceholder
                    : t.servers.bodyRawPlaceholder
                }
                rows={4}
                spellCheck={false}
                className="font-mono text-xs"
              />
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>{t.servers.paramsTitle}</Label>
            <ParamsEditor
              pathTemplate={pathTemplate}
              query={query}
              headers={headers}
              body={bodyType === "none" ? "" : body}
              params={params}
              onChange={setParams}
              variableNames={variableNames}
              warnings={warnings}
            />
          </div>

          <div className="space-y-3 rounded-md border border-border p-3">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">{t.servers.allowMutation}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t.servers.allowMutationHelp}
                </span>
              </span>
              <Switch
                checked={allowMutation}
                onCheckedChange={setAllowMutation}
              />
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">{t.servers.enabled}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t.servers.enabledHelp}
                </span>
              </span>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.servers.cancel}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {isPending ? t.servers.savingTool : t.servers.saveTool}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
