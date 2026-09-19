/**
 * @file Platform MCP: a scoped, agent-facing control plane over the owner's
 * Studio. Every tool is declared once in a central registry with a title,
 * purpose, described inputs, explicit output schema, behavior annotations, and
 * required scopes. Scope filtering removes unauthorized tools and properties
 * (never representing undisclosed state as false/null). Destructive operations
 * still require a confirmation string matching the resource's current name,
 * and server-side confirmation/scope enforcement is never replaced by hints.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "./context.js";
import { APP_ERROR_CODES, AppError, appJsonError } from "./app-error.js";
import { extractBearerToken } from "./mcp-agent-token.js";
import {
  contractFingerprint,
  MCP_CONTRACT_META_KEY,
  MCP_CONTRACT_VERSION,
} from "./mcp-contract.js";
import {
  createToolCommandSchema,
  curlConfirmCommandSchema,
  duplicateToolCommandSchema,
  previewToolCompileCommandSchema,
  setServerValueCommandSchema,
  updateToolCommandSchema,
} from "./mcp-domain-commands.js";
import { handleMcpHttpRequest } from "./mcp-http.js";
import {
  MCP_GATEWAY_REQUEST_SIZE_LIMIT,
  type McpPlatformScope,
} from "./mcp-policy.js";
import {
  redactSensitiveExamples,
  scanDefinitionIds,
  type McpRequestDefinition,
} from "./mcp-request-definition.js";
import { releaseServerSlot, tryAcquireInvocation } from "./mcp-rate-limit.js";
import {
  installContractTools,
  type RegisteredContractTool,
} from "./mcp-registration.js";
import {
  buildMcpToolResult,
  errorEnvelope,
  internalErrorEnvelope,
  invalidArgumentsEnvelope,
  mcpToolEnvelopeSchema,
  mcpToolErrorSchema,
  toMcpToolError,
  type McpToolEnvelope,
} from "./mcp-result.js";
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
  page: z.number().int().min(1).optional().describe("1-based page number."),
  pageSize: z
    .union([z.literal(10), z.literal(20), z.literal(50)])
    .optional()
    .describe("Items per page."),
};

const serverIdShape = {
  serverId: z.string().min(1).describe("Owning server id."),
};

const paginationMeta = {
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
};

const serverResource = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  baseUrl: z.string(),
  allowedHosts: z.array(z.string()),
  status: z.string(),
  configRevision: z.number().int(),
  trafficLight: z.string(),
  hasSecret: z.boolean().optional(),
  enabledToolCount: z.number().int(),
  lastCallAt: z.string().nullable(),
});

/** Secret-existence properties are omitted entirely without secret_reference. */
const serverResourceWithoutSecret = serverResource.omit({ hasSecret: true });

const toolResource = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  method: z.string(),
  requestDefinition: z.unknown(),
  compileStatus: z.string().nullable(),
  compileIssues: z.unknown(),
  annotations: z.unknown(),
  allowMutation: z.boolean(),
  enabled: z.boolean(),
  source: z.string(),
  /** Server configuration revision after the committed mutation. */
  revision: z.number().int().optional(),
});

const variableResource = z.object({
  id: z.string(),
  name: z.string(),
  isSecret: z.boolean(),
  hasValue: z.boolean(),
  kind: z.string().optional(),
  owner: z.string().optional(),
});

const callLogResource = z.object({
  id: z.string(),
  toolId: z.string().nullable(),
  source: z.string(),
  status: z.string(),
  httpStatus: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  appCode: z.string().nullable(),
  requestSummary: z.string().nullable(),
  responseSummary: z.string().nullable(),
  createdAt: z.string().nullable(),
});

const connectionSnippetResource = z.object({
  url: z.string(),
  authorization: z.string(),
  instructions: z.string(),
});

const mutationAckResource = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  deleted: z.boolean().optional(),
  revoked: z.boolean().optional(),
  /** Server configuration revision after the committed mutation. */
  revision: z.number().int().optional(),
});

type PlatformToolContext = {
  db: Parameters<typeof listServers>[0];
  userId: string;
  tokenId: string;
  credentialSecret: string;
  apiOrigin: string;
  hasScope: (scope: McpPlatformScope) => boolean;
};

