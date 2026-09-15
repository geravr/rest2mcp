import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { APP_ERROR_CODES, AppError, appJsonError } from "./app-error.js";
import { serverAuthRecipeSchema } from "./mcp-auth-recipe.js";
import { extractBearerToken } from "./mcp-agent-token.js";
import {
  handleMcpHttpRequest,
  jsonToolError,
  jsonToolResult,
} from "./mcp-http.js";
import { executeMappedTool } from "../services/mcp-executor-service.js";
import {
  authenticateAgentToken,
  createServer,
  createTool,
  createToolFromCurl,
  deleteServer,
  deleteTool,
  deleteVariable,
  getConnectionSnippet,
  listCallLogs,
  listServers,
  listTools,
  listVariables,
  resolveApiOrigin,
  setServerAuth,
  setVariable,
} from "../services/mcp-studio-service.js";

const paginationShape = {
  page: z.number().int().min(1).optional(),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).optional(),
};

const requestTemplateSchema = z.object({
  query: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().nullable().optional(),
  bodyType: z.enum(["json", "form", "raw"]).optional(),
});

const paramsSchema = z.array(
  z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    required: z.boolean(),
    type: z.enum(["string", "number", "boolean", "json"]),
  }),
);

function asToolResult<T>(run: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try {
      return jsonToolResult(await run(args));
    } catch (error) {
      if (error instanceof AppError) {
        return jsonToolError(error.message, error.appCode);
      }
      return jsonToolError("Platform tool failed.");
    }
  };
}

