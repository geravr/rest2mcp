/**
 * @file Hardened hosted Streamable HTTP MCP gateway. Validates Origin and
 * request size before authentication, applies per-token rate/concurrency
 * limits per invocation, advertises only enabled successfully compiled
 * tools, and returns MCP-native structured results/errors.
 */
import { mcpServer, mcpTool, type McpTool } from "@repo/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { APP_ERROR_CODES, AppError, appJsonError } from "./app-error.js";
import { extractBearerToken } from "./mcp-agent-token.js";
import {
  handleMcpHttpRequest,
  jsonToolError,
  structuredToolError,
  structuredToolResult,
} from "./mcp-http.js";
import { MCP_GATEWAY_REQUEST_SIZE_LIMIT } from "./mcp-policy.js";
import { releaseServerSlot, tryAcquireInvocation } from "./mcp-rate-limit.js";
import {
  mcpExecutionEnvelopeSchema,
  type McpAgentInput,
  type McpCompiledPlan,
  type McpExecutionEnvelope,
} from "./mcp-request-definition.js";
import {
  compilePlanForTool,
  executeMappedTool,
  loadToolCompileInputs,
  MUTATING_METHODS,
} from "../services/mcp-executor-service.js";
import { authenticateAgentToken } from "../services/mcp-studio-service.js";

function agentInputToZodType(input: McpAgentInput): z.ZodType {
  let field: z.ZodType;
  switch (input.type) {
    case "string": {
      let s = z.string();
      if (input.minLength !== undefined) s = s.min(input.minLength);
      if (input.maxLength !== undefined) s = s.max(input.maxLength);
      if (input.pattern) {
        try {
          s = s.regex(new RegExp(input.pattern));
        } catch {
          // Invalid author patterns must not crash gateway construction.
        }
      }
      field = s;
      break;
    }
    case "number": {
      let n = z.number();
      if (input.minimum !== undefined) n = n.min(input.minimum);
      if (input.maximum !== undefined) n = n.max(input.maximum);
      field = n;
      break;
    }
    case "integer": {
      let n = z.number().int();
      if (input.minimum !== undefined) n = n.min(input.minimum);
      if (input.maximum !== undefined) n = n.max(input.maximum);
      field = n;
      break;
    }
    case "boolean":
      field = z.boolean();
      break;
    case "json":
      field = z.unknown();
      break;
  }
  if (input.enum && input.enum.length > 0) {
    const [first, ...rest] = input.enum.map((value) => z.literal(value));
    field = rest.length > 0 ? z.union([first, ...rest]) : first;
  }
  if (input.description) field = field.describe(input.description);
  if (Array.isArray(input.examples) && input.examples.length > 0) {
    field = field.meta({ examples: input.examples });
  }
  return input.required ? field : field.optional();
}

/** Generates a closed (no-unknown-keys) zod object schema from compiled agent inputs. */
export function deriveInputSchema(agentInputs: McpAgentInput[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const input of agentInputs) {
    shape[input.name] = agentInputToZodType(input);
  }
  return z.object(shape).strict();
}

function toolAnnotationsFromPlan(plan: McpCompiledPlan): ToolAnnotations {
  return {
    readOnlyHint: plan.annotations.readOnlyHint,
    destructiveHint: plan.annotations.destructiveHint,
    idempotentHint: plan.annotations.idempotentHint,
    openWorldHint: plan.annotations.openWorldHint,
  };
}

function describePlanPath(plan: McpCompiledPlan): string {
  const parts = plan.pathSegments.map((segment) =>
    segment.source.kind === "literal"
      ? String(segment.source.value ?? "")
      : "{value}",
  );
  const joined = parts.join("");
  return joined.length > 0 ? joined : "/";
}

function isTrustedOrigin(origin: string, appOrigin: string): boolean {
  try {
    return new URL(origin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

function emptyEnvelope(
  overrides: Partial<McpExecutionEnvelope> & { appCode: string },
): McpExecutionEnvelope {
  return {
    ok: false,
    status: null,
    contentType: null,
    headers: {},
    truncated: false,
    ...overrides,
  };
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
      // Always advertise the tools capability, even with zero registered
      // tools, so `tools/list` answers `[]` instead of "Method not found"
      // for a paused server or one with no compilable tools.
      (
        mcp as unknown as { setToolRequestHandlers: () => void }
      ).setToolRequestHandlers();

      if (!server || server.status === "paused") {
        return mcp;
      }

      const enabledTools = await db
        .select()
        .from(mcpTool)
        .where(and(eq(mcpTool.serverId, server.id), eq(mcpTool.enabled, true)));

      const compileInputs = await loadToolCompileInputs(db, server);

      const compiledTools: Array<{ tool: McpTool; plan: McpCompiledPlan }> = [];
      for (const tool of enabledTools) {
        try {
          compiledTools.push({
            tool,
            plan: compilePlanForTool(tool, compileInputs),
          });
        } catch {
          // Invalid or uncompilable tools are never advertised on the gateway.
          continue;
        }
      }
      compiledTools.sort((a, b) => a.tool.name.localeCompare(b.tool.name));

      for (const { tool, plan } of compiledTools) {
        let inputSchema: ReturnType<typeof deriveInputSchema>;
        try {
          inputSchema = deriveInputSchema(plan.agentInputs);
        } catch {
          continue;
        }
        mcp.registerTool(
          tool.name,
          {
            description:
              tool.description ?? `${plan.method} ${describePlanPath(plan)}`,
            inputSchema: inputSchema.shape,
            outputSchema: mcpExecutionEnvelopeSchema.shape,
            annotations: toolAnnotationsFromPlan(plan),
          },
          async (rawArgs) => {
            const mutating = MUTATING_METHODS.has(plan.method);
            const rateLimit = tryAcquireInvocation({
              tokenId: token.id,
              serverId: server.id,
              mutating,
            });
            if (!rateLimit.ok) {
              return structuredToolError(
                emptyEnvelope({
                  appCode: APP_ERROR_CODES.MCP_RATE_LIMITED,
                  ...(rateLimit.retryAfterSeconds !== undefined
                    ? { retryAfterSeconds: rateLimit.retryAfterSeconds }
                    : {}),
                }),
              );
            }

            try {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = inputSchema.parse(rawArgs ?? {}) as Record<
                  string,
                  unknown
                >;
              } catch {
                return jsonToolError(
                  "Invalid tool arguments.",
                  APP_ERROR_CODES.INVALID_INPUT,
                );
              }
              const result = await executeMappedTool(db, {
                serverId: server.id,
                toolId: tool.id,
                args: parsedArgs,
                source: "agent",
                credentialSecret: env.MCP_CREDENTIAL_SECRET,
              });
              return result.ok
                ? structuredToolResult(result.envelope)
                : structuredToolError(result.envelope);
            } catch (error) {
              if (error instanceof AppError) {
                return jsonToolError(error.message, error.appCode);
              }
              return jsonToolError("Tool execution failed.");
            } finally {
              releaseServerSlot(server.id);
            }
          },
        );
      }

      return mcp;
    });
  });

  return routes;
}
