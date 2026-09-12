import { useDeleteMcpServer } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
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
  Input,
  Label,
} from "@repo/ui";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

/**
 * Type-to-confirm server deletion. Mount conditionally so the confirmation
 * input always starts empty.
 */
export function DeleteServerDialog({
  server,
  onClose,
}: {
  server: { id: string; name: string };
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const navigate = useNavigate();
  const deleteServer = useDeleteMcpServer();
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === server.name;

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.servers.deleteTitle}</DialogTitle>
          <DialogDescription>
            {t.servers.deleteDescription.replace("{name}", server.name)}
          </DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertDescription>
            {t.servers.deleteConfirmLabel.replace("{name}", server.name)}
          </AlertDescription>
        </Alert>
        <div className="space-y-2">
          <Label htmlFor="delete-server-confirm" className="sr-only">
            {t.servers.deleteConfirmLabel.replace("{name}", server.name)}
          </Label>
          <Input
            id="delete-server-confirm"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder={server.name}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t.servers.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!confirmed || deleteServer.isPending}
            onClick={() =>
              deleteServer.mutate(
                { serverId: server.id },
                {
                  onSuccess: () => {
                    onClose();
                    void navigate({ to: "/servers" });
                  },
                },
              )
            }
          >
            {deleteServer.isPending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : null}
            {deleteServer.isPending
              ? t.servers.deleting
              : t.servers.deleteConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