export function createPlatformMcpRoutes() {
  const routes = new Hono<AppContext>();

  routes.all("/", async (c) => {
    const rawToken = extractBearerToken(c.req.header("authorization"));
    if (!rawToken) {
      return c.json(
        appJsonError(
          APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
          "Platform token is required.",
        ),
        401,
      );
    }

    const db = c.get("dbDirect") ?? c.get("db");
    const env = c.get("env") ?? c.env;

    let token;
    try {
      token = await authenticateAgentToken(db, rawToken, { kind: "platform" });
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(
          appJsonError(error.appCode, error.message),
          error.status as 401,
        );
      }
      throw error;
    }

    const userId = token.userId;
    const apiOrigin = resolveApiOrigin(c.req.raw, env.API_ORIGIN);

    return handleMcpHttpRequest(c.req.raw, async () => {
      const mcp = new McpServer({
        name: "rest2mcp-platform",
        version: "1.0.0",
      });

      mcp.registerTool(
        "list_servers",
        {
          description: "List MCP servers owned by the authenticated user.",
          inputSchema: z.object(paginationShape),
        },
        asToolResult(
          async (args: { page?: number; pageSize?: 10 | 20 | 50 }) => {
            const page = await listServers(db, userId, {
              page: args.page ?? 1,
              pageSize: args.pageSize ?? 10,
            });
            return {
              ...page,
              items: page.items.map((item) => ({
                id: item.id,
                name: item.name,
                slug: item.slug,
                description: item.description,
                baseUrl: item.baseUrl,
                allowedHosts: item.allowedHosts,
                status: item.status,
                trafficLight: item.trafficLight,
                hasSecret: item.hasSecret,
                enabledToolCount: item.enabledToolCount,
                lastCallAt: item.lastCallAt,
              })),
            };
          },
        ),
      );

      mcp.registerTool(
        "create_server",
        {
          description:
            "Create a new MCP server. Optional auth recipe stores a secret variable and default header/query.",
          inputSchema: z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            baseUrl: z.url(),
            slug: z.string().optional(),
            auth: serverAuthRecipeSchema.optional(),
          }),
        },
        asToolResult((args) =>
          createServer(db, userId, args, env.MCP_CREDENTIAL_SECRET),
        ),
      );

      mcp.registerTool(
        "delete_server",
        {
          description:
            "Delete a server you own, cascading its tools, variables, agent tokens, and call logs.",
          inputSchema: z.object({
            serverId: z.string().min(1),
          }),
        },
        asToolResult((args) => deleteServer(db, userId, args.serverId)),
      );

      mcp.registerTool(
        "add_tool",
        {
          description:
            "Add a REST tool to a server you own. pathTemplate and requestTemplate values support {{placeholder}} interpolation from agent arguments or server variables.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            name: z.string().min(1),
            description: z.string().optional(),
            method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]),
            pathTemplate: z.string().min(1),
            requestTemplate: requestTemplateSchema.optional(),
            params: paramsSchema.optional(),
            allowMutation: z.boolean().optional(),
            enabled: z.boolean().optional(),
          }),
        },
        asToolResult((args) =>
          createTool(db, userId, args.serverId, {
            name: args.name,
            description: args.description,
            method: args.method,
            pathTemplate: args.pathTemplate,
            requestTemplate: args.requestTemplate,
            params: args.params,
            allowMutation: args.allowMutation,
            enabled: args.enabled,
          }),
        ),
      );

      mcp.registerTool(
        "add_tool_from_curl",
        {
          description:
            "Add a tool by pasting a curl command. Detected auth headers are captured as secret variables plus a server default header.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            curl: z.string().min(1),
            name: z.string().optional(),
            description: z.string().optional(),
          }),
        },
        asToolResult((args) =>
          createToolFromCurl(
            db,
            userId,
            args.serverId,
            args,
            env.MCP_CREDENTIAL_SECRET,
          ),
        ),
      );

      mcp.registerTool(
        "delete_tool",
        {
          description:
            "Delete a tool from a server you own. Historical call logs are kept.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            toolId: z.string().min(1),
          }),
        },
        asToolResult((args) =>
          deleteTool(db, userId, args.serverId, args.toolId),
        ),
      );

      mcp.registerTool(
        "set_variable",
        {
          description:
            "Create a server variable or rotate its value. Secret variables are encrypted at rest and never returned.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            name: z.string().min(1),
            isSecret: z.boolean(),
            value: z.string(),
          }),
        },
        asToolResult((args) =>
          setVariable(
            db,
            userId,
            args.serverId,
            {
              name: args.name,
              isSecret: args.isSecret,
              value: args.value,
            },
            env.MCP_CREDENTIAL_SECRET,
          ),
        ),
      );

      mcp.registerTool(
        "set_server_auth",
        {
          description:
            "Apply or clear server authentication (none/bearer/header/query/basic). Secrets are encrypted and never returned.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            auth: serverAuthRecipeSchema,
          }),
        },
        asToolResult((args) =>
          setServerAuth(
            db,
            userId,
            args.serverId,
            args.auth,
            env.MCP_CREDENTIAL_SECRET,
          ),
        ),
      );

      mcp.registerTool(
        "list_variables",
        {
          description:
            "List server variables. Returns names, isSecret flags, and hasValue metadata only.",
          inputSchema: z.object({
            serverId: z.string().min(1),
          }),
        },
        asToolResult(async (args: { serverId: string }) => {
          const variables = await listVariables(db, userId, args.serverId);
          return variables.map(({ id, name, isSecret, hasValue }) => ({
            id,
            name,
            isSecret,
            hasValue,
          }));
        }),
      );

      mcp.registerTool(
        "delete_variable",
        {
          description: "Delete a server variable by name.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            name: z.string().min(1),
          }),
        },
        asToolResult((args) =>
          deleteVariable(db, userId, args.serverId, args.name),
        ),
      );

      mcp.registerTool(
        "list_tools",
        {
          description: "List tools on a server you own.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            ...paginationShape,
          }),
        },
        asToolResult((args) =>
          listTools(db, userId, args.serverId, {
            page: args.page ?? 1,
            pageSize: args.pageSize ?? 10,
          }),
        ),
      );

      mcp.registerTool(
        "test_tool",
        {
          description: "Invoke a tool with the shared executor.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            toolId: z.string().min(1),
            args: z.record(z.string(), z.unknown()).optional(),
          }),
        },
        asToolResult((args) =>
          executeMappedTool(db, {
            serverId: args.serverId,
            ownerUserId: userId,
            toolId: args.toolId,
            args: args.args,
            source: "platform",
            credentialSecret: env.MCP_CREDENTIAL_SECRET,
          }),
        ),
      );

      mcp.registerTool(
        "get_connection_snippet",
        {
          description:
            "Get the hosted MCP URL for a server. Does not mint a token.",
          inputSchema: z.object({
            serverId: z.string().min(1),
          }),
        },
        asToolResult((args) =>
          getConnectionSnippet(db, userId, args.serverId, apiOrigin),
        ),
      );

      mcp.registerTool(
        "list_recent_calls",
        {
          description: "List recent call logs for a server you own.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            ...paginationShape,
          }),
        },
        asToolResult((args) =>
          listCallLogs(db, userId, args.serverId, {
            page: args.page ?? 1,
            pageSize: args.pageSize ?? 10,
          }),
        ),
      );

      return mcp;
    });
  });

  return routes;
}
