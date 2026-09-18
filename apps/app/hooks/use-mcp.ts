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

export function useMcpServers(input: PaginationInput) {
  return useQuery({
    ...api.mcp.servers.queryOptions(input),
    placeholderData: keepPreviousData,
  });
}

export function useMcpServer(serverId: string) {
  return useQuery({
    ...api.mcp.getServer.queryOptions({ serverId }),
    placeholderData: keepPreviousData,
    enabled: serverId.length > 0,
  });
}

export function useMcpTools(serverId: string, input: PaginationInput) {
  return useQuery({
    ...api.mcp.tools.queryOptions({ serverId, ...input }),
    placeholderData: keepPreviousData,
    enabled: serverId.length > 0,
  });
}

export function useMcpTokens(serverId: string) {
  return useQuery({
    ...api.mcp.tokens.queryOptions({ serverId }),
    placeholderData: keepPreviousData,
    enabled: serverId.length > 0,
  });
}

export function useMcpSnippet(serverId: string) {
  return useQuery({
    ...api.mcp.connectionSnippet.queryOptions({ serverId }),
    placeholderData: keepPreviousData,
    enabled: serverId.length > 0,
  });
}

export function useMcpVariables(serverId: string) {
  return useQuery({
    ...api.mcp.variables.queryOptions({ serverId }),
    placeholderData: keepPreviousData,
    enabled: serverId.length > 0,
  });
}

export function useMcpCallLogs(serverId: string, input: PaginationInput) {
  return useQuery({
    ...api.mcp.callLogs.queryOptions({ serverId, ...input }),
    placeholderData: keepPreviousData,
    enabled: serverId.length > 0,
  });
}

export function usePlatformToken() {
  return useQuery({
    ...api.mcp.platformToken.queryOptions(),
    placeholderData: keepPreviousData,
  });
}

export function usePlatformSnippet() {
  return useQuery({
    ...api.mcp.platformSnippet.queryOptions(),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateMcp() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries(api.mcp.servers.pathFilter()),
      queryClient.invalidateQueries(api.mcp.getServer.pathFilter()),
      queryClient.invalidateQueries(api.mcp.tools.pathFilter()),
      queryClient.invalidateQueries(api.mcp.tokens.pathFilter()),
      queryClient.invalidateQueries(api.mcp.variables.pathFilter()),
      queryClient.invalidateQueries(api.mcp.callLogs.pathFilter()),
      queryClient.invalidateQueries(api.mcp.platformToken.pathFilter()),
    ]);
  };
}

export function useCreateMcpServer() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.createServer.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.created);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useSetMcpServerAuth() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.setServerAuth.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.servers.authSaved);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useUpdateMcpServer() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.updateServer.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.updated);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useDeleteMcpServer() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.deleteServer.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.deleted);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useTestMcpConnection() {
  const { t } = useTranslations();
  const baseOptions = api.mcp.testConnection.mutationOptions();
  return useMutation({
    ...baseOptions,
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useParseCurlPreview() {
  const { t } = useTranslations();
  const baseOptions = api.mcp.parseCurlPreview.mutationOptions();
  return useMutation({
    ...baseOptions,
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function usePreviewToolCompile() {
  const { t } = useTranslations();
  const baseOptions = api.mcp.previewToolCompile.mutationOptions();
  return useMutation({
    ...baseOptions,
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useCreateMcpTool() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.createTool.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.toolCreated);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useCreateMcpToolFromCurl() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.createToolFromCurl.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.toolCreated);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useUpdateMcpTool() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.updateTool.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.toolUpdated);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useDeleteMcpTool() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.deleteTool.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.toolDeleted);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useCreateMcpVariable() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.createVariable.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.variableSaved);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useUpdateMcpVariable() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.updateVariable.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.variableSaved);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useDeleteMcpVariable() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.deleteVariable.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.variableDeleted);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useCreateMcpToken() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.createToken.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.tokenCreated);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useRevokeMcpToken() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.revokeToken.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.tokenRevoked);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useInvokeMcpTool() {
  const { t } = useTranslations();
  const queryClient = useQueryClient();
  const baseOptions = api.mcp.invokeTool.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await queryClient.invalidateQueries(api.mcp.callLogs.pathFilter());
      await queryClient.invalidateQueries(api.mcp.getServer.pathFilter());
      await queryClient.invalidateQueries(api.mcp.servers.pathFilter());
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useCreatePlatformToken() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.createPlatformToken.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.platform.tokenCreated);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}

export function useRevokePlatformToken() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.revokePlatformToken.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.platform.tokenRevoked);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      toast.error(resolveErrorMessage(error, t));
    },
  });
}
