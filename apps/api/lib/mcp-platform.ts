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
import { Hono, type Context } from "hono";
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
  publishPreviewCommandSchema,
  publishServerCommandSchema,
  restoreRevisionCommandSchema,
  revisionDetailCommandSchema,
  revisionHistoryCommandSchema,
  setServerValueCommandSchema,
  updateToolCommandSchema,
} from "./mcp-domain-commands.js";
import { handleMcpHttpRequest } from "./mcp-http.js";
import {
  MCP_GATEWAY_REQUEST_SIZE_LIMIT,
  type McpPlatformScope,
} from "./mcp-policy.js";
import {
  platformHasScope,
  type PlatformPrincipal,
} from "./mcp-platform-principal.js";
import { authenticatePlatformPat } from "../services/mcp-platform-token-service.js";
import { recordPlatformSecurityEventBestEffort } from "../services/mcp-platform-security-event-service.js";
import {
  redactSensitiveExamples,
  scanDefinitionIds,
  type McpRequestDefinition,
} from "./mcp-request-definition.js";
import {
  releasePlatformRequest,
  releaseServerSlot,
  tryAcquireInvocation,
  tryAcquirePlatformRequest,
  tryAcquirePlatformWrite,
} from "./mcp-rate-limit.js";
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
  getPublishedToolIdentity,
  getRevisionDetail,
  listRevisionHistory,
  previewPublish,
  publishServer,
  restoreRevisionToDraft,
} from "../services/mcp-publishing-service.js";
import {
  confirmCurlImport,
  createServer,
  createTool,
  deleteServer,
  deleteTool,
  deleteVariable,
  duplicateTool,
  getConnectionSnippet,
  getServerName,
  getToolEditorState,
  getToolEnabledState,
  getToolName,
  isServerValueRuntimeEffective,
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

/**
 * Safe agent-visible tool projection for `list_tools`. It never carries the
 * stored authoring definition, so it cannot leak secret server-value ids,
 * binding locations, or false/null placeholders for undisclosed state.
 */
/**
 * Compile issues are projected to location + code only. Compiler messages can
 * embed server-value ids or names, so they are never disclosed to a read-only
 * agent-visible tool list; callers can re-read the definition with author scope.
 */
const toolCompileIssueSummary = z.object({
  path: z.string(),
  id: z.string().optional(),
  code: z.string(),
  severity: z.enum(["error", "warning"]),
});

const toolSummaryResource = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  method: z.string(),
  compileStatus: z.string().nullable(),
  compileIssues: z.array(toolCompileIssueSummary),
  annotations: z.unknown(),
  allowMutation: z.boolean(),
  enabled: z.boolean(),
  source: z.string(),
});

/** Authoring-definition read result for `get_tool_definition`. */
const toolDefinitionResource = z.object({
  toolId: z.string(),
  definition: z.unknown().nullable(),
  issues: z.unknown(),
});

const variableResource = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  owner: z.string().optional(),
  description: z.string().nullable().optional(),
  hasValue: z.boolean(),
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

/**
 * Categorized publication issue. Compiler messages are never disclosed: they
 * can embed server-value ids or names, so only stable codes and locations are
 * returned to agents.
 */
const publicationIssueResource = z.object({
  code: z.string(),
  severity: z.enum(["error", "warning"]),
  path: z.string().optional(),
  nodeId: z.string().optional(),
  toolName: z.string().optional(),
});

const revisionDiffSummaryResource = z.object({
  serverChanged: z.array(z.string()),
  commonChanged: z.boolean(),
  authChanged: z.boolean(),
  toolsAdded: z.array(z.string()),
  toolsRemoved: z.array(z.string()),
  toolsChanged: z.array(z.string()),
  toolsEnabled: z.array(z.string()),
  toolsDisabled: z.array(z.string()),
  configChanged: z.boolean(),
  contractChanged: z.boolean(),
});

const publishPreviewResource = z.object({
  serverId: z.string(),
  draftRevision: z.number().int(),
  publishedRevisionId: z.string().nullable(),
  publishedRevisionNumber: z.number().int().nullable(),
  candidateFingerprint: z.string(),
  contractFingerprint: z.string(),
  ready: z.boolean(),
  dirty: z.boolean(),
  errors: z.array(publicationIssueResource),
  warnings: z.array(publicationIssueResource),
  warningCodes: z.array(z.string()),
  diff: revisionDiffSummaryResource.extend({
    changed: z.boolean(),
    destructive: z.boolean(),
  }),
});

const publishResultResource = z.object({
  serverId: z.string(),
  revisionId: z.string(),
  revisionNumber: z.number().int(),
  candidateFingerprint: z.string(),
  contractFingerprint: z.string(),
  sourceDraftRevision: z.number().int(),
  status: z.string(),
  configRevision: z.number().int(),
  idempotent: z.boolean(),
});

const revisionSummaryResource = z.object({
  id: z.string(),
  revisionNumber: z.number().int(),
  sourceDraftRevision: z.number().int(),
  candidateFingerprint: z.string(),
  contractFingerprint: z.string(),
  actorSource: z.string(),
  note: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
});

const revisionToolResource = z.object({
  sourceToolId: z.string(),
  name: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  method: z.string(),
  enabled: z.boolean(),
  allowMutation: z.boolean(),
  source: z.string(),
  contractFingerprint: z.string().nullable(),
  definitionHash: z.string().nullable(),
  compileStatus: z.string().nullable(),
  compileIssueCount: z.number().int(),
});

/** Secret slots are surfaced without id or name; only existence is disclosed. */
const revisionConfigResource = z.object({
  sourceValueId: z.string().optional(),
  name: z.string().optional(),
  kind: z.string(),
  owner: z.string().nullable().optional(),
  hasValue: z.boolean(),
});

