import {
  useCreateMcpToolFromCurl,
  useParseCurlPreview,
  type McpToolGroupSummary,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
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
  Field,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@repo/ui";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

type CurlOccurrence = {
  occurrenceId: string;
  location: "path" | "query" | "header" | "form" | "json";
  key?: string;
  jsonPath?: string;
  value: string;
};

type MarkingState = {
  as: "literal" | "agentInput";
  name: string;
};

// Mirrors mcpValueNameSchema on the API: [a-z][a-z0-9_]*.
const AGENT_INPUT_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Radix Select cannot use an empty value for the ungrouped choice. */
const UNGROUPED_GROUP = "ungrouped";

/**
 * The selector only offers listed groups, so an id missing from the loaded list
 * (deleted, or not loaded yet) resolves to ungrouped for the displayed selection
 * and for the submitted payload alike.
 */
function resolveGroupSelection(
  candidate: string | null | undefined,
  groups: McpToolGroupSummary[],
): string {
  return candidate && groups.some((group) => group.id === candidate)
    ? candidate
    : UNGROUPED_GROUP;
}

function suggestName(occurrence: CurlOccurrence, index: number): string {
  const source = occurrence.jsonPath ?? occurrence.key ?? occurrence.value;
  const cleaned = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "p_$1");
  return cleaned.length > 0 ? cleaned.slice(0, 40) : `input_${index + 1}`;
}

function truncate(value: string, length = 48): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

/**
 * Two-phase safe curl import: paste → preview with per-occurrence markings →
 * confirm. The backend never returns a detected credential's value, never
 * creates or rotates server values/authentication here, and always creates
 * exactly one disabled draft tool.
 */
