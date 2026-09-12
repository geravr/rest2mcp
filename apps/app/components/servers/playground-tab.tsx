import { SettingsFormSkeleton } from "@/components/loading";
import { useInvokeMcpTool, useMcpTools } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { cn } from "@repo/ui";
import {
  Button,
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

export function ServerPlaygroundTab({ serverId }: { serverId: string }) {
  const { t } = useTranslations();
  const tools = useMcpTools(serverId, { page: 1, pageSize: 50 });
  const invoke = useInvokeMcpTool();
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
    callLogId: string | null;
  } | null>(null);

  const tool = tools.data?.items.find((item) => item.id === toolId) ?? null;
  const params = tool?.params ?? [];

  const setValue = (name: string, value: ParamValue) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const missingRequired = params.filter(
    (param) =>
      param.required &&
      (values[param.name] === undefined || values[param.name] === ""),
  );

  const submit = () => {
    setAttempted(true);
    if (!tool || missingRequired.length > 0) return;

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
      { serverId, toolId: tool.id, args },
      {
        onSuccess: (payload) => {
          setResult({ body: payload.body, callLogId: payload.callLogId });
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
      <div className="space-y-2">
        <Label>{t.servers.selectTool}</Label>
        <Select
          value={toolId}
          onValueChange={(next) => {
            setToolId(next);
            // Booleans start as explicit false so required ones can be
            // submitted without an on→off round-trip.
            const nextTool = tools.data?.items.find((item) => item.id === next);
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
          <SelectTrigger>
            <SelectValue placeholder={t.servers.selectTool} />
          </SelectTrigger>
          <SelectContent>
            {tools.data.items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {params.map((param) => {
        const raw = values[param.name];
        const showMissing =
          attempted && param.required && (raw === undefined || raw === "");
        const showInvalidJson = invalidJsonParams.has(param.name);
        const showInvalidNumber = invalidNumberParams.has(param.name);
        return (
          <div key={param.name} className="space-y-2">
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
                type={param.type === "number" ? "number" : "text"}
                value={typeof raw === "string" ? raw : ""}
                onChange={(event) => setValue(param.name, event.target.value)}
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
          </div>
        );
      })}

      <Button type="submit" disabled={invoke.isPending || !tool}>
        {invoke.isPending ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : null}
        {invoke.isPending ? t.servers.invoking : t.servers.invoke}
      </Button>

      {result ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t.servers.result}</h3>
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
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
            {result.body}
          </pre>
        </div>
      ) : null}
    </form>
  );
}
