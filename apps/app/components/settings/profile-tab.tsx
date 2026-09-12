import { SettingsFormSkeleton } from "@/components/loading";
import { UserAvatar } from "@/components/user-avatar";
import { useTranslations } from "@/i18n/use-translations";
import { auth } from "@/lib/auth";
import { resolveErrorMessage } from "@/lib/errors";
import { sessionQueryKey, type SessionData } from "@/lib/queries/session";
import { useUserMeQuery } from "@/lib/queries/user";
import { api } from "@/lib/trpc";
import { uploadFileToStorage } from "@/lib/storage";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldError,
  FieldHint,
  Input,
  Label,
} from "@repo/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

export function ProfileSettingsTab() {
  const { t } = useTranslations();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useUserMeQuery();
  const [emailFeedback, setEmailFeedback] = useState<string | null>(null);
  const [isEmailPending, setIsEmailPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const profileSchema = z.object({
    name: z.string().trim().min(1, t.settings.profile.nameRequired).max(128),
  });
  const emailChangeSchema = z.object({
    email: z.email({ error: t.settings.profile.emailInvalid }),
  });
  type EmailChangeFormValues = z.input<typeof emailChangeSchema>;
  type ProfileFormValues = z.input<typeof profileSchema>;

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: "",
    },
  });

  const emailForm = useForm<EmailChangeFormValues>({
    resolver: zodResolver(emailChangeSchema),
    defaultValues: {
      email: "",
    },
  });

  useEffect(() => {
    if (!data) {
      return;
    }

    form.reset({
      name: data.name ?? "",
    });
    emailForm.reset({
      email: data.email ?? "",
    });
  }, [data, emailForm, form]);

  function applyUpdatedUser(updatedUser: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    image: string | null;
  }) {
    queryClient.setQueryData(api.user.me.queryKey(), updatedUser);
    void queryClient.invalidateQueries(api.user.me.pathFilter());
    queryClient.setQueryData<SessionData | null>(sessionQueryKey, (current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        user: {
          ...current.user,
          name: updatedUser.name,
          email: updatedUser.email,
          emailVerified: updatedUser.emailVerified,
          image: updatedUser.image,
        },
      };
    });
  }

  const updateProfileBaseOptions = api.user.updateProfile.mutationOptions();

  const updateProfileMutation = useMutation({
    ...updateProfileBaseOptions,
    mutationFn: (values: ProfileFormValues, context) =>
      updateProfileBaseOptions.mutationFn!(
        {
          name: values.name.trim(),
          image: data?.image ?? null,
        },
        context,
      ),
    onSuccess: (updatedUser, variables, onMutateResult, context) => {
      updateProfileBaseOptions.onSuccess?.(
        updatedUser,
        variables,
        onMutateResult,
        context,
      );
      applyUpdatedUser(updatedUser);
      form.reset({ name: updatedUser.name });
      toast.success(t.toasts.profile.profileUpdated);
    },
    onError: (mutationError, variables, onMutateResult, context) => {
      updateProfileBaseOptions.onError?.(
        mutationError,
        variables,
        onMutateResult,
        context,
      );
      toast.error(resolveErrorMessage(mutationError, t));
    },
  });

  const updateAvatarMutation = useMutation({
    ...updateProfileBaseOptions,
    mutationFn: async (file: File, context) => {
      const contentType = file.type.toLowerCase();

      if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
        throw new Error(t.settings.profile.invalidAvatarType);
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error(t.settings.profile.avatarTooLarge);
      }

      const upload = await uploadFileToStorage({
        file,
        directory: "avatars",
      });

      return updateProfileBaseOptions.mutationFn!(
        {
          name: form.getValues("name").trim(),
          image: upload.accessUrl,
        },
        context,
      );
    },
    onSuccess: (updatedUser, variables, onMutateResult, context) => {
      updateProfileBaseOptions.onSuccess?.(
        updatedUser,
        variables,
        onMutateResult,
        context,
      );
      applyUpdatedUser(updatedUser);
      form.reset({ name: updatedUser.name });
      toast.success(t.toasts.profile.avatarUpdated);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    onError: (mutationError, variables, onMutateResult, context) => {
      updateProfileBaseOptions.onError?.(
        mutationError,
        variables,
        onMutateResult,
        context,
      );
      toast.error(resolveErrorMessage(mutationError, t));
    },
  });

  if (isLoading && !data) {
    return <SettingsFormSkeleton cards={3} fields={2} />;
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {resolveErrorMessage(error, t) || t.settings.profile.errorDescription}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            {t.settings.profile.unavailableDescription}
          </p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.settings.profile.photoLabel}</CardTitle>
          <CardDescription>
            {t.settings.profile.photoDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarSection
            id={data.id}
            image={data.image}
            name={data.name}
            isPending={updateAvatarMutation.isPending}
            inputRef={fileInputRef}
            onSelectFile={(file: File) => {
              updateAvatarMutation.mutate(file);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.profile.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileDetailsForm
            form={form}
            isPending={updateProfileMutation.isPending}
            onSubmit={(values) => {
              updateProfileMutation.mutate(values);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.profile.emailLabel}</CardTitle>
          <CardDescription>
            {t.settings.profile.emailSectionDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmailChangeSection
            currentEmail={data.email}
            emailVerified={data.emailVerified}
            form={emailForm}
            feedback={emailFeedback}
            isPending={isEmailPending}
            onSubmit={async (values) => {
              setEmailFeedback(null);
              setIsEmailPending(true);

              const nextEmail = values.email.trim().toLowerCase();
              if (nextEmail === data.email) {
                setEmailFeedback(t.settings.profile.emailRequiredDifferent);
                setIsEmailPending(false);
                return;
              }

              const result = await auth.changeEmail({
                newEmail: nextEmail,
                callbackURL: window.location.href,
              });

              if (result.error) {
                const message =
                  result.error.message || t.settings.profile.emailChangeFailed;
                setEmailFeedback(message);
                toast.error(message);
                setIsEmailPending(false);
                return;
              }

              toast.success(t.toasts.profile.emailChangeRequested);
              setIsEmailPending(false);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileDetailsForm({
  form,
  isPending,
  onSubmit,
}: {
  form: UseFormReturn<{ name: string }>;
  isPending: boolean;
  onSubmit: (values: { name: string }) => void;
}) {
  const { t } = useTranslations();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4">
      <Field>
        <Label htmlFor="settings-name">{t.settings.profile.nameLabel}</Label>
        <Input
          id="settings-name"
          type="text"
          placeholder={t.settings.profile.namePlaceholder}
          disabled={isPending}
          {...register("name")}
        />
        <FieldError>{errors.name?.message}</FieldError>
      </Field>
      <Button type="submit" disabled={isPending}>
        {isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {isPending ? t.settings.profile.saving : t.settings.profile.saveChanges}
      </Button>
    </form>
  );
}

function AvatarSection({
  id,
  image,
  name,
  isPending,
  inputRef,
  onSelectFile,
}: {
  id: string;
  image: string | null;
  name: string;
  isPending: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSelectFile: (file: File) => void;
}) {
  const { t } = useTranslations();

  return (
    <div className="flex items-center gap-4">
      <UserAvatar
        id={id}
        image={image}
        name={name}
        alt={name || t.layout.topbar.userFallback}
        size="lg"
      />

      <div className="flex items-center">
        <Label htmlFor="avatar-upload" className="sr-only">
          {t.settings.profile.photoLabel}
        </Label>
        <input
          ref={inputRef}
          id="avatar-upload"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) {
              return;
            }

            onSelectFile(file);
          }}
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          {isPending ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              {t.settings.profile.uploadingAvatar}
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              {t.settings.profile.uploadAvatar}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function EmailChangeSection({
  currentEmail,
  emailVerified,
  form,
  feedback,
  isPending,
  onSubmit,
}: {
  currentEmail: string;
  emailVerified: boolean;
  form: UseFormReturn<{ email: string }>;
  feedback: string | null;
  isPending: boolean;
  onSubmit: (values: { email: string }) => Promise<void>;
}) {
  const { t } = useTranslations();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  return (
    <form
      onSubmit={handleSubmit((values) => {
        void onSubmit(values);
      })}
      className="max-w-md space-y-4"
    >
      <Field>
        <Label htmlFor="settings-email-change">
          {t.settings.profile.emailLabel}
        </Label>
        <Input
          id="settings-email-change"
          type="email"
          autoComplete="email"
          disabled={isPending}
          {...register("email")}
        />
        <FieldError>{errors.email?.message}</FieldError>
        <FieldHint>
          {t.settings.profile.currentEmailLabel.replace(
            "{email}",
            currentEmail,
          )}
        </FieldHint>
      </Field>

      <Badge variant={emailVerified ? "outline" : "secondary"}>
        {emailVerified
          ? t.settings.profile.verifiedBadge
          : t.settings.profile.unverifiedBadge}
      </Badge>

      <FieldError>{feedback}</FieldError>

      <FieldHint>{t.settings.profile.emailChangeNote}</FieldHint>

      <Button type="submit" disabled={isPending}>
        {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {isPending
          ? t.settings.profile.requestingEmailChange
          : t.settings.profile.requestEmailChange}
      </Button>
    </form>
  );
}
