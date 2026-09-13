import { useUpdateMcpServer } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
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
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { ServerIcon } from "./server-icon";

/**
 * Mount conditionally (`{open ? <EditServerDialog …/> : null}`) so the form
 * state always initializes from the current server.
 */
export function EditServerDialog({
  server,
  onClose,
}: {
  server: {
    id: string;
    name: string;
    description: string | null;
    baseUrl: string;
    iconImage: string | null;
  };
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const updateServer = useUpdateMcpServer();
  const [name, setName] = useState(server.name);
  const [baseUrl, setBaseUrl] = useState(server.baseUrl);
  const [description, setDescription] = useState(server.description ?? "");

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <ServerIcon
              serverId={server.id}
              iconImage={server.iconImage}
              size="sm"
            />
            {t.servers.editTitle}
          </DialogTitle>
          <DialogDescription>{server.baseUrl}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            updateServer.mutate(
              {
                serverId: server.id,
                name,
                baseUrl,
                description: description.trim() ? description.trim() : null,
              },
              { onSuccess: () => onClose() },
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="edit-server-name">{t.servers.name}</Label>
            <Input
              id="edit-server-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t.servers.namePlaceholder}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-server-base">{t.servers.baseUrl}</Label>
            <Input
              id="edit-server-base"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={t.servers.baseUrlPlaceholder}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-server-description">
              {t.servers.descriptionLabel}
            </Label>
            <Input
              id="edit-server-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t.servers.optionalDescription}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.servers.cancel}
            </Button>
            <Button type="submit" disabled={updateServer.isPending}>
              {updateServer.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {updateServer.isPending
                ? t.servers.savingChanges
                : t.servers.saveChanges}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
