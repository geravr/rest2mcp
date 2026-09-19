import { SettingsFormSkeleton } from "@/components/loading";
import { DeleteServerDialog } from "@/components/servers/delete-server-dialog";
import { DeleteVariableDialog } from "@/components/servers/delete-variable-dialog";
import { EditVariableDialog } from "@/components/servers/edit-variable-dialog";
import {
  authResetKey,
  ServerAuthCard,
} from "@/components/servers/server-auth-card";
import { SourceRowEditor } from "@/components/servers/source-row-editor";
import {
  useCreateMcpVariable,
  useMcpServerCommon,
  useMcpTools,
  useMcpVariables,
  useUpdateMcpServer,
  useUpdateMcpServerCommon,
} from "@/hooks/use-mcp";
import type { InferredAuth } from "@/lib/server-auth";
import {
  buildServerValueLookup,
  commonRowsToEntries,
  definitionToSourceRows,
  type ClientCommonEntries,
} from "@/lib/request-definition";
import { inferDefaultMapRows, type SourceRow } from "@/lib/value-origin";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { ServerIcon } from "@/components/servers/server-icon";
import { uploadFileToStorage } from "@/lib/storage";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  Switch,
} from "@repo/ui";
import { LoaderCircle, Lock, Pencil, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

type ServerIdentity = {
  id: string;
  name: string;
  description: string | null;
  baseUrl: string;
  iconUrl: string | null;
  configRevision: number;
};

function ServerDefaultsCard({
  variableNames,
  variableKinds,
  serverValues,
  common,
  defaultHeaders,
  defaultQuery,
  pending,
  onSave,
}: {
  variableNames: string[];
  variableKinds?: Record<string, "config" | "secret">;
  serverValues: Array<{ id: string; name: string }>;
  common: ClientCommonEntries;
  defaultHeaders: Record<string, string> | null;
  defaultQuery: Record<string, string> | null;
  pending: boolean;
  onSave: (common: ClientCommonEntries) => void;
}) {
  const { t } = useTranslations();
  const lookup = useMemo(
    () => buildServerValueLookup(serverValues),
    [serverValues],
  );
  const hasCommon = common.headers.length > 0 || common.query.length > 0;
  const [headersDraft, setHeadersDraft] = useState<SourceRow[]>(() =>
    hasCommon
      ? definitionToSourceRows(common.headers, lookup, new Map())
      : inferDefaultMapRows(defaultHeaders, variableNames),
  );
  const [queryDraft, setQueryDraft] = useState<SourceRow[]>(() =>
    hasCommon
      ? definitionToSourceRows(common.query, lookup, new Map())
      : inferDefaultMapRows(defaultQuery, variableNames),
  );
  const initialDraftsRef = useRef({ headersDraft, queryDraft });
  const defaultsDirty =
    JSON.stringify(headersDraft) !==
      JSON.stringify(initialDraftsRef.current.headersDraft) ||
    JSON.stringify(queryDraft) !==
      JSON.stringify(initialDraftsRef.current.queryDraft);

  return (
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
            onSave({
              headers: commonRowsToEntries(headersDraft, lookup.idByName),
              query: commonRowsToEntries(queryDraft, lookup.idByName),
            });
          }}
        >
          <div className="grid gap-6 xl:grid-cols-2">
            <Field>
              <Label>{t.servers.defaultHeaders}</Label>
              <SourceRowEditor
                rows={headersDraft}
                onChange={setHeadersDraft}
                variableNames={variableNames}
                variableKinds={variableKinds}
                mode="defaults"
                emptyLabel={t.servers.emptyHeaderRows}
              />
            </Field>
            <Field>
              <Label>{t.servers.defaultQuery}</Label>
              <SourceRowEditor
                rows={queryDraft}
                onChange={setQueryDraft}
                variableNames={variableNames}
                variableKinds={variableKinds}
                mode="defaults"
                emptyLabel={t.servers.emptyQueryRows}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!defaultsDirty || pending}>
              {pending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {pending ? t.servers.savingDefaults : t.servers.saveDefaults}
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
  );
}

