import { ServerAuthFields } from "@/components/servers/server-auth-fields";
import { useSetMcpServerAuth, useTestMcpConnection } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
  authFormFromInferred,
  buildAuthRecipe,
  type AuthFormState,
  type InferredAuth,
} from "@/lib/server-auth";
import { isAppErrorCode } from "@repo/core";
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
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function authResetKey(auth: InferredAuth): string {
  return [
    auth.type,
    auth.variableName ?? "",
    auth.headerName ?? "",
    auth.paramName ?? "",
  ].join(":");
}

export function ServerAuthCard({
  serverId,
  auth,
}: {
  serverId: string;
  auth: InferredAuth;
}) {
  const { t } = useTranslations();
  const setServerAuth = useSetMcpServerAuth();
  const testConnection = useTestMcpConnection();
  const [authForm, setAuthForm] = useState<AuthFormState>(() =>
    authFormFromInferred(auth),
  );

  const protectedKeys = [
    ...(auth.protectedKeys?.headers ?? []),
    ...(auth.protectedKeys?.query ?? []),
  ];

  const testResult = testConnection.data;
  const testPhrasing = (() => {
    if (!testResult) return null;
    if (testResult.ok && testResult.httpStatus !== null) {
      const status = String(testResult.httpStatus);
      if (testResult.httpStatus === 401 || testResult.httpStatus === 403) {
        return {
          tone: "warning" as const,
          text: t.servers.connectionAuthFailing.replace("{status}", status),
        };
      }
      return {
        tone: "success" as const,
        text: t.servers.connectionReachable.replace("{status}", status),
      };
    }
    const detail =
      testResult.appCode && isAppErrorCode(testResult.appCode)
        ? t.errors.codes[testResult.appCode]
        : t.errors.unexpected;
    return {
      tone: "destructive" as const,
      text: t.servers.connectionUnreachable.replace("{detail}", detail),
    };
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.servers.authTitle}</CardTitle>
        <CardDescription>{t.servers.authDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {protectedKeys.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {t.servers.authProtectedKeysLabel}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {protectedKeys.map((key) => (
                <Badge
                  key={key}
                  variant="outline"
                  className="font-mono text-xs"
                >
                  {key}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        <ServerAuthFields
          value={authForm}
          onChange={setAuthForm}
          includeCustom
          idPrefix="settings-auth"
        />
        {testConnection.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t.servers.testingConnection}
          </p>
        ) : testPhrasing ? (
          <Alert
            variant={
              testPhrasing.tone === "destructive" ? "destructive" : "default"
            }
          >
            <AlertDescription>{testPhrasing.text}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={
              authForm.type === "custom" ||
              setServerAuth.isPending ||
              (authForm.type !== "none" && !buildAuthRecipe(authForm))
            }
            onClick={() => {
              const recipe = buildAuthRecipe(authForm);
              if (!recipe) {
                toast.error(t.servers.authRequiredFields);
                return;
              }
              setServerAuth.mutate({
                serverId,
                auth: recipe,
              });
            }}
          >
            {setServerAuth.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {setServerAuth.isPending
              ? t.servers.authSaving
              : t.servers.authSave}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={testConnection.isPending}
            onClick={() => testConnection.mutate({ serverId })}
          >
            {testConnection.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {t.servers.testConnection}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
