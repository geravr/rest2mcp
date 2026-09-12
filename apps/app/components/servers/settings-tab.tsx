import { SettingsFormSkeleton } from "@/components/loading";
import {
  KeyValueEditor,
  pairsToRecord,
  recordToPairs,
  type KeyValuePair,
} from "@/components/servers/key-value-editor";
import {
  useCreateMcpVariable,
  useDeleteMcpVariable,
  useMcpVariables,
  useUpdateMcpServer,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from "@repo/ui";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function recordsEqual(
  left: Record<string, string> | null,
  right: Record<string, string> | null,
): boolean {
  const a = left ?? {};
  const b = right ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

type ServerIdentity = {
  id: string;
  name: string;
  description: string | null;
  baseUrl: string;
};

/** Server-owned configuration: identity, variables, and request defaults. */
export function ServerSettingsTab({
  server,
  defaultHeaders,
  defaultQuery,
}: {
  server: ServerIdentity;
  defaultHeaders: Record<string, string> | null;
  defaultQuery: Record<string, string> | null;
}) {
  const { t } = useTranslations();
  const variables = useMcpVariables(server.id);
  const createVariable = useCreateMcpVariable();
  const deleteVariable = useDeleteMcpVariable();
  const updateServer = useUpdateMcpServer();

  const [name, setName] = useState(server.name);
  const [baseUrl, setBaseUrl] = useState(server.baseUrl);
  const [description, setDescription] = useState(server.description ?? "");

  const [variableName, setVariableName] = useState("");
  const [variableValue, setVariableValue] = useState("");
  const [variableSecret, setVariableSecret] = useState(true);

  const [headersDraft, setHeadersDraft] = useState<KeyValuePair[]>(() =>
    recordToPairs(defaultHeaders),
  );
  const [queryDraft, setQueryDraft] = useState<KeyValuePair[]>(() =>
    recordToPairs(defaultQuery),
  );

  const variableNames = (variables.data ?? []).map((variable) => variable.name);
  const identityDirty =
    name.trim() !== server.name ||
    baseUrl.trim() !== server.baseUrl ||
    (description.trim() || null) !== (server.description ?? null);
  const defaultsDirty = useMemo(
    () =>
      !recordsEqual(pairsToRecord(headersDraft), defaultHeaders) ||
      !recordsEqual(pairsToRecord(queryDraft), defaultQuery),
    [headersDraft, queryDraft, defaultHeaders, defaultQuery],
  );

  const trimmedVariableName = variableName.trim();
  const variableNameInvalid =
    trimmedVariableName.length > 0 &&
    !VARIABLE_NAME_PATTERN.test(trimmedVariableName);
  const canAddVariable =
    VARIABLE_NAME_PATTERN.test(trimmedVariableName) &&
    variableValue.length > 0 &&
    !createVariable.isPending;

  if (variables.isLoading && variables.data === undefined) {
    return <SettingsFormSkeleton cards={3} fields={3} />;
  }

  if (variables.isError) {
    return (
      <p className="text-sm text-destructive">
        {resolveErrorMessage(variables.error, t)}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.servers.identityTitle}</CardTitle>
          <CardDescription>{t.servers.identityDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!identityDirty) return;
              updateServer.mutate({
                serverId: server.id,
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                description: description.trim() ? description.trim() : null,
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="settings-server-name">{t.servers.name}</Label>
                <Input
                  id="settings-server-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t.servers.namePlaceholder}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-server-base">
                  {t.servers.baseUrl}
                </Label>
                <Input
                  id="settings-server-base"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={t.servers.baseUrlPlaceholder}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-server-description">
                {t.servers.descriptionLabel}
              </Label>
              <Input
                id="settings-server-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t.servers.optionalDescription}
              />
            </div>
            <Button
              type="submit"
              disabled={!identityDirty || updateServer.isPending}
            >
              {updateServer.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {updateServer.isPending
                ? t.servers.savingChanges
                : t.servers.saveChanges}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.servers.variables}</CardTitle>
          <CardDescription>{t.servers.variablesDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!variables.data || variables.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.servers.noVariables}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {variables.data.map((variable) => (
                <li
                  key={variable.id}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">
                    {variable.name}
                  </code>
                  {variable.isSecret ? (
                    <Badge variant="secondary">
                      {t.servers.variableSecretBadge}
                    </Badge>
                  ) : null}
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {variable.isSecret
                      ? variable.hasValue
                        ? t.servers.variableHasValue
                        : t.servers.variableNoValue
                      : variable.value}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={deleteVariable.isPending}
                    aria-label={t.servers.deleteVariable}
                    onClick={() =>
                      deleteVariable.mutate({
                        serverId: server.id,
                        name: variable.name,
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canAddVariable) return;
              createVariable.mutate(
                {
                  serverId: server.id,
                  name: trimmedVariableName,
                  isSecret: variableSecret,
                  value: variableValue,
                },
                {
                  onSuccess: () => {
                    setVariableName("");
                    setVariableValue("");
                    setVariableSecret(true);
                  },
                },
              );
            }}
          >
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]">
              <div className="space-y-2">
                <Label htmlFor="var-name">{t.servers.variableName}</Label>
                <Input
                  id="var-name"
                  value={variableName}
                  onChange={(event) => setVariableName(event.target.value)}
                  placeholder={t.servers.variableNamePlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  aria-invalid={variableNameInvalid}
                  aria-describedby="var-name-hint"
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
              <div className="flex h-9 items-center gap-2">
                <Switch
                  id="var-secret"
                  checked={variableSecret}
                  onCheckedChange={setVariableSecret}
                />
                <Label htmlFor="var-secret">{t.servers.variableSecret}</Label>
              </div>
              <Button type="submit" disabled={!canAddVariable}>
                {createVariable.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {createVariable.isPending
                  ? t.servers.addingVariable
                  : t.servers.addVariable}
              </Button>
            </div>
            <p
              id="var-name-hint"
              className={
                variableNameInvalid
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {variableNameInvalid
                ? t.servers.variableInvalidName
                : variableSecret
                  ? t.servers.variableSecretHelp
                  : t.servers.variableNameHint}
            </p>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.servers.defaultsTitle}</CardTitle>
          <CardDescription>{t.servers.defaultsDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!defaultsDirty) return;
              const parsedHeaders = pairsToRecord(headersDraft);
              const parsedQuery = pairsToRecord(queryDraft);
              updateServer.mutate({
                serverId: server.id,
                defaultHeaders:
                  Object.keys(parsedHeaders).length > 0 ? parsedHeaders : null,
                defaultQuery:
                  Object.keys(parsedQuery).length > 0 ? parsedQuery : null,
              });
            }}
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <Label>{t.servers.defaultHeaders}</Label>
                <KeyValueEditor
                  pairs={headersDraft}
                  onChange={setHeadersDraft}
                  variableNames={variableNames}
                />
              </div>
              <div className="space-y-2">
                <Label>{t.servers.defaultQuery}</Label>
                <KeyValueEditor
                  pairs={queryDraft}
                  onChange={setQueryDraft}
                  variableNames={variableNames}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                disabled={!defaultsDirty || updateServer.isPending}
              >
                {updateServer.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {updateServer.isPending
                  ? t.servers.savingDefaults
                  : t.servers.saveDefaults}
              </Button>
              {defaultsDirty ? (
                <p className="text-xs text-muted-foreground">
                  {t.servers.defaultsUnsaved}
                </p>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
