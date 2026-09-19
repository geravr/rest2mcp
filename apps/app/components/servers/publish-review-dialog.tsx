import { SettingsFormSkeleton } from "@/components/loading";
import {
  STALE_PUBLISH_CODES,
  usePublishPreview,
  usePublishServer,
} from "@/hooks/use-mcp";
import type { UI } from "@/i18n";
import { useTranslations } from "@/i18n/use-translations";
import { getAppCode, resolveErrorMessage } from "@/lib/errors";
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
  Switch,
  Textarea,
} from "@repo/ui";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";

const FINGERPRINT_LENGTH = 12;
const NOTE_MAX_LENGTH = 500;

const WARNING_MESSAGE_KEYS = [
  "contract_changed",
  "tool_added",
  "tool_removed",
  "tool_disabled",
  "destructive_change",
  "auth_changed",
  "config_changed",
] as const;

type WarningCodeKey = (typeof WARNING_MESSAGE_KEYS)[number];

function warningText(
  warning: { code: string; message: string },
  t: UI,
): string {
  const warnings = t.servers.publishWarnings;
  if ((WARNING_MESSAGE_KEYS as readonly string[]).includes(warning.code)) {
    return warnings[warning.code as WarningCodeKey];
  }
  return t.servers.publishIssueFallback.replace("{code}", warning.code);
}

function errorText(issue: { code: string; message: string }, t: UI): string {
  const codes = t.errors.codes as Record<string, string>;
  const known = codes[issue.code];
  if (known) return known;
  return t.servers.publishIssueFallback.replace("{code}", issue.code);
}

function createPublishRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pub_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function DiffGroup({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <li className="text-sm">
      <span className="font-medium">{label}</span>
      {": "}
      <span className="text-muted-foreground">{values.join(", ")}</span>
    </li>
  );
}

/**
 * Publish review flow: readiness, blocking errors, warnings that require
 * explicit acknowledgement, the safe structural diff, and the candidate
 * fingerprint bound to the publication command.
 */
