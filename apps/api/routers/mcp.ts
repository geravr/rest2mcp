import { paginationInputSchema } from "@repo/core";
import { z } from "zod";
import { serverAuthRecipeSchema } from "../lib/mcp-auth-recipe.js";
import { mcpCommonEntriesSchema } from "../lib/mcp-request-definition.js";
import {
  createPlatformPatCommandSchema,
  createToolCommandSchema,
  curlConfirmCommandSchema,
  duplicateToolCommandSchema,
  expectedRevisionSchema,
  previewToolCompileCommandSchema,
  publishPreviewCommandSchema,
  publishServerCommandSchema,
  restoreRevisionCommandSchema,
  revisionDetailCommandSchema,
  revisionHistoryCommandSchema,
  revokePlatformPatCommandSchema,
  rotatePlatformPatCommandSchema,
  updateToolCommandSchema,
  verifyPlatformStepUpCommandSchema,
} from "../lib/mcp-domain-commands.js";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import { validatePlatformGrantRequest } from "../lib/mcp-platform-principal.js";
import { protectedProcedure, router } from "../lib/trpc.js";
import { reconcileServerIconAssetsWithEnv } from "../services/mcp-asset-service.js";
import { executeMappedTool } from "../services/mcp-executor-service.js";
import {
  confirmCurlImport,
  createServer,
  createServerToken,
  createTool,
  createVariable,
  deleteServer,
  deleteTool,
  deleteVariable,
  duplicateTool,
  getConnectionSnippet,
  getServer,
  getServerCommon,
  listCallLogs,
  listServerTokens,
  listServers,
  listTools,
  listVariables,
  previewCurlImport,
  previewToolCompile,
  resolveApiOrigin,
  revokeServerToken,
  setServerAuth,
  testConnection,
  updateServer,
  updateServerCommon,
  updateTool,
  updateVariable,
} from "../services/mcp-studio-service.js";
import {
  createPlatformPat,
  listPlatformPats,
  revokePlatformPat,
  rotatePlatformPat,
} from "../services/mcp-platform-token-service.js";
import {
  getRevisionDetail,
  listRevisionHistory,
  previewPublish,
  publishServer,
  restoreRevisionToDraft,
} from "../services/mcp-publishing-service.js";
import {
  createPlatformStepUpGrant,
  requestPlatformStepUpOtp,
  verifyPlatformStepUpOtp,
} from "../services/mcp-platform-step-up-service.js";
import {
  listPlatformSecurityEvents,
  recordPlatformSecurityEventBestEffort,
} from "../services/mcp-platform-security-event-service.js";

const serverIdInput = z.object({ serverId: z.string().min(1) });

const variableNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*$/);

