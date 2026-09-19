import { useUpdateMcpVariable } from "@/hooks/use-mcp";
import { useTranslations } from "@/i18n/use-translations";
import {
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
  name: string;
  isSecret: boolean;
  value?: string;
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
  const initialValue = variable.isSecret ? "" : (variable.value ?? "");
  const [value, setValue] = useState(initialValue);
  const [isSecret, setIsSecret] = useState(variable.isSecret);

  const dirty = value !== initialValue || isSecret !== variable.isSecret;
  const needsValue = variable.isSecret || !isSecret;
  const canSave =
    dirty && (!needsValue || value.length > 0) && !updateVariable.isPending;
  const showPlaintextHint = variable.isSecret && !isSecret;

  return (
    <Dialog open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.servers.editVariableTitle}</DialogTitle>
          {variable.isSecret ? (
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
                name: variable.name,
                isSecret,
                ...(value.length > 0 ? { value } : {}),
              },
              { onSuccess: () => onClose() },
            );
          }}
        >
          <Field>
            <Label htmlFor="edit-var-name">{t.servers.variableName}</Label>
            <Input
              id="edit-var-name"
              value={variable.name}
              readOnly
              className="font-mono text-xs"
            />
          </Field>
          <Field>
            <Label htmlFor="edit-var-value">{t.servers.variableValue}</Label>
            <Input
              id="edit-var-value"
              type={isSecret ? "password" : "text"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              placeholder={
                isSecret ? t.servers.editVariableSecretPlaceholder : undefined
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
              checked={isSecret}
              onCheckedChange={setIsSecret}
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
