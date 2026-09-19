import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldHint,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from "@repo/ui";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/servers/copy-button";
import { SettingsFormSkeleton } from "@/components/loading/settings-form-skeleton";
import {
  useCreatePlatformToken,
  useMcpServers,
  usePlatformSecurityEvents,
  usePlatformSnippet,
  usePlatformTokens,
  useRequestPlatformStepUp,
  useRevokePlatformToken,
  useRotatePlatformToken,
  useVerifyPlatformStepUp,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
  MCP_DEFAULT_PLATFORM_SCOPES,
  MCP_PLATFORM_HIGH_RISK_SCOPES,
  MCP_PLATFORM_HIGH_RISK_TTL_DEFAULT_DAYS,
  MCP_PLATFORM_HIGH_RISK_TTL_MAX_DAYS,
  MCP_PLATFORM_LOW_RISK_TTL_DEFAULT_DAYS,
  MCP_PLATFORM_LOW_RISK_TTL_MAX_DAYS,
  MCP_PLATFORM_PRESETS,
  MCP_PLATFORM_PRESET_IDS,
  MCP_PLATFORM_SCOPES,
  MCP_PLATFORM_SCOPE_DEPENDENCIES,
  type McpPlatformPreset,
  type McpPlatformResourceMode,
  type McpPlatformScope,
} from "@/lib/mcp-limits";

type GrantDraft = {
  name: string;
  scopes: McpPlatformScope[];
  resourceMode: McpPlatformResourceMode;
  serverIds: string[];
  expiresInDays: number;
};

const TTL_OPTIONS = [7, 30, 90] as const;

function grantIsHighRisk(draft: GrantDraft): boolean {
  if (draft.resourceMode === "account") return true;
  return draft.scopes.some((scope) =>
    MCP_PLATFORM_HIGH_RISK_SCOPES.includes(scope),
  );
}

function maxTtlDays(highRisk: boolean): number {
  return highRisk
    ? MCP_PLATFORM_HIGH_RISK_TTL_MAX_DAYS
    : MCP_PLATFORM_LOW_RISK_TTL_MAX_DAYS;
}

function defaultTtlDays(highRisk: boolean): number {
  return highRisk
    ? MCP_PLATFORM_HIGH_RISK_TTL_DEFAULT_DAYS
    : MCP_PLATFORM_LOW_RISK_TTL_DEFAULT_DAYS;
}

const EVENT_TYPE_LABEL_KEYS = {
  token_issued: "tokenIssued",
  token_rotated: "tokenRotated",
  token_revoked: "tokenRevoked",
  scope_denied: "scopeDenied",
  resource_denied: "resourceDenied",
  step_up_failed: "stepUpFailed",
  destructive_action: "destructiveAction",
  mutating_invocation: "mutatingInvocation",
} as const;

type PlatformEventType = keyof typeof EVENT_TYPE_LABEL_KEYS;

function initialDraft(): GrantDraft {
  return {
    name: "",
    scopes: [...MCP_DEFAULT_PLATFORM_SCOPES],
    resourceMode: "selected",
    serverIds: [],
    expiresInDays: MCP_PLATFORM_LOW_RISK_TTL_DEFAULT_DAYS,
  };
}

