import { SettingsFormSkeleton } from "@/components/loading";
import { CopyButton } from "@/components/servers/copy-button";
import {
  useCreatePlatformToken,
  usePlatformSnippet,
  usePlatformToken,
  useRevokePlatformToken,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import {
  MCP_DEFAULT_PLATFORM_SCOPES,
  MCP_PLATFORM_SCOPES,
  type McpPlatformScope,
} from "@/lib/mcp-limits";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

const EXPIRY_OPTIONS = [7, 30, 90, 365] as const;

export function PlatformTokenTab() {
  const { t } = useTranslations();
  const token = usePlatformToken();
  const snippet = usePlatformSnippet();
  const createToken = useCreatePlatformToken();
  const revokeToken = useRevokePlatformToken();
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [scopes, setScopes] = useState<McpPlatformScope[]>([
    ...MCP_DEFAULT_PLATFORM_SCOPES,
  ]);
  const [expiresInDays, setExpiresInDays] = useState<number>(90);

  const scopeLabel = (scope: McpPlatformScope) =>
    t.settings.platform.scopes[scope];

  const toggleScope = (scope: McpPlatformScope, checked: boolean) =>
    setScopes((current) =>
      checked ? [...current, scope] : current.filter((item) => item !== scope),
    );

  if (
    (token.isLoading && token.data === undefined) ||
    (snippet.isLoading && snippet.data === undefined)
  ) {
    return <SettingsFormSkeleton cards={1} fields={2} />;
  }

  if (token.isError) {
    return (
      <p className="text-sm text-destructive">
        {resolveErrorMessage(token.error, t)}
      </p>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.platform.title}</CardTitle>
        <CardDescription>{t.settings.platform.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {snippet.data ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t.settings.platform.urlLabel}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                {snippet.data.url}
              </code>
              <CopyButton value={snippet.data.url} />
            </div>
          </div>
        ) : null}

        <p className="text-sm text-muted-foreground">
          {token.data
            ? t.settings.platform.hasToken.replace(
                "{prefix}",
                token.data.prefix,
              )
            : t.settings.platform.noToken}
        </p>

        {token.data ? (
          <div className="space-y-2 text-sm">
            {token.data.scopes && token.data.scopes.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">
                  {t.settings.platform.activeScopesLabel}
                </span>
                {token.data.scopes.map((scope) => (
                  <Badge key={scope} variant="outline">
                    {scopeLabel(scope as McpPlatformScope)}
                  </Badge>
                ))}
              </div>
            ) : null}
            {token.data.expiresAt ? (
              <p className="text-muted-foreground">
                {t.settings.platform.expiresAtLabel.replace(
                  "{date}",
                  new Date(token.data.expiresAt).toLocaleDateString(),
                )}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm font-medium">
            {t.settings.platform.scopesLabel}
          </p>
          <div className="space-y-2">
            {MCP_PLATFORM_SCOPES.map((scope) => (
              <label
                key={scope}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>
                  <span className="font-medium">{scopeLabel(scope)}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t.settings.platform.scopeDescriptions[scope]}
                  </span>
                </span>
                <Switch
                  checked={scopes.includes(scope)}
                  onCheckedChange={(checked) => toggleScope(scope, checked)}
                />
              </label>
            ))}
          </div>
          <Field>
            <Label htmlFor="platform-token-expiry">
              {t.settings.platform.expiryLabel}
            </Label>
            <Select
              value={String(expiresInDays)}
              onValueChange={(value) => setExpiresInDays(Number(value))}
            >
              <SelectTrigger id="platform-token-expiry" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {t.settings.platform.expiryDays.replace(
                      "{days}",
                      String(days),
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={createToken.isPending || scopes.length === 0}
            onClick={() =>
              createToken.mutate(
                { scopes, expiresInDays },
                { onSuccess: (created) => setRawToken(created.token) },
              )
            }
          >
            {createToken.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {createToken.isPending
              ? t.settings.platform.creatingToken
              : t.settings.platform.createToken}
          </Button>
          {token.data ? (
            <Button
              type="button"
              variant="outline"
              disabled={revokeToken.isPending}
              onClick={() =>
                revokeToken.mutate(undefined, {
                  onSuccess: () => setRawToken(null),
                })
              }
            >
              {revokeToken.isPending
                ? t.settings.platform.revokingToken
                : t.settings.platform.revokeToken}
            </Button>
          ) : null}
        </div>

        {rawToken ? (
          <Alert>
            <AlertDescription className="space-y-2">
              <p>{t.settings.platform.tokenShownOnce}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all font-mono text-xs">{rawToken}</code>
                <CopyButton value={rawToken} />
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
