import { useDeleteMcpTool } from "@/hooks/use-mcp";
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
  tool,
  onClose,
}: {
  serverId: string;
  tool: { id: string; name: string };
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const deleteTool = useDeleteMcpTool();

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.servers.deleteToolTitle}</DialogTitle>
          <DialogDescription>
            {t.servers.deleteToolDescription.replace("{name}", tool.name)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.servers.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deleteTool.isPending}
            onClick={() =>
              deleteTool.mutate(
                { serverId, toolId: tool.id },
                { onSuccess: () => onClose() },
              )
            }
          >
            {deleteTool.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {deleteTool.isPending ? t.servers.deleting : t.servers.deleteTool}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
