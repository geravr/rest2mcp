import {
  AI_CAPABILITY_PROFILES,
  APP_ERROR_CODES,
  compareAiCatalogEntries,
  type AiCatalogEntry,
  type AiCatalogSnapshot,
  type AiConnectionProjection,
  type AiProviderKind,
  type AiReadiness,
} from "@repo/core";
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
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldHint,
  Input,
  Label,
  Skeleton,
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@repo/ui";
import {
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { SettingsFormSkeleton } from "@/components/loading/settings-form-skeleton";
import { AiProviderIcon } from "@/components/settings/ai-provider-icon";
import {
  useAiCatalog,
  useAiConnections,
  useAiReadiness,
  useConnectAiProvider,
  useInvalidateAi,
  useRefreshAiCatalog,
  useRemoveAiConnection,
  useRotateAiCredential,
  useVerifyAiModel,
} from "@/hooks/use-ai";
import { useTranslations } from "@/i18n/use-translations";
import { aiProviderKindsInOrder, localizeConnectionErrorCode } from "@/lib/ai";
import { getAppCode, resolveErrorMessage } from "@/lib/errors";

const CAPABILITY_PROFILE = AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.id;
const PROVIDER_KINDS_IN_ORDER = aiProviderKindsInOrder();
const PROVIDER_KEY_URLS: Record<AiProviderKind, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  xai: "https://console.x.ai/",
  meta: "https://api.meta.ai/",
  openrouter: "https://openrouter.ai/settings/keys",
  opencode_zen: "https://opencode.ai/auth",
  opencode_go: "https://opencode.ai/auth",
};

type SetupStep = 1 | 2 | 3;
type ActionError = { message: string; conflict: boolean };

function toActionError(error: unknown, message: string): ActionError {
  return {
    message,
    conflict:
      getAppCode(error) === APP_ERROR_CODES.AI_CONNECTION_REVISION_CONFLICT,
  };
}