const revisionDetailResource = revisionSummaryResource.extend({
  schemaVersion: z.number().int(),
  compilerVersion: z.string(),
  server: z.object({
    name: z.string(),
    description: z.string().nullable(),
    baseUrl: z.string(),
    allowedHosts: z.array(z.string()),
  }),
  diffSummary: revisionDiffSummaryResource.nullable(),
  tools: z.array(revisionToolResource),
  configs: z.array(revisionConfigResource),
});

const restoreRevisionResource = z.object({
  serverId: z.string(),
  revisionId: z.string(),
  draftRevision: z.number().int(),
  configRevision: z.number().int(),
  missingSecretCount: z.number().int(),
  toolCount: z.number().int(),
});

type PlatformToolContext = {
  db: Parameters<typeof listServers>[0];
  principal: PlatformPrincipal;
  userId: string;
  tokenId: string;
  credentialSecret: string;
  apiOrigin: string;
  hasScope: (scope: McpPlatformScope) => boolean;
};

/** Coarse risk tier advertised for registry completeness and policy review. */
export type PlatformRiskTier =
  | "read"
  | "observe"
  | "author"
  | "publish"
  | "invoke"
  | "invoke_mutation"
  | "destructive";

type PlatformPolicyDecision =
  | { ok: true }
  | { ok: false; missingScopes: McpPlatformScope[]; reason: string };

type PlatformToolDefinition = {
  name: string;
  title: string;
  description: string;
  /** Every listed scope is required for this tool to be exposed. */
  scopes: readonly McpPlatformScope[];
  /** Declared risk tier; used by the registry completeness assertion. */
  risk: PlatformRiskTier;
  /**
   * Authoritative resource argument for selected-server enforcement, or null
   * when the tool is not scoped to one server.
   */
  resourceArg: string | null;
  /** Optional dynamic policy evaluated with the principal and parsed args. */
  dynamicPolicy?: (
    principal: PlatformPrincipal,
    args: Record<string, unknown>,
  ) => PlatformPolicyDecision;
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

function defaultRiskTier(
  scopes: readonly McpPlatformScope[],
): PlatformRiskTier {
  if (scopes.includes("destructive")) return "destructive";
  if (scopes.includes("invoke_mutation")) return "invoke_mutation";
  if (scopes.includes("publish")) return "publish";
  if (scopes.includes("invoke")) return "invoke";
  if (scopes.includes("author")) return "author";
  if (scopes.includes("observe")) return "observe";
  return "read";
}

function definePlatformTool<
  I extends z.ZodTypeAny,
  D extends z.ZodTypeAny,
>(definition: {
  name: string;
  title: string;
  description: string;
  scopes: readonly McpPlatformScope[];
  risk?: PlatformRiskTier;
  resourceArg?: string | null;
  dynamicPolicy?: (
    principal: PlatformPrincipal,
    args: Record<string, unknown>,
  ) => PlatformPolicyDecision;
  input: I;
  data: D;
  dataForScope?: (
    hasScope: (scope: McpPlatformScope) => boolean,
  ) => z.ZodTypeAny;
  annotations: ToolAnnotations;
  run: (ctx: PlatformToolContext, args: z.infer<I>) => Promise<z.infer<D>>;
}): PlatformToolDefinition {
  const resourceArg =
    definition.resourceArg === undefined ? "serverId" : definition.resourceArg;
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    scopes: definition.scopes,
    risk: definition.risk ?? defaultRiskTier(definition.scopes),
    resourceArg,
    ...(definition.dynamicPolicy
      ? { dynamicPolicy: definition.dynamicPolicy }
      : {}),
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
 * One policy evaluator for discovery, direct calls, and handler wrapping.
 * Static scope prerequisites are checked first, then the tool's optional
 * dynamic policy (e.g. account-wide authoring, publish transitions).
 */
export function evaluatePlatformToolPolicy(
  tool: PlatformToolDefinition,
  principal: PlatformPrincipal,
  args: Record<string, unknown>,
): PlatformPolicyDecision {
  const missing = tool.scopes.filter(
    (scope) => !platformHasScope(principal, scope),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      missingScopes: missing,
      reason: "This tool requires additional token scopes.",
    };
  }
  if (tool.dynamicPolicy) return tool.dynamicPolicy(principal, args);
  return { ok: true };
}

/**
 * Selected-server enforcement before any resource lookup. Ungranted servers get
 * the same generic denial as nonexistent ones; resource queries are additionally
 * constrained in the service layer.
 */
export function assertPlatformResourceAllowed(
  principal: PlatformPrincipal,
  serverId: string,
): void {
  if (principal.resourceMode === "account") return;
  if (principal.allowedServerIds.includes(serverId)) return;
  throw new AppError({
    appCode: APP_ERROR_CODES.MCP_RESOURCE_DENIED,
    message: "The requested resource is not available.",
    status: 404,
  });
}

function requireAccountWide(
  principal: PlatformPrincipal,
  reason: string,
): PlatformPolicyDecision {
  if (principal.resourceMode !== "account") {
    return {
      ok: false,
      missingScopes: [],
      reason,
    };
  }
  return { ok: true };
}

/** Runtime-effective authoring requires publish; draft-only changes do not. */
function hasPublishScope(principal: PlatformPrincipal): boolean {
  return platformHasScope(principal, "publish");
}

/**
 * Runtime-effectiveness classification for a candidate tool change. A change is
 * runtime-effective when the candidate stays/goes enabled or when it edits a
 * tool that is currently enabled (including disabling one).
 */
function isRuntimeEffectiveToolChange(input: {
  candidateEnabled: boolean;
  persistedEnabled: boolean;
}): boolean {
  return input.candidateEnabled || input.persistedEnabled;
}

/** Single denial shape for a runtime-effective change attempted without publish. */
function publishScopeDenied(reason: string): AppError {
  return new AppError({
    appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
    message: reason,
    status: 403,
    details: { scopes: ["publish"] },
  });
}

/**
 * One generic denial for a referenced server-value id outside the caller's
 * visible non-secret catalog. Secret, foreign, and nonexistent ids are
 * indistinguishable: the same code, message, and scope list.
 */
function unknownServerValueDenied(): AppError {
  return new AppError({
    appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
    message: "This operation is not permitted with the current token scopes.",
    status: 403,
    details: { scopes: ["secret_reference"] },
  });
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

/**
 * The single server-value reference policy used by every authoring handler.
 * Without `secret_reference`, every referenced id must be visible in the
 * caller's non-secret catalog for that server; secret, foreign, and unknown
 * ids produce one generic denial. With `secret_reference`, existence and
 * ownership validation is left to the service and values/ciphertext are still
 * never returned.
 */
/** Replaces non-visible server-value ids anywhere in a compiled plan. */
function redactServerValueIds(
  value: unknown,
  visibleIds: Set<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactServerValueIds(item, visibleIds));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      if (
        key === "serverValueId" &&
        typeof item === "string" &&
        !visibleIds.has(item)
      ) {
        output[key] = "msv_redacted";
      } else {
        output[key] = redactServerValueIds(item, visibleIds);
      }
    }
    return output;
  }
  return value;
}