type PlatformToolDefinition = {
  name: string;
  title: string;
  description: string;
  /** Every listed scope is required for this tool to be exposed. */
  scopes: readonly McpPlatformScope[];
  input: z.ZodTypeAny;
  data: z.ZodTypeAny;
  /** Optional scope-dependent output schema, e.g. to omit hidden properties. */
  dataForScope?: (
    hasScope: (scope: McpPlatformScope) => boolean,
  ) => z.ZodTypeAny;
  annotations: ToolAnnotations;
  run: (
    ctx: PlatformToolContext,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
};

function definePlatformTool<
  I extends z.ZodTypeAny,
  D extends z.ZodTypeAny,
>(definition: {
  name: string;
  title: string;
  description: string;
  scopes: readonly McpPlatformScope[];
  input: I;
  data: D;
  dataForScope?: (
    hasScope: (scope: McpPlatformScope) => boolean,
  ) => z.ZodTypeAny;
  annotations: ToolAnnotations;
  run: (ctx: PlatformToolContext, args: z.infer<I>) => Promise<z.infer<D>>;
}): PlatformToolDefinition {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    scopes: definition.scopes,
    input: definition.input,
    data: definition.data,
    ...(definition.dataForScope
      ? { dataForScope: definition.dataForScope }
      : {}),
    annotations: definition.annotations,
    run: (ctx, args) =>
      definition.run(ctx, args as z.infer<I>) as Promise<unknown>,
  };
}

/**
 * Strips sensitive `examples` from any tool row echoed back to an agent before
 * the result is projected through the advertised output schema.
 */
function redactToolRow<T extends Record<string, unknown>>(tool: T): T {
  if (!("requestDefinition" in tool)) return tool;
  return {
    ...tool,
    requestDefinition: redactSensitiveExamples(
      (tool as { requestDefinition?: unknown }).requestDefinition,
    ),
  };
}

const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const DESTRUCTIVE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

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

