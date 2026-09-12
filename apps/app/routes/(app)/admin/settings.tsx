import { SettingsFormSkeleton } from "@/components/loading";
import { useAdminSettings, useUpdateRegistration } from "@/hooks/use-admin";
import { useTranslations } from "@/i18n/use-translations";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldHint,
  Label,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@repo/ui";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

const settingsTabValues = ["registration"] as const;

const searchSchema = z.object({
  tab: z.enum(settingsTabValues).optional().catch(undefined),
});

export const Route = createFileRoute("/(app)/admin/settings")({
  validateSearch: searchSchema,
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { t } = useTranslations();
  const { data: settings, isLoading } = useAdminSettings();
  const updateMutation = useUpdateRegistration();

  const activeTab = search.tab ?? "registration";

  const [registrationEnabledDraft, setRegistrationEnabledDraft] = useState<
    boolean | null
  >(null);
  const [registrationMessageDraft, setRegistrationMessageDraft] = useState<
    string | null
  >(null);

  const registrationEnabled =
    registrationEnabledDraft ?? settings?.registrationEnabled ?? true;
  const registrationMessage =
    registrationMessageDraft ?? settings?.registrationDisabledMessage ?? "";

  const hasRegistrationChanges = settings
    ? registrationEnabled !== settings.registrationEnabled ||
      (!registrationEnabled &&
        registrationMessage !== (settings.registrationDisabledMessage ?? ""))
    : false;

  const handleSaveRegistration = () => {
    if (!settings) {
      return;
    }

    updateMutation.mutate(
      {
        enabled: registrationEnabled,
        message: registrationEnabled
          ? null
          : registrationMessage.trim() || null,
      },
      {
        onSuccess: () => {
          setRegistrationEnabledDraft(null);
          setRegistrationMessageDraft(null);
        },
      },
    );
  };

  const handleTabChange = (tab: string) => {
    const nextTab = tab as (typeof settingsTabValues)[number];
    navigate({
      to: "/admin/settings",
      replace: true,
      search: nextTab === "registration" ? {} : { tab: nextTab },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t.admin.settings.title}
        </h1>
        <p className="text-muted-foreground">{t.admin.settings.description}</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="registration">
            {t.admin.settings.userRegistration}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="registration">
          {isLoading && !settings ? (
            <SettingsFormSkeleton cards={1} fields={2} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t.admin.settings.userRegistration}</CardTitle>
                <CardDescription>
                  {t.admin.settings.userRegistrationDescription}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="max-w-lg space-y-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <Label htmlFor="registration-toggle">
                        {t.admin.settings.publicRegistration}
                      </Label>
                      <Switch
                        id="registration-toggle"
                        checked={registrationEnabled}
                        disabled={updateMutation.isPending}
                        onCheckedChange={(checked) =>
                          setRegistrationEnabledDraft(checked)
                        }
                      />
                    </div>
                    <FieldHint>
                      {registrationEnabled
                        ? t.admin.settings.publicRegistrationEnabledHint
                        : t.admin.settings.publicRegistrationDisabledHint}
                    </FieldHint>
                  </div>

                  {!registrationEnabled && (
                    <Field>
                      <Label htmlFor="disabled-message">
                        {t.admin.settings.disabledMessageLabel}
                      </Label>
                      <Textarea
                        id="disabled-message"
                        placeholder={
                          t.admin.settings.disabledMessagePlaceholder
                        }
                        value={registrationMessage}
                        onChange={(event) =>
                          setRegistrationMessageDraft(event.target.value)
                        }
                        maxLength={500}
                      />
                      <FieldHint>
                        {t.admin.settings.disabledMessageHelp}
                      </FieldHint>
                    </Field>
                  )}
                </div>
              </CardContent>
              <CardFooter>
                <Button
                  type="button"
                  onClick={handleSaveRegistration}
                  disabled={!hasRegistrationChanges || updateMutation.isPending}
                >
                  {updateMutation.isPending && (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  )}
                  {updateMutation.isPending
                    ? t.admin.settings.savingUserRegistration
                    : t.admin.settings.saveUserRegistration}
                </Button>
              </CardFooter>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