export function PlatformTokenTab() {
  const { t } = useTranslations();
  const tokenPage = usePlatformTokens({ page: 1, pageSize: 50 });
  const snippet = usePlatformSnippet();
  const events = usePlatformSecurityEvents({ page: 1, pageSize: 10 });
  const servers = useMcpServers({ page: 1, pageSize: 50 });

  const createToken = useCreatePlatformToken();
  const rotateToken = useRotatePlatformToken();
  const revokeToken = useRevokePlatformToken();
  const requestStepUp = useRequestPlatformStepUp();
  const verifyStepUp = useVerifyPlatformStepUp();

  const [rawToken, setRawToken] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rotateTargetId, setRotateTargetId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GrantDraft>(initialDraft);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [otp, setOtp] = useState("");

  const highRisk = grantIsHighRisk(draft);
  const maxDays = maxTtlDays(highRisk);
  const serverItems = servers.data?.items ?? [];

  const scopesToShow = useMemo(
    () =>
      draft.scopes.length > 0 ? draft.scopes : [...MCP_DEFAULT_PLATFORM_SCOPES],
    [draft.scopes],
  );

  function openCreate() {
    setRotateTargetId(null);
    setDraft(initialDraft());
    setOtp("");
    setRawToken(null);
    setDialogOpen(true);
  }

  function openRotate(target: {
    id: string;
    name: string;
    scopes: McpPlatformScope[];
    resourceMode: McpPlatformResourceMode | null;
    selectedServerIds: string[];
    expiresAt: Date | string | null;
  }) {
    setRotateTargetId(target.id);
    setDraft({
      name: `${target.name} (rotated)`,
      scopes: target.scopes.length > 0 ? target.scopes : ["read"],
      resourceMode: target.resourceMode ?? "selected",
      serverIds: target.selectedServerIds,
      expiresInDays: defaultTtlDays(
        grantIsHighRisk({
          ...initialDraft(),
          scopes: target.scopes,
          resourceMode: target.resourceMode ?? "selected",
        }),
      ),
    });
    setOtp("");
    setDialogOpen(true);
  }

  function applyPreset(preset: McpPlatformPreset) {
    setDraft((current) => ({
      ...current,
      scopes: [...MCP_PLATFORM_PRESETS[preset]],
      expiresInDays: defaultTtlDays(
        grantIsHighRisk({
          ...current,
          scopes: [...MCP_PLATFORM_PRESETS[preset]],
        }),
      ),
    }));
  }

  function toggleScope(scope: McpPlatformScope, checked: boolean) {
    setDraft((current) => {
      const next = new Set(current.scopes);
      if (checked) next.add(scope);
      else next.delete(scope);
      const scopes = MCP_PLATFORM_SCOPES.filter((s) => next.has(s));
      return {
        ...current,
        scopes,
        expiresInDays: Math.min(
          current.expiresInDays,
          maxTtlDays(grantIsHighRisk({ ...current, scopes })),
        ),
      };
    });
  }

  async function issueGrant() {
    const payload = {
      name: draft.name.trim(),
      scopes: draft.scopes,
      resourceMode: draft.resourceMode,
      serverIds:
        draft.resourceMode === "selected" ? draft.serverIds : undefined,
      expiresInDays: draft.expiresInDays,
    };
    const created = rotateTargetId
      ? await rotateToken.mutateAsync({ ...payload, tokenId: rotateTargetId })
      : await createToken.mutateAsync(payload);
    setRawToken(created.token);
    setDialogOpen(false);
    setStepUpOpen(false);
    setOtp("");
    setRotateTargetId(null);
  }

  async function submit() {
    if (draft.name.trim().length === 0) return;
    if (draft.resourceMode === "selected" && draft.serverIds.length === 0)
      return;
    if (highRisk) {
      await requestStepUp.mutateAsync();
      setStepUpOpen(true);
      return;
    }
    await issueGrant();
  }

  async function confirmStepUp() {
    await verifyStepUp.mutateAsync({
      otp,
      scopes: draft.scopes,
      resourceMode: draft.resourceMode,
      serverIds:
        draft.resourceMode === "selected" ? draft.serverIds : undefined,
    });
    await issueGrant();
  }

  if (tokenPage.isLoading && tokenPage.data === undefined) {
    return <SettingsFormSkeleton cards={2} fields={3} />;
  }

  const isSubmitting =
    createToken.isPending ||
    rotateToken.isPending ||
    verifyStepUp.isPending ||
    requestStepUp.isPending;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.settings.platform.title}</CardTitle>
          <CardDescription>{t.settings.platform.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t.settings.platform.urlLabel}</Label>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-3 py-2 text-xs">
                {snippet.data?.url ?? "..."}
              </code>
              {snippet.data?.url ? (
                <CopyButton value={snippet.data.url} />
              ) : null}
            </div>
          </div>

          {rawToken ? (
            <Alert>
              <AlertTitle>{t.settings.platform.tokenShownOnce}</AlertTitle>
              <AlertDescription className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">
                  {rawToken}
                </code>
                <CopyButton value={rawToken} />
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>{t.settings.platform.inventoryTitle}</CardTitle>
            <CardDescription>
              {t.settings.platform.inventoryEmpty}
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            {t.settings.platform.createToken}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {(tokenPage.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.settings.platform.noToken}
            </p>
          ) : (
            (tokenPage.data?.items ?? []).map((token) => {
              const revoked = token.revokedAt !== null;
              return (
                <div
                  key={token.id}
                  className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{token.name}</span>
                      <Badge variant={revoked ? "secondary" : "outline"}>
                        {revoked
                          ? t.settings.platform.revokedLabel
                          : t.settings.platform.activeLabel}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">
                        {token.prefix}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {token.scopes.map((scope) => (
                        <Badge key={scope} variant="outline">
                          {t.settings.platform.scopes[scope]}
                        </Badge>
                      ))}
                      <Badge variant="secondary">
                        {token.resourceMode === "account"
                          ? t.settings.platform.accountWide
                          : t.settings.platform.selectedCount.replace(
                              "{count}",
                              String(token.selectedServerIds.length),
                            )}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {token.expiresAt
                        ? t.settings.platform.expiresAtLabel.replace(
                            "{date}",
                            new Date(token.expiresAt).toLocaleDateString(),
                          )
                        : ""}
                      {" · "}
                      {token.lastUsedAt
                        ? t.settings.platform.lastUsedLabel.replace(
                            "{date}",
                            new Date(token.lastUsedAt).toLocaleDateString(),
                          )
                        : t.settings.platform.neverUsedLabel}
                    </p>
                  </div>
                  {!revoked ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={rotateToken.isPending}
                        onClick={() => openRotate(token)}
                      >
                        {t.settings.platform.rotateToken}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={revokeToken.isPending}
                        onClick={() => {
                          if (
                            window.confirm(t.settings.platform.confirmRevoke)
                          ) {
                            revokeToken.mutate({ tokenId: token.id });
                          }
                        }}
                      >
                        {t.settings.platform.revokeToken}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.platform.activity.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(events.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.settings.platform.activity.empty}
            </p>
          ) : (
            (events.data?.items ?? []).map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span>
                  {
                    t.settings.platform.activity[
                      EVENT_TYPE_LABEL_KEYS[
                        event.eventType as PlatformEventType
                      ]
                    ]
                  }
                </span>
                <span className="text-xs text-muted-foreground">
                  {
                    t.settings.platform.activity[
                      event.outcome === "success"
                        ? "outcomeSuccess"
                        : event.outcome === "denied"
                          ? "outcomeDenied"
                          : "outcomeFailure"
                    ]
                  }
                  {" · "}
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {rotateTargetId
                ? t.settings.platform.rotateToken
                : t.settings.platform.createToken}
            </DialogTitle>
            <DialogDescription>
              {t.settings.platform.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field>
              <Label htmlFor="platform-pat-name">
                {t.settings.platform.nameLabel}
              </Label>
              <Input
                id="platform-pat-name"
                value={draft.name}
                placeholder={t.settings.platform.namePlaceholder}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </Field>

            <div className="space-y-2">
              <Label>{t.settings.platform.presetLabel}</Label>
              <div className="flex flex-wrap gap-2">
                {MCP_PLATFORM_PRESET_IDS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => applyPreset(preset)}
                  >
                    {t.settings.platform.presets[preset]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t.settings.platform.presetDescriptions.inspect}
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>{t.settings.platform.resourceModeLabel}</Label>
              <div className="flex gap-2">
                {(["selected", "account"] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={
                      draft.resourceMode === mode ? "default" : "outline"
                    }
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        resourceMode: mode,
                        expiresInDays: Math.min(
                          current.expiresInDays,
                          maxTtlDays(
                            grantIsHighRisk({ ...current, resourceMode: mode }),
                          ),
                        ),
                      }))
                    }
                  >
                    {t.settings.platform.resourceModes[mode]}
                  </Button>
                ))}
              </div>
              <FieldHint>
                {
                  t.settings.platform.resourceModeDescriptions[
                    draft.resourceMode
                  ]
                }
              </FieldHint>
            </div>

            {draft.resourceMode === "selected" ? (
              <div className="space-y-2">
                <Label>{t.settings.platform.selectedServersLabel}</Label>
                {serverItems.length === 0 ? (
                  <FieldHint>{t.settings.platform.serversEmpty}</FieldHint>
                ) : (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                    {serverItems.map((server) => {
                      const selected = draft.serverIds.includes(server.id);
                      return (
                        <label
                          key={server.id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="truncate">{server.name}</span>
                          <Switch
                            checked={selected}
                            onCheckedChange={(checked) =>
                              setDraft((current) => ({
                                ...current,
                                serverIds: checked
                                  ? [...current.serverIds, server.id]
                                  : current.serverIds.filter(
                                      (id) => id !== server.id,
                                    ),
                              }))
                            }
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>{t.settings.platform.advancedLabel}</Label>
              <div className="space-y-1.5">
                {MCP_PLATFORM_SCOPES.map((scope) => {
                  const dependencies = MCP_PLATFORM_SCOPE_DEPENDENCIES[scope];
                  return (
                    <div
                      key={scope}
                      className="flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm">
                          {t.settings.platform.scopes[scope]}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t.settings.platform.scopeDescriptions[scope]}
                        </div>
                        {dependencies.length > 0 ? (
                          <div className="text-xs text-muted-foreground">
                            {t.settings.platform.dependencyHint
                              .replace(
                                "{scope}",
                                t.settings.platform.scopes[scope],
                              )
                              .replace(
                                "{dependency}",
                                dependencies
                                  .map((dep) => t.settings.platform.scopes[dep])
                                  .join(", "),
                              )}
                          </div>
                        ) : null}
                      </div>
                      <Switch
                        checked={draft.scopes.includes(scope)}
                        onCheckedChange={(checked) =>
                          toggleScope(scope, checked)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="platform-pat-ttl">
                {t.settings.platform.ttlLabel}
              </Label>
              <Select
                value={String(draft.expiresInDays)}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    expiresInDays: Number(value),
                  }))
                }
              >
                <SelectTrigger id="platform-pat-ttl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TTL_OPTIONS.filter((days) => days <= maxDays).map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {t.settings.platform.ttlDays.replace(
                        "{days}",
                        String(days),
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldHint>
                {t.settings.platform.ttlCapHint.replace(
                  "{days}",
                  String(maxDays),
                )}
              </FieldHint>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant={highRisk ? "destructive" : "secondary"}>
                {highRisk
                  ? t.settings.platform.highRiskLabel
                  : t.settings.platform.lowRiskLabel}
              </Badge>
              {highRisk ? (
                <span className="text-xs text-muted-foreground">
                  {t.settings.platform.highRiskWarning}
                </span>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">
              {t.settings.platform.rotateHint}
            </p>
          </div>

          <DialogFooter>
            <Button
              onClick={() => void submit()}
              disabled={
                isSubmitting ||
                draft.name.trim().length === 0 ||
                draft.scopes.length === 0 ||
                (draft.resourceMode === "selected" &&
                  draft.serverIds.length === 0)
              }
            >
              {isSubmitting
                ? t.settings.platform.creatingToken
                : rotateTargetId
                  ? t.settings.platform.rotateToken
                  : t.settings.platform.createToken}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stepUpOpen} onOpenChange={setStepUpOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.settings.platform.stepUp.title}</DialogTitle>
            <DialogDescription>
              {t.settings.platform.stepUp.hint}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <Label htmlFor="platform-pat-otp">
              {t.settings.platform.stepUp.codeLabel}
            </Label>
            <Input
              id="platform-pat-otp"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void requestStepUp.mutateAsync()}
              disabled={requestStepUp.isPending}
            >
              {requestStepUp.isPending
                ? t.settings.platform.stepUp.sendingCode
                : t.settings.platform.stepUp.sendCode}
            </Button>
            <Button
              onClick={() => void confirmStepUp()}
              disabled={verifyStepUp.isPending || otp.length !== 6}
            >
              {verifyStepUp.isPending
                ? t.settings.platform.stepUp.verifying
                : t.settings.platform.stepUp.verifyAndCreate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-xs text-muted-foreground">
        {scopesToShow.length} {t.settings.platform.scopesLabel.toLowerCase()}
      </p>
    </div>
  );
}