export function CurlImportDialog({
  serverId,
  configRevision = 1,
  groups = [],
  initialGroupId,
  onClose,
}: {
  serverId: string;
  configRevision?: number;
  /** Server groups already fetched by the parent; this dialog never queries them. */
  groups?: McpToolGroupSummary[];
  /** Active Studio group filter, used only to preselect the imported tool's group. */
  initialGroupId?: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const parsePreview = useParseCurlPreview();
  const createFromCurl = useCreateMcpToolFromCurl();
  const [curl, setCurl] = useState("");
  const [markings, setMarkings] = useState<Record<string, MarkingState>>({});
  /**
   * `null` until the owner picks a group, so the effective selection keeps
   * following `initialGroupId` while the parent's group query resolves. An owner
   * choice is never overwritten by a later prop.
   */
  const [groupChoice, setGroupChoice] = useState<string | null>(null);
  const [report, setReport] = useState<{
    excludedCredentials: number;
    issues: number;
  } | null>(null);

  const showGroupSelect = groups.length > 0 || initialGroupId !== undefined;
  // Derived on every render from the owner's choice first, then the props, so a
  // group list or an initialGroupId that arrives after the first render still
  // decides the displayed selection and the submitted payload alike.
  const resolvedGroupSelection = resolveGroupSelection(
    groupChoice ?? initialGroupId ?? UNGROUPED_GROUP,
    groups,
  );

  const preview = parsePreview.data ?? null;
  const occurrences = (preview?.occurrences ?? []) as CurlOccurrence[];

  const markingFor = (
    occurrence: CurlOccurrence,
    index: number,
  ): MarkingState =>
    markings[occurrence.occurrenceId] ?? {
      as: "literal",
      name: suggestName(occurrence, index),
    };

  const setMarking = (occurrenceId: string, patch: Partial<MarkingState>) => {
    const occurrence = occurrences.find((o) => o.occurrenceId === occurrenceId);
    const index = occurrences.findIndex((o) => o.occurrenceId === occurrenceId);
    if (!occurrence) return;
    const current = markingFor(occurrence, index);
    setMarkings((prev) => ({
      ...prev,
      [occurrenceId]: { ...current, ...patch },
    }));
  };

  const activeMarkings = Object.entries(markings)
    .map(([occurrenceId, marking]) => ({
      occurrenceId,
      marking,
      occurrence: occurrences.find((o) => o.occurrenceId === occurrenceId),
    }))
    .filter(
      (entry) =>
        entry.marking.as !== "literal" && entry.occurrence !== undefined,
    );

  const invalidMarking = activeMarkings.some(
    (entry) => !AGENT_INPUT_NAME_PATTERN.test(entry.marking.name),
  );

  const confirm = () => {
    if (!preview) return;
    createFromCurl.mutate(
      {
        serverId,
        expectedRevision: configRevision,
        curl,
        groupId:
          resolvedGroupSelection === UNGROUPED_GROUP
            ? null
            : resolvedGroupSelection,
        markings: activeMarkings.map((entry) => ({
          location: entry.occurrence!.location,
          key: entry.occurrence!.key,
          jsonPath: entry.occurrence!.jsonPath,
          occurrenceId: entry.occurrenceId,
          as: "agentInput" as const,
          agentInput: {
            id: entry.marking.name,
            name: entry.marking.name,
            required: true,
            sensitive: false,
            type: "string" as const,
          },
        })),
      },
      {
        onSuccess: (result) => {
          setReport({
            excludedCredentials: result.excludedCredentials.length,
            issues: result.issues.length,
          });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.servers.importCurl}</DialogTitle>
          <DialogDescription>
            {preview
              ? t.servers.curlPreviewDescription
              : t.servers.curlPlaceholder}
          </DialogDescription>
        </DialogHeader>

        {report ? (
          <>
            <Alert>
              <AlertDescription>
                {t.servers.curlImportSummary.replace(
                  "{issues}",
                  String(report.issues),
                )}
              </AlertDescription>
            </Alert>
            {report.excludedCredentials > 0 ? (
              <Alert>
                <AlertDescription>
                  {t.servers.curlImportCredentialsCta}
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              {report.excludedCredentials > 0 ? (
                <Button asChild variant="outline">
                  <Link
                    to="/servers/$serverId"
                    params={{ serverId }}
                    search={{ tab: "settings" }}
                    onClick={onClose}
                  >
                    {t.servers.curlGoToAuth}
                  </Link>
                </Button>
              ) : null}
              <Button type="button" onClick={onClose}>
                {t.servers.cancel}
              </Button>
            </DialogFooter>
          </>
        ) : !preview ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              parsePreview.mutate({ serverId, curl });
            }}
          >
            <Field>
              <Label htmlFor="curl-import-input">{t.servers.curlLabel}</Label>
              <Textarea
                id="curl-import-input"
                value={curl}
                onChange={(event) => setCurl(event.target.value)}
                placeholder={t.servers.curlPlaceholder}
                rows={5}
                spellCheck={false}
                className="font-mono text-xs"
                required
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t.servers.cancel}
              </Button>
              <Button
                type="submit"
                disabled={parsePreview.isPending || !curl.trim()}
              >
                {parsePreview.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {parsePreview.isPending
                  ? t.servers.curlParsing
                  : t.servers.curlParse}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{preview.method}</Badge>
              <code className="break-all font-mono text-xs">
                {preview.relativePath}
              </code>
            </div>

            {preview.excludedCredentials.length > 0 ? (
              <Alert>
                <AlertDescription className="space-y-2">
                  {preview.excludedCredentials.map((credential) => (
                    <p key={`${credential.kind}-${credential.headerName}`}>
                      {t.servers.credentialExcluded
                        .replace("{kind}", credential.kind)
                        .replace("{header}", credential.headerName)}
                    </p>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}

            <ul className="space-y-2">
              {occurrences.map((occurrence, index) => {
                const marking = markingFor(occurrence, index);
                return (
                  <li
                    key={occurrence.occurrenceId}
                    className="space-y-2 rounded-md border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {t.servers.locations[occurrence.location]}
                        {occurrence.key
                          ? ` · ${occurrence.key}`
                          : occurrence.jsonPath
                            ? ` · ${occurrence.jsonPath}`
                            : ""}
                      </Badge>
                      <code className="break-all font-mono text-xs">
                        {truncate(occurrence.value)}
                      </code>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={marking.as}
                        onValueChange={(as) =>
                          setMarking(occurrence.occurrenceId, {
                            as: as as MarkingState["as"],
                          })
                        }
                      >
                        <SelectTrigger
                          className="w-40"
                          aria-label={t.servers.markingAs}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="literal">
                            {t.servers.markAsLiteral}
                          </SelectItem>
                          <SelectItem value="agentInput">
                            {t.servers.markAsParam}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {marking.as === "agentInput" ? (
                        <Input
                          value={marking.name}
                          onChange={(event) =>
                            setMarking(occurrence.occurrenceId, {
                              name: event.target.value,
                            })
                          }
                          placeholder={t.servers.markingNamePlaceholder}
                          aria-label={t.servers.markingName}
                          autoComplete="off"
                          spellCheck={false}
                          className="w-40 font-mono text-xs"
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>

            {invalidMarking ? (
              <p className="text-xs text-destructive">
                {t.servers.invalidMarkingName}
              </p>
            ) : null}

            {showGroupSelect ? (
              <Field>
                <Label htmlFor="curl-import-group">
                  {t.servers.groups.moveTarget}
                </Label>
                <Select
                  value={resolvedGroupSelection}
                  onValueChange={setGroupChoice}
                >
                  <SelectTrigger id="curl-import-group">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNGROUPED_GROUP}>
                      {t.servers.groups.ungrouped}
                    </SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={createFromCurl.isPending}
                onClick={() => {
                  parsePreview.reset();
                  setMarkings({});
                }}
              >
                {t.servers.curlBack}
              </Button>{" "}
              <Button
                type="button"
                disabled={createFromCurl.isPending || invalidMarking}
                onClick={confirm}
              >
                {createFromCurl.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                {createFromCurl.isPending
                  ? t.servers.savingTool
                  : t.servers.curlCreate}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
