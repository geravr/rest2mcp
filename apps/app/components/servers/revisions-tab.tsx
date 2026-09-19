import { SettingsFormSkeleton, TableRowsSkeleton } from "@/components/loading";
import { AdminListPagination } from "@/components/admin-list";
import {
  useRestoreRevision,
  useRevisionDetail,
  useRevisionHistory,
} from "@/hooks/use-mcp";
import type { UI } from "@/i18n";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import type { PageSize } from "@repo/core";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

const FINGERPRINT_LENGTH = 12;

function actorLabel(actorSource: string, t: UI): string {
  if (actorSource === "studio") return t.servers.revisionActorStudio;
  if (actorSource === "platform") return t.servers.revisionActorPlatform;
  return actorSource;
}

function RevisionDetailDialog({
  serverId,
  revisionId,
  expectedConfigRevision,
  expectedDraftRevision,
  onClose,
}: {
  serverId: string;
  revisionId: string;
  expectedConfigRevision: number;
  expectedDraftRevision: number;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const detail = useRevisionDetail(serverId, revisionId);
  const restore = useRestoreRevision();
  const [confirming, setConfirming] = useState(false);

  const data = detail.data;

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {data
              ? t.servers.revisionTitle.replace(
                  "{number}",
                  String(data.revisionNumber),
                )
              : t.servers.revisionDetailTitle}
          </DialogTitle>
          <DialogDescription>
            {t.servers.revisionDetailDescription}
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading && !data ? (
          <SettingsFormSkeleton cards={1} fields={2} />
        ) : detail.isError ? (
          <p className="text-sm text-destructive">
            {resolveErrorMessage(detail.error, t)}
          </p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">
            {t.servers.revisionNotFound}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {data.isActive ? (
                <Badge variant="default">{t.servers.revisionActive}</Badge>
              ) : null}
              <span className="text-sm text-muted-foreground">
                {actorLabel(data.actorSource, t)} ·{" "}
                {new Date(data.createdAt).toLocaleString()}
              </span>
            </div>

            {data.note ? (
              <p className="text-sm text-muted-foreground">{data.note}</p>
            ) : null}

            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {t.servers.revisionCandidateFingerprint.replace(
                  "{fingerprint}",
                  data.candidateFingerprint.slice(0, FINGERPRINT_LENGTH),
                )}
              </p>
              <p>
                {t.servers.revisionContractFingerprint.replace(
                  "{fingerprint}",
                  data.contractFingerprint.slice(0, FINGERPRINT_LENGTH),
                )}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t.servers.revisionToolsTitle}
              </p>
              {data.tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.servers.revisionNoTools}
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {data.tools.map((tool) => (
                    <li
                      key={tool.sourceToolId}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium">{tool.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {tool.method}
                          {tool.compileIssueCount > 0
                            ? ` · ${t.servers.revisionIssueCount.replace(
                                "{count}",
                                String(tool.compileIssueCount),
                              )}`
                            : null}
                        </p>
                      </div>
                      <Badge variant={tool.enabled ? "outline" : "secondary"}>
                        {tool.enabled
                          ? t.servers.enabled
                          : t.servers.revisionDisabled}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t.servers.revisionConfigTitle}
              </p>
              {data.configs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.servers.revisionNoConfig}
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {data.configs.map((config) => (
                    <li
                      key={config.sourceValueId}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="text-sm">{config.name}</span>
                      <div className="flex items-center gap-2">
                        {config.kind === "secret" ? (
                          <Badge variant="secondary">
                            {t.servers.variableSecretBadge}
                          </Badge>
                        ) : null}
                        {config.kind === "secret" && !config.available ? (
                          <Badge variant="destructive">
                            {t.servers.revisionSecretUnavailable}
                          </Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {config.hasValue
                            ? t.servers.variableHasValue
                            : t.servers.variableNoValue}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {data.missingSecretCount > 0 ? (
              <Alert>
                <AlertDescription>
                  {t.servers.revisionMissingSecrets} ({data.missingSecretCount})
                </AlertDescription>
              </Alert>
            ) : null}

            {confirming ? (
              <Alert>
                <AlertDescription className="space-y-3">
                  <p>{t.servers.restoreConfirmDescription}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={restore.isPending}
                      onClick={() => setConfirming(false)}
                    >
                      {t.servers.cancel}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={restore.isPending}
                      onClick={() =>
                        restore.mutate(
                          {
                            serverId,
                            revisionId,
                            expectedRevision: expectedConfigRevision,
                            expectedDraftRevision,
                          },
                          { onSuccess: () => onClose() },
                        )
                      }
                    >
                      {restore.isPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : null}
                      {restore.isPending
                        ? t.servers.restoring
                        : t.servers.restoreConfirm}
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(true)}
              >
                {t.servers.restoreToDraft}
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.servers.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ServerRevisionsTab({
  serverId,
  draftRevision,
  configRevision,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  serverId: string;
  draftRevision: number;
  configRevision: number;
  page: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
}) {
  const { t } = useTranslations();
  const { data, isLoading, isError, error } = useRevisionHistory(serverId, {
    page,
    pageSize,
  });
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(
    null,
  );

  if (isLoading && !data) {
    return <TableRowsSkeleton />;
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {resolveErrorMessage(error, t)}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {!data || data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.servers.noRevisions}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.servers.revisionNumber}</TableHead>
              <TableHead>{t.servers.source}</TableHead>
              <TableHead>{t.servers.created}</TableHead>
              <TableHead>{t.servers.revisionNote}</TableHead>
              <TableHead className="w-24">
                <span className="sr-only">{t.servers.viewLog}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((revision) => (
              <TableRow
                key={revision.id}
                className="cursor-pointer"
                onClick={() => setSelectedRevisionId(revision.id)}
              >
                <TableCell className="font-medium">
                  #{revision.revisionNumber}
                </TableCell>
                <TableCell>{actorLabel(revision.actorSource, t)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(revision.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="max-w-xs truncate">
                  {revision.note ?? "—"}
                </TableCell>
                <TableCell>
                  {revision.isActive ? (
                    <Badge variant="default">{t.servers.revisionActive}</Badge>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data ? (
        <AdminListPagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          itemCount={data.items.length}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      ) : null}

      {selectedRevisionId ? (
        <RevisionDetailDialog
          serverId={serverId}
          revisionId={selectedRevisionId}
          expectedConfigRevision={configRevision}
          expectedDraftRevision={draftRevision}
          onClose={() => setSelectedRevisionId(null)}
        />
      ) : null}
    </div>
  );
}
