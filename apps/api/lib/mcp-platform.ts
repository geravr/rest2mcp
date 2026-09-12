import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { APP_ERROR_CODES, AppError, appJsonError } from "./app-error.js";
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
  getConnectionSnippet,
  listCallLogs,
  listServers,
  listTools,
  resolveApiOrigin,
  setCredential,
} from "../services/mcp-studio-service.js";

const paginationShape = {
  page: z.number().int().min(1).optional(),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).optional(),
};

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
              })),
            };
          },
        ),
      );

      mcp.registerTool(
        "create_server",
        {
          description: "Create a new MCP server.",
          inputSchema: z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            baseUrl: z.url(),
            slug: z.string().optional(),
          }),
        },
        asToolResult((args) => createServer(db, userId, args)),
      );

      mcp.registerTool(
        "add_tool",
        {
          description: "Add a REST tool to a server you own.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            name: z.string().min(1),
            description: z.string().optional(),
            method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]),
            pathTemplate: z.string().min(1),
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
            allowMutation: args.allowMutation,
            enabled: args.enabled,
          }),
        ),
      );

      mcp.registerTool(
        "add_tool_from_curl",
        {
          description: "Add a tool by pasting a curl command.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            curl: z.string().min(1),
            name: z.string().optional(),
            description: z.string().optional(),
          }),
        },
        asToolResult((args) =>
          createToolFromCurl(db, userId, args.serverId, args),
        ),
      );

      mcp.registerTool(
        "set_credential",
        {
          description: "Set or replace the encrypted upstream credential.",
          inputSchema: z.object({
            serverId: z.string().min(1),
            scheme: z.enum(["bearer", "api_key", "header"]),
            headerName: z.string().optional(),
            valueLocation: z.enum(["header", "query"]),
            secret: z.string().min(1),
          }),
        },
        asToolResult((args) =>
          setCredential(
            db,
            userId,
            args.serverId,
            args,
            env.MCP_CREDENTIAL_SECRET,
          ),
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
