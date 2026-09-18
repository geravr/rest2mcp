/**
 * @file Platform MCP: a scoped, agent-facing control plane over the owner's
 * Studio. Tools are registered only when the authenticated token carries the
 * required scope, so unauthorized operations are absent from `list_tools`
 * rather than merely denied at call time. Destructive operations additionally
 * require a confirmation string matching the resource's *current* name.
 * Platform MCP never accepts a plaintext secret value or an auth recipe, and
 * `get_connection_snippet` never mints a token.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { APP_ERROR_CODES, AppError, appJsonError } from "./app-error.js";
import { extractBearerToken } from "./mcp-agent-token.js";
import {
  createToolCommandSchema,
  curlConfirmCommandSchema,
  duplicateToolCommandSchema,
  previewToolCompileCommandSchema,
  setServerValueCommandSchema,
  updateToolCommandSchema,
} from "./mcp-domain-commands.js";
import {
  handleMcpHttpRequest,
  jsonToolError,
  jsonToolResult,
} from "./mcp-http.js";
import {
  MCP_GATEWAY_REQUEST_SIZE_LIMIT,
  type McpPlatformScope,
} from "./mcp-policy.js";
import {
  scanDefinitionIds,
  type McpRequestDefinition,
} from "./mcp-request-definition.js";
import { releaseServerSlot, tryAcquireInvocation } from "./mcp-rate-limit.js";
import { executeMappedTool } from "../services/mcp-executor-service.js";
import {
  authenticateAgentToken,
  createServer,
  createTool,
  createToolFromCurl,
  deleteServer,
  deleteTool,
  deleteVariable,
  duplicateTool,
  getConnectionSnippet,
  getServerName,
  getToolEditorState,
  getToolName,
  listCallLogs,
  listServers,
  listTools,
  listVariables,
  previewToolCompile,
  resolveApiOrigin,
  setVariable,
  updateTool,
} from "../services/mcp-studio-service.js";

const paginationShape = {
  page: z.number().int().min(1).optional(),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).optional(),
};

const serverIdShape = { serverId: z.string().min(1) };

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

function assertDestructiveConfirmation(
  confirm: string,
  currentName: string,
): void {
  if (confirm !== currentName) {
    throw new AppError({
      appCode: APP_ERROR_CODES.MCP_DESTRUCTIVE_CONFIRMATION_REQUIRED,
      message: `Confirmation "${confirm}" does not match the current resource name.`,
      status: 400,
    });
  }
}

function isTrustedOrigin(origin: string, appOrigin: string): boolean {
  try {
    return new URL(origin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

type PlatformToolRow = {
  id: string;
  name: string;
  description: string | null;
  method: string;
  requestDefinition: unknown;
  compileStatus: string | null;
  compileIssues: unknown;
  annotations: unknown;
  allowMutation: boolean;
  enabled: boolean;
  source: string;
};

/**
 * Strips legacy compatibility fields and resolved server values so Platform
 * agents reason only about the canonical typed definition and id-addressable
 * compile issues.
 */
function toPlatformToolResult(tool: PlatformToolRow) {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    method: tool.method,
    requestDefinition: tool.requestDefinition,
    compileStatus: tool.compileStatus,
    compileIssues: tool.compileIssues,
    annotations: tool.annotations,
    allowMutation: tool.allowMutation,
    enabled: tool.enabled,
    source: tool.source,
  };
}

/**
 * Requires `secret_reference` before any secret server-value id is resolved.
 * The generic denial does not reveal whether the id exists. Loading the value
 * catalog only inspects kind/metadata; it never decrypts a secret value.
 */
async function assertTypedServerValueScopes(input: {
  db: Parameters<typeof listVariables>[0];
  userId: string;
  serverId: string;
  definition: McpRequestDefinition;
  hasSecretReference: boolean;
  hasScope: (scope: McpPlatformScope) => boolean;
}): Promise<void> {
  const refs = scanDefinitionIds(input.definition).serverValueRefs;
  if (refs.length === 0) return;
  if (!input.hasScope("author")) {
    throw new AppError({
      appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
      message: "Author scope is required to write tools.",
      status: 403,
      details: { scopes: ["author"] },
    });
  }
  if (input.hasSecretReference) return;
  const variables = await listVariables(input.db, input.userId, input.serverId);
  const byId = new Map(variables.map((variable) => [variable.id, variable]));
  const secretHit = refs.some((ref) => byId.get(ref.id)?.isSecret === true);
  if (secretHit) {
    throw new AppError({
      appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
      message: "This operation is not permitted with the current token scopes.",
      status: 403,
      details: { scopes: ["secret_reference"] },
    });
  }
}