async function assertVisibleServerValueReferences(input: {
  principal: PlatformPrincipal;
  db: PlatformDb;
  serverId: string;
  definition: McpRequestDefinition;
}): Promise<void> {
  const refs = scanDefinitionIds(input.definition).serverValueRefs;
  if (refs.length === 0) return;
  if (platformHasScope(input.principal, "secret_reference")) return;
  const variables = await listVariablesForPlatform(
    input.principal,
    input.db,
    input.serverId,
  );
  const visibleIds = new Set(
    variables.filter((variable) => variable.kind !== "secret").map((v) => v.id),
  );
  if (refs.some((ref) => !visibleIds.has(ref.id))) {
    throw unknownServerValueDenied();
  }
}

type PlatformDb = Parameters<typeof listServers>[0];
type PlatformPageArgs = { page?: number; pageSize?: 10 | 20 | 50 };

function platformPage(args: PlatformPageArgs) {
  return { page: args.page ?? 1, pageSize: args.pageSize ?? 10 };
}

/**
 * Principal-aware Platform service adapters. Every adapter enforces the
 * selected-server predicate and passes `principal.userId` into the Studio
 * service, so handlers never call services with a bare `userId`.
 */
function listServersForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  args: PlatformPageArgs,
) {
  return listServers(
    db,
    principal.userId,
    platformPage(args),
    principal.resourceMode === "selected"
      ? { allowedServerIds: principal.allowedServerIds }
      : {},
  );
}

function listToolsForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  args: PlatformPageArgs,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return listTools(db, principal.userId, serverId, platformPage(args));
}

function listVariablesForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return listVariables(db, principal.userId, serverId);
}

function listCallLogsForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  args: PlatformPageArgs,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return listCallLogs(db, principal.userId, serverId, platformPage(args));
}

function getConnectionSnippetForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  apiOrigin: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return getConnectionSnippet(db, principal.userId, serverId, apiOrigin);
}

function createServerForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  input: Parameters<typeof createServer>[2],
) {
  return createServer(db, principal.userId, input);
}

function createToolForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  input: Parameters<typeof createTool>[3],
) {
  assertPlatformResourceAllowed(principal, serverId);
  return createTool(db, principal.userId, serverId, input);
}

async function getToolEditorStateForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  toolId: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return getToolEditorState(db, principal.userId, serverId, toolId);
}

function updateToolForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  toolId: string,
  input: Parameters<typeof updateTool>[4],
) {
  assertPlatformResourceAllowed(principal, serverId);
  return updateTool(db, principal.userId, serverId, toolId, input);
}

function previewToolCompileForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  input: Parameters<typeof previewToolCompile>[3],
) {
  assertPlatformResourceAllowed(principal, serverId);
  return previewToolCompile(db, principal.userId, serverId, input);
}

function duplicateToolForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  toolId: string,
  input: Parameters<typeof duplicateTool>[4],
) {
  assertPlatformResourceAllowed(principal, serverId);
  return duplicateTool(db, principal.userId, serverId, toolId, input);
}

function confirmCurlImportForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  input: Parameters<typeof confirmCurlImport>[3],
) {
  assertPlatformResourceAllowed(principal, serverId);
  return confirmCurlImport(db, principal.userId, serverId, input, {
    rejectCredentials: true,
  });
}

function setVariableForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  input: Parameters<typeof setVariable>[3],
  credentialSecret: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return setVariable(db, principal.userId, serverId, input, credentialSecret);
}

function getServerNameForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return getServerName(db, principal.userId, serverId);
}

function getToolNameForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  toolId: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return getToolName(db, principal.userId, serverId, toolId);
}

function getToolEnabledStateForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  toolId: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return getToolEnabledState(db, principal.userId, serverId, toolId);
}

function isServerValueRuntimeEffectiveForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  valueName: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return isServerValueRuntimeEffective(
    db,
    principal.userId,
    serverId,
    valueName,
  );
}

function deleteServerForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  expectedRevision: number,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return deleteServer(db, principal.userId, serverId, expectedRevision);
}

function deleteToolForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  toolId: string,
  expectedRevision: number,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return deleteTool(db, principal.userId, serverId, toolId, expectedRevision);
}

function deleteVariableForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  valueId: string,
  expectedRevision: number,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return deleteVariable(
    db,
    principal.userId,
    serverId,
    valueId,
    expectedRevision,
  );
}

function previewPublishForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return previewPublish(db, principal.userId, serverId);
}

function publishServerForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  input: Omit<Parameters<typeof publishServer>[1], "userId" | "actorSource">,
) {
  assertPlatformResourceAllowed(principal, input.serverId);
  return publishServer(db, {
    ...input,
    userId: principal.userId,
    actorSource: "platform",
  });
}

function listRevisionHistoryForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  args: PlatformPageArgs,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return listRevisionHistory(
    db,
    principal.userId,
    serverId,
    platformPage(args),
  );
}

function getRevisionDetailForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  serverId: string,
  revisionId: string,
) {
  assertPlatformResourceAllowed(principal, serverId);
  return getRevisionDetail(db, principal.userId, serverId, revisionId);
}

function restoreRevisionForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  input: Omit<Parameters<typeof restoreRevisionToDraft>[1], "userId">,
) {
  assertPlatformResourceAllowed(principal, input.serverId);
  return restoreRevisionToDraft(db, { ...input, userId: principal.userId });
}

/** Drops compiler messages so stable codes and locations only reach agents. */
function projectPublicationIssue(issue: {
  code: string;
  severity: "error" | "warning";
  path?: string;
  nodeId?: string;
  toolName?: string;
}) {
  return {
    code: issue.code,
    severity: issue.severity,
    ...(issue.path ? { path: issue.path } : {}),
    ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
    ...(issue.toolName ? { toolName: issue.toolName } : {}),
  };
}

/** Secret config slots are anonymized; non-secret values are never included. */
function projectRevisionConfig(config: {
  sourceValueId: string;
  name: string;
  kind: string;
  owner: string | null;
  hasValue: boolean;
}) {
  if (config.kind === "secret") {
    return {
      kind: config.kind,
      ...(config.owner ? { owner: config.owner } : {}),
      hasValue: config.hasValue,
    };
  }
  return {
    sourceValueId: config.sourceValueId,
    name: config.name,
    kind: config.kind,
    owner: config.owner,
    hasValue: config.hasValue,
  };
}

function executeMappedToolForPlatform(
  principal: PlatformPrincipal,
  db: PlatformDb,
  input: Omit<Parameters<typeof executeMappedTool>[1], "ownerUserId">,
) {
  return executeMappedTool(db, { ...input, ownerUserId: principal.userId });
}

