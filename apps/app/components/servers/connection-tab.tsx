import { SettingsFormSkeleton } from "@/components/loading";
import { CopyButton } from "@/components/servers/copy-button";
import {
  useCreateMcpToken,
  useMcpSnippet,
  useMcpTokens,
  useRevokeMcpToken,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

/** Client connection: gateway URL and agent tokens. */
export function ServerConnectionTab({ serverId }: { serverId: string }) {
  const { t } = useTranslations();
  const snippet = useMcpSnippet(serverId);
  const tokens = useMcpTokens(serverId);
  const createToken = useCreateMcpToken();
  const revokeToken = useRevokeMcpToken();
  const [rawToken, setRawToken] = useState<string | null>(null);

  if (
    (snippet.isLoading && snippet.data === undefined) ||
    (tokens.isLoading && tokens.data === undefined)
  ) {
    return <SettingsFormSkeleton cards={1} fields={3} />;
  }

  if (snippet.isError || tokens.isError) {
    return (
      <p className="text-sm text-destructive">
        {resolveErrorMessage(snippet.error ?? tokens.error, t)}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.servers.snippetTitle}</CardTitle>
        <CardDescription>{t.servers.snippetDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
          <ul className="divide-y divide-border rounded-md border border-border">
            {tokens.data.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
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
      </CardContent>
    </Card>
  );
}
