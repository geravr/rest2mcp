import { paginationInputSchema } from "@repo/core";
import { z } from "zod";
import { protectedProcedure, router } from "../lib/trpc.js";
import { executeMappedTool } from "../services/mcp-executor-service.js";
import {
  createServer,
  createServerToken,
  createTool,
  createToolFromCurl,
  createVariable,
  deleteServer,
  deleteTool,
  deleteVariable,
  getConnectionSnippet,
  getPlatformTokenMeta,
  getServer,
  createPlatformToken,
  listCallLogs,
  listServerTokens,
  listServers,
  listTools,
  listVariables,
  previewCurlImport,
  resolveApiOrigin,
  revokePlatformToken,
  revokeServerToken,
  testConnection,
  updateServer,
  updateTool,
  updateVariable,
} from "../services/mcp-studio-service.js";

const httpMethodSchema = z.enum([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const requestTemplateSchema = z.object({
  query: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().nullable().optional(),
  bodyType: z.enum(["json", "form", "raw"]).optional(),
});

const toolParamSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  required: z.boolean(),
  type: z.enum(["string", "number", "boolean", "json"]),
});

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
      }),
    )
    .mutation(({ ctx, input }) =>
      createServer(ctx.dbDirect, ctx.user.id, input),
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
    .input(
      serverIdInput.extend({
        name: z.string().trim().min(1).max(64),
        description: z.string().trim().max(2000).nullable().optional(),
        method: httpMethodSchema,
        pathTemplate: z.string().trim().min(1).max(500),
        requestTemplate: requestTemplateSchema.optional(),
        params: z.array(toolParamSchema).max(50).optional(),
        allowMutation: z.boolean().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createTool(ctx.dbDirect, ctx.user.id, input.serverId, input),
    ),

  createToolFromCurl: protectedProcedure
    .input(
      serverIdInput.extend({
        curl: z.string().trim().min(1).max(20_000),
        name: z.string().trim().min(1).max(64).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        markings: z
          .array(
            z.object({
              value: z.string().min(1).max(8_000),
              as: z.enum(["param", "variable"]),
              name: z.string().trim().min(1).max(100),
              isSecret: z.boolean().optional(),
            }),
          )
          .max(50)
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      createToolFromCurl(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input,
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
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
    .input(
      serverIdInput.extend({
        toolId: z.string().min(1),
        name: z.string().trim().min(1).max(64).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        method: httpMethodSchema.optional(),
        pathTemplate: z.string().trim().min(1).max(500).optional(),
        requestTemplate: requestTemplateSchema.optional(),
        params: z.array(toolParamSchema).max(50).optional(),
        allowMutation: z.boolean().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateTool(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.toolId,
        input,
      ),
    ),

  deleteTool: protectedProcedure
    .input(serverIdInput.extend({ toolId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      deleteTool(ctx.dbDirect, ctx.user.id, input.serverId, input.toolId),
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
        value: z.string().max(8_000),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateVariable(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input.name,
        { value: input.value },
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
    .mutation(({ ctx, input }) =>
      executeMappedTool(ctx.dbDirect, {
        serverId: input.serverId,
        ownerUserId: ctx.user.id,
        toolId: input.toolId,
        args: input.args,
        source: "playground",
        credentialSecret: ctx.env.MCP_CREDENTIAL_SECRET,
      }),
    ),

  callLogs: protectedProcedure
    .input(serverIdInput.extend(paginationInputSchema.shape))
    .query(({ ctx, input }) =>
      listCallLogs(ctx.db, ctx.user.id, input.serverId, input),
    ),

  platformToken: protectedProcedure.query(({ ctx }) =>
    getPlatformTokenMeta(ctx.db, ctx.user.id),
  ),

  createPlatformToken: protectedProcedure
    .input(z.object({ name: z.string().trim().max(80).optional() }).optional())
    .mutation(({ ctx, input }) =>
      createPlatformToken(ctx.dbDirect, ctx.user.id, input?.name),
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