const PLATFORM_REGISTRY: PlatformToolDefinition[] = [
  definePlatformTool({
    name: "list_servers",
    title: "List servers",
    description:
      "List the MCP servers you own with pagination. Use this to discover server ids before calling other tools.",
    scopes: ["read"],
    input: z.object(paginationShape).strict(),
    data: z.object({ ...paginationMeta, items: z.array(serverResource) }),
    dataForScope: (hasScope) =>
      z.object({
        ...paginationMeta,
        items: z.array(
          hasScope("secret_reference")
            ? serverResource
            : serverResourceWithoutSecret,
        ),
      }),
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const page = await listServers(ctx.db, ctx.userId, {
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
          configRevision: item.configRevision,
          trafficLight: item.trafficLight,
          ...(ctx.hasScope("secret_reference")
            ? { hasSecret: item.hasSecret }
            : {}),
          enabledToolCount: item.enabledToolCount,
          lastCallAt: item.lastCallAt ? item.lastCallAt.toISOString() : null,
        })),
      };
    },
  }),

  definePlatformTool({
    name: "list_tools",
    title: "List server tools",
    description:
      "List the tools on a server you own, including each canonical typed request definition and id-addressable compile issues.",
    scopes: ["read"],
    input: z.object({ ...serverIdShape, ...paginationShape }).strict(),
    data: z.object({ ...paginationMeta, items: z.array(toolResource) }),
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const page = await listTools(ctx.db, ctx.userId, args.serverId, {
        page: args.page ?? 1,
        pageSize: args.pageSize ?? 10,
      });
      return {
        ...page,
        items: page.items.map((tool) => ({
          id: tool.id,
          name: tool.name,
          title: tool.title,
          description: tool.description,
          method: tool.method,
          requestDefinition: redactSensitiveExamples(tool.requestDefinition),
          compileStatus: tool.compileStatus,
          compileIssues: tool.compileIssues,
          annotations: tool.annotations,
          allowMutation: tool.allowMutation,
          enabled: tool.enabled,
          source: tool.source,
        })),
      };
    },
  }),

  definePlatformTool({
    name: "list_variables",
    title: "List server values",
    description:
      "List the server values on a server you own. Without secret_reference scope, secret rows are omitted entirely so their existence is not disclosed.",
    scopes: ["read"],
    input: z.object(serverIdShape).strict(),
    data: z.array(variableResource),
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const variables = await listVariables(ctx.db, ctx.userId, args.serverId);
      return variables
        .filter(
          (variable) => !variable.isSecret || ctx.hasScope("secret_reference"),
        )
        .map(({ id, name, isSecret, hasValue, kind, owner }) => ({
          id,
          name,
          isSecret,
          hasValue,
          ...(kind ? { kind } : {}),
          ...(owner ? { owner } : {}),
        }));
    },
  }),

  definePlatformTool({
    name: "get_connection_snippet",
    title: "Get connection snippet",
    description:
      "Get the hosted MCP URL for a server you own. Does not mint or return a token.",
    scopes: ["read"],
    input: z.object(serverIdShape).strict(),
    data: connectionSnippetResource,
    annotations: READ_ANNOTATIONS,
    run: (ctx, args) =>
      getConnectionSnippet(ctx.db, ctx.userId, args.serverId, ctx.apiOrigin),
  }),

  definePlatformTool({
    name: "list_recent_calls",
    title: "List recent calls",
    description:
      "List recent call logs for a server you own, newest first, with pagination.",
    scopes: ["read"],
    input: z.object({ ...serverIdShape, ...paginationShape }).strict(),
    data: z.object({ ...paginationMeta, items: z.array(callLogResource) }),
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const page = await listCallLogs(ctx.db, ctx.userId, args.serverId, {
        page: args.page ?? 1,
        pageSize: args.pageSize ?? 10,
      });
      return {
        ...page,
        items: page.items.map((item) => ({
          ...item,
          createdAt: item.createdAt ? item.createdAt.toISOString() : null,
        })),
      };
    },
  }),

  definePlatformTool({
    name: "create_server",
    title: "Create server",
    description:
      "Create a new MCP server. Authentication is never accepted here; configure it afterward in Studio.",
    scopes: ["author"],
    input: z
      .object({
        name: z.string().min(1).describe("Human-facing server name."),
        description: z.string().optional().describe("Optional server summary."),
        baseUrl: z.url().describe("Upstream REST base URL."),
        slug: z.string().optional().describe("Optional URL-safe server slug."),
      })
      .strict(),
    data: serverResource,
    annotations: WRITE_ANNOTATIONS,
    run: async (ctx, args) => {
      const server = await createServer(ctx.db, ctx.userId, {
        name: args.name,
        description: args.description ?? null,
        baseUrl: args.baseUrl,
        slug: args.slug,
      });
      return {
        ...server,
        lastCallAt: server.lastCallAt ? server.lastCallAt.toISOString() : null,
      };
    },
  }),

  definePlatformTool({
    name: "create_tool",
    title: "Create tool",
    description:
      "Create a REST tool from a versioned typed request definition with literal, serverValue, and agentInput bindings. Binding a secret server value requires the secret_reference scope.",
    scopes: ["author"],
    input: createToolCommandSchema,
    data: toolResource,
    annotations: WRITE_ANNOTATIONS,
    run: async (ctx, args) => {
      await assertTypedServerValueScopes({
        db: ctx.db,
        userId: ctx.userId,
        serverId: args.serverId,
        definition: args.requestDefinition,
        hasSecretReference: ctx.hasScope("secret_reference"),
        hasScope: ctx.hasScope,
      });
      return redactToolRow(
        await createTool(ctx.db, ctx.userId, args.serverId, {
          expectedRevision: args.expectedRevision,
          name: args.name,
          title: args.title,
          description: args.description,
          method: args.method,
          requestDefinition: args.requestDefinition,
          allowMutation: args.allowMutation,
          enabled: args.enabled,
        }),
      );
    },
  }),

  definePlatformTool({
    name: "update_tool",
    title: "Update tool",
    description:
      "Update a tool you own using a versioned typed request definition. Legacy template fields are not accepted; mixed payloads are rejected.",
    scopes: ["author"],
    input: updateToolCommandSchema,
    data: toolResource,
    annotations: WRITE_ANNOTATIONS,
    run: async (ctx, args) => {
      let effectiveDefinition = args.requestDefinition;
      if (!effectiveDefinition) {
        const state = await getToolEditorState(
          ctx.db,
          ctx.userId,
          args.serverId,
          args.toolId,
        );
        if (state.definition) effectiveDefinition = state.definition;
      }
      if (effectiveDefinition) {
        await assertTypedServerValueScopes({
          db: ctx.db,
          userId: ctx.userId,
          serverId: args.serverId,
          definition: effectiveDefinition,
          hasSecretReference: ctx.hasScope("secret_reference"),
          hasScope: ctx.hasScope,
        });
      }
      return redactToolRow(
        await updateTool(ctx.db, ctx.userId, args.serverId, args.toolId, {
          expectedRevision: args.expectedRevision,
          name: args.name,
          title: args.title,
          description: args.description,
          method: args.method,
          requestDefinition: args.requestDefinition,
          allowMutation: args.allowMutation,
          enabled: args.enabled,
        }),
      );
    },
  }),

  definePlatformTool({
    name: "preview_tool",
    title: "Preview tool contract",
    description:
      "Dry-run compile a typed request definition against the server's current values, common entries, and auth configuration, and return the exact agent-visible contract. Writes nothing.",
    scopes: ["author"],
    input: previewToolCompileCommandSchema,
    data: z.object({
      ok: z.boolean(),
      ready: z.boolean(),
      issues: z.array(z.unknown()),
      plan: z.unknown(),
      contract: z.unknown(),
      compatibilityProjectable: z.boolean(),
    }),
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      await assertTypedServerValueScopes({
        db: ctx.db,
        userId: ctx.userId,
        serverId: args.serverId,
        definition: args.requestDefinition,
        hasSecretReference: ctx.hasScope("secret_reference"),
        hasScope: ctx.hasScope,
      });
      return previewToolCompile(ctx.db, ctx.userId, args.serverId, {
        name: args.name,
        title: args.title,
        description: args.description,
        method: args.method,
        requestDefinition: args.requestDefinition,
        allowMutation: args.allowMutation,
      });
    },
  }),

  definePlatformTool({
    name: "duplicate_tool",
    title: "Duplicate tool",
    description:
      "Duplicate a typed tool, regenerating definition-local ids while preserving referenced server-value ids.",
    scopes: ["author"],
    input: duplicateToolCommandSchema,
    data: toolResource,
    annotations: WRITE_ANNOTATIONS,
    run: async (ctx, args) => {
      const state = await getToolEditorState(
        ctx.db,
        ctx.userId,
        args.serverId,
        args.toolId,
      );
      if (state.definition) {
        await assertTypedServerValueScopes({
          db: ctx.db,
          userId: ctx.userId,
          serverId: args.serverId,
          definition: state.definition,
          hasSecretReference: ctx.hasScope("secret_reference"),
          hasScope: ctx.hasScope,
        });
      }
      return redactToolRow(
        await duplicateTool(ctx.db, ctx.userId, args.serverId, args.toolId, {
          expectedRevision: args.expectedRevision,
          name: args.name,
          title: args.title,
          description: args.description,
          enabled: args.enabled,
        }),
      );
    },
  }),

  definePlatformTool({
    name: "add_tool_from_curl",
    title: "Add tool from curl",
    description:
      "Import a tool from one curl command. Curl commands containing credentials, cookies, or proxy auth are rejected — configure authentication separately in Studio.",
    scopes: ["author"],
    input: curlConfirmCommandSchema,
    data: z.object({
      id: z.string().optional(),
      name: z.string().optional(),
      compileOk: z.boolean().optional(),
      issues: z.array(z.unknown()).optional(),
      excludedCredentials: z.array(z.unknown()).optional(),
    }),
    annotations: WRITE_ANNOTATIONS,
    run: async (ctx, args) => {
      if (!ctx.hasScope("secret_reference")) {
        const variables =
          (await listVariables(ctx.db, ctx.userId, args.serverId)) ?? [];
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
      return redactToolRow(
        await createToolFromCurl(ctx.db, ctx.userId, args.serverId, args, {
          rejectCredentials: true,
        }),
      );
    },
  }),

  definePlatformTool({
    name: "set_variable",
    title: "Set server value",
    description:
      "Create or update a non-secret server configuration value. Secrets cannot be created or rotated through Platform MCP.",
    scopes: ["author"],
    input: setServerValueCommandSchema,
    data: mutationAckResource,
    annotations: WRITE_ANNOTATIONS,
    run: async (ctx, args) => {
      if (args.kind === "secret") {
        throw new AppError({
          appCode: APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
          message:
            "Platform MCP cannot create or rotate secrets; use the Studio secret flow.",
          status: 400,
        });
      }
      const variables =
        (await listVariables(ctx.db, ctx.userId, args.serverId)) ?? [];
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
        ctx.db,
        ctx.userId,
        args.serverId,
        {
          expectedRevision: args.expectedRevision,
          name: args.name,
          isSecret: false,
          value: args.value,
        },
        ctx.credentialSecret,
      );
    },
  }),

  definePlatformTool({
    name: "test_tool",
    title: "Test tool invocation",
    description:
      "Invoke a tool with the shared compiled executor and structured result contract. Returns the nested upstream execution envelope.",
    scopes: ["invoke"],
    input: z
      .object({
        ...serverIdShape,
        toolId: z.string().min(1).describe("Tool id to invoke."),
        args: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Arguments matching the tool's input schema."),
      })
      .strict(),
    data: z.object({
      ok: z.boolean(),
      httpStatus: z.number().int().nullable(),
      envelope: mcpToolEnvelopeSchema,
      durationMs: z.number(),
      callLogId: z.string().nullable(),
    }),
    annotations: { ...WRITE_ANNOTATIONS, destructiveHint: true },
    run: async (ctx, args) => {
      const rateLimit = tryAcquireInvocation({
        tokenId: ctx.tokenId,
        serverId: args.serverId,
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
        const result = await executeMappedTool(ctx.db, {
          serverId: args.serverId,
          ownerUserId: ctx.userId,
          toolId: args.toolId,
          args: args.args,
          source: "platform",
          credentialSecret: ctx.credentialSecret,
        });
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
    },
  }),

  definePlatformTool({
    name: "delete_server",
    title: "Delete server",
    description:
      "Delete a server you own, cascading its tools, variables, agent tokens, and call logs. Requires `confirm` to match the server's current name; the server enforces this independently of annotations.",
    scopes: ["destructive"],
    input: z
      .object({
        ...serverIdShape,
        expectedRevision: z
          .number()
          .int()
          .min(1)
          .describe("Last observed server configuration revision."),
        confirm: z
          .string()
          .min(1)
          .describe("Must match the server's current name."),
      })
      .strict(),
    data: mutationAckResource,
    annotations: DESTRUCTIVE_ANNOTATIONS,
    run: async (ctx, args) => {
      const currentName = await getServerName(
        ctx.db,
        ctx.userId,
        args.serverId,
      );
      assertDestructiveConfirmation(args.confirm, currentName);
      return deleteServer(
        ctx.db,
        ctx.userId,
        args.serverId,
        args.expectedRevision,
      );
    },
  }),

  definePlatformTool({
    name: "delete_tool",
    title: "Delete tool",
    description:
      "Delete a tool from a server you own. Requires `confirm` to match the tool's current name; the server enforces this independently of annotations.",
    scopes: ["destructive"],
    input: z
      .object({
        ...serverIdShape,
        expectedRevision: z
          .number()
          .int()
          .min(1)
          .describe("Last observed server configuration revision."),
        toolId: z.string().min(1).describe("Tool id to delete."),
        confirm: z
          .string()
          .min(1)
          .describe("Must match the tool's current name."),
      })
      .strict(),
    data: mutationAckResource,
    annotations: DESTRUCTIVE_ANNOTATIONS,
    run: async (ctx, args) => {
      const currentName = await getToolName(
        ctx.db,
        ctx.userId,
        args.serverId,
        args.toolId,
      );
      assertDestructiveConfirmation(args.confirm, currentName);
      return deleteTool(
        ctx.db,
        ctx.userId,
        args.serverId,
        args.toolId,
        args.expectedRevision,
      );
    },
  }),

  definePlatformTool({
    name: "delete_variable",
    title: "Delete server value",
    description:
      "Delete a server value you own. Requires `confirm` to match the value's current name; the server enforces this independently of annotations.",
    scopes: ["destructive"],
    input: z
      .object({
        ...serverIdShape,
        expectedRevision: z
          .number()
          .int()
          .min(1)
          .describe("Last observed server configuration revision."),
        name: z.string().min(1).describe("Server value name to delete."),
        confirm: z.string().min(1).describe("Must repeat the value name."),
      })
      .strict(),
    data: mutationAckResource,
    annotations: DESTRUCTIVE_ANNOTATIONS,
    run: async (ctx, args) => {
      assertDestructiveConfirmation(args.confirm, args.name);
      return deleteVariable(
        ctx.db,
        ctx.userId,
        args.serverId,
        args.name,
        args.expectedRevision,
      );
    },
  }),
];

function isTrustedOrigin(origin: string, appOrigin: string): boolean {
  try {
    return new URL(origin).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

function isToolExposed(
  tool: PlatformToolDefinition,
  hasScope: (scope: McpPlatformScope) => boolean,
): boolean {
  return tool.scopes.every(hasScope);
}

/**
 * One object output schema accepts both the typed success envelope and the
 * shared error envelope. The MCP SDK requires an object output schema, and
 * `error`/`data` presence distinguishes the two outcomes.
 */
function platformOutputValidator(data: z.ZodTypeAny) {
  return z.strictObject({
    ok: z.boolean(),
    status: z.number().int().nullable(),
    contentType: z.string().nullable(),
    data: data.optional(),
    body: z.string().optional(),
    headers: z.record(z.string(), z.string()),
    truncated: z.boolean(),
    binary: z.boolean().optional(),
    error: mcpToolErrorSchema.optional(),
  });
}

/**
 * Builds the exact advertised output schema (success envelope with typed data
 * or the shared error envelope) and the contract fingerprint metadata.
 */
export function buildPlatformContract(
  tool: PlatformToolDefinition,
  hasScope: (scope: McpPlatformScope) => boolean = () => true,
) {
  const data = tool.dataForScope?.(hasScope) ?? tool.data;
  const outputValidator = platformOutputValidator(data);
  const inputSchema = z.toJSONSchema(tool.input, {
    io: "input",
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  const outputSchema = z.toJSONSchema(outputValidator, {
    io: "output",
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  const fingerprint = contractFingerprint({
    contractVersion: MCP_CONTRACT_VERSION,
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema,
    outputSchema,
    annotations: tool.annotations,
  });
  return {
    inputSchema,
    outputSchema,
    fingerprint,
    outputValidator: outputValidator as unknown as z.ZodType<
      Record<string, unknown>
    >,
    metadata: {
      [MCP_CONTRACT_META_KEY]: {
        version: MCP_CONTRACT_VERSION,
        fingerprint,
      },
    },
  };
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

      const exposedTools = PLATFORM_REGISTRY.filter((tool) =>
        isToolExposed(tool, hasScope),
      ).sort((a, b) => a.name.localeCompare(b.name));

      const ctx: PlatformToolContext = {
        db,
        userId,
        tokenId: token.id,
        credentialSecret: env.MCP_CREDENTIAL_SECRET,
        apiOrigin,
        hasScope,
      };

      const registrations: RegisteredContractTool[] = exposedTools.map(
        (tool) => {
          const contract = buildPlatformContract(tool, hasScope);
          return {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: contract.inputSchema,
            outputSchema: contract.outputSchema,
            annotations: tool.annotations,
            metadata: contract.metadata,
            handler: async (rawArgs) => {
              const parsed = tool.input.safeParse(rawArgs ?? {});
              if (!parsed.success) {
                return buildMcpToolResult(
                  invalidArgumentsEnvelope(parsed.error),
                  { validator: contract.outputValidator },
                );
              }
              try {
                const data = await tool.run(
                  ctx,
                  parsed.data as Record<string, unknown>,
                );
                const envelope: McpToolEnvelope = {
                  ok: true,
                  status: null,
                  contentType: null,
                  data,
                  headers: {},
                  truncated: false,
                };
                return buildMcpToolResult(envelope, {
                  validator: contract.outputValidator,
                });
              } catch (error) {
                const envelope =
                  error instanceof AppError
                    ? errorEnvelope(toMcpToolError(error))
                    : internalErrorEnvelope();
                return buildMcpToolResult(envelope, {
                  validator: contract.outputValidator,
                });
              }
            },
          };
        },
      );

      installContractTools(mcp, registrations);
      return mcp;
    });
  });

  return routes;
}

/** Exposed for contract snapshots and tests. */
export { PLATFORM_REGISTRY, platformOutputValidator };
