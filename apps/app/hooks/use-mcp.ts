import { useTranslations } from "@/i18n/use-translations";
import { getAppCode, resolveErrorMessage } from "@/lib/errors";
import { api } from "@/lib/trpc";
import {
  APP_ERROR_CODES,
  type Paginated,
  type PaginationInput,
} from "@repo/core";
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
};

export type PublicationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
  toolName?: string;
};

export type PublishDiff = {
  serverChanged: string[];
  commonChanged: boolean;
  authChanged: boolean;
  toolsAdded: string[];
  toolsRemoved: string[];
  toolsChanged: string[];
  toolsEnabled: string[];
  toolsDisabled: string[];
  configChanged: boolean;
  contractChanged: boolean;
  changed: boolean;
  destructive: boolean;
};

export type PublishPreview = {
  serverId: string;
  draftRevision: number;
  publishedRevisionId: string | null;
  publishedRevisionNumber: number | null;
  candidateFingerprint: string;
  contractFingerprint: string;
  ready: boolean;
  dirty: boolean;
  errors: PublicationIssue[];
  warnings: PublicationIssue[];
  warningCodes: string[];
  diff: PublishDiff;
};

export type PublishServerInput = {
  serverId: string;
  expectedDraftRevision: number;
  expectedPublishedRevisionId: string | null;
  publishRequestId: string;
  candidateFingerprint: string;
  acknowledgedWarningCodes?: string[];
  note?: string;
};

export type PublishResult = {
  serverId: string;
  revisionId: string;
  revisionNumber: number;
  candidateFingerprint: string;
  contractFingerprint: string;
  sourceDraftRevision: number;
  status: string;
  configRevision: number;
  idempotent: boolean;
};

export type RevisionSummary = {
  id: string;
  revisionNumber: number;
  sourceDraftRevision: number;
  candidateFingerprint: string;
  contractFingerprint: string;
  actorSource: string;
  note: string | null;
  isActive: boolean;
  createdAt: Date;
};

export type RevisionDetail = RevisionSummary & {
  schemaVersion: number;
  compilerVersion: string;
  server: {
    name: string;
    description: string | null;
    baseUrl: string;
    allowedHosts: string[];
  };
  diffSummary: unknown;
  tools: Array<{
    sourceToolId: string;
    name: string;
    title: string | null;
    description: string | null;
    method: string;
    enabled: boolean;
    allowMutation: boolean;
    source: string;
    contractFingerprint: string | null;
    definitionHash: string | null;
    compileStatus: string | null;
    compileIssueCount: number;
  }>;
  configs: Array<{
    sourceValueId: string;
    name: string;
    kind: string;
    owner: string | null;
    hasValue: boolean;
    available: boolean;
  }>;
  missingSecretCount: number;
};

export type RestoreRevisionInput = {
  serverId: string;
  revisionId: string;
  expectedRevision: number;
  expectedDraftRevision: number;
};