export function AiSettingsTab() {
  const { t } = useTranslations();
  const connectionsQuery = useAiConnections();
  const readinessQuery = useAiReadiness(CAPABILITY_PROFILE);
  const [explicitKind, setExplicitKind] = useState<AiProviderKind | null>(null);
  const [step, setStep] = useState<SetupStep | null>(null);
  const [editing, setEditing] = useState(false);
  const [modelVerifying, setModelVerifying] = useState(false);
  const ready = readinessQuery.data?.ready ?? false;

  if (connectionsQuery.isLoading && connectionsQuery.data === undefined) {
    return <SettingsFormSkeleton cards={1} fields={3} />;
  }

  const connections = connectionsQuery.data?.connections ?? [];
  const connectionByKind = new Map(
    connections.map((connection) => [connection.providerKind, connection]),
  );
  const configuredSelection = readinessQuery.data?.selection ?? null;
  const selectedKind = editing
    ? explicitKind
    : (explicitKind ??
      configuredSelection?.providerKind ??
      connections[0]?.providerKind ??
      null);
  const selectedConnection = selectedKind
    ? (connectionByKind.get(selectedKind) ?? null)
    : null;
  const furthest: SetupStep = !selectedKind ? 1 : !selectedConnection ? 2 : 3;
  const preferred: SetupStep =
    selectedConnection?.lastErrorCode && !ready ? 2 : furthest;
  const requested = step ?? (editing ? 1 : preferred);
  const activeStep: SetupStep = requested > furthest ? furthest : requested;
  const showWizard = !ready || editing || !selectedConnection;

  function resetWizardState() {
    setExplicitKind(null);
    setStep(null);
  }

  function finishWizard() {
    setEditing(false);
    resetWizardState();
  }

  function startWizard() {
    setEditing(true);
    resetWizardState();
    setStep(1);
  }
  const steps: Array<{
    step: SetupStep;
    label: string;
    completed: boolean;
    disabled: boolean;
  }> = [
    {
      step: 1,
      label: t.settings.ai.steps.chooseProvider,
      completed: activeStep > 1,
      disabled: false,
    },
    {
      step: 2,
      label: t.settings.ai.steps.connectKey,
      completed: activeStep > 2,
      disabled: selectedKind === null,
    },
    {
      step: 3,
      label: t.settings.ai.steps.verifyModel,
      completed: false,
      disabled: selectedConnection === null,
    },
  ];

  return (
    <div className="pb-8">
      <Card>
        <CardHeader className="flex flex-col gap-4 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-xl">
              {t.settings.ai.readiness.title}
            </CardTitle>
            <CardDescription className="max-w-prose leading-6">
              {ready && !showWizard
                ? t.settings.ai.readiness.description
                : readinessQuery.isError
                  ? resolveErrorMessage(readinessQuery.error, t)
                  : readinessQuery.data?.reason
                    ? t.settings.ai.readiness.reasons[
                        readinessQuery.data.reason
                      ]
                    : t.settings.ai.readiness.description}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant={ready ? "secondary" : "outline"}
              className={
                ready
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                  : undefined
              }
            >
              {ready
                ? t.settings.ai.readiness.readyLabel
                : t.settings.ai.readiness.notReadyLabel}
            </Badge>
            {showWizard && editing && ready ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={finishWizard}
              >
                {t.settings.ai.steps.done}
              </Button>
            ) : null}
            {!showWizard && configuredSelection ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startWizard}
              >
                {t.settings.ai.changeProvider}
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {connectionsQuery.isError ? (
            <p className="text-sm text-destructive">
              {resolveErrorMessage(connectionsQuery.error, t)}
            </p>
          ) : null}

          {showWizard ? (
            <Stepper
              value={activeStep}
              onValueChange={(value) => {
                if (modelVerifying) return;
                setStep(value as SetupStep);
              }}
            >
              <StepperNav aria-label={t.settings.ai.stepperLabel}>
                {steps.map((item, index) => (
                  <StepperItem
                    key={item.step}
                    step={item.step}
                    completed={item.completed}
                    disabled={
                      item.disabled || (modelVerifying && item.step !== 3)
                    }
                  >
                    <StepperTrigger
                      aria-label={t.settings.ai.stepName
                        .replace("{step}", String(item.step))
                        .replace("{label}", item.label)}
                    >
                      <StepperIndicator>
                        {item.step === 3 && modelVerifying ? (
                          <LoaderCircle
                            className="size-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          item.step
                        )}
                      </StepperIndicator>
                      <StepperTitle>{item.label}</StepperTitle>
                    </StepperTrigger>
                    {index < steps.length - 1 ? <StepperSeparator /> : null}
                  </StepperItem>
                ))}
              </StepperNav>

              <StepperContent step={1}>
                <ProviderDirectory
                  selectedKind={selectedKind}
                  onSelect={(providerKind) => {
                    setExplicitKind(providerKind);
                    setStep(1);
                  }}
                />
                <StepActions
                  onNext={() => setStep(2)}
                  nextDisabled={selectedKind === null}
                />
              </StepperContent>

              {selectedKind ? (
                <StepperContent step={2}>
                  <ProviderConfiguration
                    key={selectedKind}
                    providerKind={selectedKind}
                    connection={selectedConnection}
                    onConnected={() => setStep(3)}
                  />
                  <StepActions
                    onBack={() => setStep(1)}
                    onNext={selectedConnection ? () => setStep(3) : undefined}
                  />
                </StepperContent>
              ) : null}

              {selectedKind && selectedConnection ? (
                <StepperContent step={3}>
                  <ModelStep
                    providerKind={selectedKind}
                    connection={selectedConnection}
                    readiness={readinessQuery.data ?? null}
                    onBack={() => setStep(2)}
                    onVerified={finishWizard}
                    onVerifyingChange={setModelVerifying}
                  />
                </StepperContent>
              ) : null}
            </Stepper>
          ) : configuredSelection ? (
            <ConfiguredSummary selection={configuredSelection} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ConfiguredSummary({
  selection,
}: {
  selection: NonNullable<AiReadiness["selection"]>;
}) {
  const { t } = useTranslations();
  const providerName = t.settings.ai.providerNames[selection.providerKind];
  const verifiedAt = new Date(selection.verifiedAt).toLocaleString();

  return (
    <div className="flex items-start gap-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <CheckCircle2 className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 space-y-3">
        <p className="font-medium text-emerald-950 dark:text-emerald-50">
          {t.settings.ai.configuredTitle}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="gap-1.5 border-emerald-500/30 bg-emerald-500/20 text-emerald-950 hover:bg-emerald-500/20 dark:text-emerald-50">
            <AiProviderIcon
              providerKind={selection.providerKind}
              className="size-3.5"
            />
            {providerName}
          </Badge>
          <Badge
            variant="outline"
            className="max-w-full border-emerald-500/40 font-mono text-emerald-950 dark:text-emerald-50"
          >
            {selection.modelId}
          </Badge>
        </div>
        <p className="text-sm text-emerald-900/80 dark:text-emerald-100/90">
          {t.settings.ai.verifiedAtLabel.replace("{date}", verifiedAt)}
        </p>
      </div>
    </div>
  );
}

function StepActions({
  onBack,
  onNext,
  nextDisabled = false,
  nextPending = false,
  backDisabled = false,
  nextLabel,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextPending?: boolean;
  backDisabled?: boolean;
  nextLabel?: string;
}) {
  const { t } = useTranslations();
  if (!onBack && !onNext) return null;

  return (
    <div className="mt-8 flex items-center gap-3 border-t border-border pt-4">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={backDisabled}
        >
          {t.settings.ai.back}
        </Button>
      ) : null}
      {onNext ? (
        <Button
          type="button"
          className="ml-auto"
          onClick={onNext}
          disabled={nextDisabled}
          aria-busy={nextPending}
        >
          {nextPending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {nextLabel ?? t.settings.ai.steps.next}
        </Button>
      ) : null}
    </div>
  );
}

function ProviderDirectory({
  selectedKind,
  onSelect,
}: {
  selectedKind: AiProviderKind | null;
  onSelect: (providerKind: AiProviderKind) => void;
}) {
  const { t } = useTranslations();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          {t.settings.ai.chooseProvider}
        </p>
        <span className="text-sm text-muted-foreground">
          {t.settings.ai.providerCount.replace(
            "{count}",
            String(PROVIDER_KINDS_IN_ORDER.length),
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {PROVIDER_KINDS_IN_ORDER.map((providerKind) => {
          const isSelected = selectedKind === providerKind;
          return (
            <button
              key={providerKind}
              type="button"
              aria-label={t.settings.ai.providerNames[providerKind]}
              aria-pressed={isSelected}
              onClick={() => onSelect(providerKind)}
              className={cn(
                "flex min-h-14 items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isSelected
                  ? "border-primary bg-accent"
                  : "border-border bg-background hover:bg-accent",
              )}
            >
              <span className="flex min-w-0 items-center gap-3">
                <AiProviderIcon
                  providerKind={providerKind}
                  className="size-5 shrink-0 text-foreground"
                />
                <span className="truncate font-medium">
                  {t.settings.ai.providerNames[providerKind]}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-transparent",
                )}
              >
                <Check className="size-3" />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProviderConfiguration({
  providerKind,
  connection,
  onConnected,
}: {
  providerKind: AiProviderKind;
  connection: AiConnectionProjection | null;
  onConnected?: () => void;
}) {
  const { t } = useTranslations();
  const connect = useConnectAiProvider();
  const rotate = useRotateAiCredential();
  const remove = useRemoveAiConnection();
  const invalidate = useInvalidateAi();
  const connectInputRef = useRef<HTMLInputElement>(null);
  const rotateInputRef = useRef<HTMLInputElement>(null);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [showCredential, setShowCredential] = useState(false);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const providerName = t.settings.ai.providerNames[providerKind];

  async function submitConnect() {
    const credential = connectInputRef.current?.value.trim() ?? "";
    if (credential.length === 0) return;
    setActionError(null);
    try {
      await connect.mutateAsync({ providerKind, credential });
      if (connectInputRef.current) connectInputRef.current.value = "";
      onConnected?.();
    } catch (error) {
      setActionError(toActionError(error, resolveErrorMessage(error, t)));
      if (
        getAppCode(error) === APP_ERROR_CODES.AI_CONNECTION_REVISION_CONFLICT
      ) {
        void invalidate();
      }
    }
  }

  async function submitRotate() {
    if (!connection) return;
    const credential = rotateInputRef.current?.value.trim() ?? "";
    if (credential.length === 0) return;
    setActionError(null);
    try {
      await rotate.mutateAsync({
        connectionId: connection.id,
        credential,
        expectedConfigRevision: connection.configRevision,
        expectedCredentialRevision: connection.credentialRevision,
      });
      if (rotateInputRef.current) rotateInputRef.current.value = "";
      setRotateOpen(false);
    } catch (error) {
      setActionError(toActionError(error, resolveErrorMessage(error, t)));
      if (
        getAppCode(error) === APP_ERROR_CODES.AI_CONNECTION_REVISION_CONFLICT
      ) {
        void invalidate();
      }
    }
  }

  async function confirmRemove() {
    if (!connection) return;
    setActionError(null);
    try {
      await remove.mutateAsync({
        connectionId: connection.id,
        expectedConfigRevision: connection.configRevision,
      });
      setRemoveOpen(false);
      setRotateOpen(false);
    } catch (error) {
      setRemoveOpen(false);
      setActionError(toActionError(error, resolveErrorMessage(error, t)));
    }
  }

  const verified = connection !== null && connection.verifiedAt !== null;
  const failed = connection !== null && connection.lastErrorCode !== null;
  const errorMessage = actionError?.conflict
    ? t.settings.ai.conflictRetryHint
    : actionError?.message;

  return (
    <div data-provider={providerKind} className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <h3 className="flex items-center gap-2.5 text-lg font-semibold">
          <AiProviderIcon
            providerKind={providerKind}
            className="size-5 shrink-0 text-foreground"
          />
          <span>
            {connection
              ? t.settings.ai.connectedKeyTitle.replace(
                  "{provider}",
                  providerName,
                )
              : t.settings.ai.connectKeyTitle.replace(
                  "{provider}",
                  providerName,
                )}
          </span>
        </h3>
        {connection ? (
          <Badge
            variant={
              failed ? "destructive" : verified ? "secondary" : "outline"
            }
            className="shrink-0"
          >
            {failed
              ? t.settings.ai.states.verificationFailed
              : verified
                ? t.settings.ai.states.verified
                : t.settings.ai.states.notConnected}
          </Badge>
        ) : null}
      </div>

      {connection ? (
        <div className="space-y-4">
          {connection.lastErrorCode !== null ? (
            <div className="space-y-1">
              <p className="text-sm text-destructive">
                {localizeConnectionErrorCode(connection.lastErrorCode, t) ??
                  t.settings.ai.states.verificationFailed}
              </p>
              {connection.lastAttemptAt ? (
                <p className="text-xs text-muted-foreground">
                  {t.settings.ai.lastAttemptLabel.replace(
                    "{date}",
                    new Date(connection.lastAttemptAt).toLocaleString(),
                  )}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
              <KeyRound className="size-4 text-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium">{t.settings.ai.keyStored}</p>
                <p className="text-sm text-muted-foreground">
                  {t.settings.ai.credentialInputHint}
                </p>
              </div>
            </div>
          )}

          {actionError && !rotateOpen ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : null}

          {rotateOpen ? (
            <CredentialInput
              id={`ai-rotate-${providerKind}`}
              inputRef={rotateInputRef}
              showCredential={showCredential}
              onToggleVisibility={() => setShowCredential((show) => !show)}
              label={t.settings.ai.credentialLabel}
              placeholder={t.settings.ai.credentialPlaceholder}
              visibilityLabel={
                showCredential
                  ? t.settings.ai.hideCredential
                  : t.settings.ai.showCredential
              }
              hint={t.settings.ai.credentialInputHint}
            />
          ) : null}
          {actionError && rotateOpen ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {rotateOpen ? (
              <>
                <Button
                  size="sm"
                  onClick={() => void submitRotate()}
                  disabled={rotate.isPending}
                >
                  {rotate.isPending
                    ? t.settings.ai.rotating
                    : t.settings.ai.rotateConfirm}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRotateOpen(false);
                    setActionError(null);
                  }}
                >
                  {t.settings.ai.cancel}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRotateOpen(true);
                    setActionError(null);
                  }}
                >
                  {t.settings.ai.rotate}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setActionError(null);
                    setRemoveOpen(true);
                  }}
                >
                  {t.settings.ai.remove}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <CredentialInput
            id={`ai-connect-${providerKind}`}
            inputRef={connectInputRef}
            showCredential={showCredential}
            onToggleVisibility={() => setShowCredential((show) => !show)}
            label={t.settings.ai.credentialLabel}
            placeholder={t.settings.ai.credentialPlaceholder}
            visibilityLabel={
              showCredential
                ? t.settings.ai.hideCredential
                : t.settings.ai.showCredential
            }
            hint={t.settings.ai.credentialInputHint}
          />
          <a
            href={PROVIDER_KEY_URLS[providerKind]}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t.settings.ai.keyHelp.replace("{provider}", providerName)}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          {errorMessage ? (
            <p className="text-sm text-destructive">{errorMessage}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void submitConnect()}
              disabled={connect.isPending}
            >
              <ShieldCheck aria-hidden="true" />
              {connect.isPending
                ? t.settings.ai.verifying
                : t.settings.ai.connect}
            </Button>
            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <LockKeyhole className="size-3.5" aria-hidden="true" />
              {t.settings.ai.encryptedAfterVerify}
            </span>
          </div>
        </div>
      )}

      <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
        <ShieldCheck
          className="mt-0.5 size-4 shrink-0 text-foreground"
          aria-hidden="true"
        />
        <span>{t.settings.ai.securityCallout}</span>
      </p>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.settings.ai.removeTitle}</DialogTitle>
            <DialogDescription>
              {t.settings.ai.removeDescription.replace(
                "{provider}",
                providerName,
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveOpen(false)}
              disabled={remove.isPending}
            >
              {t.settings.ai.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmRemove()}
              disabled={remove.isPending}
            >
              {remove.isPending
                ? t.settings.ai.removing
                : t.settings.ai.removeConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CredentialInput({
  id,
  inputRef,
  showCredential,
  onToggleVisibility,
  label,
  placeholder,
  visibilityLabel,
  hint,
}: {
  id: string;
  inputRef: RefObject<HTMLInputElement | null>;
  showCredential: boolean;
  onToggleVisibility: () => void;
  label: string;
  placeholder: string;
  visibilityLabel: string;
  hint: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          ref={inputRef}
          type={showCredential ? "text" : "password"}
          autoComplete="off"
          placeholder={placeholder}
          className="h-10 pr-11"
        />
        <button
          type="button"
          aria-label={visibilityLabel}
          title={visibilityLabel}
          onClick={onToggleVisibility}
          className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showCredential ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
      <FieldHint>{hint}</FieldHint>
    </div>
  );
}

function ModelStep({
  providerKind,
  connection,
  readiness,
  showStatus = true,
  onBack,
  onVerified,
  onVerifyingChange,
}: {
  providerKind: AiProviderKind;
  connection: AiConnectionProjection;
  readiness: AiReadiness | null;
  showStatus?: boolean;
  onBack?: () => void;
  onVerified?: () => void;
  onVerifyingChange?: (verifying: boolean) => void;
}) {
  const { t } = useTranslations();
  const verified = connection.verifiedAt !== null;
  const failed = connection.lastErrorCode !== null;

  return (
    <div data-provider={providerKind} className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">
            {t.settings.ai.verifyModelTitle}
          </h3>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            {t.settings.ai.modelsDescription}
          </p>
        </div>
        {showStatus ? (
          <Badge
            variant={
              failed ? "destructive" : verified ? "secondary" : "outline"
            }
            className="shrink-0"
          >
            {failed
              ? t.settings.ai.states.verificationFailed
              : verified
                ? t.settings.ai.states.verified
                : t.settings.ai.states.notConnected}
          </Badge>
        ) : null}
      </div>
      <ModelPicker
        connection={connection}
        readiness={readiness}
        onBack={onBack}
        onVerified={onVerified}
        onVerifyingChange={onVerifyingChange}
      />
    </div>
  );
}

function ModelPicker({
  connection,
  readiness,
  onBack,
  onVerified,
  onVerifyingChange,
}: {
  connection: AiConnectionProjection;
  readiness: AiReadiness | null;
  onBack?: () => void;
  onVerified?: () => void;
  onVerifyingChange?: (verifying: boolean) => void;
}) {
  const { t } = useTranslations();
  const catalog = useAiCatalog(connection.providerKind, CAPABILITY_PROFILE);
  const refreshCatalog = useRefreshAiCatalog();
  const verify = useVerifyAiModel();
  const [refreshing, setRefreshing] = useState(false);
  const [pickedModelId, setPickedModelId] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  async function refresh() {
    setPickerError(null);
    setRefreshing(true);
    try {
      await refreshCatalog({
        providerKind: connection.providerKind,
        capabilityProfile: CAPABILITY_PROFILE,
      });
    } catch (error) {
      setPickerError(resolveErrorMessage(error, t));
    } finally {
      setRefreshing(false);
    }
  }

  async function verifyModel(modelId: string) {
    setPickerError(null);
    onVerifyingChange?.(true);
    try {
      await verify.mutateAsync({
        connectionId: connection.id,
        capabilityProfile: CAPABILITY_PROFILE,
        modelId,
        expectedConfigRevision: connection.configRevision,
      });
      onVerified?.();
    } catch (error) {
      setPickerError(resolveErrorMessage(error, t));
    } finally {
      onVerifyingChange?.(false);
    }
  }

  const selection =
    readiness?.selection?.providerKind === connection.providerKind
      ? readiness.selection
      : null;
  const hasVerifiable =
    catalog.data?.entries.some(
      (entry) => entry.qualification.state !== "unsupported",
    ) ?? false;
  const verifyingModelLabel =
    catalog.data?.entries.find(
      (entry) => entry.descriptor.modelId === pickedModelId,
    )?.descriptor.displayName ?? pickedModelId;

  return (
    <div className="space-y-4">
      {selection ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm text-muted-foreground">
            {t.settings.ai.selectedModel}
          </p>
          <p className="mt-1 font-mono text-sm font-medium">
            {selection.modelId}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.settings.ai.verifiedAtLabel.replace(
              "{date}",
              new Date(selection.verifiedAt).toLocaleString(),
            )}
          </p>
        </div>
      ) : null}

      {catalog.isLoading && catalog.data === undefined ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : catalog.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{resolveErrorMessage(catalog.error, t)}</AlertTitle>
          <AlertDescription>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void catalog.refetch()}
            >
              {t.settings.ai.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : catalog.data ? (
        <CatalogEntries
          key={connection.id}
          snapshot={catalog.data}
          selectionModelId={selection?.modelId ?? null}
          pickedModelId={pickedModelId}
          onPickModel={setPickedModelId}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          pickerError={pickerError}
          interactionDisabled={verify.isPending}
        />
      ) : null}

      {verify.isPending && verifyingModelLabel ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4"
        >
          <LoaderCircle
            className="mt-0.5 size-4 shrink-0 animate-spin text-primary"
            aria-hidden="true"
          />
          <p className="text-sm leading-6 text-muted-foreground">
            {t.settings.ai.verification.inProgress.replace(
              "{model}",
              verifyingModelLabel,
            )}
          </p>
        </div>
      ) : null}

      <StepActions
        onBack={onBack}
        backDisabled={verify.isPending}
        onNext={
          hasVerifiable
            ? () => {
                if (pickedModelId) void verifyModel(pickedModelId);
              }
            : undefined
        }
        nextDisabled={!pickedModelId || verify.isPending}
        nextPending={verify.isPending}
        nextLabel={
          verify.isPending
            ? t.settings.ai.verification.verifying
            : t.settings.ai.verification.verifyAndSelect
        }
      />
    </div>
  );
}

function CatalogEntries({
  snapshot,
  selectionModelId,
  pickedModelId,
  onPickModel,
  onRefresh,
  refreshing,
  pickerError,
  interactionDisabled = false,
}: {
  snapshot: AiCatalogSnapshot;
  selectionModelId: string | null;
  pickedModelId: string | null;
  onPickModel: (modelId: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  pickerError: string | null;
  interactionDisabled?: boolean;
}) {
  const { t } = useTranslations();
  const [modelQuery, setModelQuery] = useState("");
  const allEntries = [...snapshot.entries].sort(compareAiCatalogEntries);
  const entries = allEntries.filter((entry) => {
    const query = modelQuery.trim().toLowerCase();
    return (
      query.length === 0 ||
      entry.descriptor.displayName.toLowerCase().includes(query) ||
      entry.descriptor.modelId.toLowerCase().includes(query)
    );
  });
  const verifiable = allEntries.filter(
    (entry) => entry.qualification.state !== "unsupported",
  );

  return (
    <div
      className={cn(
        "space-y-3",
        interactionDisabled && "pointer-events-none opacity-60",
      )}
      aria-busy={interactionDisabled}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {snapshot.stale
            ? t.settings.ai.staleCatalogBanner
            : t.settings.ai.catalogRetrievedAt.replace(
                "{date}",
                new Date(snapshot.retrievedAt).toLocaleString(),
              )}
        </p>
        {snapshot.stale ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={interactionDisabled}
          >
            <RefreshCw
              className={refreshing ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            {refreshing
              ? t.settings.ai.refreshingCatalog
              : t.settings.ai.refreshCatalog}
          </Button>
        ) : null}
      </div>

      {snapshot.stale ? (
        <p className="text-sm text-muted-foreground">
          {t.settings.ai.catalogRetrievedAt.replace(
            "{date}",
            new Date(snapshot.retrievedAt).toLocaleString(),
          )}
        </p>
      ) : null}

      {pickerError ? (
        <p className="text-sm text-destructive">{pickerError}</p>
      ) : null}

      {allEntries.length > 0 ? (
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={modelQuery}
            onChange={(event) => setModelQuery(event.target.value)}
            placeholder={t.settings.ai.searchModels}
            aria-label={t.settings.ai.searchModels}
            className="h-10 pl-9"
            disabled={interactionDisabled}
          />
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t.settings.ai.modelsEmpty}
        </p>
      ) : (
        <div className="max-h-52 overflow-y-auto pr-1">
          <ul
            className="grid grid-cols-2 gap-2"
            aria-label={t.settings.ai.modelsTitle}
          >
            {entries.map((entry) => (
              <CatalogRow
                key={entry.descriptor.modelId}
                entry={entry}
                verified={selectionModelId === entry.descriptor.modelId}
                picked={pickedModelId === entry.descriptor.modelId}
                onPick={() => onPickModel(entry.descriptor.modelId)}
              />
            ))}
          </ul>
        </div>
      )}

      {verifiable.length > 0 ? (
        <p className="border-t border-border pt-3 text-sm leading-6 text-muted-foreground">
          {t.settings.ai.verification.disclosure}
        </p>
      ) : null}
    </div>
  );
}

function CatalogRow({
  entry,
  verified,
  picked,
  onPick,
}: {
  entry: AiCatalogEntry;
  verified: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslations();
  const { descriptor, qualification } = entry;
  const unsupported = qualification.state === "unsupported";

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {descriptor.displayName}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {descriptor.modelId}
          </p>
        </div>
        {verified ? (
          <Badge variant="secondary" className="shrink-0">
            {t.settings.ai.states.verified}
          </Badge>
        ) : picked ? (
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground"
          >
            <Check className="size-3" />
          </span>
        ) : null}
      </div>
      {unsupported ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t.settings.ai.unsupportedReasons[qualification.reason]}
        </p>
      ) : null}
    </>
  );

  if (unsupported) {
    return (
      <li className="rounded-lg border border-border bg-muted/40 p-3 opacity-70">
        {content}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        aria-label={descriptor.displayName}
        aria-pressed={picked}
        onClick={onPick}
        className={cn(
          "h-full w-full rounded-lg border p-3 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          picked || verified
            ? "border-primary bg-accent"
            : "border-border bg-background hover:bg-accent",
        )}
      >
        {content}
      </button>
    </li>
  );
}
