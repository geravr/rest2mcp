import { SettingsFormSkeleton } from "@/components/loading";
import { useInvokeMcpTool, useMcpTools } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { cn } from "@repo/ui";
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
  Textarea,
} from "@repo/ui";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

type ParamValue = string | boolean;

type PlaygroundMode = "published" | "draft";

export function ServerPlaygroundTab({
  serverId,
  serverStatus,
  draftRevision,
  publishedRevisionNumber,
  publishedTools = [],
}: {
  serverId: string;
  serverStatus: "draft" | "live" | "paused";
  draftRevision: number;
  publishedRevisionNumber: number | null;
  publishedTools?: Array<{
    id: string;
    name: string;
    method: string;
    allowMutation: boolean;
    params: Array<{
      name: string;
      type: string;
      required: boolean;
      sensitive: boolean;
      description?: string;
      minimum?: number;
      maximum?: number;
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    }>;
  }>;
}) {
  const { t } = useTranslations();
  const tools = useMcpTools(serverId, { page: 1, pageSize: 50 });
  const invoke = useInvokeMcpTool();
  const [mode, setMode] = useState<PlaygroundMode>(
    publishedRevisionNumber !== null ? "published" : "draft",
  );
  const [toolId, setToolId] = useState("");
  const [values, setValues] = useState<Record<string, ParamValue>>({});
  const [attempted, setAttempted] = useState(false);
  const [invalidJsonParams, setInvalidJsonParams] = useState<Set<string>>(
    () => new Set(),
  );
  const [invalidNumberParams, setInvalidNumberParams] = useState<Set<string>>(
    () => new Set(),
  );
  const [result, setResult] = useState<{
    body: string;
    httpStatus: number | null;
    callLogId: string | null;
    ok: boolean;
  } | null>(null);

  const publishedById = new Map(publishedTools.map((item) => [item.id, item]));
  const visibleTools =
    mode === "published"
      ? (tools.data?.items ?? []).flatMap((item) => {
          const published = publishedById.get(item.id);
          if (!published) return [];
          // Published mode mirrors the active revision, not the mutable draft:
          // a draft disable/edit must not change the executable contract.
          return [
            {
              ...item,
              name: published.name,
              method: published.method,
              allowMutation: published.allowMutation,
              enabled: true,
              // Published mode advertises the active revision's input schema.
              params: published.params,
            },
          ];
        })
      : (tools.data?.items ?? []);
  const tool = visibleTools.find((item) => item.id === toolId) ?? null;
  const params = tool?.params ?? [];

  const invokeBlockedReason = (() => {
    if (mode === "published" && publishedRevisionNumber === null) {
      return t.servers.invokeNoPublishedRevision;
    }
    if (mode === "published" && serverStatus === "paused") {
      return t.servers.invokeServerPaused;
    }
    if (!tool) return null;
    if (!tool.enabled) return t.servers.invokeDisabledTool;
    const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(tool.method);
    if (mutating && !tool.allowMutation) return t.servers.invokeMutationBlocked;
    return null;
  })();

  const setValue = (name: string, value: ParamValue) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const missingRequired = params.filter(
    (param) =>
      param.required &&
      (values[param.name] === undefined || values[param.name] === ""),
  );

  const submit = () => {
    setAttempted(true);
    setResult(null);
    if (!tool || missingRequired.length > 0 || invokeBlockedReason) return;

    const args: Record<string, unknown> = {};
    const invalidJson = new Set<string>();
    const invalidNumber = new Set<string>();
    for (const param of params) {
      const raw = values[param.name];
      if (raw === undefined || raw === "") continue;
      if (param.type === "boolean") {
        args[param.name] = raw === true;
      } else if (param.type === "number") {
        const parsed = Number(raw);
        if (Number.isNaN(parsed)) {
          invalidNumber.add(param.name);
        } else {
          args[param.name] = parsed;
        }
      } else if (param.type === "json") {
        try {
          args[param.name] = JSON.parse(String(raw));
        } catch {
          invalidJson.add(param.name);
        }
      } else {
        args[param.name] = raw;
      }
    }
    setInvalidJsonParams(invalidJson);
    setInvalidNumberParams(invalidNumber);
    if (invalidJson.size > 0 || invalidNumber.size > 0) return;

    invoke.mutate(
      {
        serverId,
        toolId: tool.id,
        args,
        mode,
        expectedDraftRevision: draftRevision,
      },
      {
        onSuccess: (payload) => {
          const envelope = payload.envelope;
          const body =
            envelope.data !== undefined
              ? JSON.stringify(envelope, null, 2)
              : (envelope.body ?? JSON.stringify(envelope, null, 2));
          setResult({
            body,
            httpStatus: payload.httpStatus,
            callLogId: payload.callLogId,
            ok: payload.ok,
          });
        },
        onError: (error) => {
          setResult({
            body: JSON.stringify(
              {
                ok: false,
                appCode: null,
                message: resolveErrorMessage(error, t),
              },
              null,
              2,
            ),
            httpStatus: null,
            callLogId: null,
            ok: false,
          });
        },
      },
    );
  };

  if (tools.isLoading && !tools.data) {
    return <SettingsFormSkeleton cards={1} fields={3} />;
  }

  if (tools.isError) {
    return (
      <p className="text-sm text-destructive">
        {resolveErrorMessage(tools.error, t)}
      </p>
    );
  }

  if (mode === "published" && visibleTools.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t.servers.playgroundNoPublishedTools}
      </p>
    );
  }

  if (!tools.data || tools.data.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.servers.noTools}</p>;
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <Field>
          <Label htmlFor="playground-mode">{t.servers.playgroundMode}</Label>
          <Select
            value={mode}
            onValueChange={(next) => {
              setMode(next as PlaygroundMode);
              setResult(null);
            }}
          >
            <SelectTrigger id="playground-mode" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value="published"
                disabled={publishedRevisionNumber === null}
              >
                {t.servers.playgroundModePublished}
              </SelectItem>
              <SelectItem value="draft">
                {t.servers.playgroundModeDraft}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <p className="text-sm text-muted-foreground">
          {mode === "published"
            ? publishedRevisionNumber !== null
              ? t.servers.playgroundPublishedSource.replace(
                  "{number}",
                  String(publishedRevisionNumber),
                )
              : t.servers.invokeNoPublishedRevision
            : t.servers.playgroundDraftSource.replace(
                "{revision}",
                String(draftRevision),
              )}
        </p>
      </div>

      {mode === "draft" ? (
        <p className="text-sm text-muted-foreground">
          {t.servers.playgroundDraftNotice}
        </p>
      ) : null}

      <Field>
        <Label htmlFor="playground-tool">{t.servers.selectTool}</Label>
        <Select
          value={toolId}
          onValueChange={(next) => {
            setToolId(next);
            const nextTool = visibleTools.find((item) => item.id === next);
            const defaults: Record<string, ParamValue> = {};
            for (const param of nextTool?.params ?? []) {
              if (param.type === "boolean") defaults[param.name] = false;
            }
            setValues(defaults);
            setResult(null);
            setAttempted(false);
            setInvalidJsonParams(new Set());
            setInvalidNumberParams(new Set());
          }}
        >
          <SelectTrigger id="playground-tool">
            <SelectValue placeholder={t.servers.selectTool} />
          </SelectTrigger>
          <SelectContent>
            {visibleTools.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {params.map((param) => {
        const raw = values[param.name];
        const showMissing =
          attempted && param.required && (raw === undefined || raw === "");
        const showInvalidJson = invalidJsonParams.has(param.name);
        const showInvalidNumber = invalidNumberParams.has(param.name);
        return (
          <Field key={param.name}>
            <Label htmlFor={`play-param-${param.name}`}>
              <code className="font-mono text-xs">{param.name}</code>
              {param.required ? (
                <span className="ml-1 text-destructive">*</span>
              ) : null}
            </Label>
            {param.description ? (
              <p className="text-xs text-muted-foreground">
                {param.description}
              </p>
            ) : null}
            {param.type === "boolean" ? (
              <div>
                <Switch
                  id={`play-param-${param.name}`}
                  checked={raw === true}
                  onCheckedChange={(checked) => setValue(param.name, checked)}
                />
              </div>
            ) : param.type === "json" ? (
              <Textarea
                id={`play-param-${param.name}`}
                value={typeof raw === "string" ? raw : ""}
                onChange={(event) => setValue(param.name, event.target.value)}
                rows={4}
                spellCheck={false}
                className={cn(
                  "font-mono text-xs",
                  showInvalidJson && "border-destructive",
                )}
              />
            ) : (
              <Input
                id={`play-param-${param.name}`}
                type={
                  param.sensitive
                    ? "password"
                    : param.type === "number"
                      ? "number"
                      : "text"
                }
                value={typeof raw === "string" ? raw : ""}
                onChange={(event) => setValue(param.name, event.target.value)}
                autoComplete="off"
                minLength={param.minLength}
                maxLength={param.maxLength}
                min={param.minimum}
                max={param.maximum}
                pattern={param.pattern}
                className={cn(
                  showMissing && "border-destructive",
                  showInvalidNumber && "border-destructive",
                )}
              />
            )}
            {showInvalidJson ? (
              <p className="text-xs text-destructive">
                {t.servers.invalidJson}
              </p>
            ) : null}
            {showInvalidNumber ? (
              <p className="text-xs text-destructive">
                {t.servers.invalidNumber}
              </p>
            ) : null}
          </Field>
        );
      })}

      {invokeBlockedReason ? (
        <p className="text-sm text-muted-foreground">{invokeBlockedReason}</p>
      ) : null}

      <Button
        type="submit"
        disabled={invoke.isPending || !tool || Boolean(invokeBlockedReason)}
      >
        {invoke.isPending ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : null}
        {invoke.isPending ? t.servers.invoking : t.servers.invoke}
      </Button>

      {result ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              {result.httpStatus !== null
                ? t.servers.resultStatus.replace(
                    "{status}",
                    String(result.httpStatus),
                  )
                : t.servers.result}
            </h3>
            {result.callLogId ? (
              <Link
                to="/servers/$serverId"
                params={{ serverId }}
                search={{ tab: "logs", log: result.callLogId }}
                className="text-sm text-muted-foreground hover:underline"
              >
                {t.servers.viewCallLog}
              </Link>
            ) : null}
          </div>
          {!result.ok ? (
            <p className="text-sm text-destructive">{t.servers.resultError}</p>
          ) : null}
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
            {result.body}
          </pre>
        </div>
      ) : null}
    </form>
  );
}