export type RestoreRevisionResult = {
  serverId: string;
  revisionId: string;
  draftRevision: number;
  configRevision: number;
  missingSecretCount: number;
  toolCount: number;
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

export function useMcpCallLogs(serverId: string, input: PaginationInput) {
  return useQuery({
    ...api.mcp.callLogs.queryOptions({ serverId, ...input }),
    placeholderData: keepPreviousData,
    enabled: serverId.length > 0,
  });
}

/** Advisory publication preview for the observed draft revision. */
export function usePublishPreview(
  serverId: string,
): UseQueryResult<PublishPreview> {
  return useQuery({
    ...api.mcp.publishPreview.queryOptions({ serverId }),
    enabled: serverId.length > 0,
  }) as unknown as UseQueryResult<PublishPreview>;
}

export function useRevisionHistory(
  serverId: string,
  input: PaginationInput,
): UseQueryResult<Paginated<RevisionSummary>> {
  return useQuery({
    ...api.mcp.revisionHistory.queryOptions({ serverId, ...input }),
    placeholderData: keepPreviousData,
    enabled: serverId.length > 0,
  }) as unknown as UseQueryResult<Paginated<RevisionSummary>>;
}

export function useRevisionDetail(
  serverId: string,
  revisionId: string,
  options: { enabled?: boolean } = {},
): UseQueryResult<RevisionDetail> {
  return useQuery({
    ...api.mcp.revisionDetail.queryOptions({ serverId, revisionId }),
    enabled:
      (options.enabled ?? true) && serverId.length > 0 && revisionId.length > 0,
  }) as unknown as UseQueryResult<RevisionDetail>;
}

export function usePlatformTokens(
  input: { page?: number; pageSize?: 10 | 20 | 50 } = {},
) {
  return useQuery({
    ...api.mcp.platformTokens.queryOptions(input),
    placeholderData: keepPreviousData,
  });
}

export function usePlatformSecurityEvents(
  input: { page?: number; pageSize?: 10 | 20 | 50 } = {},
) {
  return useQuery({
    ...api.mcp.platformSecurityEvents.queryOptions(input),
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
      queryClient.invalidateQueries(api.mcp.callLogs.pathFilter()),
      queryClient.invalidateQueries(api.mcp.publishPreview.pathFilter()),
      queryClient.invalidateQueries(api.mcp.revisionHistory.pathFilter()),
      queryClient.invalidateQueries(api.mcp.revisionDetail.pathFilter()),
      queryClient.invalidateQueries(api.mcp.platformTokens.pathFilter()),
      queryClient.invalidateQueries(
        api.mcp.platformSecurityEvents.pathFilter(),
      ),
    ]);
  };
}

export const STALE_PUBLISH_CODES: ReadonlySet<string> = new Set([
  APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT,
  APP_ERROR_CODES.MCP_PUBLISH_STALE_REVISION,
  APP_ERROR_CODES.MCP_PUBLISH_CANDIDATE_CHANGED,
]);

/**
 * Centralized mutation error handling. Write and publication conflicts
 * invalidate and reload the server aggregate so stale state is never reported
 * as saved; every failure surfaces localized copy.
 */
export function useMcpMutationError() {
  const { t } = useTranslations();
  const invalidate = useInvalidateMcp();
  return (error: unknown) => {
    const code = getAppCode(error);
    if (
      code === APP_ERROR_CODES.MCP_WRITE_CONFLICT ||
      STALE_PUBLISH_CODES.has(code ?? "")
    ) {
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

export function usePublishServer(): UseMutationResult<
  PublishResult,
  Error,
  PublishServerInput,
  unknown
> {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.publishServer.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (data, ...rest) => {
      baseOptions.onSuccess?.(data, ...rest);
      await invalidate();
      toast.success(
        t.toasts.servers.published.replace(
          "{number}",
          String(data.revisionNumber),
        ),
      );
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      handleError(error);
    },
  }) as unknown as UseMutationResult<
    PublishResult,
    Error,
    PublishServerInput,
    unknown
  >;
}

export function useRestoreRevision(): UseMutationResult<
  RestoreRevisionResult,
  Error,
  RestoreRevisionInput,
  unknown
> {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.restoreRevision.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (data, ...rest) => {
      baseOptions.onSuccess?.(data, ...rest);
      await invalidate();
      toast.success(t.toasts.servers.restored);
    },
    onError: (error, ...rest) => {
      baseOptions.onError?.(error, ...rest);
      handleError(error);
    },
  }) as unknown as UseMutationResult<
    RestoreRevisionResult,
    Error,
    RestoreRevisionInput,
    unknown
  >;
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

export function useRotatePlatformToken() {
  const { t } = useTranslations();
  const handleError = useMcpMutationError();
  const invalidate = useInvalidateMcp();
  const baseOptions = api.mcp.rotatePlatformToken.mutationOptions();
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

export function useRequestPlatformStepUp() {
  const handleError = useMcpMutationError();
  return useMutation({
    ...api.mcp.requestPlatformStepUp.mutationOptions(),
    onError: (error, ...rest) => {
      handleError(error);
      void rest;
    },
  });
}

export function useVerifyPlatformStepUp() {
  const handleError = useMcpMutationError();
  return useMutation({
    ...api.mcp.verifyPlatformStepUp.mutationOptions(),
    onError: (error, ...rest) => {
      handleError(error);
      void rest;
    },
  });
}
