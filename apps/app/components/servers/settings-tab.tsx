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
  useMcpTools,
  useMcpVariables,
  useUpdateMcpServer,
} from "@/hooks/use-mcp";
import type { InferredAuth } from "@/lib/server-auth";
import {
  compileMap,
  inferDefaultMapRows,
  type SourceRow,
} from "@/lib/value-origin";
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
import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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
  iconImage: string | null;
};

function ServerDefaultsCard({
  serverId,
  variableNames,
  defaultHeaders,
  defaultQuery,
  pending,
  onSave,
}: {
  serverId: string;
  variableNames: string[];
  defaultHeaders: Record<string, string> | null;
  defaultQuery: Record<string, string> | null;
  pending: boolean;
  onSave: (input: {
    serverId: string;
    defaultHeaders: Record<string, string> | null;
    defaultQuery: Record<string, string> | null;
  }) => void;
}) {
  const { t } = useTranslations();
  const [headersDraft, setHeadersDraft] = useState<SourceRow[]>(() =>
    inferDefaultMapRows(defaultHeaders, variableNames),
  );
  const [queryDraft, setQueryDraft] = useState<SourceRow[]>(() =>
    inferDefaultMapRows(defaultQuery, variableNames),
  );
  const defaultsDirty = useMemo(
    () =>
      !recordsEqual(compileMap(headersDraft), defaultHeaders) ||
      !recordsEqual(compileMap(queryDraft), defaultQuery),
    [headersDraft, queryDraft, defaultHeaders, defaultQuery],
  );

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
            const parsedHeaders = compileMap(headersDraft);
            const parsedQuery = compileMap(queryDraft);
            onSave({
              serverId,
              defaultHeaders:
                Object.keys(parsedHeaders).length > 0 ? parsedHeaders : null,
              defaultQuery:
                Object.keys(parsedQuery).length > 0 ? parsedQuery : null,
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
  const tools = useMcpTools(server.id, { page: 1, pageSize: 50 });
  const createVariable = useCreateMcpVariable();
  const updateServer = useUpdateMcpServer();
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
      });
      await updateServer.mutateAsync({
        serverId: server.id,
        iconImage: upload.accessUrl,
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
              iconImage={server.iconImage}
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
                {server.iconImage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={iconUploadPending || iconRemovePending}
                    onClick={() => {
                      setIconRemovePending(true);
                      updateServer.mutate(
                        { serverId: server.id, iconImage: null },
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
              {variables.data.map((variable) => (
                <li key={variable.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">
                      {variable.name}
                    </code>
                    {variable.isSecret ? (
                      <Badge variant="secondary" className="shrink-0">
                        {t.servers.variableSecretBadge}
                      </Badge>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
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
        serverId={server.id}
        variableNames={variableNames}
        defaultHeaders={defaultHeaders}
        defaultQuery={defaultQuery}
        pending={updateServer.isPending}
        onSave={(input) => updateServer.mutate(input)}
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
          variable={editVariable}
          onClose={() => setEditVariable(null)}
        />
      ) : null}
      {deleteVariableName ? (
        <DeleteVariableDialog
          serverId={server.id}
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
