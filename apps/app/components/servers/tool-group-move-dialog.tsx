import {
  useAssignMcpToolGroup,
  type McpToolGroupSummary,
} from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

/** Mirrors the API `toolGroupFilterSchema` sentinel for `groupId IS NULL`. */
const UNGROUPED_TARGET = "ungrouped";

export function ToolGroupMoveDialog({
  serverId,
  configRevision = 1,
  groups,
  toolId,
  onClose,
}: {
  serverId: string;
  configRevision?: number;
  groups: McpToolGroupSummary[];
  toolId: string;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const assignGroup = useAssignMcpToolGroup();
  const [target, setTarget] = useState<string>(UNGROUPED_TARGET);

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.servers.groups.moveTitle}</DialogTitle>
          <DialogDescription>
            {t.servers.groups.moveDescription}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <Label htmlFor="tool-group-move-target">
            {t.servers.groups.moveTarget}
          </Label>
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger id="tool-group-move-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNGROUPED_TARGET}>
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

        {assignGroup.error ? (
          <FieldError>{resolveErrorMessage(assignGroup.error, t)}</FieldError>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.servers.cancel}
          </Button>
          <Button
            type="button"
            disabled={assignGroup.isPending}
            onClick={() =>
              assignGroup.mutate(
                {
                  serverId,
                  expectedRevision: configRevision,
                  toolIds: [toolId],
                  groupId: target === UNGROUPED_TARGET ? null : target,
                },
                { onSuccess: () => onClose() },
              )
            }
          >
            {assignGroup.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {assignGroup.isPending
              ? t.servers.groups.moving
              : t.servers.groups.moveSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
