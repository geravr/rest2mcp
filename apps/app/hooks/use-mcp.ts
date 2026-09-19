import { useTranslations } from "@/i18n/use-translations";
import { getAppCode, resolveErrorMessage } from "@/lib/errors";
import { api } from "@/lib/trpc";
import { APP_ERROR_CODES, type PaginationInput } from "@repo/core";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { toast } from "sonner";

export type McpToolEditorIssue = {
  path: string;
  id?: string;
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type McpToolEditorState = {
  toolId: string;
  typed: boolean;
  definition: unknown;
  issues: McpToolEditorIssue[];
  conversionDraft: unknown;
  conversionIssues: McpToolEditorIssue[];
};

export type McpToolPreviewCompileInput = {
  serverId: string;
  name?: string;
  title?: string | null;
  description?: string | null;
  method: string;
  requestDefinition: unknown;
  allowMutation?: boolean;
};

export type McpToolPreviewCompileResult = {
  ok: boolean;
  ready: boolean;
  issues: McpToolEditorIssue[];
  plan: unknown;
  contract: unknown;
  compatibilityProjectable: boolean;
};

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

export function useMcpServerCommon(serverId: string) {
  return useQuery({
    ...api.mcp.serverCommon.queryOptions({ serverId }),
    placeholderData: keepPreviousData,
    enabled: serverId.length > 0,
  });
}

export function useMcpToolEditorState(
  serverId: string,
  toolId: string,
  enabled: boolean,
): UseQueryResult<McpToolEditorState> {
  return useQuery({
    ...api.mcp.toolEditorState.queryOptions({ serverId, toolId }),
    enabled: enabled && serverId.length > 0 && toolId.length > 0,
  }) as unknown as UseQueryResult<McpToolEditorState>;
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
      queryClient.invalidateQueries(api.mcp.serverCommon.pathFilter()),
      queryClient.invalidateQueries(api.mcp.toolEditorState.pathFilter()),
      queryClient.invalidateQueries(api.mcp.callLogs.pathFilter()),
      queryClient.invalidateQueries(api.mcp.platformToken.pathFilter()),
    ]);
  };
}

/**
 * Centralized mutation error handling. A `MCP_WRITE_CONFLICT` invalidates and
 * reloads the server aggregate so stale optimistic state is never reported as
 * saved; every failure surfaces localized copy.
 */
export function useMcpMutationError() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  return (error: unknown) => {
    if (getAppCode(error) === APP_ERROR_CODES.MCP_WRITE_CONFLICT) {
      void invalidate();
    }
    toast.error(resolveErrorMessage(error, t));
  };
}

export function useCreateMcpServer() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useSetMcpServerAuth() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useUpdateMcpServer() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useUpdateMcpServerCommon() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.updateServerCommon.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
      toast.success(t.toasts.servers.updated);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      handleError(error);
    },
  });
}

export function useDeleteMcpServer() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useTestMcpConnection() {
  const handleError = useMcpMutationError();
  const baseOptions = api.mcp.testConnection.mutationOptions();
  return useMutation({
    ...baseOptions,
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      handleError(error);
    },
  });
}

export function useParseCurlPreview() {
  const handleError = useMcpMutationError();
  const baseOptions = api.mcp.parseCurlPreview.mutationOptions();
  return useMutation({
    ...baseOptions,
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      handleError(error);
    },
  });
}

export function usePreviewToolCompile(): UseMutationResult<
  McpToolPreviewCompileResult,
  Error,
  McpToolPreviewCompileInput,
  unknown
> {
  const handleError = useMcpMutationError();
  const baseOptions = api.mcp.previewToolCompile.mutationOptions();
  return useMutation({
    ...baseOptions,
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      handleError(error);
    },
  }) as unknown as UseMutationResult<
    McpToolPreviewCompileResult,
    Error,
    McpToolPreviewCompileInput,
    unknown
  >;
}

export function useCreateMcpTool() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useCreateMcpToolFromCurl() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useUpdateMcpTool() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useDeleteMcpTool() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useCreateMcpVariable() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useUpdateMcpVariable() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useDeleteMcpVariable() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useCreateMcpToken() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useRevokeMcpToken() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useInvokeMcpTool() {
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useCreatePlatformToken() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}

export function useRevokePlatformToken() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
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
      handleError(error);
    },
  });
}
