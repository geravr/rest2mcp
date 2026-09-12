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

export function PlatformTokenTab() {
  const { t } = useTranslations();
  const token = usePlatformToken();
  const snippet = usePlatformSnippet();
  const createToken = useCreatePlatformToken();
  const revokeToken = useRevokePlatformToken();
  const [rawToken, setRawToken] = useState<string | null>(null);

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

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={createToken.isPending}
            onClick={() =>
              createToken.mutate(
                {},
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
