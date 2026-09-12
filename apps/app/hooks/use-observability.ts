import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { captureHandledPostHogException } from "@/lib/posthog";
import { useSessionQuery } from "@/lib/queries/session";
import { api } from "@/lib/trpc";
import type { UpdateObservabilitySettingsInput } from "@repo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function useObservabilitySettingsQuery() {
  const { data: session } = useSessionQuery();
  const userId = session?.user.id;

  return useQuery(
    api.user.observabilitySettings.queryOptions(undefined, {
      enabled: Boolean(userId),
      staleTime: 30_000,
    }),
  );
}

export function useUpdateObservabilitySettings() {
  const { t } = useTranslations();
  const { data: session } = useSessionQuery();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const baseOptions = api.user.updateObservabilitySettings.mutationOptions();

  return useMutation({
    ...baseOptions,
    mutationFn: async (input: UpdateObservabilitySettingsInput, context) => {
      if (!userId) {
        throw new Error(t.settings.privacy.errorDescription);
      }

      return baseOptions.mutationFn!(input, context);
    },
    onSuccess: (settings, input, onMutateResult, context) => {
      baseOptions.onSuccess?.(settings, input, onMutateResult, context);
      queryClient.setQueryData(
        api.user.observabilitySettings.queryKey(),
        settings,
      );
      void queryClient.invalidateQueries(
        api.user.observabilitySettings.pathFilter(),
      );
      if (input.consentStatus === "granted") {
        toast.success(t.toasts.observability.enabled);
      } else if (input.consentStatus === "denied") {
        toast.success(t.toasts.observability.disabled);
      } else {
        toast.success(t.toasts.observability.privacyUpdated);
      }
    },
    onError: (error, variables, onMutateResult, context) => {
      baseOptions.onError?.(error, variables, onMutateResult, context);
      toast.error(resolveErrorMessage(error, t));
      captureHandledPostHogException(error, {
        action: "update_observability_settings",
        area: "settings",
      });
    },
  });
}
