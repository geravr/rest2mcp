/**
 * @file Authenticated tRPC surface for AI provider management. Inputs are
 * strict: unknown fields (including any endpoint or base-URL override) are
 * rejected before any outbound call or database write.
 */
import {
  aiCapabilityProfileIdSchema,
  aiCatalogSnapshotSchema,
  aiConnectionProjectionSchema,
  aiProviderKindSchema,
  aiReadinessSchema,
  aiSelectionProjectionSchema,
} from "@repo/core";
import { z } from "zod";
import { protectedProcedure, router } from "../lib/trpc.js";
import type { TRPCContext } from "../lib/context.js";
import { getAiProviderAdapter } from "../lib/ai/provider-registry.js";
import {
  connectAiProvider,
  getAiReadiness,
  listAiConnections,
  removeAiConnection,
  rotateAiProviderCredential,
} from "../services/ai-provider-service.js";
import {
  getAiCatalogSnapshot,
  verifyAndSelectAiModel,
} from "../services/ai-catalog-service.js";

const credentialSchema = z.string().trim().min(16).max(4096);

const capabilityProfileInput = z.strictObject({
  capabilityProfile: aiCapabilityProfileIdSchema,
});

export const aiRouter = router({
  connections: protectedProcedure
    .output(
      z.strictObject({
        connections: z.array(aiConnectionProjectionSchema),
      }),
    )
    .query(({ ctx }) => listAiConnections(aiDeps(ctx), ctx.user.id)),

  readiness: protectedProcedure
    .input(capabilityProfileInput)
    .output(aiReadinessSchema)
    .query(({ ctx, input }) =>
      getAiReadiness(aiDeps(ctx), ctx.user.id, input.capabilityProfile),
    ),

  connect: protectedProcedure
    .input(
      z.strictObject({
        providerKind: aiProviderKindSchema,
        credential: credentialSchema,
      }),
    )
    .output(aiConnectionProjectionSchema)
    .mutation(({ ctx, input }) =>
      connectAiProvider(aiDeps(ctx), ctx.user.id, input),
    ),

  rotate: protectedProcedure
    .input(
      z.strictObject({
        connectionId: z.string().min(1),
        credential: credentialSchema,
        expectedConfigRevision: z.number().int().min(1),
        expectedCredentialRevision: z.number().int().min(1).optional(),
      }),
    )
    .output(aiConnectionProjectionSchema)
    .mutation(({ ctx, input }) =>
      rotateAiProviderCredential(aiDeps(ctx), ctx.user.id, input),
    ),

  remove: protectedProcedure
    .input(
      z.strictObject({
        connectionId: z.string().min(1),
        expectedConfigRevision: z.number().int().min(1),
      }),
    )
    .output(
      z.strictObject({
        removed: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await removeAiConnection(aiDeps(ctx), ctx.user.id, input);
      return { removed: true } as const;
    }),

  catalog: protectedProcedure
    .input(
      z.strictObject({
        providerKind: aiProviderKindSchema,
        capabilityProfile: aiCapabilityProfileIdSchema,
        refresh: z.boolean().optional(),
      }),
    )
    .output(aiCatalogSnapshotSchema)
    .query(({ ctx, input }) =>
      getAiCatalogSnapshot(aiDeps(ctx), ctx.user.id, input),
    ),

  verifyModel: protectedProcedure
    .input(
      z.strictObject({
        connectionId: z.string().min(1),
        capabilityProfile: aiCapabilityProfileIdSchema,
        modelId: z.string().trim().min(1).max(256),
        expectedConfigRevision: z.number().int().min(1).optional(),
      }),
    )
    .output(aiSelectionProjectionSchema)
    .mutation(({ ctx, input }) =>
      verifyAndSelectAiModel(aiDeps(ctx), ctx.user.id, input),
    ),
});

function aiDeps(ctx: Pick<TRPCContext, "db" | "env">) {
  return {
    db: ctx.db,
    aiCredentialSecret: ctx.env.AI_CREDENTIAL_SECRET,
    getAdapter: getAiProviderAdapter,
  };
}