export function PublishReviewDialog({
  serverId,
  onClose,
}: {
  serverId: string;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const preview = usePublishPreview(serverId);
  const publish = usePublishServer();
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [note, setNote] = useState("");
  const [publishedRevision, setPublishedRevision] = useState<number | null>(
    null,
  );
  const requestIdRef = useRef<{ fingerprint: string; id: string } | null>(null);

  const data = preview.data;
  const candidateFingerprint = data?.candidateFingerprint;
  const [acknowledgedFor, setAcknowledgedFor] = useState(candidateFingerprint);

  // Warning acknowledgements are bound to the exact candidate fingerprint.
  // Adjust during render (React's guarded reset) so a changed candidate clears
  // stale approvals without an effect and without discarding the note.
  if (acknowledgedFor !== candidateFingerprint) {
    setAcknowledgedFor(candidateFingerprint);
    setAcknowledged(new Set());
  }

  const conflictCode = getAppCode(publish.error);
  const hasStaleConflict =
    conflictCode !== undefined && STALE_PUBLISH_CODES.has(conflictCode);

  const allWarningsAcknowledged =
    data?.warningCodes.every((code) => acknowledged.has(code)) ?? false;
  const canPublish = Boolean(
    data &&
    data.ready &&
    data.dirty &&
    allWarningsAcknowledged &&
    !publish.isPending,
  );

  const toggleAcknowledged = (code: string, checked: boolean) => {
    setAcknowledged((prev) => {
      const next = new Set(prev);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  };

  const submit = () => {
    if (!data || !canPublish) return;
    // Reuse one idempotency key across retries of the same candidate so a
    // lost response returns the committed revision instead of republishing.
    if (requestIdRef.current?.fingerprint !== data.candidateFingerprint) {
      requestIdRef.current = {
        fingerprint: data.candidateFingerprint,
        id: createPublishRequestId(),
      };
    }
    publish.mutate(
      {
        serverId,
        expectedDraftRevision: data.draftRevision,
        expectedPublishedRevisionId: data.publishedRevisionId,
        publishRequestId: requestIdRef.current.id,
        candidateFingerprint: data.candidateFingerprint,
        acknowledgedWarningCodes: [...data.warningCodes],
        note: note.trim().length > 0 ? note.trim() : undefined,
      },
      {
        onSuccess: (result) => setPublishedRevision(result.revisionNumber),
      },
    );
  };

  if (publishedRevision !== null) {
    return (
      <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.servers.publishSuccessTitle}</DialogTitle>
            <DialogDescription>
              {t.servers.publishSuccessDescription.replace(
                "{number}",
                String(publishedRevision),
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              {t.servers.publishSuccessDone}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.servers.publishTitle}</DialogTitle>
          <DialogDescription>{t.servers.publishDescription}</DialogDescription>
        </DialogHeader>

        {preview.isLoading && !data ? (
          <SettingsFormSkeleton cards={1} fields={2} />
        ) : preview.isError ? (
          <p className="text-sm text-destructive">
            {resolveErrorMessage(preview.error, t)}
          </p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">
            {t.servers.publishUnavailable}
          </p>
        ) : (
          <div className="space-y-4">
            {hasStaleConflict ? (
              <Alert variant="destructive">
                <AlertDescription className="space-y-2">
                  <p>{t.servers.publishStale}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void preview.refetch()}
                  >
                    {t.servers.publishRefresh}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 text-sm">
              {data.publishedRevisionNumber === null ? (
                <Badge variant="secondary">
                  {t.servers.unpublishedRevision}
                </Badge>
              ) : (
                <Badge variant="outline">
                  {t.servers.publishedRevision.replace(
                    "{number}",
                    String(data.publishedRevisionNumber),
                  )}
                </Badge>
              )}
              <Badge variant={data.ready ? "default" : "destructive"}>
                {data.ready ? t.servers.publishReady : t.servers.publishBlocked}
              </Badge>
              {!data.dirty ? (
                <Badge variant="secondary">{t.servers.publishNoChanges}</Badge>
              ) : null}
            </div>

            {data.errors.length > 0 ? (
              <Alert variant="destructive">
                <AlertDescription className="space-y-2">
                  <p className="font-medium">
                    {t.servers.publishBlockingErrors}
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {data.errors.map((issue) => (
                      <li
                        key={`${issue.code}-${issue.toolName ?? ""}-${issue.message}`}
                        className="text-sm"
                      >
                        <span>{errorText(issue, t)}</span>
                        {issue.toolName ? (
                          <>
                            {" "}
                            <Link
                              to="/servers/$serverId"
                              params={{ serverId }}
                              search={{ tab: "tools" }}
                              className="underline"
                            >
                              {issue.toolName}
                            </Link>
                          </>
                        ) : null}
                        {issue.path ? (
                          <span className="ml-1 font-mono text-xs text-muted-foreground">
                            {issue.path}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {data.warnings.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t.servers.publishWarningsTitle}
                </p>
                <ul className="space-y-2">
                  {data.warnings.map((warning) => {
                    const switchId = `publish-warning-${warning.code}`;
                    return (
                      <li
                        key={warning.code}
                        className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                      >
                        <div className="space-y-1">
                          <Label htmlFor={switchId} className="text-sm">
                            {warningText(warning, t)}
                          </Label>
                          {warning.toolName ? (
                            <p className="text-xs text-muted-foreground">
                              {warning.toolName}
                            </p>
                          ) : null}
                        </div>
                        <Switch
                          id={switchId}
                          checked={acknowledged.has(warning.code)}
                          onCheckedChange={(checked) =>
                            toggleAcknowledged(warning.code, checked)
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t.servers.publishDiffTitle}
              </p>
              {!data.diff.changed ? (
                <p className="text-sm text-muted-foreground">
                  {t.servers.publishNoChanges}
                </p>
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  <DiffGroup
                    label={t.servers.publishDiffServer}
                    values={data.diff.serverChanged}
                  />
                  {data.diff.authChanged ? (
                    <li className="text-sm">{t.servers.publishDiffAuth}</li>
                  ) : null}
                  {data.diff.commonChanged ? (
                    <li className="text-sm">{t.servers.publishDiffCommon}</li>
                  ) : null}
                  <DiffGroup
                    label={t.servers.publishDiffToolsAdded}
                    values={data.diff.toolsAdded}
                  />
                  <DiffGroup
                    label={t.servers.publishDiffToolsRemoved}
                    values={data.diff.toolsRemoved}
                  />
                  <DiffGroup
                    label={t.servers.publishDiffToolsChanged}
                    values={data.diff.toolsChanged}
                  />
                  <DiffGroup
                    label={t.servers.publishDiffToolsEnabled}
                    values={data.diff.toolsEnabled}
                  />
                  <DiffGroup
                    label={t.servers.publishDiffToolsDisabled}
                    values={data.diff.toolsDisabled}
                  />
                  {data.diff.configChanged ? (
                    <li className="text-sm">{t.servers.publishDiffConfig}</li>
                  ) : null}
                  {data.diff.contractChanged ? (
                    <li className="text-sm">{t.servers.publishDiffContract}</li>
                  ) : null}
                  {data.diff.destructive ? (
                    <li className="text-sm text-destructive">
                      {t.servers.publishDiffDestructive}
                    </li>
                  ) : null}
                </ul>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t.servers.publishFingerprint.replace(
                  "{fingerprint}",
                  data.candidateFingerprint.slice(0, FINGERPRINT_LENGTH),
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="publish-note" className="text-sm">
                {t.servers.publishNoteLabel}
              </Label>
              <Textarea
                id="publish-note"
                value={note}
                maxLength={NOTE_MAX_LENGTH}
                rows={2}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t.servers.publishNotePlaceholder}
              />
            </div>

            {data.warnings.length > 0 && !allWarningsAcknowledged ? (
              <p className="text-sm text-muted-foreground">
                {t.servers.publishAckRemaining}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.servers.cancel}
          </Button>
          <Button type="button" disabled={!canPublish} onClick={submit}>
            {publish.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {publish.isPending
              ? t.servers.publishingChanges
              : t.servers.publishChanges}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
