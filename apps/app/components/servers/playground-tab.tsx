import { SettingsFormSkeleton } from "@/components/loading";
import { useInvokeMcpTool, useMcpTools } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { Button, Label, Textarea } from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function ServerPlaygroundTab({ serverId }: { serverId: string }) {
  const { t } = useTranslations();
  const tools = useMcpTools(serverId, { page: 1, pageSize: 50 });
  const invoke = useInvokeMcpTool();
  const [toolId, setToolId] = useState("");
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState<string | null>(null);

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
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(args) as Record<string, unknown>;
        } catch {
          toast.error(t.servers.invalidJson);
          return;
        }
        invoke.mutate(
          { serverId, toolId, args: parsed },
          {
            onSuccess: (payload) => {
              setResult(payload.body);
            },
          },
        );
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="play-tool">{t.servers.selectTool}</Label>
        <select
          id="play-tool"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={toolId}
          onChange={(event) => setToolId(event.target.value)}
          required
        >
          <option value="">{t.servers.selectTool}</option>
          {tools.data?.items.map((tool) => (
            <option key={tool.id} value={tool.id}>
              {tool.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="play-args">{t.servers.argsLabel}</Label>
        <Textarea
          id="play-args"
          value={args}
          onChange={(event) => setArgs(event.target.value)}
          placeholder={t.servers.argsPlaceholder}
          rows={6}
        />
      </div>
      <Button type="submit" disabled={invoke.isPending || !toolId}>
        {invoke.isPending ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : null}
        {invoke.isPending ? t.servers.invoking : t.servers.invoke}
      </Button>
      {result ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t.servers.result}</h3>
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
            {result}
          </pre>
        </div>
      ) : null}
    </form>
  );
}
