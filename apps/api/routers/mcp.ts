import { paginationInputSchema } from "@repo/core";
import { z } from "zod";
import { serverAuthRecipeSchema } from "../lib/mcp-auth-recipe.js";
import { mcpCommonEntriesSchema } from "../lib/mcp-request-definition.js";
import {
  createLegacyToolCommandSchema,
  createPlatformTokenCommandSchema,
  createToolCommandSchema,
  curlConfirmCommandSchema,
  duplicateToolCommandSchema,
  previewLegacyToolCompileCommandSchema,
  previewToolCompileCommandSchema,
  updateLegacyToolCommandSchema,
  updateToolCommandSchema,
} from "../lib/mcp-domain-commands.js";
import { protectedProcedure, router } from "../lib/trpc.js";
import { executeMappedTool } from "../services/mcp-executor-service.js";
import {
  createLegacyTool,
  createServer,
  createServerToken,
  createTool,
  createToolFromCurl,
  createVariable,
  deleteServer,
  deleteTool,
  deleteVariable,
  duplicateTool,
  getConnectionSnippet,
  getPlatformTokenMeta,
  getServer,
  getServerCommon,
  getToolEditorState,
  createPlatformToken,
  listCallLogs,
  listServerTokens,
  listServers,
  listTools,
  listVariables,
  previewCurlImport,
  previewLegacyToolCompile,
  previewToolCompile,
  resolveApiOrigin,
  revokePlatformToken,
  revokeServerToken,
  setServerAuth,
  testConnection,
  updateLegacyTool,
  updateServer,
  updateServerCommon,
  updateTool,
  updateVariable,
} from "../services/mcp-studio-service.js";

const templateMapSchema = z.record(z.string(), z.string().max(8_000));

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
        auth: serverAuthRecipeSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      setServerAuth(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.auth,
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
    ),

  getServer: protectedProcedure
    .input(serverIdInput)
    .query(({ ctx, input }) => getServer(ctx.db, ctx.user.id, input.serverId)),

  updateServer: protectedProcedure
    .input(
      serverIdInput.extend({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        iconImage: z.url().nullable().optional(),
        baseUrl: z.url().optional(),
        status: z.enum(["draft", "live", "paused"]).optional(),
        allowedHosts: z.array(z.string().min(1)).optional(),
        defaultHeaders: templateMapSchema.nullable().optional(),
        defaultQuery: templateMapSchema.nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateServer(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input,
        ctx.env.APP_ORIGIN,
      ),
    ),

  deleteServer: protectedProcedure
    .input(serverIdInput)
    .mutation(({ ctx, input }) =>
      deleteServer(ctx.dbDirect, ctx.user.id, input.serverId),
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

  /** Explicit legacy compatibility path; first-party clients use `createTool`. */
  createLegacyTool: protectedProcedure
    .input(createLegacyToolCommandSchema)
    .mutation(({ ctx, input }) =>
      createLegacyTool(ctx.dbDirect, ctx.user.id, input.serverId, input),
    ),

  createToolFromCurl: protectedProcedure
    .input(curlConfirmCommandSchema)
    .mutation(({ ctx, input }) =>
      createToolFromCurl(ctx.dbDirect, ctx.user.id, input.serverId, input),
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

  toolEditorState: protectedProcedure
    .input(serverIdInput.extend({ toolId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      getToolEditorState(ctx.db, ctx.user.id, input.serverId, input.toolId),
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

  /** Explicit legacy compatibility path; rejects typed records. */
  updateLegacyTool: protectedProcedure
    .input(updateLegacyToolCommandSchema)
    .mutation(({ ctx, input }) =>
      updateLegacyTool(
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
        name: input.name,
        description: input.description,
        enabled: input.enabled,
      }),
    ),

  deleteTool: protectedProcedure
    .input(serverIdInput.extend({ toolId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      deleteTool(ctx.dbDirect, ctx.user.id, input.serverId, input.toolId),
    ),

  previewToolCompile: protectedProcedure
    .input(previewToolCompileCommandSchema)
    .mutation(({ ctx, input }) =>
      previewToolCompile(ctx.db, ctx.user.id, input.serverId, {
        method: input.method,
        requestDefinition: input.requestDefinition,
        allowMutation: input.allowMutation,
      }),
    ),

  /** Explicit legacy compatibility preview; first-party clients use the typed path. */
  previewLegacyToolCompile: protectedProcedure
    .input(previewLegacyToolCompileCommandSchema)
    .mutation(({ ctx, input }) =>
      previewLegacyToolCompile(ctx.db, ctx.user.id, input.serverId, {
        method: input.method,
        pathTemplate: input.pathTemplate,
        requestTemplate: input.requestTemplate,
        params: input.params,
        allowMutation: input.allowMutation,
      }),
    ),

  serverCommon: protectedProcedure
    .input(serverIdInput)
    .query(({ ctx, input }) =>
      getServerCommon(ctx.db, ctx.user.id, input.serverId),
    ),

  updateServerCommon: protectedProcedure
    .input(serverIdInput.extend({ common: mcpCommonEntriesSchema }))
    .mutation(({ ctx, input }) =>
      updateServerCommon(ctx.dbDirect, ctx.user.id, input.serverId, {
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
        name: variableNameSchema,
        isSecret: z.boolean(),
        value: z.string().max(8_000),
      }),
    )
    .mutation(({ ctx, input }) =>
      createVariable(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input,
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
    ),

  updateVariable: protectedProcedure
    .input(
      serverIdInput.extend({
        name: variableNameSchema,
        value: z.string().max(8_000).optional(),
        isSecret: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateVariable(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.name,
        { value: input.value, isSecret: input.isSecret },
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
    ),

  deleteVariable: protectedProcedure
    .input(serverIdInput.extend({ name: variableNameSchema }))
    .mutation(({ ctx, input }) =>
      deleteVariable(ctx.dbDirect, ctx.user.id, input.serverId, input.name),
    ),

  tokens: protectedProcedure
    .input(serverIdInput)
    .query(({ ctx, input }) =>
      listServerTokens(ctx.db, ctx.user.id, input.serverId),
    ),

  createToken: protectedProcedure
    .input(serverIdInput.extend({ name: z.string().trim().max(80).optional() }))
    .mutation(({ ctx, input }) =>
      createServerToken(ctx.dbDirect, ctx.user.id, input.serverId, input.name),
    ),

  revokeToken: protectedProcedure
    .input(serverIdInput.extend({ tokenId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      revokeServerToken(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.tokenId,
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
      serverIdInput.extend({
        toolId: z.string().min(1),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await executeMappedTool(ctx.dbDirect, {
        serverId: input.serverId,
        ownerUserId: ctx.user.id,
        toolId: input.toolId,
        args: input.args,
        source: "playground",
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

  platformToken: protectedProcedure.query(({ ctx }) =>
    getPlatformTokenMeta(ctx.db, ctx.user.id),
  ),

  createPlatformToken: protectedProcedure
    .input(createPlatformTokenCommandSchema.optional())
    .mutation(({ ctx, input }) =>
      createPlatformToken(ctx.dbDirect, ctx.user.id, input ?? {}),
    ),

  revokePlatformToken: protectedProcedure.mutation(({ ctx }) =>
    revokePlatformToken(ctx.dbDirect, ctx.user.id),
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
