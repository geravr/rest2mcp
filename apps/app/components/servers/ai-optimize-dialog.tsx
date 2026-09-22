import {
  AiSettingsCta,
  useAiFeatureReadiness,
} from "@/hooks/use-ai-readiness-guard";
import {
  useOptimizerApplyDraft,
  useOptimizerAuthorize,
  useOptimizerCancel,
  useOptimizerItems,
  useOptimizerItem,
  useOptimizerPreflightDraft,
  useOptimizerPreflightOpenapi,
  useOptimizerRuns,
  useOptimizerStatus,
  type OptimizerItemDetail,
  type OptimizerPreflightResult,
  type PreflightOpenapiInput,
} from "@/hooks/use-ai-optimizer";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Separator,
  Skeleton,
} from "@repo/ui";
import { Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type AiOptimizeScope =
  | { kind: "single"; toolIds: [string] }
  | { kind: "selected"; toolIds: string[] }
  | { kind: "all_eligible" }
  | { kind: "openapi"; operationKeys: string[] };

/** Observed server revisions the preflight was computed against. */
export type AiOptimizeServerState = {
  configRevision: number;
  /** Present for draft flows; the import flow only knows the config revision. */
  draftRevision?: number;
};

/** Selected recommendation operations reported back to the import flow. */
export type AiOptimizationSelectionState = {
  runId: string;
  operations: Array<{ operationKey: string; operationIds: string[] }>;
};

type Phase = "preflight" | "authorize" | "progress" | "review";

const ACTIVE_RUN_STATES = ["queued", "running", "cancel_requested"];
const TERMINAL_RUN_STATES = new Set([
  "completed",
  "completed_with_errors",
  "failed",
  "cancelled",
  "expired",
]);

type PersistedRunScope =
  | { kind: "single"; toolIds: [string] }
  | { kind: "selected"; toolIds: string[] }
  | { kind: "all_eligible" }
  | { kind: "openapi"; operationKeys: string[] };

function sorted(values: string[]): string {
  return [...values].sort().join("|");
}

/** True when a persisted active run matches the requested scope exactly. */
function scopeMatches(
  runScope: PersistedRunScope,
  requested: AiOptimizeScope | null,
): boolean {
  if (!requested || runScope.kind !== requested.kind) return false;
  if (runScope.kind === "all_eligible") return true;
  if (
    (runScope.kind === "single" || runScope.kind === "selected") &&
    (requested.kind === "single" || requested.kind === "selected")
  ) {
    return sorted(runScope.toolIds) === sorted(requested.toolIds);
  }
  if (runScope.kind === "openapi" && requested.kind === "openapi") {
    return sorted(runScope.operationKeys) === sorted(requested.operationKeys);
  }
  return false;
}

/**
 * Readiness-gated optimization flow: preflight disclosure, explicit
 * authorization, restart-safe progress with cancellation (an active run for
 * the same scope resumes instead of re-planning), grouped review with
 * per-operation selection, and one atomic draft-only application.
 */
export function AiOptimizeDialog(input: {
  serverId: string;
  serverState: AiOptimizeServerState | null;
  scope: AiOptimizeScope | null;
  /** Required for OpenAPI scope: reparsed source identity for the plan. */
  openapi?: Pick<PreflightOpenapiInput, "source" | "fingerprint">;
  /** Import mode reports selected operations instead of applying drafts. */
  onOptimizationChange?: (state: AiOptimizationSelectionState | null) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const open = input.scope !== null;
  const { t } = useTranslations();
  const { ready, isLoading: readinessLoading } =
    useAiFeatureReadiness("structured-text-v1");

  const [phase, setPhase] = useState<Phase>("preflight");
  const [runId, setRunId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const preflightStartedRef = useRef(false);

  const preflightDraft = useOptimizerPreflightDraft();
  const preflightOpenapi = useOptimizerPreflightOpenapi();
  const isOpenapiScope = input.scope?.kind === "openapi";
  const preflight = isOpenapiScope ? preflightOpenapi : preflightDraft;
  const authorize = useOptimizerAuthorize();
  const cancelMutation = useOptimizerCancel();
  const runs = useOptimizerRuns(input.serverId, 1, 10, {
    enabled: open && phase === "preflight",
  });
  const activeRun = useMemo(() => {
    if (!runs.data || !input.scope) return null;
    return (
      runs.data.items.find(
        (candidate) =>
          ACTIVE_RUN_STATES.includes(candidate.state) &&
          scopeMatches(candidate.scope as PersistedRunScope, input.scope),
      ) ?? null
    );
  }, [runs.data, input.scope]);
  const effectiveRunId = runId ?? activeRun?.id ?? null;
  const status = useOptimizerStatus(effectiveRunId, {
    refetchWhileActive:
      phase === "progress" || (phase === "preflight" && activeRun !== null),
  });
  const displayPhase: Phase =
    phase === "preflight" && activeRun
      ? "progress"
      : (phase === "progress" || (phase === "preflight" && activeRun)) &&
          status.data &&
          TERMINAL_RUN_STATES.has(status.data.state)
        ? "review"
        : phase;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) input.onOptimizationChange?.(null);
    input.onOpenChange(nextOpen);
  };

  const scopeSessionKey =
    input.scope === null
      ? ""
      : input.scope.kind === "all_eligible"
        ? "all_eligible"
        : input.scope.kind === "openapi"
          ? `openapi:${sorted(input.scope.operationKeys)}`
          : `${input.scope.kind}:${sorted(input.scope.toolIds)}`;

  useEffect(() => {
    preflightStartedRef.current = false;
  }, [scopeSessionKey]);

  const startPreflight = () => {
    if (!input.scope || !input.serverState) return;
    const common = {
      serverId: input.serverId,
      expectedConfigRevision: input.serverState.configRevision,
    };
    const onPlan = (plan: OptimizerPreflightResult) => {
      setRunId(plan.runId);
      setPhase("authorize");
    };
    const onError = (error: Error) =>
      setErrorText(resolveErrorMessage(error, t));
    if (input.scope.kind === "openapi") {
      if (!input.openapi) return;
      preflightOpenapi.mutate(
        {
          ...common,
          source: input.openapi.source,
          fingerprint: input.openapi.fingerprint,
          operationKeys: input.scope.operationKeys,
        },
        { onSuccess: onPlan, onError },
      );
      return;
    }
    preflightDraft.mutate(
      { ...common, scope: input.scope },
      { onSuccess: onPlan, onError },
    );
  };

  // Resume a persisted active run for the same scope (navigation/reload safe);
  // otherwise plan a fresh one exactly once per open.
  useEffect(() => {
    if (
      !open ||
      phase !== "preflight" ||
      readinessLoading ||
      !ready ||
      preflightStartedRef.current ||
      activeRun
    ) {
      return;
    }
    if (runs.isLoading || runs.isFetching) return;
    if (!input.serverState) return;
    preflightStartedRef.current = true;
    startPreflight();
    // startPreflight captures this render's inputs by design.
  }, [
    open,
    phase,
    readinessLoading,
    ready,
    activeRun,
    runs.isLoading,
    runs.isFetching,
    input.serverState,
    scopeSessionKey,
  ]);

  const authorizePlan = () => {
    if (!input.serverState) return;
    authorize.mutate(
      {
        runId: runId ?? "",
        expectedConfigRevision: input.serverState.configRevision,
        ...(input.serverState.draftRevision !== undefined
          ? { expectedDraftRevision: input.serverState.draftRevision }
          : {}),
        ...(isOpenapiScope && input.openapi
          ? { source: input.openapi.source }
          : {}),
      },
      {
        onSuccess: () => setPhase("progress"),
        onError: (error) => setErrorText(resolveErrorMessage(error, t)),
      },
    );
  };

  const requestCancel = () => {
    if (!effectiveRunId) return;
    cancelMutation.mutate(
      { runId: effectiveRunId },
      { onError: (error) => setErrorText(resolveErrorMessage(error, t)) },
    );
  };

  const progress = status.data?.progress;
  const activeStates = ["planned", "queued", "running", "cancel_requested"];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.servers.aiOptimizer.title}</DialogTitle>
          <DialogDescription>
            {t.servers.aiOptimizer.description}
          </DialogDescription>
        </DialogHeader>

        {!ready && !readinessLoading ? (
          <AiSettingsCta capabilityProfile="structured-text-v1" />
        ) : errorText ? (
          <Alert variant="destructive">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        ) : displayPhase === "preflight" || preflight.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t.servers.aiOptimizer.preparing}
          </p>
        ) : displayPhase === "authorize" && preflight.data ? (
          <AuthorizationView
            plan={preflight.data}
            onAuthorize={authorizePlan}
            onCancel={() => handleOpenChange(false)}
            pending={authorize.isPending}
          />
        ) : displayPhase === "progress" ? (
          <div className="space-y-4">
            <p className="text-sm">
              {t.servers.aiOptimizer.progress.inProgress}
            </p>
            {progress ? (
              <p className="text-sm text-muted-foreground">
                {t.servers.aiOptimizer.progress.narrative
                  .replace("{ready}", String(progress.recommended))
                  .replace("{total}", String(progress.total))
                  .replace("{failed}", String(progress.failed))}
              </p>
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {status.data?.state === "cancel_requested" ? (
              <p className="text-sm text-muted-foreground">
                {t.servers.aiOptimizer.progress.cancelling}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={requestCancel}
                disabled={
                  cancelMutation.isPending ||
                  !activeStates.includes(status.data?.state ?? "")
                }
              >
                {t.servers.aiOptimizer.progress.cancel}
              </Button>
            </div>
          </div>
        ) : displayPhase === "review" ? (
          <ReviewView
            runId={effectiveRunId ?? ""}
            mode={isOpenapiScope ? "import" : "draft"}
            serverState={input.serverState}
            onSelectionsChange={(operations) =>
              input.onOptimizationChange?.(
                operations.length > 0 && effectiveRunId
                  ? { runId: effectiveRunId, operations }
                  : null,
              )
            }
            onDone={() => handleOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AuthorizationView(input: {
  plan: OptimizerPreflightResult;
  onAuthorize: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const { t } = useTranslations();
  const plan = input.plan;
  const copy = t.servers.aiOptimizer;
  const cost =
    plan.estimate.pricing.state === "estimated"
      ? copy.authorize.costEstimated.replace(
          "{cost}",
          `$${plan.estimate.pricing.totalCostUsd.toFixed(2)}`,
        )
      : copy.authorize.costUnknown;
  return (
    <div className="space-y-4">
      <p className="text-sm">
        {copy.authorize.lead.replace("{count}", String(plan.eligible.length))}
      </p>
      <p className="text-sm text-muted-foreground">
        {plan.model.providerKind} · {plan.model.modelId} · {cost}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {copy.authorize.details}
        </summary>
        <div className="mt-3 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">
              {copy.authorize.scope}
            </span>
            <span>{copy.scope[plan.scopeKind]}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">
              {copy.authorize.eligible}
            </span>
            <span>
              {plan.eligible.length}
              {plan.ineligible.length > 0
                ? ` (+${plan.ineligible.length} ${copy.authorize.ineligibleShort})`
                : ""}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">
              {copy.authorize.tokens}
            </span>
            <span>
              {plan.estimate.tokens.inputTokens} /{" "}
              {plan.estimate.tokens.outputTokens}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{copy.authorize.cost}</span>
            <span>
              {plan.estimate.pricing.state === "estimated"
                ? copy.authorize.costEstimated.replace(
                    "{cost}",
                    `$${plan.estimate.pricing.totalCostUsd.toFixed(2)}`,
                  )
                : copy.authorize.costUnknown}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">
              {copy.authorize.expires}
            </span>
            <span>{new Date(plan.expiresAt).toLocaleTimeString()}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">
              {copy.authorize.policyVersion}
            </span>
            <span>v{plan.policyVersion}</span>
          </div>
        </div>
        <Separator />
        <div className="space-y-1 text-sm">
          <p className="font-medium">{copy.authorize.disclosedTitle}</p>
          <p className="text-muted-foreground">
            {copy.authorize.disclosedBody}
          </p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {plan.disclosedData.map((category) => (
              <li key={category}>{copy.disclosed[category]}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium">{copy.authorize.mutableTitle}</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {plan.mutableFields.map((field) => (
              <li key={field}>{copy.mutable[field]}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-1.5 font-medium">
            <ShieldAlert className="h-4 w-4" />
            {copy.authorize.immutableTitle}
          </p>
          <p className="text-muted-foreground">
            {copy.authorize.immutableBody}
          </p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {plan.immutableFields.map((field) => (
              <li key={field}>{copy.immutable[field]}</li>
            ))}
          </ul>
        </div>
      </details>
      {plan.ineligible.length > 0 ? (
        <Alert>
          <AlertDescription>
            <p>
              {(plan.ineligible.length === 1
                ? copy.authorize.ineligibleBodyOne
                : copy.authorize.ineligibleBody
              ).replace("{count}", String(plan.ineligible.length))}
            </p>
            <ul className="list-disc pl-5">
              {plan.ineligible.map((entry) => (
                <li
                  key={`${entry.ref.kind}-${
                    entry.ref.kind === "draft_tool"
                      ? entry.ref.toolId
                      : entry.ref.operationKey
                  }`}
                >
                  {entry.name} — {copy.ineligibleReason[entry.reason]}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={input.onCancel}>
          {copy.authorize.decline}
        </Button>
        <Button onClick={input.onAuthorize} disabled={input.pending}>
          {input.pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {copy.authorize.approve}
        </Button>
      </DialogFooter>
    </div>
  );
}

type ItemSelectionEntry = {
  operationKey: string;
  operationIds: string[];
};

function ReviewView(input: {
  runId: string;
  mode: "draft" | "import";
  serverState: AiOptimizeServerState | null;
  onSelectionsChange: (operations: ItemSelectionEntry[]) => void;
  onDone: () => void;
}) {
  const { t } = useTranslations();
  const [page, setPage] = useState(1);
  const shownItems = useOptimizerItems(input.runId, 1, page * 20);
  const [selections, setSelections] = useState<
    Record<string, ItemSelectionEntry>
  >({});
  const [applyError, setApplyError] = useState<string | null>(null);
  const apply = useOptimizerApplyDraft();
  const selectionsRef = useRef(selections);

  const updateSelection = (
    itemId: string,
    operationKey: string,
    operationIds: string[],
  ) => {
    const next = { ...selectionsRef.current };
    if (operationIds.length === 0) {
      delete next[itemId];
    } else {
      next[itemId] = { operationKey, operationIds };
    }
    selectionsRef.current = next;
    setSelections(next);
    input.onSelectionsChange(Object.values(next));
  };

  const applySelected = () => {
    if (!input.serverState || input.serverState.draftRevision === undefined) {
      return;
    }
    const entries = Object.entries(selectionsRef.current);
    if (entries.length === 0) return;
    setApplyError(null);
    const payload = entries.map(([itemId, entry]) => ({
      itemId,
      operationIds: [...entry.operationIds].sort(),
    }));
    // Stable key for one selection set: a repeat returns the committed result.
    const applyKey = (
      "st-" +
      payload
        .map((entry) => `${entry.itemId}:${entry.operationIds.join("+")}`)
        .sort()
        .join("|")
    ).slice(0, 128);
    apply.mutate(
      {
        runId: input.runId,
        selections: payload,
        expectedConfigRevision: input.serverState.configRevision,
        expectedDraftRevision: input.serverState.draftRevision,
        applyKey,
      },
      {
        onSuccess: () => {
          selectionsRef.current = {};
          setSelections({});
        },
        onError: (error) => {
          // Stale conflicts keep the recommendations visible for a new run.
          setApplyError(resolveErrorMessage(error, t));
        },
      },
    );
  };

  const selectedCount = Object.keys(selections).length;

  return (
    <div className="space-y-4">
      {input.mode === "import" ? (
        <p className="text-sm text-muted-foreground">
          {t.servers.aiOptimizer.import.reviewHint}
        </p>
      ) : null}
      {shownItems.data && shownItems.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t.servers.aiOptimizer.review.empty}
        </p>
      ) : null}
      {shownItems.data?.items.map((item) => (
        <ItemCard
          key={item.id}
          runId={input.runId}
          itemId={item.id}
          mode={input.mode}
          selection={selections[item.id]}
          onSelectionChange={updateSelection}
        />
      ))}
      {shownItems.data &&
      shownItems.data.total > shownItems.data.items.length ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => current + 1)}
          >
            {t.servers.aiOptimizer.review.loadMore}
          </Button>
        </div>
      ) : null}
      {shownItems.data &&
      shownItems.data.items.some((item) => item.state === "failed") ? (
        <Alert>
          <AlertDescription>
            {t.servers.aiOptimizer.review.partialFailures}
          </AlertDescription>
        </Alert>
      ) : null}
      {applyError ? (
        <Alert variant="destructive">
          <AlertDescription>{applyError}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        {input.mode === "draft" && selectedCount > 0 ? (
          <Button onClick={applySelected} disabled={apply.isPending}>
            {apply.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {t.servers.aiOptimizer.review.applySelected.replace(
              "{count}",
              String(selectedCount),
            )}
          </Button>
        ) : null}
        <Button variant="outline" onClick={input.onDone}>
          {t.servers.aiOptimizer.review.close}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ItemCard(input: {
  runId: string;
  itemId: string;
  mode: "draft" | "import";
  selection?: ItemSelectionEntry;
  onSelectionChange: (
    itemId: string,
    operationKey: string,
    operationIds: string[],
  ) => void;
}) {
  const { t } = useTranslations();
  const copy = t.servers.aiOptimizer;
  const item = useOptimizerItem(input.runId, input.itemId);

  const detail: OptimizerItemDetail | undefined = item.data;
  const executable = detail?.review.operations ?? [];
  const advisory = detail?.review.advisories ?? [];
  const rejected = detail?.review.rejected ?? [];
  const state = detail?.state ?? "queued";
  const selected = input.selection?.operationIds ?? [];

  const operationKey =
    detail?.ref.kind === "openapi_candidate"
      ? detail.ref.operationKey
      : input.itemId;

  const setSelected = (operationIds: string[]) => {
    input.onSelectionChange(input.itemId, operationKey, operationIds);
  };

  const stateLabel = () => {
    switch (state) {
      case "recommended":
        return copy.review.states.recommended;
      case "no_change":
        return copy.review.states.noChange;
      case "failed":
        return copy.review.states.failed;
      case "applied":
        return copy.review.states.applied;
      case "cancelled":
        return copy.review.states.cancelled;
      default:
        return null;
    }
  };
  const label = stateLabel();

  if (!detail) {
    // Known-layout loading state; never flash the raw internal id.
    return (
      <div className="space-y-2 rounded-md border border-border p-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }
  if (state === "no_change" || state === "failed" || state === "cancelled") {
    const failureKey = detail.failureCode ?? "";
    const failureCopy =
      (copy.itemFailure as Record<string, string | undefined>)[failureKey] ??
      copy.review.failureCode;
    return (
      <div className="rounded-md border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{detail.name}</span>
          {label ? <Badge variant="secondary">{label}</Badge> : null}
        </div>
        {detail.state === "failed" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {failureCopy.includes("{code}")
              ? failureCopy.replace("{code}", failureKey)
              : failureCopy}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{detail.name}</span>
        {label ? <Badge variant="secondary">{label}</Badge> : null}
      </div>

      {state === "recommended" && executable.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              {copy.review.operationsTitle}
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setSelected(
                  selected.length === executable.length
                    ? []
                    : executable.map((op) => op.operationId),
                )
              }
            >
              {selected.length === executable.length
                ? copy.review.clearAll
                : copy.review.selectAllSafe}
            </Button>
          </div>
          {executable.map((op) => (
            <div
              key={op.operationId}
              className="space-y-1 rounded-md border border-border p-2"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`op-${input.itemId}-${op.operationId}`}
                  className="h-4 w-4 accent-primary"
                  checked={selected.includes(op.operationId)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, op.operationId]
                        : selected.filter((id) => id !== op.operationId),
                    )
                  }
                />
                <Label
                  htmlFor={`op-${input.itemId}-${op.operationId}`}
                  className="text-sm"
                >
                  {copy.review.fields[
                    op.kind as keyof typeof copy.review.fields
                  ] ?? op.targetLabel}
                  {op.targetLabel === "tool" ? "" : ` ${op.targetLabel}`}
                </Label>
                {op.class === "guarded" ? (
                  <Badge variant="outline">{copy.review.guarded}</Badge>
                ) : null}
              </div>
              <p className="pl-6 text-sm">
                {op.before ? (
                  <span className="text-muted-foreground line-through">
                    {op.before}
                  </span>
                ) : null}
                {op.before ? (
                  <span className="px-2 text-muted-foreground">→</span>
                ) : null}
                <span className="font-medium">{op.after}</span>
              </p>
              {op.requestDiff?.map((line) => (
                <p
                  key={`${op.operationId}-${line.label}`}
                  className="pl-6 font-mono text-xs"
                >
                  {line.label}: {line.before} → {line.after}
                </p>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {advisory.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {copy.review.advisoriesTitle}
          </p>
          {advisory.map((entry) => (
            <p key={entry.advisoryId} className="text-xs text-muted-foreground">
              {copy.advisory[entry.code]}: {entry.rationale}
            </p>
          ))}
        </div>
      ) : null}

      {rejected.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            {copy.review.rejectedTitle}
          </p>
          {rejected.map((entry) => (
            <p
              key={entry.operationId}
              className="text-xs text-muted-foreground"
            >
              {copy.rejectedCodes[entry.code]}: {entry.detail}
            </p>
          ))}
        </div>
      ) : null}

      {state === "recommended" &&
      selected.length > 0 &&
      input.mode === "import" ? (
        <p className="text-right text-xs text-muted-foreground">
          {copy.import.applyWithImport}
        </p>
      ) : null}
      {state === "applied" ? (
        <p className="text-xs text-muted-foreground">
          {copy.review.savedToDraft}
        </p>
      ) : null}
    </div>
  );
}