const PLATFORM_REGISTRY: PlatformToolDefinition[] = [
  definePlatformTool({
    name: "list_servers",
    title: "List servers",
    description:
      "List the MCP servers you own with pagination. Use this to discover server ids before calling other tools.",
    scopes: ["read"],
    resourceArg: null,
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
      const page = await listServersForPlatform(ctx.principal, ctx.db, args);
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
      "List the safe agent-visible summary of the tools on a server you own, with id-addressable compile issues. Stored authoring definitions are never returned; use get_tool_definition for an editable definition.",
    scopes: ["read"],
    input: z.object({ ...serverIdShape, ...paginationShape }).strict(),
    data: z.object({ ...paginationMeta, items: z.array(toolSummaryResource) }),
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const page = await listToolsForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args,
      );
      return {
        ...page,
        items: page.items.map((tool) => ({
          id: tool.id,
          name: tool.name,
          title: tool.title,
          description: tool.description,
          method: tool.method,
          compileStatus: tool.compileStatus,
          compileIssues: (tool.compileIssues ?? []).map((issue) => ({
            path: issue.path,
            ...(issue.id ? { id: issue.id } : {}),
            code: issue.code,
            severity: issue.severity,
          })),
          annotations: tool.annotations,
          allowMutation: tool.allowMutation,
          enabled: tool.enabled,
          source: tool.source,
        })),
      };
    },
  }),

  definePlatformTool({
    name: "get_tool_definition",
    title: "Get tool definition",
    description:
      "Read the stored editable request definition for a tool you own. Requires author scope. A definition that binds secret server values additionally requires secret_reference scope; without it the entire read is denied with no partial definition or secret metadata.",
    scopes: ["author"],
    input: z
      .object({
        ...serverIdShape,
        toolId: z.string().min(1).describe("Tool id to read."),
      })
      .strict(),
    data: toolDefinitionResource,
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const state = await getToolEditorStateForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args.toolId,
      );
      const editable = state.definition ?? null;
      if (editable) {
        await assertVisibleServerValueReferences({
          principal: ctx.principal,
          db: ctx.db,
          serverId: args.serverId,
          definition: editable,
        });
      }
      return {
        toolId: state.toolId,
        definition: state.definition
          ? redactSensitiveExamples(state.definition)
          : null,
        issues: state.compileIssues,
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
      const variables = await listVariablesForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
      );
      return variables
        .filter(
          (variable) =>
            variable.kind !== "secret" || ctx.hasScope("secret_reference"),
        )
        .map(({ id, name, kind, owner, description, hasValue }) => ({
          id,
          name,
          kind,
          ...(owner ? { owner } : {}),
          ...(description != null ? { description } : {}),
          hasValue,
        }));
    },
  }),

  definePlatformTool({
    name: "list_revisions",
    title: "List server revisions",
    description:
      "List the paginated publication history for a server you own, newest first, with revision numbers, fingerprints, safe actor/source metadata, active state, and timestamps.",
    scopes: ["read"],
    input: revisionHistoryCommandSchema,
    data: z.object({
      ...paginationMeta,
      items: z.array(revisionSummaryResource),
    }),
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const page = await listRevisionHistoryForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args,
      );
      return {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        items: page.items.map((revision) => ({
          id: revision.id,
          revisionNumber: revision.revisionNumber,
          sourceDraftRevision: revision.sourceDraftRevision,
          candidateFingerprint: revision.candidateFingerprint,
          contractFingerprint: revision.contractFingerprint,
          actorSource: revision.actorSource,
          note: revision.note,
          isActive: revision.isActive,
          createdAt: revision.createdAt.toISOString(),
        })),
      };
    },
  }),

  definePlatformTool({
    name: "get_revision",
    title: "Get revision detail",
    description:
      "Read a secret-safe historical revision for a server you own: revision identity, fingerprints, safe server fields, categorized diff, tool contracts, and config existence. Secret slots are surfaced without id, name, or value. Requires read scope.",
    scopes: ["read"],
    input: revisionDetailCommandSchema,
    data: revisionDetailResource,
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const detail = await getRevisionDetailForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args.revisionId,
      );
      return {
        id: detail.id,
        revisionNumber: detail.revisionNumber,
        sourceDraftRevision: detail.sourceDraftRevision,
        candidateFingerprint: detail.candidateFingerprint,
        contractFingerprint: detail.contractFingerprint,
        actorSource: detail.actorSource,
        note: detail.note,
        isActive: detail.isActive,
        createdAt: detail.createdAt.toISOString(),
        schemaVersion: detail.schemaVersion,
        compilerVersion: detail.compilerVersion,
        server: detail.server,
        diffSummary: detail.diffSummary,
        tools: detail.tools,
        configs: detail.configs.map(projectRevisionConfig),
      };
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
      getConnectionSnippetForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        ctx.apiOrigin,
      ),
  }),

  definePlatformTool({
    name: "list_recent_calls",
    title: "List recent calls",
    description:
      "List recent call logs for a server you own, newest first, with pagination. Requires observe scope.",
    scopes: ["observe"],
    input: z.object({ ...serverIdShape, ...paginationShape }).strict(),
    data: z.object({ ...paginationMeta, items: z.array(callLogResource) }),
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const page = await listCallLogsForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args,
      );
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
      "Create a new MCP server. Authentication is never accepted here; configure it afterward in Studio. Requires an account-wide token.",
    scopes: ["author"],
    resourceArg: null,
    dynamicPolicy: (principal) =>
      requireAccountWide(
        principal,
        "Only an account-wide token may create servers.",
      ),
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
      const server = await createServerForPlatform(ctx.principal, ctx.db, {
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
      "Create a REST tool from a versioned typed request definition with literal, serverValue, and agentInput bindings. Without publish scope the tool is always persisted as a disabled draft; binding a secret server value requires the secret_reference scope.",
    scopes: ["author"],
    input: createToolCommandSchema,
    data: toolResource,
    annotations: WRITE_ANNOTATIONS,
    run: async (ctx, args) => {
      await assertVisibleServerValueReferences({
        principal: ctx.principal,
        db: ctx.db,
        serverId: args.serverId,
        definition: args.requestDefinition,
      });
      // Draft-only authoring: a principal without publish never enables a tool.
      const enabled = hasPublishScope(ctx.principal) ? args.enabled : false;
      return redactToolRow(
        await createToolForPlatform(ctx.principal, ctx.db, args.serverId, {
          expectedRevision: args.expectedRevision,
          name: args.name,
          title: args.title,
          description: args.description,
          method: args.method,
          requestDefinition: args.requestDefinition,
          allowMutation: args.allowMutation,
          enabled,
        }),
      );
    },
  }),

  definePlatformTool({
    name: "update_tool",
    title: "Update tool",
    description:
      "Update a tool you own using a versioned typed request definition. Enabling a tool or modifying an enabled tool requires publish scope and is denied without writing otherwise. Template fields are not accepted; mixed payloads are rejected.",
    scopes: ["author"],
    input: updateToolCommandSchema,
    data: toolResource,
    annotations: WRITE_ANNOTATIONS,
    run: async (ctx, args) => {
      let effectiveDefinition = args.requestDefinition;
      if (!effectiveDefinition) {
        const state = await getToolEditorStateForPlatform(
          ctx.principal,
          ctx.db,
          args.serverId,
          args.toolId,
        );
        if (state.definition) effectiveDefinition = state.definition;
      }
      if (effectiveDefinition) {
        await assertVisibleServerValueReferences({
          principal: ctx.principal,
          db: ctx.db,
          serverId: args.serverId,
          definition: effectiveDefinition,
        });
      }
      const persistedEnabled = await getToolEnabledStateForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args.toolId,
      );
      const candidateEnabled = args.enabled ?? persistedEnabled;
      if (
        !hasPublishScope(ctx.principal) &&
        isRuntimeEffectiveToolChange({ candidateEnabled, persistedEnabled })
      ) {
        throw publishScopeDenied(
          "Enabling a tool or modifying an enabled tool requires publish scope.",
        );
      }
      return redactToolRow(
        await updateToolForPlatform(
          ctx.principal,
          ctx.db,
          args.serverId,
          args.toolId,
          {
            expectedRevision: args.expectedRevision,
            name: args.name,
            title: args.title,
            description: args.description,
            method: args.method,
            requestDefinition: args.requestDefinition,
            allowMutation: args.allowMutation,
            enabled: args.enabled,
          },
        ),
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
    }),
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      await assertVisibleServerValueReferences({
        principal: ctx.principal,
        db: ctx.db,
        serverId: args.serverId,
        definition: args.requestDefinition,
      });
      const result = await previewToolCompileForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        {
          name: args.name,
          title: args.title,
          description: args.description,
          method: args.method,
          requestDefinition: args.requestDefinition,
          allowMutation: args.allowMutation,
        },
      );
      // Compiler messages can embed server-value ids/names; expose only stable
      // codes and locations, matching the Platform message-disclosure rule.
      const safeIssues = result.issues.map((issue) => ({
        severity: issue.severity,
        code: issue.code,
        path: issue.path,
        ...(issue.id !== undefined ? { id: issue.id } : {}),
      }));
      const base = {
        ok: result.ok,
        ready: result.ready,
        issues: safeIssues,
        plan: result.plan,
        contract: result.contract,
      };
      if (platformHasScope(ctx.principal, "secret_reference")) {
        return base;
      }
      // Auth/common bindings are injected into the compiled plan; without
      // secret_reference authority their secret slot ids must not be returned.
      const variables = await listVariablesForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
      );
      const visibleIds = new Set(
        variables
          .filter((variable) => variable.kind !== "secret")
          .map((v) => v.id),
      );
      return {
        ...base,
        plan: redactServerValueIds(result.plan, visibleIds),
      };
    },
  }),

  definePlatformTool({
    name: "preview_publish",
    title: "Preview publication",
    description:
      "Write-free publication preview for a server you own: observed draft revision, active revision identity, candidate and contract fingerprints, readiness, categorized errors/warnings, and a secret-safe diff. Requires author scope; never publishes.",
    scopes: ["author"],
    input: publishPreviewCommandSchema,
    data: publishPreviewResource,
    annotations: READ_ANNOTATIONS,
    run: async (ctx, args) => {
      const preview = await previewPublishForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
      );
      return {
        serverId: preview.serverId,
        draftRevision: preview.draftRevision,
        publishedRevisionId: preview.publishedRevisionId,
        publishedRevisionNumber: preview.publishedRevisionNumber,
        candidateFingerprint: preview.candidateFingerprint,
        contractFingerprint: preview.contractFingerprint,
        ready: preview.ready,
        dirty: preview.dirty,
        errors: preview.errors.map(projectPublicationIssue),
        warnings: preview.warnings.map(projectPublicationIssue),
        warningCodes: preview.warningCodes,
        diff: { ...preview.diff },
      };
    },
  }),

  definePlatformTool({
    name: "publish_server",
    title: "Publish server revision",
    description:
      "Atomically publish the complete candidate as a new immutable revision. Requires publish scope plus the observed draft revision, active revision id, candidate fingerprint, a unique publish request id, and acknowledgement of every warning code. A repeated request id with the same candidate is idempotent.",
    scopes: ["publish"],
    input: publishServerCommandSchema,
    data: publishResultResource,
    annotations: WRITE_ANNOTATIONS,
    run: (ctx, args) =>
      publishServerForPlatform(ctx.principal, ctx.db, {
        serverId: args.serverId,
        expectedDraftRevision: args.expectedDraftRevision,
        expectedPublishedRevisionId: args.expectedPublishedRevisionId,
        publishRequestId: args.publishRequestId,
        candidateFingerprint: args.candidateFingerprint,
        acknowledgedWarningCodes: args.acknowledgedWarningCodes,
        note: args.note,
      }),
  }),

  definePlatformTool({
    name: "duplicate_tool",
    title: "Duplicate tool",
    description:
      "Duplicate a typed tool, regenerating definition-local ids while preserving referenced server-value ids. Without publish scope the copy is always persisted as a disabled draft.",
    scopes: ["author"],
    input: duplicateToolCommandSchema,
    data: toolResource,
    annotations: WRITE_ANNOTATIONS,
    run: async (ctx, args) => {
      const state = await getToolEditorStateForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args.toolId,
      );
      if (state.definition) {
        await assertVisibleServerValueReferences({
          principal: ctx.principal,
          db: ctx.db,
          serverId: args.serverId,
          definition: state.definition,
        });
      }
      const enabled = hasPublishScope(ctx.principal) ? args.enabled : false;
      return redactToolRow(
        await duplicateToolForPlatform(
          ctx.principal,
          ctx.db,
          args.serverId,
          args.toolId,
          {
            expectedRevision: args.expectedRevision,
            name: args.name,
            title: args.title,
            description: args.description,
            enabled,
          },
        ),
      );
    },
  }),

  definePlatformTool({
    name: "restore_revision",
    title: "Restore revision to draft",
    description:
      "Replace the current publishable draft structure with a historical revision under optimistic concurrency. Restores to the draft only: it never changes the active published pointer, tokens, status, or current secret material. Requires author scope.",
    scopes: ["author"],
    input: restoreRevisionCommandSchema,
    data: restoreRevisionResource,
    annotations: WRITE_ANNOTATIONS,
    run: (ctx, args) =>
      restoreRevisionForPlatform(ctx.principal, ctx.db, {
        serverId: args.serverId,
        revisionId: args.revisionId,
        expectedRevision: args.expectedRevision,
        expectedDraftRevision: args.expectedDraftRevision,
      }),
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
      if (!platformHasScope(ctx.principal, "secret_reference")) {
        const variables = await listVariablesForPlatform(
          ctx.principal,
          ctx.db,
          args.serverId,
        );
        const visibleNames = new Set(
          variables
            .filter((variable) => variable.kind !== "secret")
            .map((variable) => variable.name),
        );
        const denied = (args.markings ?? []).some(
          (marking) =>
            marking.as === "serverValue" &&
            (marking.name === undefined || !visibleNames.has(marking.name)),
        );
        if (denied) throw unknownServerValueDenied();
      }
      return redactToolRow(
        await confirmCurlImportForPlatform(
          ctx.principal,
          ctx.db,
          args.serverId,
          args,
        ),
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
      const variables = await listVariablesForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
      );
      if (
        variables.some(
          (variable) =>
            variable.name === args.name && variable.kind === "secret",
        )
      ) {
        if (!ctx.hasScope("secret_reference")) {
          // Without secret_reference the caller must not learn whether a
          // same-named secret exists, so deny generically.
          throw new AppError({
            appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
            message:
              "This operation is not permitted with the current token scopes.",
            status: 403,
            details: { scopes: ["secret_reference"] },
          });
        }
        // The caller may already see secret metadata, so the honest reason is
        // that secrets are never writable through this tool.
        throw new AppError({
          appCode: APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
          message:
            "Refusing to overwrite a secret server value; rotate it through the Studio secret flow.",
          status: 409,
        });
      }
      if (!hasPublishScope(ctx.principal)) {
        const runtimeEffective = await isServerValueRuntimeEffectiveForPlatform(
          ctx.principal,
          ctx.db,
          args.serverId,
          args.name,
        );
        if (runtimeEffective) {
          throw publishScopeDenied(
            "Changing a server value used by an enabled tool requires publish scope.",
          );
        }
      }
      return setVariableForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        {
          expectedRevision: args.expectedRevision,
          name: args.name,
          kind: "config",
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
        confirm: z
          .string()
          .optional()
          .describe(
            "Required for a compiled destructive tool; must match its current name.",
          ),
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
      // Classify from the active published revision, never the mutable draft:
      // draft edits must not change live authority or destructive confirmation.
      assertPlatformResourceAllowed(ctx.principal, args.serverId);
      const published = await getPublishedToolIdentity(
        ctx.db,
        ctx.principal.userId,
        args.serverId,
        args.toolId,
        ctx.credentialSecret,
      );
      const method = published.method.toUpperCase();
      const mutating =
        method === "POST" ||
        method === "PUT" ||
        method === "PATCH" ||
        method === "DELETE";
      if (mutating && !ctx.hasScope("invoke_mutation")) {
        throw new AppError({
          appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
          message: "Mutating tool invocations require invoke_mutation scope.",
          status: 403,
          details: { scopes: ["invoke_mutation"] },
        });
      }
      if (method === "DELETE") {
        assertDestructiveConfirmation(args.confirm ?? "", published.name);
      }

      const rateLimit = tryAcquireInvocation({
        tokenId: ctx.tokenId,
        serverId: args.serverId,
        mutating,
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
        const result = await executeMappedToolForPlatform(
          ctx.principal,
          ctx.db,
          {
            serverId: args.serverId,
            toolId: args.toolId,
            args: args.args,
            source: "platform",
            credentialSecret: ctx.credentialSecret,
            snapshot: published.snapshot,
          },
        );
        if (mutating) {
          void recordPlatformSecurityEventBestEffort(ctx.db, {
            userId: ctx.userId,
            eventType: "mutating_invocation",
            outcome: result.ok ? "success" : "failure",
            tokenId: ctx.tokenId,
            tokenPrefix: ctx.principal.tokenPrefix,
            serverId: args.serverId,
            metadata: { tool: args.toolId, method },
          });
        }
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
      const currentName = await getServerNameForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
      );
      assertDestructiveConfirmation(args.confirm, currentName);
      const result = await deleteServerForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args.expectedRevision,
      );
      void recordPlatformSecurityEventBestEffort(ctx.db, {
        userId: ctx.userId,
        eventType: "destructive_action",
        outcome: "success",
        tokenId: ctx.tokenId,
        tokenPrefix: ctx.principal.tokenPrefix,
        serverId: args.serverId,
        metadata: { operation: "delete_server" },
      });
      return result;
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
      const currentName = await getToolNameForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args.toolId,
      );
      assertDestructiveConfirmation(args.confirm, currentName);
      const result = await deleteToolForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        args.toolId,
        args.expectedRevision,
      );
      void recordPlatformSecurityEventBestEffort(ctx.db, {
        userId: ctx.userId,
        eventType: "destructive_action",
        outcome: "success",
        tokenId: ctx.tokenId,
        tokenPrefix: ctx.principal.tokenPrefix,
        serverId: args.serverId,
        metadata: { operation: "delete_tool" },
      });
      return result;
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
      const variables = await listVariablesForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
      );
      const target = variables.find((variable) => variable.name === args.name);
      if (!target) {
        throw new AppError({
          appCode: APP_ERROR_CODES.INVALID_INPUT,
          message: "Server value not found.",
          status: 404,
        });
      }
      assertDestructiveConfirmation(args.confirm, target.name);
      const result = await deleteVariableForPlatform(
        ctx.principal,
        ctx.db,
        args.serverId,
        target.id,
        args.expectedRevision,
      );
      void recordPlatformSecurityEventBestEffort(ctx.db, {
        userId: ctx.userId,
        eventType: "destructive_action",
        outcome: "success",
        tokenId: ctx.tokenId,
        tokenPrefix: ctx.principal.tokenPrefix,
        serverId: args.serverId,
        metadata: { operation: "delete_variable" },
      });
      return result;
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

