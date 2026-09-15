import { useCreateMcpToolFromCurl, useParseCurlPreview } from "@/hooks/use-mcp";
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
  Switch,
  Textarea,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

type MarkableValue = {
  value: string;
  location: "path" | "query" | "header" | "body";
  key: string | null;
};

type MarkingState = {
  as: "literal" | "param" | "variable";
  name: string;
  isSecret: boolean;
};

// Mirrors the API patterns in mcp-studio-service.ts; variables are stricter.
const PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function suggestName(markable: MarkableValue, index: number): string {
  const source = markable.key ?? markable.value;
  const cleaned = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "p_$1");
  return cleaned.length > 0 ? cleaned.slice(0, 40) : `param_${index + 1}`;
}

function truncate(value: string, length = 48): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

/** Two-phase curl import: paste → preview with per-value markings → create. */
export function CurlImportDialog({
  serverId,
  onClose,
}: {
  serverId: string;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const parsePreview = useParseCurlPreview();
  const createFromCurl = useCreateMcpToolFromCurl();
  const [curl, setCurl] = useState("");
  const [markings, setMarkings] = useState<Record<number, MarkingState>>({});
  const [authMarking, setAuthMarking] = useState<{
    name: string;
    isSecret: boolean;
  } | null>(null);
  const [report, setReport] = useState<{
    variables: number;
    params: number;
    existingAuthKept: boolean;
  } | null>(null);

  const preview = parsePreview.data ?? null;

  const markingFor = (markable: MarkableValue, index: number): MarkingState =>
    markings[index] ?? {
      as: "literal",
      name: suggestName(markable, index),
      isSecret: false,
    };

  const setMarking = (index: number, patch: Partial<MarkingState>) => {
    const markable = preview?.values[index];
    if (!markable) return;
    const current = markingFor(markable, index);
    setMarkings((prev) => ({
      ...prev,
      [index]: { ...current, ...patch },
    }));
  };

  const activeMarkings = Object.entries(markings)
    .map(([index, marking]) => ({
      index: Number(index),
      marking,
      value: preview?.values[Number(index)]?.value ?? "",
    }))
    .filter((entry) => entry.marking.as !== "literal" && entry.value);

  const invalidMarking =
    activeMarkings.some((entry) => {
      const pattern =
        entry.marking.as === "variable"
          ? VARIABLE_NAME_PATTERN
          : PARAM_NAME_PATTERN;
      return !pattern.test(entry.marking.name);
    }) ||
    (authMarking !== null && !VARIABLE_NAME_PATTERN.test(authMarking.name));

  const confirm = () => {
    if (!preview) return;
    const authMarkings =
      preview.auth && authMarking
        ? [
            {
              value: preview.auth.value,
              as: "variable" as const,
              name: authMarking.name,
              isSecret: authMarking.isSecret,
            },
          ]
        : [];
    createFromCurl.mutate(
      {
        serverId,
        curl,
        markings: [
          ...authMarkings,
          ...activeMarkings.map((entry) => ({
            value: entry.value,
            as: entry.marking.as as "param" | "variable",
            name: entry.marking.name,
            ...(entry.marking.as === "variable"
              ? { isSecret: entry.marking.isSecret }
              : {}),
          })),
        ],
      },
      {
        onSuccess: (result) => {
          setReport({
            variables: result.capturedVariables.length,
            params: result.capturedParams.length,
            existingAuthKept: result.existingAuthKept,
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
                {report.existingAuthKept
                  ? t.servers.existingAuthKept
                  : t.servers.captureReport
                      .replace("{variables}", String(report.variables))
                      .replace("{params}", String(report.params))}
              </AlertDescription>
            </Alert>
            <DialogFooter>
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
              parsePreview.mutate(
                { serverId, curl },
                {
                  onSuccess: (result) => {
                    setAuthMarking(
                      result.auth
                        ? {
                            name: result.auth.variableName,
                            isSecret: true,
                          }
                        : null,
                    );
                  },
                },
              );
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
                {preview.pathTemplate}
              </code>
            </div>

            {preview.auth && authMarking ? (
              <Alert>
                <AlertDescription className="space-y-3">
                  <p>{t.servers.authPreMarked}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-xs">
                      {preview.auth.headerName}
                    </Badge>
                    <Input
                      value={authMarking.name}
                      onChange={(event) =>
                        setAuthMarking({
                          ...authMarking,
                          name: event.target.value,
                        })
                      }
                      placeholder={t.servers.markingNamePlaceholder}
                      aria-label={t.servers.markingName}
                      autoComplete="off"
                      spellCheck={false}
                      className="w-44 font-mono text-xs"
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={authMarking.isSecret}
                        onCheckedChange={(isSecret) =>
                          setAuthMarking({ ...authMarking, isSecret })
                        }
                      />
                      {t.servers.markSecret}
                    </label>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <ul className="space-y-2">
              {preview.values.map((markable, index) => {
                const marking = markingFor(markable, index);
                return (
                  <li
                    key={`${markable.location}-${markable.key ?? index}`}
                    className="space-y-2 rounded-md border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {t.servers.locations[markable.location]}
                        {markable.key ? ` · ${markable.key}` : ""}
                      </Badge>
                      <code className="break-all font-mono text-xs">
                        {truncate(markable.value)}
                      </code>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={marking.as}
                        onValueChange={(as) =>
                          setMarking(index, {
                            as: as as MarkingState["as"],
                          })
                        }
                      >
                        <SelectTrigger
                          className="w-36"
                          aria-label={t.servers.markingAs}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="literal">
                            {t.servers.markAsLiteral}
                          </SelectItem>
                          <SelectItem value="param">
                            {t.servers.markAsParam}
                          </SelectItem>
                          <SelectItem value="variable">
                            {t.servers.markAsVariable}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {marking.as !== "literal" ? (
                        <>
                          <Input
                            value={marking.name}
                            onChange={(event) =>
                              setMarking(index, {
                                name: event.target.value,
                              })
                            }
                            placeholder={t.servers.markingNamePlaceholder}
                            aria-label={t.servers.markingName}
                            autoComplete="off"
                            spellCheck={false}
                            className="w-40 font-mono text-xs"
                          />
                          {marking.as === "variable" ? (
                            <label className="flex items-center gap-2 text-sm">
                              <Switch
                                checked={marking.isSecret}
                                onCheckedChange={(isSecret) =>
                                  setMarking(index, { isSecret })
                                }
                              />
                              {t.servers.markSecret}
                            </label>
                          ) : null}
                        </>
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

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={createFromCurl.isPending}
                onClick={() => {
                  parsePreview.reset();
                  setMarkings({});
                  setAuthMarking(null);
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
