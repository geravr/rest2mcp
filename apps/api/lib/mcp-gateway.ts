/**
 * @file Hardened hosted Streamable HTTP MCP gateway. Validates Origin and
 * request size before authentication, applies per-token rate/concurrency
 * limits per invocation, advertises only enabled contract-ready tools, and
 * returns the shared structured result envelope for every completion.
 */
import { mcpServer, mcpTool, type McpTool } from "@repo/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext } from "./context.js";
import { APP_ERROR_CODES, AppError, appJsonError } from "./app-error.js";
import { extractBearerToken } from "./mcp-agent-token.js";
import { compileAgentToolContract } from "./mcp-contract.js";
import { handleMcpHttpRequest } from "./mcp-http.js";
import { MCP_GATEWAY_REQUEST_SIZE_LIMIT } from "./mcp-policy.js";
import { releaseServerSlot, tryAcquireInvocation } from "./mcp-rate-limit.js";
import {
  installContractTools,
  type RegisteredContractTool,
} from "./mcp-registration.js";
import type {
  McpAgentInput,
  McpCompiledPlan,
} from "./mcp-request-definition.js";
import {
  buildMcpToolResult,
  errorEnvelope,
  internalErrorEnvelope,
  invalidArgumentsEnvelope,
  toMcpToolError,
  type McpToolEnvelope,
} from "./mcp-result.js";
import { captureMcpTelemetry, MCP_TELEMETRY_EVENTS } from "./mcp-telemetry.js";
import {
  compilePlanForTool,
  executeMappedTool,
  loadToolCompileInputs,
  MUTATING_METHODS,
} from "../services/mcp-executor-service.js";
import { authenticateAgentToken } from "../services/mcp-studio-service.js";