export function createPlatformMcpRoutes() {
  const routes = new Hono<AppContext>();

  routes.all("/", async (c) => {
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
          "Platform token is required.",
        ),
        401,
      );
    }

    const db = c.get("dbDirect") ?? c.get("db");

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
    const scopes = new Set<McpPlatformScope>(
      (token.scopes ?? []) as McpPlatformScope[],
    );
    const hasScope = (scope: McpPlatformScope) => scopes.has(scope);

    return handleMcpHttpRequest(mcpRequest, async () => {
      const mcp = new McpServer({
        name: "rest2mcp-platform",
        version: "1.0.0",
      });

      if (hasScope("read")) {
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
                  hasSecret: hasScope("secret_reference")
                    ? item.hasSecret
                    : false,
                  enabledToolCount: item.enabledToolCount,
                  lastCallAt: item.lastCallAt,
                })),
              };
            },
          ),
        );

        mcp.registerTool(
          "list_tools",
          {
            description:
              "List tools on a server you own, including each canonical typed request definition and id-addressable compile issues.",
            inputSchema: z.object({ ...serverIdShape, ...paginationShape }),
          },
          asToolResult(
            async (args: {
              serverId: string;
              page?: number;
              pageSize?: 10 | 20 | 50;
            }) => {
              const page = await listTools(db, userId, args.serverId, {
                page: args.page ?? 1,
                pageSize: args.pageSize ?? 10,
              });
              return {
                ...page,
                items: page.items.map((tool) =>
                  toPlatformToolResult(tool as unknown as PlatformToolRow),
                ),
              };
            },
          ),
        );

        mcp.registerTool(
          "list_variables",
          {
            description:
              "List server values. Without secret_reference scope, secret rows are omitted entirely so their existence is not disclosed.",
            inputSchema: z.object(serverIdShape),
          },
          asToolResult(async (args: { serverId: string }) => {
            const variables = await listVariables(db, userId, args.serverId);
            return variables
              .filter(
                (variable) =>
                  !variable.isSecret || hasScope("secret_reference"),
              )
              .map(({ id, name, isSecret, hasValue, kind, owner }) => ({
                id,
                name,
                isSecret,
                hasValue,
                ...(kind ? { kind } : {}),
                ...(owner ? { owner } : {}),
              }));
          }),
        );

        mcp.registerTool(
          "get_connection_snippet",
          {
            description:
              "Get the hosted MCP URL for a server. Does not mint or return a token.",
            inputSchema: z.object(serverIdShape),
          },
          asToolResult((args: { serverId: string }) =>
            getConnectionSnippet(db, userId, args.serverId, apiOrigin),
          ),
        );

        mcp.registerTool(
          "list_recent_calls",
          {
            description: "List recent call logs for a server you own.",
            inputSchema: z.object({ ...serverIdShape, ...paginationShape }),
          },
          asToolResult(
            (args: {
              serverId: string;
              page?: number;
              pageSize?: 10 | 20 | 50;
            }) =>
              listCallLogs(db, userId, args.serverId, {
                page: args.page ?? 1,
                pageSize: args.pageSize ?? 10,
              }),
          ),
        );
      }

      if (hasScope("author")) {
        mcp.registerTool(
          "create_server",
          {
            description:
              "Create a new MCP server. Authentication is never accepted here; configure it afterward in Studio.",
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
          "create_tool",
          {
            description:
              "Create a REST tool from a versioned typed request definition with literal, serverValue, and agentInput bindings. Binding a secret server value requires the secret_reference scope.",
            inputSchema: createToolCommandSchema,
          },
          asToolResult(async (args) => {
            await assertTypedServerValueScopes({
              db,
              userId,
              serverId: args.serverId,
              definition: args.requestDefinition,
              hasSecretReference: hasScope("secret_reference"),
              hasScope,
            });
            const tool = await createTool(db, userId, args.serverId, {
              name: args.name,
              description: args.description,
              method: args.method,
              requestDefinition: args.requestDefinition,
              allowMutation: args.allowMutation,
              enabled: args.enabled,
            });
            return toPlatformToolResult(tool as unknown as PlatformToolRow);
          }),
        );

        mcp.registerTool(
          "update_tool",
          {
            description:
              "Update a tool you own using a versioned typed request definition. Legacy template fields are not accepted; mixed payloads are rejected.",
            inputSchema: updateToolCommandSchema,
          },
          asToolResult(async (args) => {
            let effectiveDefinition = args.requestDefinition;
            if (!effectiveDefinition) {
              const state = await getToolEditorState(
                db,
                userId,
                args.serverId,
                args.toolId,
              );
              if (state.definition) effectiveDefinition = state.definition;
            }
            if (effectiveDefinition) {
              await assertTypedServerValueScopes({
                db,
                userId,
                serverId: args.serverId,
                definition: effectiveDefinition,
                hasSecretReference: hasScope("secret_reference"),
                hasScope,
              });
            }
            const tool = await updateTool(
              db,
              userId,
              args.serverId,
              args.toolId,
              {
                name: args.name,
                description: args.description,
                method: args.method,
                requestDefinition: args.requestDefinition,
                allowMutation: args.allowMutation,
                enabled: args.enabled,
              },
            );
            return toPlatformToolResult(tool as unknown as PlatformToolRow);
          }),
        );

        mcp.registerTool(
          "preview_tool",
          {
            description:
              "Dry-run compile a typed request definition against the server's current values, common entries, and auth configuration. Writes nothing.",
            inputSchema: previewToolCompileCommandSchema,
          },
          asToolResult(async (args) => {
            await assertTypedServerValueScopes({
              db,
              userId,
              serverId: args.serverId,
              definition: args.requestDefinition,
              hasSecretReference: hasScope("secret_reference"),
              hasScope,
            });
            return previewToolCompile(db, userId, args.serverId, {
              method: args.method,
              requestDefinition: args.requestDefinition,
              allowMutation: args.allowMutation,
            });
          }),
        );

        mcp.registerTool(
          "duplicate_tool",
          {
            description:
              "Duplicate a typed tool, regenerating definition-local ids while preserving referenced server-value ids.",
            inputSchema: duplicateToolCommandSchema,
          },
          asToolResult(async (args) => {
            const state = await getToolEditorState(
              db,
              userId,
              args.serverId,
              args.toolId,
            );
            if (state.definition) {
              await assertTypedServerValueScopes({
                db,
                userId,
                serverId: args.serverId,
                definition: state.definition,
                hasSecretReference: hasScope("secret_reference"),
                hasScope,
              });
            }
            const tool = await duplicateTool(
              db,
              userId,
              args.serverId,
              args.toolId,
              {
                name: args.name,
                description: args.description,
                enabled: args.enabled,
              },
            );
            return toPlatformToolResult(tool as unknown as PlatformToolRow);
          }),
        );

        mcp.registerTool(
          "add_tool_from_curl",
          {
            description:
              "Import a tool from one curl command. Curl commands containing credentials, cookies, or proxy auth are rejected — configure authentication separately in Studio.",
            inputSchema: curlConfirmCommandSchema,
          },
          asToolResult(async (args) => {
            if (!hasScope("secret_reference")) {
              const variables =
                (await listVariables(db, userId, args.serverId)) ?? [];
              const secretNames = new Set(
                variables
                  .filter((variable) => variable.isSecret)
                  .map((variable) => variable.name),
              );
              const secretMarking = (args.markings ?? []).find(
                (marking) =>
                  marking.as === "serverValue" &&
                  marking.name !== undefined &&
                  secretNames.has(marking.name),
              );
              if (secretMarking) {
                throw new AppError({
                  appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
                  message:
                    "Binding a secret server value requires the secret_reference scope.",
                  status: 403,
                  details: { scopes: ["secret_reference"] },
                });
              }
            }
            return createToolFromCurl(db, userId, args.serverId, args, {
              rejectCredentials: true,
            });
          }),
        );

        mcp.registerTool(
          "set_variable",
          {
            description:
              "Create or update a non-secret server configuration value. Secrets cannot be created or rotated through Platform MCP.",
            inputSchema: setServerValueCommandSchema,
          },
          asToolResult(async (args) => {
            if (args.kind === "secret") {
              throw new AppError({
                appCode: APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
                message:
                  "Platform MCP cannot create or rotate secrets; use the Studio secret flow.",
                status: 400,
              });
            }
            const variables =
              (await listVariables(db, userId, args.serverId)) ?? [];
            if (
              variables.some(
                (variable) => variable.name === args.name && variable.isSecret,
              )
            ) {
              throw new AppError({
                appCode: APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
                message:
                  "Refusing to overwrite a secret server value; rotate it through the Studio secret flow.",
                status: 409,
              });
            }
            return setVariable(
              db,
              userId,
              args.serverId,
              { name: args.name, isSecret: false, value: args.value },
              env.MCP_CREDENTIAL_SECRET,
            );
          }),
        );
      }

      if (hasScope("invoke")) {
        mcp.registerTool(
          "test_tool",
          {
            description:
              "Invoke a tool with the shared compiled executor and structured result contract.",
            inputSchema: z.object({
              ...serverIdShape,
              toolId: z.string().min(1),
              args: z.record(z.string(), z.unknown()).optional(),
            }),
          },
          asToolResult(async (args) => {
            const rateLimit = tryAcquireInvocation({
              tokenId: token.id,
              serverId: args.serverId,
              // Platform test_tool may target mutating methods; use the
              // stricter mutation budget until the method is known cheaply.
              mutating: true,
            });
            if (!rateLimit.ok) {
              throw new AppError({
                appCode: APP_ERROR_CODES.MCP_RATE_LIMITED,
                message: "Too many requests. Wait and try again.",
                status: 429,
                details:
                  rateLimit.retryAfterSeconds !== undefined
                    ? { retryAfterSeconds: rateLimit.retryAfterSeconds }
                    : undefined,
              });
            }
            try {
              const result = await executeMappedTool(db, {
                serverId: args.serverId,
                ownerUserId: userId,
                toolId: args.toolId,
                args: args.args,
                source: "platform",
                credentialSecret: env.MCP_CREDENTIAL_SECRET,
              });
              // Never expose decrypted secret values to the Platform agent.
              return {
                ok: result.ok,
                httpStatus: result.httpStatus,
                envelope: result.envelope,
                durationMs: result.durationMs,
                callLogId: result.callLogId,
              };
            } finally {
              releaseServerSlot(args.serverId);
            }
          }),
        );
      }

      if (hasScope("destructive")) {
        mcp.registerTool(
          "delete_server",
          {
            description:
              "Delete a server you own, cascading its tools, variables, agent tokens, and call logs. Requires `confirm` to match the server's current name.",
            inputSchema: z.object({
              ...serverIdShape,
              confirm: z.string().min(1),
            }),
          },
          asToolResult(async (args: { serverId: string; confirm: string }) => {
            const currentName = await getServerName(db, userId, args.serverId);
            assertDestructiveConfirmation(args.confirm, currentName);
            return deleteServer(db, userId, args.serverId);
          }),
        );

        mcp.registerTool(
          "delete_tool",
          {
            description:
              "Delete a tool from a server you own. Requires `confirm` to match the tool's current name.",
            inputSchema: z.object({
              ...serverIdShape,
              toolId: z.string().min(1),
              confirm: z.string().min(1),
            }),
          },
          asToolResult(
            async (args: {
              serverId: string;
              toolId: string;
              confirm: string;
            }) => {
              const currentName = await getToolName(
                db,
                userId,
                args.serverId,
                args.toolId,
              );
              assertDestructiveConfirmation(args.confirm, currentName);
              return deleteTool(db, userId, args.serverId, args.toolId);
            },
          ),
        );

        mcp.registerTool(
          "delete_variable",
          {
            description:
              "Delete a server value you own. Requires `confirm` to match the value's current name.",
            inputSchema: z.object({
              ...serverIdShape,
              name: z.string().min(1),
              confirm: z.string().min(1),
            }),
          },
          asToolResult(
            async (args: {
              serverId: string;
              name: string;
              confirm: string;
            }) => {
              assertDestructiveConfirmation(args.confirm, args.name);
              return deleteVariable(db, userId, args.serverId, args.name);
            },
          ),
        );
      }

      return mcp;
    });
  });

  return routes;
}
