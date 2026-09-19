import {
  useCreateMcpToolGroup,
  useDeleteMcpToolGroup,
  useRenameMcpToolGroup,
  type McpToolGroupSummary,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { MCP_TOOL_GROUP_LIMITS } from "@repo/core";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldHint,
  Input,
  Label,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

export function ToolGroupDialog({
  serverId,
  configRevision = 1,
  mode,
  group,
  groupCount = 0,
  onClose,
}: {
  serverId: string;
  configRevision?: number;
  mode: "create" | "rename" | "delete";
  /** Required for `rename` and `delete`. */
  group?: McpToolGroupSummary;
  /** Current owned group total; at the server cap creation is unavailable. */
  groupCount?: number;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const createGroup = useCreateMcpToolGroup();
  const renameGroup = useRenameMcpToolGroup();
  const deleteGroup = useDeleteMcpToolGroup();
  const [name, setName] = useState(group?.name ?? "");

  const atLimit = groupCount >= MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer;
  const trimmedName = name.trim();
  const nameValid =
    trimmedName.length > 0 && trimmedName.length <= MCP_TOOL_GROUP_LIMITS.name;

  const active =
    mode === "delete"
      ? { pending: deleteGroup.isPending, error: deleteGroup.error }
      : mode === "rename"
        ? { pending: renameGroup.isPending, error: renameGroup.error }
        : { pending: createGroup.isPending, error: createGroup.error };

  const submit = () => {
    if (mode === "delete") {
      if (!group) return;
      deleteGroup.mutate(
        { serverId, expectedRevision: configRevision, groupId: group.id },
        { onSuccess: () => onClose() },
      );
      return;
    }
    if (!nameValid || (mode === "create" && atLimit)) return;
    if (mode === "rename") {
      if (!group) return;
      renameGroup.mutate(
        {
          serverId,
          expectedRevision: configRevision,
          groupId: group.id,
          name: trimmedName,
        },
        { onSuccess: () => onClose() },
      );
      return;
    }
    createGroup.mutate(
      { serverId, expectedRevision: configRevision, name: trimmedName },
      { onSuccess: () => onClose() },
    );
  };

  if (mode !== "create" && !group) return null;

  const title =
    mode === "create"
      ? t.servers.groups.createTitle
      : mode === "rename"
        ? t.servers.groups.renameTitle
        : t.servers.groups.deleteTitle;

  const deleteDescription =
    group === undefined
      ? ""
      : group.toolCount === 1
        ? t.servers.groups.deleteDescriptionOne.replace("{name}", group.name)
        : t.servers.groups.deleteDescription
            .replace("{name}", group.name)
            .replace("{count}", String(group.toolCount));

  const description =
    mode === "create"
      ? t.servers.groups.createDescription
      : mode === "rename"
        ? t.servers.groups.renameDescription
        : deleteDescription;

  const submitLabel =
    mode === "create"
      ? active.pending
        ? t.servers.groups.creating
        : t.servers.groups.create
      : mode === "rename"
        ? active.pending
          ? t.servers.groups.renaming
          : t.servers.groups.rename
        : active.pending
          ? t.servers.groups.deleting
          : t.servers.groups.delete;

  const submitDisabled =
    active.pending ||
    (mode !== "delete" && (!nameValid || (mode === "create" && atLimit)));

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {mode === "create" && atLimit ? (
          <Alert>
            <AlertDescription>
              {t.servers.groups.limitReached.replace(
                "{limit}",
                String(MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer),
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {mode !== "delete" ? (
          <Field>
            <Label htmlFor="tool-group-name">
              {t.servers.groups.nameLabel}
            </Label>
            <Input
              id="tool-group-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.servers.groups.namePlaceholder}
              autoComplete="off"
              spellCheck={false}
              disabled={mode === "create" && atLimit}
            />
            <FieldHint>
              {t.servers.groups.nameHint.replace(
                "{limit}",
                String(MCP_TOOL_GROUP_LIMITS.name),
              )}
            </FieldHint>
          </Field>
        ) : null}

        {active.error ? (
          <FieldError>{resolveErrorMessage(active.error, t)}</FieldError>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.servers.cancel}
          </Button>
          <Button
            type="button"
            variant={mode === "delete" ? "destructive" : "default"}
            disabled={submitDisabled}
            onClick={submit}
          >
            {active.pending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
