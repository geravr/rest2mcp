import { mcpServer, mcpTool } from "@repo/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
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
import { authenticateAgentToken } from "../services/mcp-studio-service.js";

const argsSchema = z.record(z.string(), z.unknown()).optional();

export function createMcpGatewayRoutes() {
  const routes = new Hono<AppContext>();

  routes.all("/:serverId", async (c) => {
    const serverId = c.req.param("serverId");
    const rawToken = extractBearerToken(c.req.header("authorization"));
    if (!rawToken) {
      return c.json(
        appJsonError(
          APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
          "Agent token is required.",
        ),
        401,
      );
    }

    const db = c.get("dbDirect") ?? c.get("db");
    const env = c.get("env") ?? c.env;

    try {
      await authenticateAgentToken(db, rawToken, {
        kind: "server",
        serverId,
      });
    } catch (error) {
      if (error instanceof AppError) {
        return c.json(
          appJsonError(error.appCode, error.message),
          error.status as 401,
        );
      }
      throw error;
    }

    return handleMcpHttpRequest(c.req.raw, async () => {
      const [server] = await db
        .select()
        .from(mcpServer)
        .where(eq(mcpServer.id, serverId))
        .limit(1);

      const tools = server
        ? await db
            .select()
            .from(mcpTool)
            .where(
              and(eq(mcpTool.serverId, server.id), eq(mcpTool.enabled, true)),
            )
        : [];

      const mcp = new McpServer({
        name: server?.name ?? "mcp-server",
        version: "1.0.0",
      });

      for (const tool of tools) {
        mcp.registerTool(
          tool.name,
          {
            description:
              tool.description ?? `${tool.method} ${tool.pathTemplate}`,
            inputSchema: z.looseObject({}),
          },
          async (args) => {
            try {
              const parsedArgs = argsSchema.parse(args) ?? {};
              const result = await executeMappedTool(db, {
                serverId,
                toolId: tool.id,
                args: parsedArgs,
                source: "agent",
                credentialSecret: env.MCP_CREDENTIAL_SECRET,
              });
              return jsonToolResult({
                httpStatus: result.httpStatus,
                truncated: result.truncated,
                body: result.body,
              });
            } catch (error) {
              if (error instanceof AppError) {
                return jsonToolError(error.message, error.appCode);
              }
              return jsonToolError("Tool execution failed.");
            }
          },
        );
      }

      return mcp;
    });
  });

  return routes;
}
