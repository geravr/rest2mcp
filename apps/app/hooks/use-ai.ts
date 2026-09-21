import type {
  AiCapabilityProfileId,
  AiCatalogSnapshot,
  AiConnectionProjection,
  AiProviderKind,
  AiReadiness,
  AiSelectionProjection,
} from "@repo/core";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "@/lib/trpc";

export type AiConnectionsResult = { connections: AiConnectionProjection[] };

export type ConnectAiProviderInput = {
  providerKind: AiProviderKind;
  credential: string;
};

export type RotateAiCredentialInput = {
  connectionId: string;
  credential: string;
  expectedConfigRevision: number;
  expectedCredentialRevision?: number;
};

export type RemoveAiConnectionInput = {
  connectionId: string;
  expectedConfigRevision: number;
};

export type VerifyAiModelInput = {
  connectionId: string;
  capabilityProfile: AiCapabilityProfileId;
  modelId: string;
  expectedConfigRevision?: number;
};

export type RefreshAiCatalogInput = {
  providerKind: AiProviderKind;
  capabilityProfile: AiCapabilityProfileId;
};

/**
 * Non-secret AI connection projections for the signed-in owner. Loading and
 * error states are observed through the returned tRPC query statuses.
 */
export function useAiConnections(): UseQueryResult<AiConnectionsResult> {
  return useQuery(
    api.ai.connections.queryOptions(),
  ) as unknown as UseQueryResult<AiConnectionsResult>;
}

/** Server-side readiness of one capability profile for the owner. */
export function useAiReadiness(
  capabilityProfile: AiCapabilityProfileId,
): UseQueryResult<AiReadiness> {
  return useQuery(
    api.ai.readiness.queryOptions({ capabilityProfile }),
  ) as unknown as UseQueryResult<AiReadiness>;
}

/**
 * Compatible-model catalog snapshot for one provider and capability profile.
 * Pass `{ enabled: false }` to defer fetching until a picker is opened.
 */
export function useAiCatalog(
  providerKind: AiProviderKind,
  capabilityProfile: AiCapabilityProfileId,
  options: { enabled?: boolean } = {},
): UseQueryResult<AiCatalogSnapshot> {
  return useQuery({
    ...api.ai.catalog.queryOptions({ providerKind, capabilityProfile }),
    enabled: options.enabled ?? true,
  }) as unknown as UseQueryResult<AiCatalogSnapshot>;
}

/**
 * Forces a live provider refresh for one catalog and then invalidates the
 * cached catalog queries so rendered pickers reload from the new snapshot.
 */
export function useRefreshAiCatalog() {
  const queryClient = useQueryClient();
  return async (input: RefreshAiCatalogInput) => {
    await queryClient.fetchQuery(
      api.ai.catalog.queryOptions({ ...input, refresh: true }),
    );
    await queryClient.invalidateQueries(api.ai.catalog.pathFilter());
  };
}

/**
 * Invalidates every AI query (connections, readiness, catalog) so connection
 * changes are reflected everywhere at once.
 */
export function useInvalidateAi() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries(api.ai.connections.pathFilter()),
      queryClient.invalidateQueries(api.ai.readiness.pathFilter()),
      queryClient.invalidateQueries(api.ai.catalog.pathFilter()),
    ]);
  };
}

/**
 * Connects a provider. The server verifies the credential before any write;
 * mutation errors are surfaced to the caller for localized inline rendering.
 */
export function useConnectAiProvider(): UseMutationResult<
  AiConnectionProjection,
  Error,
  ConnectAiProviderInput
> {
  const invalidate = useInvalidateAi();
  const baseOptions = api.ai.connect.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
    },
  }) as unknown as UseMutationResult<
    AiConnectionProjection,
    Error,
    ConnectAiProviderInput
  >;
}

/**
 * Replaces a connection credential. Uses optimistic concurrency via
 * `expectedConfigRevision` / `expectedCredentialRevision`; revision conflicts
 * must be handled by the caller.
 */
export function useRotateAiCredential(): UseMutationResult<
  AiConnectionProjection,
  Error,
  RotateAiCredentialInput
> {
  const invalidate = useInvalidateAi();
  const baseOptions = api.ai.rotate.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
    },
  }) as unknown as UseMutationResult<
    AiConnectionProjection,
    Error,
    RotateAiCredentialInput
  >;
}

/** Removes a connection together with its catalog and verified selection. */
export function useRemoveAiConnection(): UseMutationResult<
  { removed: true },
  Error,
  RemoveAiConnectionInput
> {
  const invalidate = useInvalidateAi();
  const baseOptions = api.ai.remove.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
    },
  }) as unknown as UseMutationResult<
    { removed: true },
    Error,
    RemoveAiConnectionInput
  >;
}

/**
 * Verifies one model against the capability profile and stores it as the
 * active selection on success. Success invalidates readiness so every AI
 * surface observes the new selection.
 */
export function useVerifyAiModel(): UseMutationResult<
  AiSelectionProjection,
  Error,
  VerifyAiModelInput
> {
  const invalidate = useInvalidateAi();
  const baseOptions = api.ai.verifyModel.mutationOptions();
  return useMutation({
    ...baseOptions,
    onSuccess: async (...args) => {
      baseOptions.onSuccess?.(...args);
      await invalidate();
    },
  }) as unknown as UseMutationResult<
    AiSelectionProjection,
    Error,
    VerifyAiModelInput
  >;
}
