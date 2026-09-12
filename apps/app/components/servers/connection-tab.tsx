import { SettingsFormSkeleton } from "@/components/loading";
import { CopyButton } from "@/components/servers/copy-button";
import {
  useCreateMcpToken,
  useMcpSnippet,
  useMcpTokens,
  useRevokeMcpToken,
  useSetMcpCredential,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { Alert, AlertDescription, Button, Input, Label } from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

type CredentialScheme = "bearer" | "api_key" | "header";
type CredentialLocation = "header" | "query";

function isCredentialScheme(
  value: string | null | undefined,
): value is CredentialScheme {
  return value === "bearer" || value === "api_key" || value === "header";
}

function isCredentialLocation(
  value: string | null | undefined,
): value is CredentialLocation {
  return value === "header" || value === "query";
}

function defaultHeaderName(
  scheme: CredentialScheme,
  headerName?: string | null,
): string {
  if (headerName) return headerName;
  return scheme === "bearer" ? "Authorization" : "X-API-Key";
}

export function ServerConnectionTab({
  serverId,
  hasSecret,
  scheme: storedScheme,
  headerName: storedHeaderName,
  valueLocation: storedValueLocation,
}: {
  serverId: string;
  hasSecret: boolean;
  scheme?: string | null;
  headerName?: string | null;
  valueLocation?: string | null;
}) {
  const { t } = useTranslations();
  const snippet = useMcpSnippet(serverId);
  const tokens = useMcpTokens(serverId);
  const setCredential = useSetMcpCredential();
  const createToken = useCreateMcpToken();
  const revokeToken = useRevokeMcpToken();
  const [secret, setSecret] = useState("");
  const [scheme, setScheme] = useState<CredentialScheme>(() =>
    isCredentialScheme(storedScheme) ? storedScheme : "bearer",
  );
  const [headerName, setHeaderName] = useState(() =>
    defaultHeaderName(
      isCredentialScheme(storedScheme) ? storedScheme : "bearer",
      storedHeaderName,
    ),
  );
  const [valueLocation, setValueLocation] = useState<CredentialLocation>(() =>
    isCredentialLocation(storedValueLocation) ? storedValueLocation : "header",
  );
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [savedLocally, setSavedLocally] = useState(false);
  const stored = hasSecret || savedLocally;

  if (
    (snippet.isLoading && snippet.data === undefined) ||
    (tokens.isLoading && tokens.data === undefined)
  ) {
    return <SettingsFormSkeleton cards={2} fields={3} />;
  }

  if (snippet.isError || tokens.isError) {
    return (
      <p className="text-sm text-destructive">
        {resolveErrorMessage(snippet.error ?? tokens.error, t)}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t.servers.credential}</h3>
        <p className="text-sm text-muted-foreground">
          {stored ? t.servers.credentialHasSecret : t.servers.credentialMissing}
        </p>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const nextSecret = secret.trim();
            if (!nextSecret && !stored) return;
            setCredential.mutate(
              {
                serverId,
                scheme,
                headerName,
                valueLocation,
                ...(nextSecret ? { secret: nextSecret } : {}),
              },
              {
                onSuccess: () => {
                  setSecret("");
                  setSavedLocally(true);
                },
              },
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="cred-scheme">{t.servers.credentialScheme}</Label>
            <select
              id="cred-scheme"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={scheme}
              onChange={(event) =>
                setScheme(event.target.value as CredentialScheme)
              }
            >
              <option value="bearer">{t.servers.schemeBearer}</option>
              <option value="api_key">{t.servers.schemeApiKey}</option>
              <option value="header">{t.servers.schemeHeader}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-location">
              {t.servers.credentialLocation}
            </Label>
            <select
              id="cred-location"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={valueLocation}
              onChange={(event) =>
                setValueLocation(event.target.value as CredentialLocation)
              }
            >
              <option value="header">{t.servers.locationHeader}</option>
              <option value="query">{t.servers.locationQuery}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-header">{t.servers.credentialHeader}</Label>
            <Input
              id="cred-header"
              value={headerName}
              onChange={(event) => setHeaderName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cred-secret">{t.servers.credentialSecret}</Label>
            <Input
              id="cred-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={stored ? t.servers.credentialKeepStored : undefined}
              autoComplete="off"
              required={!stored}
            />
          </div>
          <Button type="submit" disabled={setCredential.isPending}>
            {setCredential.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {setCredential.isPending
              ? t.servers.savingCredential
              : t.servers.saveCredential}
          </Button>
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