export const mcpRouter = router({
  servers: protectedProcedure
    .input(paginationInputSchema.optional())
    .query(({ ctx, input }) =>
      listServers(
        ctx.db,
        ctx.user.id,
        paginationInputSchema.parse(input ?? {}),
      ),
    ),

  createServer: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).nullable().optional(),
        baseUrl: z.url(),
        slug: z.string().trim().min(1).max(64).optional(),
        auth: serverAuthRecipeSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createServer(
        ctx.dbDirect,
        ctx.user.id,
        input,
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
    ),

  setServerAuth: protectedProcedure
    .input(
      serverIdInput.extend({
        expectedRevision: expectedRevisionSchema,
        auth: serverAuthRecipeSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      setServerAuth(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.expectedRevision,
        input.auth,
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
    ),

  getServer: protectedProcedure
    .input(serverIdInput)
    .query(({ ctx, input }) => getServer(ctx.db, ctx.user.id, input.serverId)),

  updateServer: protectedProcedure
    .input(
      serverIdInput
        .extend({
          expectedRevision: expectedRevisionSchema,
          name: z.string().trim().min(1).max(120).optional(),
          description: z.string().trim().max(2000).nullable().optional(),
          iconAssetId: z.string().min(1).nullable().optional(),
          baseUrl: z.url().optional(),
          status: z.enum(["draft", "live", "paused"]).optional(),
          allowedHosts: z.array(z.string().min(1)).optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateServer(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input,
      );
      // Opportunistic post-commit sweep for replaced/abandoned icon assets.
      if (input.iconAssetId !== undefined) {
        void reconcileServerIconAssetsWithEnv(ctx.dbDirect, ctx.env).catch(
          () => {},
        );
      }
      return result;
    }),

  deleteServer: protectedProcedure
    .input(serverIdInput.extend({ expectedRevision: expectedRevisionSchema }))
    .mutation(({ ctx, input }) =>
      deleteServer(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.expectedRevision,
      ),
    ),

  testConnection: protectedProcedure
    .input(serverIdInput)
    .mutation(({ ctx, input }) =>
      testConnection(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
    ),

  tools: protectedProcedure
    .input(serverIdInput.extend(paginationInputSchema.shape))
    .query(({ ctx, input }) =>
      listTools(ctx.db, ctx.user.id, input.serverId, input),
    ),

  createTool: protectedProcedure
    .input(createToolCommandSchema)
    .mutation(({ ctx, input }) =>
      createTool(ctx.dbDirect, ctx.user.id, input.serverId, input),
    ),

  createToolFromCurl: protectedProcedure
    .input(curlConfirmCommandSchema)
    .mutation(({ ctx, input }) =>
      confirmCurlImport(ctx.dbDirect, ctx.user.id, input.serverId, input),
    ),

  parseCurlPreview: protectedProcedure
    .input(
      serverIdInput.extend({
        curl: z.string().trim().min(1).max(20_000),
      }),
    )
    .mutation(({ ctx, input }) =>
      previewCurlImport(ctx.db, ctx.user.id, input.serverId, input.curl),
    ),

  updateTool: protectedProcedure
    .input(updateToolCommandSchema)
    .mutation(({ ctx, input }) =>
      updateTool(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.toolId,
        input,
      ),
    ),

  duplicateTool: protectedProcedure
    .input(duplicateToolCommandSchema)
    .mutation(({ ctx, input }) =>
      duplicateTool(ctx.dbDirect, ctx.user.id, input.serverId, input.toolId, {
        expectedRevision: input.expectedRevision,
        name: input.name,
        title: input.title,
        description: input.description,
        enabled: input.enabled,
      }),
    ),

  deleteTool: protectedProcedure
    .input(
      serverIdInput.extend({
        toolId: z.string().min(1),
        expectedRevision: expectedRevisionSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      deleteTool(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.toolId,
        input.expectedRevision,
      ),
    ),

  previewToolCompile: protectedProcedure
    .input(previewToolCompileCommandSchema)
    .mutation(({ ctx, input }) =>
      previewToolCompile(ctx.db, ctx.user.id, input.serverId, {
        name: input.name,
        title: input.title,
        description: input.description,
        method: input.method,
        requestDefinition: input.requestDefinition,
        allowMutation: input.allowMutation,
      }),
    ),

  serverCommon: protectedProcedure
    .input(serverIdInput)
    .query(({ ctx, input }) =>
      getServerCommon(ctx.db, ctx.user.id, input.serverId),
    ),

  updateServerCommon: protectedProcedure
    .input(
      serverIdInput.extend({
        expectedRevision: expectedRevisionSchema,
        common: mcpCommonEntriesSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      updateServerCommon(ctx.dbDirect, ctx.user.id, input.serverId, {
        expectedRevision: input.expectedRevision,
        common: input.common,
      }),
    ),

  variables: protectedProcedure
    .input(serverIdInput)
    .query(({ ctx, input }) =>
      listVariables(ctx.db, ctx.user.id, input.serverId),
    ),

  createVariable: protectedProcedure
    .input(
      serverIdInput.extend({
        expectedRevision: expectedRevisionSchema,
        name: variableNameSchema,
        kind: z.enum(["config", "secret"]),
        value: z.string().max(8_000),
        description: z.string().trim().max(2_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createVariable(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        {
          expectedRevision: input.expectedRevision,
          name: input.name,
          kind: input.kind,
          value: input.value,
          description: input.description,
        },
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
    ),

  updateVariable: protectedProcedure
    .input(
      serverIdInput.extend({
        expectedRevision: expectedRevisionSchema,
        valueId: z.string().min(1),
        value: z.string().max(8_000).optional(),
        kind: z.enum(["config", "secret"]).optional(),
        description: z.string().trim().max(2_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateVariable(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.valueId,
        {
          expectedRevision: input.expectedRevision,
          value: input.value,
          kind: input.kind,
          description: input.description,
        },
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
    ),

  deleteVariable: protectedProcedure
    .input(
      serverIdInput.extend({
        expectedRevision: expectedRevisionSchema,
        valueId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      deleteVariable(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.valueId,
        input.expectedRevision,
      ),
    ),

  tokens: protectedProcedure
    .input(serverIdInput)
    .query(({ ctx, input }) =>
      listServerTokens(ctx.db, ctx.user.id, input.serverId),
    ),

  createToken: protectedProcedure
    .input(
      serverIdInput.extend({
        expectedRevision: expectedRevisionSchema,
        name: z.string().trim().max(80).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createServerToken(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.expectedRevision,
        input.name,
      ),
    ),

  revokeToken: protectedProcedure
    .input(
      serverIdInput.extend({
        tokenId: z.string().min(1),
        expectedRevision: expectedRevisionSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      revokeServerToken(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.tokenId,
        input.expectedRevision,
      ),
    ),

  connectionSnippet: protectedProcedure
    .input(serverIdInput)
    .query(({ ctx, input }) =>
      getConnectionSnippet(
        ctx.db,
        ctx.user.id,
        input.serverId,
        resolveApiOrigin(ctx.req, ctx.env.API_ORIGIN),
      ),
    ),

  invokeTool: protectedProcedure
    .input(
      serverIdInput
        .extend({
          toolId: z.string().min(1),
          args: z.record(z.string(), z.unknown()).optional(),
          mode: z.enum(["published", "draft"]).optional(),
          expectedDraftRevision: z.number().int().min(1).optional(),
        })
        .refine(
          (value) =>
            value.mode !== "draft" || value.expectedDraftRevision !== undefined,
          {
            message:
              "Draft execution requires the observed expectedDraftRevision.",
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await executeMappedTool(ctx.dbDirect, {
        serverId: input.serverId,
        ownerUserId: ctx.user.id,
        toolId: input.toolId,
        args: input.args,
        source: "playground",
        mode: input.mode ?? "published",
        expectedDraftRevision: input.expectedDraftRevision,
        credentialSecret: ctx.env.MCP_CREDENTIAL_SECRET,
      });
      return {
        ok: result.ok,
        httpStatus: result.httpStatus,
        envelope: result.envelope,
        durationMs: result.durationMs,
        callLogId: result.callLogId,
      };
    }),

  callLogs: protectedProcedure
    .input(serverIdInput.extend(paginationInputSchema.shape))
    .query(({ ctx, input }) =>
      listCallLogs(ctx.db, ctx.user.id, input.serverId, input),
    ),

  publishPreview: protectedProcedure
    .input(publishPreviewCommandSchema)
    .query(({ ctx, input }) =>
      previewPublish(ctx.db, ctx.user.id, input.serverId),
    ),

  publishServer: protectedProcedure
    .input(publishServerCommandSchema)
    .mutation(({ ctx, input }) =>
      publishServer(ctx.dbDirect, {
        ...input,
        userId: ctx.user.id,
        actorSource: "studio",
      }),
    ),

  revisionHistory: protectedProcedure
    .input(revisionHistoryCommandSchema)
    .query(({ ctx, input }) =>
      listRevisionHistory(ctx.db, ctx.user.id, input.serverId, {
        page: input.page,
        pageSize: input.pageSize,
      }),
    ),

  revisionDetail: protectedProcedure
    .input(revisionDetailCommandSchema)
    .query(({ ctx, input }) =>
      getRevisionDetail(ctx.db, ctx.user.id, input.serverId, input.revisionId),
    ),

  restoreRevision: protectedProcedure
    .input(restoreRevisionCommandSchema)
    .mutation(({ ctx, input }) =>
      restoreRevisionToDraft(ctx.dbDirect, {
        ...input,
        userId: ctx.user.id,
      }),
    ),

  platformTokens: protectedProcedure
    .input(paginationInputSchema.optional())
    .query(({ ctx, input }) =>
      listPlatformPats(ctx.db, ctx.user.id, input ?? { page: 1, pageSize: 10 }),
    ),

  createPlatformToken: protectedProcedure
    .input(createPlatformPatCommandSchema)
    .mutation(({ ctx, input }) =>
      createPlatformPat(ctx.dbDirect, ctx.user.id, {
        ...input,
        sessionId: ctx.session.id,
      }),
    ),

  rotatePlatformToken: protectedProcedure
    .input(rotatePlatformPatCommandSchema)
    .mutation(({ ctx, input }) =>
      rotatePlatformPat(ctx.dbDirect, ctx.user.id, {
        ...input,
        sessionId: ctx.session.id,
      }),
    ),

  revokePlatformToken: protectedProcedure
    .input(revokePlatformPatCommandSchema)
    .mutation(({ ctx, input }) =>
      revokePlatformPat(ctx.dbDirect, ctx.user.id, input.tokenId),
    ),

  requestPlatformStepUp: protectedProcedure.mutation(({ ctx }) => {
    const ip =
      ctx.req.headers.get("cf-connecting-ip")?.trim() ||
      ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;
    return requestPlatformStepUpOtp(ctx.dbDirect, ctx.env, {
      userId: ctx.user.id,
      email: ctx.user.email,
      ip,
    });
  }),

  verifyPlatformStepUp: protectedProcedure
    .input(verifyPlatformStepUpCommandSchema)
    .mutation(async ({ ctx, input }) => {
      const grant = validatePlatformGrantRequest({
        scopes: input.scopes,
        resourceMode: input.resourceMode,
        serverIds: input.serverIds,
      });
      const verified = await verifyPlatformStepUpOtp(ctx.dbDirect, {
        userId: ctx.user.id,
        otp: input.otp,
      });
      if (!verified) {
        await recordPlatformSecurityEventBestEffort(ctx.dbDirect, {
          userId: ctx.user.id,
          eventType: "step_up_failed",
          outcome: "failure",
        });
        throw appError({
          appCode: APP_ERROR_CODES.OTP_VERIFY_FAILED,
          message: "The verification code is invalid or expired.",
          status: 400,
        });
      }
      return createPlatformStepUpGrant(ctx.dbDirect, {
        userId: ctx.user.id,
        sessionId: ctx.session.id,
        fingerprint: grant.fingerprint,
      });
    }),

  platformSecurityEvents: protectedProcedure
    .input(paginationInputSchema.optional())
    .query(({ ctx, input }) =>
      listPlatformSecurityEvents(
        ctx.db,
        ctx.user.id,
        input ?? { page: 1, pageSize: 10 },
      ),
    ),

  platformSnippet: protectedProcedure.query(({ ctx }) => {
    const origin = resolveApiOrigin(ctx.req, ctx.env.API_ORIGIN);
    return {
      url: `${origin}/api/platform-mcp`,
      authorization: "Bearer <platform-token>",
      instructions:
        "Add this URL as a Streamable HTTP MCP server and send the platform token as a Bearer token.",
    };
  }),
});