function isTrustedOrigin(origin: string, appOrigin: string): boolean {
  try {
    return new URL(origin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

function nameToInputId(agentInputs: McpAgentInput[]): Map<string, string> {
  return new Map(agentInputs.map((input) => [input.name, input.id]));
}

export function createMcpGatewayRoutes() {
  const routes = new Hono<AppContext>();

  routes.all("/:serverId", async (c) => {
    const serverId = c.req.param("serverId");
    const env = c.get("env") ?? c.env;

    const origin = c.req.header("origin");
    if (origin && !isTrustedOrigin(origin, env.APP_ORIGIN)) {
      return c.json(
        appJsonError(
          APP_ERROR_CODES.MCP_ORIGIN_INVALID,
          "This Origin is not allowed for the MCP endpoint.",
        ),
        403,
      );
    }

    const contentLength = c.req.header("content-length");
    if (
      contentLength &&
      Number(contentLength) > MCP_GATEWAY_REQUEST_SIZE_LIMIT
    ) {
      return c.json(
        appJsonError(
          APP_ERROR_CODES.MCP_REQUEST_TOO_LARGE,
          "The request body is too large.",
        ),
        413,
      );
    }

    // Enforce the byte cap even when Content-Length is absent or wrong
    // (chunked encoding). Rebuild the Request so MCP transport still has a body.
    let mcpRequest = c.req.raw;
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const body = await c.req.arrayBuffer();
      if (body.byteLength > MCP_GATEWAY_REQUEST_SIZE_LIMIT) {
        return c.json(
          appJsonError(
            APP_ERROR_CODES.MCP_REQUEST_TOO_LARGE,
            "The request body is too large.",
          ),
          413,
        );
      }
      mcpRequest = new Request(c.req.raw.url, {
        method: c.req.raw.method,
        headers: c.req.raw.headers,
        body: body.byteLength > 0 ? body : undefined,
      });
    }

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

    let token;
    try {
      token = await authenticateAgentToken(db, rawToken, {
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

    return handleMcpHttpRequest(mcpRequest, async () => {
      const [server] = await db
        .select()
        .from(mcpServer)
        .where(eq(mcpServer.id, serverId))
        .limit(1);

      const mcp = new McpServer({
        name: server?.name ?? "mcp-server",
        version: "1.0.0",
      });

      // Always install the tools handlers, even with zero tools, so
      // `tools/list` answers `[]` instead of "Method not found" for a paused
      // server or one with no contract-ready tools.
      if (!server || server.status === "paused") {
        installContractTools(mcp, []);
        return mcp;
      }

      const enabledTools = await db
        .select()
        .from(mcpTool)
        .where(and(eq(mcpTool.serverId, server.id), eq(mcpTool.enabled, true)));

      const compileInputs = await loadToolCompileInputs(db, server);

      const compiledTools: Array<{
        tool: McpTool;
        plan: McpCompiledPlan;
        contract: NonNullable<
          ReturnType<typeof compileAgentToolContract>["contract"]
        >;
      }> = [];
      for (const tool of enabledTools) {
        let plan: McpCompiledPlan;
        try {
          plan = compilePlanForTool(tool, compileInputs);
        } catch {
          continue;
        }
        const contract = compileAgentToolContract({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          method: plan.method,
          plan,
        });
        if (!contract.ok || !contract.contract) {
          captureMcpTelemetry(MCP_TELEMETRY_EVENTS.contractReadinessFailed, {
            db,
            userId: token.userId,
            properties: {
              serverId: server.id,
              toolId: tool.id,
              issueCodes: contract.issues
                .filter((issue) => issue.severity === "error")
                .map((issue) => issue.code)
                .slice(0, 10),
            },
          });
          continue;
        }
        compiledTools.push({ tool, plan, contract: contract.contract });
      }
      compiledTools.sort((a, b) => a.tool.name.localeCompare(b.tool.name));

      const registrations: RegisteredContractTool[] = [];
      for (const { tool, plan, contract: activeContract } of compiledTools) {
        const inputIdByName = nameToInputId(plan.agentInputs);
        const idempotent = plan.annotations.idempotentHint === true;

        captureMcpTelemetry(MCP_TELEMETRY_EVENTS.contractEmitted, {
          db,
          userId: token.userId,
          properties: {
            serverId: server.id,
            toolId: tool.id,
            contractVersion: activeContract.contractVersion,
            fingerprint: activeContract.fingerprint,
          },
        });

        registrations.push({
          name: tool.name,
          title: activeContract.title,
          description: activeContract.description,
          inputSchema: activeContract.inputSchema,
          outputSchema: activeContract.outputSchema,
          annotations: activeContract.annotations,
          metadata: activeContract.metadata,
          handler: async (rawArgs) => {
            const mutating = MUTATING_METHODS.has(plan.method);
            const rateLimit = tryAcquireInvocation({
              tokenId: token.id,
              serverId: server.id,
              mutating,
            });
            if (!rateLimit.ok) {
              return buildMcpToolResult(
                errorEnvelope({
                  category: "rate_limit",
                  code: APP_ERROR_CODES.MCP_RATE_LIMITED,
                  message: "Too many requests. Wait and try again.",
                  retryable: true,
                  ...(rateLimit.retryAfterSeconds !== undefined
                    ? { retryAfterSeconds: rateLimit.retryAfterSeconds }
                    : {}),
                }),
              );
            }

            try {
              const parsed = activeContract.inputValidator.safeParse(
                rawArgs ?? {},
              );
              if (!parsed.success) {
                return buildMcpToolResult(
                  invalidArgumentsEnvelope(parsed.error, inputIdByName),
                );
              }
              const result = await executeMappedTool(db, {
                serverId: server.id,
                toolId: tool.id,
                args: parsed.data,
                source: "agent",
                credentialSecret: env.MCP_CREDENTIAL_SECRET,
              });
              return buildMcpToolResult(result.envelope, {
                onDefect: (reason) =>
                  captureMcpTelemetry(
                    MCP_TELEMETRY_EVENTS.schemaInvalidInternalResult,
                    {
                      db,
                      userId: token.userId,
                      properties: {
                        serverId: server.id,
                        toolId: tool.id,
                        reason,
                      },
                    },
                  ),
              });
            } catch (error) {
              const envelope: McpToolEnvelope =
                error instanceof AppError
                  ? errorEnvelope(toMcpToolError(error, { idempotent }))
                  : internalErrorEnvelope();
              return buildMcpToolResult(envelope);
            } finally {
              releaseServerSlot(server.id);
            }
          },
        });
      }

      installContractTools(mcp, registrations);
      return mcp;
    });
  });

  return routes;
}
