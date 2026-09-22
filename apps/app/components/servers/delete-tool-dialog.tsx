import { useDeleteMcpTools } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";

export function DeleteToolDialog({
  serverId,
  configRevision,
  tools,
  onClose,
}: {
  serverId: string;
  configRevision?: number;
  tools: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const deleteTools = useDeleteMcpTools();
  const single = tools.length === 1;

  const title = single
    ? t.servers.deleteToolTitleOne
    : t.servers.deleteToolTitle;
  const description = single
    ? t.servers.deleteToolDescriptionOne.replace("{name}", tools[0].name)
    : t.servers.deleteToolDescription.replace("{count}", String(tools.length));

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.servers.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteTools.isPending}
            onClick={() =>
              deleteTools.mutate(
                {
                  serverId,
                  toolIds: tools.map((tool) => tool.id),
                  expectedRevision: configRevision ?? 1,
                },
                { onSuccess: () => onClose() },
              )
            }
          >
            {deleteTools.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {deleteTools.isPending ? t.servers.deleting : t.servers.deleteTool}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