class PlatformBodyTooLargeError extends Error {
  constructor() {
    super("Platform MCP request body exceeded the size limit.");
    this.name = "PlatformBodyTooLargeError";
  }
}

/**
 * Bounded streaming reader. Cancels the underlying stream as soon as the byte
 * limit is crossed so chunked payloads cannot be buffered indefinitely.
 */
async function readBoundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const body = request.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new PlatformBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function bearerChallenge(
  c: Context<AppContext>,
  status: 401 | 403,
  code: Parameters<typeof appJsonError>[0],
  message: string,
  challenge: string,
) {
  return c.json(appJsonError(code, message), status, {
    "WWW-Authenticate": challenge,
  });
}

/**
 * Static `tools/call` preflight over one bounded JSON-RPC body (single object or
 * batch). Returns the sorted missing public scopes for the first known tool
 * that the principal cannot call; unknown tool names return null so normal
 * handling and dynamic policy still apply. No resource is looked up.
 */
function staticToolsCallDenial(
  body: Uint8Array,
  principal: PlatformPrincipal,
): { missing: McpPlatformScope[] } | null {
  if (body.byteLength === 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
  const entries = Array.isArray(payload) ? payload : [payload];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const request = entry as { method?: unknown; params?: unknown };
    if (request.method !== "tools/call") continue;
    const params = request.params;
    if (!params || typeof params !== "object") continue;
    const name = (params as { name?: unknown }).name;
    if (typeof name !== "string") continue;
    const tool = PLATFORM_REGISTRY.find((candidate) => candidate.name === name);
    if (!tool) continue;
    const missing = tool.scopes.filter(
      (scope) => !platformHasScope(principal, scope),
    );
    if (missing.length > 0) {
      return { missing: [...missing].sort() };
    }
  }
  return null;
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
    if (contentLength) {
      const declared = Number(contentLength);
      if (
        Number.isFinite(declared) &&
        declared > MCP_GATEWAY_REQUEST_SIZE_LIMIT
      ) {
        return c.json(
          appJsonError(
            APP_ERROR_CODES.MCP_REQUEST_TOO_LARGE,
            "The request body is too large.",
          ),
          413,
        );
      }
    }

    const rawToken = extractBearerToken(c.req.header("authorization"));
    if (!rawToken) {
      return bearerChallenge(
        c,
        401,
        APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
        "Platform token is required.",
        'Bearer realm="platform-mcp", error="invalid_token"',
      );
    }

    const db = c.get("dbDirect") ?? c.get("db");

    let principal;
    try {
      principal = await authenticatePlatformPat(db, rawToken);
    } catch (error) {
      if (error instanceof AppError) {
        if (error.status === 403) {
          return c.json(appJsonError(error.appCode, error.message), 403);
        }
        return bearerChallenge(
          c,
          401,
          APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
          "Platform token is invalid.",
          'Bearer realm="platform-mcp", error="invalid_token"',
        );
      }
      throw error;
    }

    const capacity = tryAcquirePlatformRequest(principal.tokenId);
    if (!capacity.ok) {
      return c.json(
        appJsonError(
          APP_ERROR_CODES.MCP_RATE_LIMITED,
          "Too many requests. Wait and try again.",
        ),
        429,
        capacity.retryAfterSeconds !== undefined
          ? { "Retry-After": String(capacity.retryAfterSeconds) }
          : undefined,
      );
    }

    try {
      let mcpRequest = c.req.raw;
      let bodyBytes: Uint8Array = new Uint8Array();
      if (c.req.method !== "GET" && c.req.method !== "HEAD") {
        try {
          bodyBytes = await readBoundedBody(
            c.req.raw,
            MCP_GATEWAY_REQUEST_SIZE_LIMIT,
          );
        } catch (error) {
          if (error instanceof PlatformBodyTooLargeError) {
            return c.json(
              appJsonError(
                APP_ERROR_CODES.MCP_REQUEST_TOO_LARGE,
                "The request body is too large.",
              ),
              413,
            );
          }
          throw error;
        }
        mcpRequest = new Request(c.req.raw.url, {
          method: c.req.raw.method,
          headers: c.req.raw.headers,
          body:
            bodyBytes.byteLength > 0
              ? (bodyBytes as unknown as BodyInit)
              : undefined,
        });
      }

      // Static scope preflight for direct calls: deny known tools missing their
      // registry scopes before any resource lookup or MCP server construction.
      const staticDenial = staticToolsCallDenial(bodyBytes, principal);
      if (staticDenial) {
        return bearerChallenge(
          c,
          403,
          APP_ERROR_CODES.MCP_SCOPE_DENIED,
          `This tool requires additional token scopes: ${staticDenial.missing.join(", ")}.`,
          `Bearer realm="platform-mcp", error="insufficient_scope", scope="${staticDenial.missing.join(" ")}"`,
        );
      }

      const apiOrigin = resolveApiOrigin(c.req.raw, env.API_ORIGIN);
      const hasScope = (scope: McpPlatformScope) =>
        platformHasScope(principal, scope);

      return await handleMcpHttpRequest(mcpRequest, async () => {
        const mcp = new McpServer({
          name: "rest2mcp-platform",
          version: "1.0.0",
        });

        const exposedTools = PLATFORM_REGISTRY.filter((tool) =>
          isToolExposed(tool, hasScope),
        ).sort((a, b) => a.name.localeCompare(b.name));

        const ctx: PlatformToolContext = {
          db,
          principal,
          userId: principal.userId,
          tokenId: principal.tokenId,
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
                const args = parsed.data as Record<string, unknown>;
                const recordDenial = (
                  eventType: "scope_denied" | "resource_denied",
                  error: AppError,
                ) => {
                  void recordPlatformSecurityEventBestEffort(db, {
                    userId: principal.userId,
                    eventType,
                    outcome: "denied",
                    tokenId: principal.tokenId,
                    tokenPrefix: principal.tokenPrefix,
                    scopes: error.details?.scopes,
                    metadata: { tool: tool.name, operation: tool.name },
                  });
                };
                const policyEnvelope = (error: AppError) =>
                  buildMcpToolResult(errorEnvelope(toMcpToolError(error)), {
                    validator: contract.outputValidator,
                  });

                const decision = evaluatePlatformToolPolicy(
                  tool,
                  principal,
                  args,
                );
                if (!decision.ok) {
                  const denial = new AppError({
                    appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
                    message: decision.reason,
                    status: 403,
                    details: { scopes: decision.missingScopes },
                  });
                  recordDenial("scope_denied", denial);
                  return policyEnvelope(denial);
                }

                if (
                  tool.resourceArg &&
                  typeof args[tool.resourceArg] === "string"
                ) {
                  try {
                    assertPlatformResourceAllowed(
                      principal,
                      args[tool.resourceArg] as string,
                    );
                  } catch (error) {
                    if (error instanceof AppError) {
                      recordDenial("resource_denied", error);
                      return policyEnvelope(error);
                    }
                    throw error;
                  }
                }

                if (tool.annotations.readOnlyHint === false) {
                  const write = tryAcquirePlatformWrite(principal.tokenId);
                  if (!write.ok) {
                    return policyEnvelope(
                      new AppError({
                        appCode: APP_ERROR_CODES.MCP_RATE_LIMITED,
                        message: "Too many writes. Wait and try again.",
                        status: 429,
                        details:
                          write.retryAfterSeconds !== undefined
                            ? { retryAfterSeconds: write.retryAfterSeconds }
                            : undefined,
                      }),
                    );
                  }
                }

                try {
                  const data = await tool.run(ctx, args);
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
    } finally {
      releasePlatformRequest(principal.tokenId);
    }
  });

  return routes;
}

/** Exposed for contract snapshots and tests. */
export { PLATFORM_REGISTRY, platformOutputValidator };
