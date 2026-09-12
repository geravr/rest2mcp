import { SettingsFormSkeleton } from "@/components/loading";
import { CopyButton } from "@/components/servers/copy-button";
import {
  useCreateMcpToken,
  useCreateMcpVariable,
  useDeleteMcpVariable,
  useMcpSnippet,
  useMcpTokens,
  useMcpVariables,
  useRevokeMcpToken,
  useUpdateMcpServer,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  Label,
  Switch,
  Textarea,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function formatDefaults(value: Record<string, string> | null): string {
  return value ? JSON.stringify(value, null, 2) : "";
}

function parseDefaults(raw: string): Record<string, string> | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.values(parsed).some((value) => typeof value !== "string")
    ) {
      return undefined;
    }
    return parsed as Record<string, string>;
  } catch {
    return undefined;
  }
}

export function ServerConnectionTab({
  serverId,
  defaultHeaders,
  defaultQuery,
}: {
  serverId: string;
  defaultHeaders: Record<string, string> | null;
  defaultQuery: Record<string, string> | null;
}) {
  const { t } = useTranslations();
  const snippet = useMcpSnippet(serverId);
  const tokens = useMcpTokens(serverId);
  const variables = useMcpVariables(serverId);
  const createVariable = useCreateMcpVariable();
  const deleteVariable = useDeleteMcpVariable();
  const updateServer = useUpdateMcpServer();
  const createToken = useCreateMcpToken();
  const revokeToken = useRevokeMcpToken();
  const [variableName, setVariableName] = useState("");
  const [variableValue, setVariableValue] = useState("");
  const [variableSecret, setVariableSecret] = useState(true);
  const [headersDraft, setHeadersDraft] = useState(() =>
    formatDefaults(defaultHeaders),
  );
  const [queryDraft, setQueryDraft] = useState(() =>
    formatDefaults(defaultQuery),
  );
  const [rawToken, setRawToken] = useState<string | null>(null);

  if (
    (snippet.isLoading && snippet.data === undefined) ||
    (tokens.isLoading && tokens.data === undefined) ||
    (variables.isLoading && variables.data === undefined)
  ) {
    return <SettingsFormSkeleton cards={2} fields={3} />;
  }

  if (snippet.isError || tokens.isError || variables.isError) {
    return (
      <p className="text-sm text-destructive">
        {resolveErrorMessage(
          snippet.error ?? tokens.error ?? variables.error,
          t,
        )}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t.servers.variables}</h3>
        <p className="text-sm text-muted-foreground">
          {t.servers.variablesDescription}
        </p>
        {!variables.data || variables.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t.servers.noVariables}
          </p>
        ) : (
          <ul className="space-y-2">
            {variables.data.map((variable) => (
              <li
                key={variable.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="flex items-center gap-2 text-sm">
                  <code className="font-mono text-xs">{variable.name}</code>
                  {variable.isSecret ? (
                    <Badge variant="secondary">
                      {t.servers.variableSecretBadge}
                    </Badge>
                  ) : null}
                  <span className="text-muted-foreground">
                    {variable.isSecret
                      ? variable.hasValue
                        ? t.servers.variableHasValue
                        : t.servers.variableNoValue
                      : variable.value}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deleteVariable.isPending}
                  onClick={() =>
                    deleteVariable.mutate({ serverId, name: variable.name })
                  }
                >
                  {t.servers.deleteVariable}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = variableName.trim();
            if (!name || !variableValue) return;
            createVariable.mutate(
              {
                serverId,
                name,
                isSecret: variableSecret,
                value: variableValue,
              },
              {
                onSuccess: () => {
                  setVariableName("");
                  setVariableValue("");
                },
              },
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="var-name">{t.servers.variableName}</Label>
            <Input
              id="var-name"
              value={variableName}
              onChange={(event) => setVariableName(event.target.value)}
              placeholder={t.servers.variableNamePlaceholder}
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="var-value">{t.servers.variableValue}</Label>
            <Input
              id="var-value"
              type={variableSecret ? "password" : "text"}
              value={variableValue}
              onChange={(event) => setVariableValue(event.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="var-secret"
              checked={variableSecret}
              onCheckedChange={setVariableSecret}
            />
            <Label htmlFor="var-secret">{t.servers.variableSecret}</Label>
          </div>
          <Button type="submit" disabled={createVariable.isPending}>
            {createVariable.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {createVariable.isPending
              ? t.servers.addingVariable
              : t.servers.addVariable}
          </Button>
        </form>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t.servers.defaultsTitle}</h3>
        <p className="text-sm text-muted-foreground">
          {t.servers.defaultsDescription}
        </p>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const parsedHeaders = parseDefaults(headersDraft);
            const parsedQuery = parseDefaults(queryDraft);
            if (parsedHeaders === undefined || parsedQuery === undefined) {
              toast.error(t.servers.invalidDefaultsJson);
              return;
            }
            updateServer.mutate({
              serverId,
              defaultHeaders: parsedHeaders,
              defaultQuery: parsedQuery,
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="default-headers">{t.servers.defaultHeaders}</Label>
            <Textarea
              id="default-headers"
              className="font-mono text-xs"
              rows={3}
              value={headersDraft}
              onChange={(event) => setHeadersDraft(event.target.value)}
              placeholder='{ "Authorization": "Bearer {{api_token}}" }'
              spellCheck={false}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default-query">{t.servers.defaultQuery}</Label>
            <Textarea
              id="default-query"
              className="font-mono text-xs"
              rows={3}
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder='{ "region": "{{region}}" }'
              spellCheck={false}
            />
          </div>
          <div>
            <Button type="submit" disabled={updateServer.isPending}>
              {updateServer.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {updateServer.isPending
                ? t.servers.savingDefaults
                : t.servers.saveDefaults}
            </Button>
          </div>
        </form>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t.servers.snippetTitle}</h3>
        <p className="text-sm text-muted-foreground">
          {t.servers.snippetDescription}
        </p>
        {snippet.data ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
              {snippet.data.url}
            </code>
            <CopyButton value={snippet.data.url} />
          </div>
        ) : null}
        <Button
          type="button"
          onClick={() =>
            createToken.mutate(
              { serverId },
              { onSuccess: (created) => setRawToken(created.token) },
            )
          }
          disabled={createToken.isPending}
        >
          {createToken.isPending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : null}
          {createToken.isPending
            ? t.servers.creatingToken
            : t.servers.createToken}
        </Button>
        {rawToken ? (
          <Alert>
            <AlertDescription className="space-y-2">
              <p>{t.servers.tokenShownOnce}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all font-mono text-xs">{rawToken}</code>
                <CopyButton value={rawToken} />
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
        {!tokens.data || tokens.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.servers.noTokens}</p>
        ) : (
          <ul className="space-y-2">
            {tokens.data.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm">
                  {token.name} · {t.servers.prefix} {token.prefix}
                </span>
                {token.revokedAt ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={revokeToken.isPending}
                    onClick={() =>
                      revokeToken.mutate({ serverId, tokenId: token.id })
                    }
                  >
                    {revokeToken.isPending
                      ? t.servers.revoking
                      : t.servers.revoke}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
