import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@repo/api";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "@/lib/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;

export type OptimizerPreflightResult =
  RouterOutput["aiOptimizer"]["preflightDraft"];
export type OptimizerAuthorizeResult = RouterOutput["aiOptimizer"]["authorize"];
export type OptimizerRunSummary = RouterOutput["aiOptimizer"]["status"];
export type OptimizerPaginatedItems = RouterOutput["aiOptimizer"]["listItems"];
export type OptimizerItemDetail = RouterOutput["aiOptimizer"]["item"];
export type OptimizerPaginatedRuns = RouterOutput["aiOptimizer"]["listRuns"];
export type OptimizerCancelResult = RouterOutput["aiOptimizer"]["cancel"];
export type OptimizerRejectResult = RouterOutput["aiOptimizer"]["reject"];
export type OptimizerApplyDraftResult =
  RouterOutput["aiOptimizer"]["applyDraft"];
export type OptimizerItemSummary = OptimizerPaginatedItems["items"][number];

export type OptimizerScopeInput =
  | { kind: "single"; toolIds: [string] }
  | { kind: "selected"; toolIds: string[] }
  | { kind: "all_eligible" };

export type PreflightDraftInput = {
  serverId: string;
  scope: OptimizerScopeInput;
  expectedConfigRevision: number;
};

export type PreflightOpenapiInput = {
  serverId: string;
  source:
    | { kind: "content"; content: string; label?: "file" | "paste" }
    | { kind: "url"; url: string };
  fingerprint: string;
  operationKeys: string[];
  expectedConfigRevision: number;
};

export type AuthorizeInput = {
  runId: string;
  expectedConfigRevision: number;
  expectedDraftRevision?: number;
  /** Required for OpenAPI runs so authorization can reparse the source. */
  source?: PreflightOpenapiInput["source"];
};

export type ApplyDraftInput = {
  runId: string;
  selections: Array<{ itemId: string; operationIds: string[] }>;
  expectedConfigRevision: number;
  expectedDraftRevision: number;
  applyKey: string;
};

/** Write-free preflight plan for draft tools; no model call happens here. */
export function useOptimizerPreflightDraft(): UseMutationResult<
  OptimizerPreflightResult,
  Error,
  PreflightDraftInput
> {
  return useMutation(
    api.aiOptimizer.preflightDraft.mutationOptions(),
  ) as unknown as UseMutationResult<
    OptimizerPreflightResult,
    Error,
    PreflightDraftInput
  >;
}

/** Write-free preflight plan for selected OpenAPI candidates. */
export function useOptimizerPreflightOpenapi(): UseMutationResult<
  OptimizerPreflightResult,
  Error,
  PreflightOpenapiInput
> {
  return useMutation(
    api.aiOptimizer.preflightOpenapi.mutationOptions(),
  ) as unknown as UseMutationResult<
    OptimizerPreflightResult,
    Error,
    PreflightOpenapiInput
  >;
}

/** Authorizes the exact planned run after the owner confirms disclosure. */
export function useOptimizerAuthorize(): UseMutationResult<
  OptimizerAuthorizeResult,
  Error,
  AuthorizeInput
> {
  return useMutation(
    api.aiOptimizer.authorize.mutationOptions(),
  ) as unknown as UseMutationResult<
    OptimizerAuthorizeResult,
    Error,
    AuthorizeInput
  >;
}

/** Durable run status with live progress counts; polls while active. */
export function useOptimizerStatus(
  runId: string | null,
  options?: { refetchWhileActive?: boolean },
): UseQueryResult<OptimizerRunSummary> {
  return useQuery({
    ...api.aiOptimizer.status.queryOptions({ runId: runId ?? "" }),
    enabled: runId !== null,
    refetchInterval:
      options?.refetchWhileActive === false
        ? false
        : (query) => {
            const state = (query.state.data as OptimizerRunSummary | undefined)
              ?.state;
            const active =
              state === "queued" ||
              state === "running" ||
              state === "planned" ||
              state === "cancel_requested";
            return active ? 3_000 : false;
          },
  }) as unknown as UseQueryResult<OptimizerRunSummary>;
}

/** Paginated analyzed items for one run. */
export function useOptimizerItems(
  runId: string | null,
  page = 1,
  pageSize = 20,
): UseQueryResult<OptimizerPaginatedItems> {
  return useQuery({
    ...api.aiOptimizer.listItems.queryOptions({
      runId: runId ?? "",
      page,
      pageSize,
    }),
    enabled: runId !== null,
  }) as unknown as UseQueryResult<OptimizerPaginatedItems>;
}

/** Full review artifacts for one item. */
export function useOptimizerItem(
  runId: string | null,
  itemId: string | null,
): UseQueryResult<OptimizerItemDetail> {
  return useQuery({
    ...api.aiOptimizer.item.queryOptions({
      runId: runId ?? "",
      itemId: itemId ?? "",
    }),
    enabled: runId !== null && itemId !== null,
  }) as unknown as UseQueryResult<OptimizerItemDetail>;
}

/** Run history for one server. */
export function useOptimizerRuns(
  serverId: string,
  page = 1,
  pageSize = 10,
  options?: { enabled?: boolean },
): UseQueryResult<OptimizerPaginatedRuns> {
  return useQuery({
    ...api.aiOptimizer.listRuns.queryOptions({ serverId, page, pageSize }),
    enabled: options?.enabled ?? true,
  }) as unknown as UseQueryResult<OptimizerPaginatedRuns>;
}

export function useOptimizerCancel(): UseMutationResult<
  OptimizerCancelResult,
  Error,
  { runId: string }
> {
  return useMutation(
    api.aiOptimizer.cancel.mutationOptions(),
  ) as unknown as UseMutationResult<
    OptimizerCancelResult,
    Error,
    { runId: string }
  >;
}

export function useOptimizerReject(): UseMutationResult<
  OptimizerRejectResult,
  Error,
  { runId: string; itemId: string }
> {
  return useMutation(
    api.aiOptimizer.reject.mutationOptions(),
  ) as unknown as UseMutationResult<
    OptimizerRejectResult,
    Error,
    { runId: string; itemId: string }
  >;
}

/**
 * Applies owner-selected operations atomically to the draft. On success the
 * server, tools, and publication-readiness state are invalidated.
 */
export function useOptimizerApplyDraft(): UseMutationResult<
  OptimizerApplyDraftResult,
  Error,
  ApplyDraftInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    ...api.aiOptimizer.applyDraft.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mcp"] });
      void queryClient.invalidateQueries({ queryKey: ["aiOptimizer"] });
    },
  }) as unknown as UseMutationResult<
    OptimizerApplyDraftResult,
    Error,
    ApplyDraftInput
  >;
}