/** Server-owned configuration: identity, auth, variables, and request defaults. */
export function ServerSettingsTab({
  server,
  defaultHeaders,
  defaultQuery,
  auth,
}: {
  server: ServerIdentity;
  defaultHeaders: Record<string, string> | null;
  defaultQuery: Record<string, string> | null;
  auth: InferredAuth;
}) {
  const { t } = useTranslations();
  const variables = useMcpVariables(server.id);
  const serverCommon = useMcpServerCommon(server.id);
  const tools = useMcpTools(server.id, { page: 1, pageSize: 50 });
  const createVariable = useCreateMcpVariable();
  const updateServer = useUpdateMcpServer();
  const updateServerCommon = useUpdateMcpServerCommon();
  const iconFileInputRef = useRef<HTMLInputElement>(null);
  const [iconUploadPending, setIconUploadPending] = useState(false);
  const [iconRemovePending, setIconRemovePending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editVariable, setEditVariable] = useState<{
    name: string;
    isSecret: boolean;
    value?: string;
  } | null>(null);
  const [deleteVariableName, setDeleteVariableName] = useState<string | null>(
    null,
  );

  const [name, setName] = useState(server.name);
  const [baseUrl, setBaseUrl] = useState(server.baseUrl);
  const [description, setDescription] = useState(server.description ?? "");

  const [variableName, setVariableName] = useState("");
  const [variableValue, setVariableValue] = useState("");
  const [variableSecret, setVariableSecret] = useState(true);

  const variableNames = (variables.data ?? []).map((variable) => variable.name);
  const variableKinds = Object.fromEntries(
    (variables.data ?? []).map((variable) => [variable.name, variable.kind]),
  );
  const identityDirty =
    name.trim() !== server.name ||
    baseUrl.trim() !== server.baseUrl ||
    (description.trim() || null) !== (server.description ?? null);
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

  const handleIconFile = async (file: File) => {
    const contentType = file.type.toLowerCase();

    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      throw new Error(t.servers.invalidIconType);
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error(t.servers.iconTooLarge);
    }

    setIconUploadPending(true);
    try {
      const upload = await uploadFileToStorage({
        file,
        directory: "server-icons",
        purpose: "server_icon",
      });
      if (!upload.assetId) {
        throw new Error(t.servers.iconUploadFailed);
      }
      await updateServer.mutateAsync({
        serverId: server.id,
        expectedRevision: server.configRevision,
        iconAssetId: upload.assetId,
      });
    } finally {
      setIconUploadPending(false);
      if (iconFileInputRef.current) {
        iconFileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.servers.iconTitle}</CardTitle>
          <CardDescription>{t.servers.iconDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <ServerIcon
              serverId={server.id}
              iconUrl={server.iconUrl}
              size="lg"
            />
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t.servers.iconPhotoDescription}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="server-icon-upload" className="sr-only">
                  {t.servers.iconUpload}
                </Label>
                <input
                  ref={iconFileInputRef}
                  id="server-icon-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  tabIndex={-1}
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      return;
                    }

                    void handleIconFile(file).catch((error: unknown) => {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : resolveErrorMessage(error, t),
                      );
                    });
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={iconUploadPending || iconRemovePending}
                  onClick={() => iconFileInputRef.current?.click()}
                >
                  {iconUploadPending ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      {t.servers.iconUploading}
                    </>
                  ) : (
                    t.servers.iconUpload
                  )}
                </Button>
                {server.iconUrl ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={iconUploadPending || iconRemovePending}
                    onClick={() => {
                      setIconRemovePending(true);
                      updateServer.mutate(
                        {
                          serverId: server.id,
                          expectedRevision: server.configRevision,
                          iconAssetId: null,
                        },
                        { onSettled: () => setIconRemovePending(false) },
                      );
                    }}
                  >
                    {iconRemovePending ? (
                      <>
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        {t.servers.iconRemoving}
                      </>
                    ) : (
                      t.servers.iconRemove
                    )}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
                expectedRevision: server.configRevision,
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                description: description.trim() ? description.trim() : null,
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <Label htmlFor="settings-server-name">{t.servers.name}</Label>
                <Input
                  id="settings-server-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t.servers.namePlaceholder}
                  required
                />
              </Field>
              <Field>
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
              </Field>
            </div>
            <Field>
              <Label htmlFor="settings-server-description">
                {t.servers.descriptionLabel}
              </Label>
              <Input
                id="settings-server-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t.servers.optionalDescription}
              />
            </Field>
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

      <ServerAuthCard
        key={authResetKey(auth)}
        serverId={server.id}
        configRevision={server.configRevision}
        auth={auth}
      />

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
              {variables.data.map((variable) => {
                const authOwned = variable.owner === "auth";
                return (
                  <li key={variable.id} className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <code className="min-w-0 flex-1 truncate font-mono text-xs">
                        {variable.name}
                      </code>
                      <Badge
                        variant={variable.isSecret ? "secondary" : "outline"}
                        className="shrink-0"
                      >
                        {variable.isSecret
                          ? t.servers.variableSecretBadge
                          : t.servers.variableConfigBadge}
                      </Badge>
                      {authOwned ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 gap-1 text-muted-foreground"
                        >
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          {t.servers.variableAuthOwnedBadge}
                        </Badge>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        disabled={authOwned}
                        aria-label={t.servers.editVariable}
                        onClick={() =>
                          setEditVariable({
                            name: variable.name,
                            isSecret: variable.isSecret,
                            value: variable.value ?? undefined,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={authOwned}
                        aria-label={t.servers.deleteVariable}
                        onClick={() => setDeleteVariableName(variable.name)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {variable.isSecret
                        ? variable.hasValue
                          ? t.servers.variableHasValue
                          : t.servers.variableNoValue
                        : variable.value}
                    </p>
                  </li>
                );
              })}
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
                  expectedRevision: server.configRevision,
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
              <Field>
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
              </Field>
              <Field>
                <Label htmlFor="var-value">{t.servers.variableValue}</Label>
                <Input
                  id="var-value"
                  type={variableSecret ? "password" : "text"}
                  value={variableValue}
                  onChange={(event) => setVariableValue(event.target.value)}
                  autoComplete="off"
                  required
                />
              </Field>
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

      <ServerDefaultsCard
        key={JSON.stringify(serverCommon.data?.common ?? null)}
        variableNames={variableNames}
        variableKinds={variableKinds}
        serverValues={(variables.data ?? []).map((variable) => ({
          id: variable.id,
          name: variable.name,
        }))}
        common={serverCommon.data?.common ?? { headers: [], query: [] }}
        defaultHeaders={defaultHeaders}
        defaultQuery={defaultQuery}
        pending={updateServerCommon.isPending}
        onSave={(common) =>
          updateServerCommon.mutate({
            serverId: server.id,
            expectedRevision: server.configRevision,
            common,
          })
        }
      />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">
            {t.servers.dangerZoneTitle}
          </CardTitle>
          <CardDescription>{t.servers.dangerZoneDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t.servers.deleteTitle}</p>
              <p className="text-sm text-muted-foreground">
                {t.servers.deleteDescription.replace("{name}", server.name)}
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              className="shrink-0"
              onClick={() => setDeleteOpen(true)}
            >
              {t.servers.deleteServer}
            </Button>
          </div>
        </CardContent>
      </Card>

      {deleteOpen ? (
        <DeleteServerDialog
          server={server}
          onClose={() => setDeleteOpen(false)}
        />
      ) : null}
      {editVariable ? (
        <EditVariableDialog
          serverId={server.id}
          configRevision={server.configRevision}
          variable={editVariable}
          onClose={() => setEditVariable(null)}
        />
      ) : null}
      {deleteVariableName ? (
        <DeleteVariableDialog
          serverId={server.id}
          configRevision={server.configRevision}
          name={deleteVariableName}
          tools={tools.data?.items ?? []}
          defaultHeaders={defaultHeaders}
          defaultQuery={defaultQuery}
          onClose={() => setDeleteVariableName(null)}
        />
      ) : null}
    </div>
  );
}
