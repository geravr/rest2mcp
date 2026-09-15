import { ServerAuthFields } from "@/components/servers/server-auth-fields";
import { useTranslations } from "@/i18n/use-translations";
import {
  buildCreateAuth,
  DEFAULT_AUTH_FORM,
  type AuthFormState,
} from "@/lib/server-auth";
import { Button, DialogFooter, Field, Input, Label } from "@repo/ui";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export type CreateServerFormValues = {
  name: string;
  baseUrl: string;
  description?: string;
  auth?: ReturnType<typeof buildCreateAuth>;
};

export function CreateServerForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (values: CreateServerFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslations();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [description, setDescription] = useState("");
  const [auth, setAuth] = useState<AuthFormState>(DEFAULT_AUTH_FORM);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const authPayload = buildCreateAuth(auth);
        if (auth.type !== "none" && !authPayload) {
          toast.error(t.servers.authRequiredFields);
          return;
        }
        onSubmit({
          name,
          baseUrl,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(authPayload ? { auth: authPayload } : {}),
        });
      }}
    >
      <Field>
        <Label htmlFor="server-name">{t.servers.name}</Label>
        <Input
          id="server-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t.servers.namePlaceholder}
          required
        />
      </Field>
      <Field>
        <Label htmlFor="server-base">{t.servers.baseUrl}</Label>
        <Input
          id="server-base"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder={t.servers.baseUrlPlaceholder}
          required
        />
      </Field>
      <Field>
        <Label htmlFor="server-description">{t.servers.descriptionLabel}</Label>
        <Input
          id="server-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t.servers.optionalDescription}
        />
      </Field>
      <ServerAuthFields
        value={auth}
        onChange={setAuth}
        idPrefix="create-auth"
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t.servers.cancel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {pending ? t.servers.creating : t.servers.create}
        </Button>
      </DialogFooter>
    </form>
  );
}
