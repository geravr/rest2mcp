import { useUpdateMcpVariable } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
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
  Switch,
} from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

export type EditableVariable = {
  id: string;
  name: string;
  kind: "config" | "secret";
  owner: "manual" | "auth";
  description?: string | null;
  hasValue: boolean;
  value?: string | null;
};

export function EditVariableDialog({
  serverId,
  configRevision = 1,
  variable,
  onClose,
}: {
  serverId: string;
  configRevision?: number;
  variable: EditableVariable;
  onClose: () => void;
}) {
  const { t } = useTranslations();
  const updateVariable = useUpdateMcpVariable();
  const initialValue = variable.kind === "secret" ? "" : (variable.value ?? "");
  const [value, setValue] = useState(initialValue);
  const [kind, setKind] = useState<"config" | "secret">(variable.kind);

  const kindChanged = kind !== variable.kind;
  const valueChanged = value !== initialValue;
  const dirty = kindChanged || valueChanged;
  // A secret always needs a fresh value on save; a secret->config transition
  // also requires a new plaintext value.
  const needsValue = kind === "secret" || variable.kind === "secret";
  const canSave =
    dirty && (!needsValue || value.length > 0) && !updateVariable.isPending;
  const showPlaintextHint = variable.kind === "secret" && kind === "config";

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.servers.editVariableTitle}</DialogTitle>
          {variable.kind === "secret" ? (
            <DialogDescription>
              {t.servers.editVariableSecretHidden}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSave) return;
            updateVariable.mutate(
              {
                serverId,
                expectedRevision: configRevision,
                valueId: variable.id,
                ...(value.length > 0 ? { value } : {}),
                ...(kindChanged ? { kind } : {}),
              },
              { onSuccess: () => onClose() },
            );
          }}
        >
          <Field>
            <Label htmlFor="edit-var-name">{t.servers.variableName}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="edit-var-name"
                value={variable.name}
                readOnly
                className="font-mono text-xs"
              />
              <Badge
                variant={variable.owner === "auth" ? "secondary" : "outline"}
                className="shrink-0"
              >
                {variable.owner === "auth"
                  ? t.servers.variableAuthOwnedBadge
                  : t.servers.variableManualOwnerBadge}
              </Badge>
            </div>
          </Field>
          <Field>
            <Label htmlFor="edit-var-value">{t.servers.variableValue}</Label>
            <Input
              id="edit-var-value"
              type={kind === "secret" ? "password" : "text"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              placeholder={
                kind === "secret"
                  ? t.servers.editVariableSecretPlaceholder
                  : undefined
              }
            />
          </Field>
          {showPlaintextHint ? (
            <p className="text-sm text-muted-foreground">
              {t.servers.editVariablePlaintextHint}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Switch
              id="edit-var-secret"
              checked={kind === "secret"}
              onCheckedChange={(checked) =>
                setKind(checked ? "secret" : "config")
              }
            />
            <Label htmlFor="edit-var-secret">{t.servers.variableSecret}</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.servers.cancel}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {updateVariable.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              {updateVariable.isPending
                ? t.servers.savingChanges
                : t.servers.saveChanges}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
