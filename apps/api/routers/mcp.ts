import { paginationInputSchema } from "@repo/core";
import { z } from "zod";
import { protectedProcedure, router } from "../lib/trpc.js";
import { executeMappedTool } from "../services/mcp-executor-service.js";
import {
  createServer,
  createServerToken,
  createTool,
  createToolFromCurl,
  getConnectionSnippet,
  getPlatformTokenMeta,
  getServer,
  createPlatformToken,
  listCallLogs,
  listServerTokens,
  listServers,
  listTools,
  resolveApiOrigin,
  revokePlatformToken,
  revokeServerToken,
  setCredential,
  updateServer,
  updateTool,
} from "../services/mcp-studio-service.js";

const httpMethodSchema = z.enum([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

const paramMapSchema = z.object({
  path: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  header: z.record(z.string(), z.string()).optional(),
  body: z
    .union([z.record(z.string(), z.string()), z.array(z.string()), z.null()])
    .optional(),
  staticQuery: z.record(z.string(), z.string()).optional(),
  staticHeaders: z.record(z.string(), z.string()).optional(),
  staticBody: z.string().nullable().optional(),
});

const serverIdInput = z.object({ serverId: z.string().min(1) });

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
        baseUrl: z.url().optional(),
        status: z.enum(["draft", "live", "paused"]).optional(),
        allowedHosts: z.array(z.string().min(1)).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      updateServer(ctx.dbDirect, ctx.user.id, input.serverId, input),
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
        paramMap: paramMapSchema.optional(),
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
      }),
    )
    .mutation(({ ctx, input }) =>
      createToolFromCurl(ctx.dbDirect, ctx.user.id, input.serverId, input),
    ),

  updateTool: protectedProcedure
    .input(
      serverIdInput.extend({
        toolId: z.string().min(1),
        name: z.string().trim().min(1).max(64).optional(),
        description: z.string().trim().max(2000).nullable().optional(),
        method: httpMethodSchema.optional(),
        pathTemplate: z.string().trim().min(1).max(500).optional(),
        paramMap: paramMapSchema.optional(),
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

  setCredential: protectedProcedure
    .input(
      serverIdInput.extend({
        scheme: z.enum(["bearer", "api_key", "header"]),
        headerName: z.string().trim().min(1).max(100).nullable().optional(),
        valueLocation: z.enum(["header", "query"]),
        secret: z.string().max(8_000).optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      setCredential(
        ctx.dbDirect,
        ctx.user.id,
        input.serverId,
        input,
        ctx.env.MCP_CREDENTIAL_SECRET,
      ),
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
