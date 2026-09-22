/**
 * @file Authenticated tRPC surface for AI tool optimization. Thin procedures:
 * strict input validation and owner scoping live here, all business logic in
 * the optimizer service. Provider calls are never triggered by review or
 * apply endpoints.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../lib/trpc.js";
import type { TRPCContext } from "../lib/context.js";
import { getAiProviderAdapter } from "../lib/ai/provider-registry.js";
import {
  optimizerApplyDraftInputSchema,
  optimizerApplyDraftResultSchema,
  optimizerAuthorizeInputSchema,
  optimizerAuthorizeResultSchema,
  optimizerCancelInputSchema,
  optimizerCancelResultSchema,
  optimizerItemDetailSchema,
  optimizerListItemsInputSchema,
  optimizerListRunsInputSchema,
  optimizerPaginatedItemsSchema,
  optimizerPaginatedRunsSchema,
  optimizerPreflightDraftInputSchema,
  optimizerPreflightOpenapiInputSchema,
  optimizerPreflightResultSchema,
  optimizerRejectInputSchema,
  optimizerRejectResultSchema,
  optimizerRunSummarySchema,
} from "../lib/mcp-optimizer-contracts.js";
import {
  applyOptimizationToDraft,
  authorizeOptimization,
  cancelOptimization,
  getOptimizationItem,
  getOptimizationStatus,
  listOptimizationItems,
  listOptimizationRuns,
  preflightDraftOptimization,
  preflightOpenApiOptimization,
  rejectOptimizationItem,
  type AiOptimizerDeps,
} from "../services/ai-optimizer-service.js";

function optimizerDeps(ctx: Pick<TRPCContext, "db">): AiOptimizerDeps {
  return { db: ctx.db, getAdapter: getAiProviderAdapter };
}

const runIdInput = z.strictObject({ runId: z.string().min(1) });

export const aiOptimizerRouter = router({
  preflightDraft: protectedProcedure
    .input(optimizerPreflightDraftInputSchema)
    .output(optimizerPreflightResultSchema)
    .mutation(({ ctx, input }) =>
      preflightDraftOptimization(optimizerDeps(ctx), ctx.user.id, input),
    ),

  preflightOpenapi: protectedProcedure
    .input(optimizerPreflightOpenapiInputSchema)
    .output(optimizerPreflightResultSchema)
    .mutation(({ ctx, input }) =>
      preflightOpenApiOptimization(optimizerDeps(ctx), ctx.user.id, input),
    ),

  authorize: protectedProcedure
    .input(optimizerAuthorizeInputSchema)
    .output(optimizerAuthorizeResultSchema)
    .mutation(({ ctx, input }) =>
      authorizeOptimization(optimizerDeps(ctx), ctx.user.id, input),
    ),

  status: protectedProcedure
    .input(runIdInput)
    .output(optimizerRunSummarySchema)
    .query(({ ctx, input }) =>
      getOptimizationStatus(optimizerDeps(ctx), ctx.user.id, input.runId),
    ),

  listRuns: protectedProcedure
    .input(optimizerListRunsInputSchema)
    .output(optimizerPaginatedRunsSchema)
    .query(({ ctx, input }) =>
      listOptimizationRuns(optimizerDeps(ctx), ctx.user.id, input),
    ),

  listItems: protectedProcedure
    .input(optimizerListItemsInputSchema)
    .output(optimizerPaginatedItemsSchema)
    .query(({ ctx, input }) =>
      listOptimizationItems(optimizerDeps(ctx), ctx.user.id, input),
    ),

  item: protectedProcedure
    .input(
      z.strictObject({ runId: z.string().min(1), itemId: z.string().min(1) }),
    )
    .output(optimizerItemDetailSchema)
    .query(({ ctx, input }) =>
      getOptimizationItem(
        optimizerDeps(ctx),
        ctx.user.id,
        input.runId,
        input.itemId,
      ),
    ),

  cancel: protectedProcedure
    .input(optimizerCancelInputSchema)
    .output(optimizerCancelResultSchema)
    .mutation(({ ctx, input }) =>
      cancelOptimization(optimizerDeps(ctx), ctx.user.id, input.runId),
    ),

  reject: protectedProcedure
    .input(optimizerRejectInputSchema)
    .output(optimizerRejectResultSchema)
    .mutation(({ ctx, input }) =>
      rejectOptimizationItem(
        optimizerDeps(ctx),
        ctx.user.id,
        input.runId,
        input.itemId,
      ),
    ),

  applyDraft: protectedProcedure
    .input(optimizerApplyDraftInputSchema)
    .output(optimizerApplyDraftResultSchema)
    .mutation(({ ctx, input }) =>
      applyOptimizationToDraft(optimizerDeps(ctx), ctx.user.id, input),
    ),
});
