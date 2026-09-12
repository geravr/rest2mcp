/**
 * @file TanStack Query hooks for the admin panel.
 *
 * Follows the same pattern as other hooks in the app:
 * queries use `api.admin.*`, mutations use toast feedback.
 */

import { useTranslations } from "@/i18n/use-translations";
import { resolveErrorMessage } from "@/lib/errors";
import { api } from "@/lib/trpc";
import type { PaginationInput } from "@repo/core";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

export type AdminUsersQueryInput = PaginationInput & {
  q?: string;
  status?: "active" | "suspended";
  role?: "user" | "super_admin";
};

export type AdminInvitationsQueryInput = PaginationInput & {
  q?: string;
  status?: "pending" | "accepted" | "expired" | "revoked";
};

export type AdminAuditLogQueryInput = PaginationInput & {
  q?: string;
  action?:
    | "registration.enabled"
    | "registration.disabled"
    | "platform_invitation.created"
    | "platform_invitation.revoked"
    | "user.banned"
    | "user.unbanned";
};

// ── Queries ──────────────────────────────────────────────────────────────

export function useAdminStats() {
  return useQuery(api.admin.stats.queryOptions());
}

export function useAdminSettings() {
  return useQuery(api.admin.settings.queryOptions());
}

export function useAdminUsers(input: AdminUsersQueryInput) {
  return useQuery({
    ...api.admin.users.queryOptions(input),
    placeholderData: keepPreviousData,
  });
}

export function useAdminInvitations(input: AdminInvitationsQueryInput) {
  return useQuery({
    ...api.admin.invitations.queryOptions(input),
    placeholderData: keepPreviousData,
  });
}

export function useAdminAuditLog(input: AdminAuditLogQueryInput) {
  return useQuery({
    ...api.admin.auditLog.queryOptions(input),
    placeholderData: keepPreviousData,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────

export function useUpdateRegistration() {
  const queryClient = useQueryClient();
  const { t } = useTranslations();
  const baseOptions = api.admin.updateRegistration.mutationOptions();

  return useMutation({
    ...baseOptions,
    onSuccess: (data, variables, onMutateResult, context) => {
      baseOptions.onSuccess?.(data, variables, onMutateResult, context);
      void queryClient.invalidateQueries(api.admin.settings.pathFilter());
      void queryClient.invalidateQueries(api.admin.stats.pathFilter());
      toast.success(
        data.registrationEnabled
          ? t.toasts.admin.registrationEnabled
          : t.toasts.admin.registrationDisabled,
      );
    },
    onError: (error, variables, onMutateResult, context) => {
      baseOptions.onError?.(error, variables, onMutateResult, context);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useCreateInvitation() {
  const queryClient = useQueryClient();
  const { t } = useTranslations();
  const baseOptions = api.admin.createInvitation.mutationOptions();

  return useMutation({
    ...baseOptions,
    onSuccess: (data, variables, onMutateResult, context) => {
      baseOptions.onSuccess?.(data, variables, onMutateResult, context);
      void queryClient.invalidateQueries(api.admin.invitations.pathFilter());
      void queryClient.invalidateQueries(api.admin.stats.pathFilter());
      void queryClient.invalidateQueries(api.admin.auditLog.pathFilter());
      toast.success(t.toasts.admin.invitationSent);
    },
    onError: (error, variables, onMutateResult, context) => {
      baseOptions.onError?.(error, variables, onMutateResult, context);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  const { t } = useTranslations();
  const baseOptions = api.admin.revokeInvitation.mutationOptions();

  return useMutation({
    ...baseOptions,
    onSuccess: (data, variables, onMutateResult, context) => {
      baseOptions.onSuccess?.(data, variables, onMutateResult, context);
      void queryClient.invalidateQueries(api.admin.invitations.pathFilter());
      void queryClient.invalidateQueries(api.admin.stats.pathFilter());
      void queryClient.invalidateQueries(api.admin.auditLog.pathFilter());
      toast.success(t.toasts.admin.invitationRevoked);
    },
    onError: (error, variables, onMutateResult, context) => {
      baseOptions.onError?.(error, variables, onMutateResult, context);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useBanUser() {
  const queryClient = useQueryClient();
  const { t } = useTranslations();
  const baseOptions = api.admin.banUser.mutationOptions();

  return useMutation({
    ...baseOptions,
    onSuccess: (data, variables, onMutateResult, context) => {
      baseOptions.onSuccess?.(data, variables, onMutateResult, context);
      void queryClient.invalidateQueries(api.admin.users.pathFilter());
      void queryClient.invalidateQueries(api.admin.stats.pathFilter());
      void queryClient.invalidateQueries(api.admin.auditLog.pathFilter());
      toast.success(t.toasts.admin.userSuspended);
    },
    onError: (error, variables, onMutateResult, context) => {
      baseOptions.onError?.(error, variables, onMutateResult, context);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useUnbanUser() {
  const queryClient = useQueryClient();
  const { t } = useTranslations();
  const baseOptions = api.admin.unbanUser.mutationOptions();

  return useMutation({
    ...baseOptions,
    onSuccess: (data, variables, onMutateResult, context) => {
      baseOptions.onSuccess?.(data, variables, onMutateResult, context);
      void queryClient.invalidateQueries(api.admin.users.pathFilter());
      void queryClient.invalidateQueries(api.admin.stats.pathFilter());
      void queryClient.invalidateQueries(api.admin.auditLog.pathFilter());
      toast.success(t.toasts.admin.userReactivated);
    },
    onError: (error, variables, onMutateResult, context) => {
      baseOptions.onError?.(error, variables, onMutateResult, context);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}
