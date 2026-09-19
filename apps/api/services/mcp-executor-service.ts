/**
 * @file Hardened MCP tool executor shared by the gateway, playground, and
 * Platform MCP. Prefers the immutable compiled plan, then compiles the stored
 * canonical request definition. A tool with neither fails closed and never
 * contacts upstream. Every binding is resolved only from its declared source;
 * one deadline covers address validation, redirects, headers, and body reads.
 */
import {
  generateId,
  mcpServer,
  mcpServerRevision,
  mcpServerRevisionConfig,
  mcpServerRevisionTool,
  mcpServerVariable,
  mcpTool,
  type McpServer,
  type McpServerRevision,
  type McpServerRevisionConfig,
  type McpServerRevisionTool,
  type McpServerVariable,
  type McpTool,
} from "@repo/db";
import { and, asc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { APP_ERROR_CODES, AppError, appError } from "../lib/app-error.js";
import { enqueueCallLog } from "../lib/mcp-audit-queue.js";
import {
  assertCompileSuccess,
  compileToolDefinition,
  type CompileServerValueRef,
} from "../lib/mcp-compiler.js";
import { decryptCredential } from "../lib/mcp-crypto.js";
import {
  MCP_LOG_PREVIEW_BYTE_LIMIT,
  MCP_RESPONSE_BYTE_LIMIT,
  MCP_SAFE_RESPONSE_HEADERS,
  MCP_UPSTREAM_DEADLINE_MS,
} from "../lib/mcp-policy.js";
import { capText, redactText } from "../lib/mcp-redact.js";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
} from "../lib/mcp-telemetry.js";
import {
  mcpAuthConfigurationSchema,
  mcpCommonEntriesSchema,
  mcpCompiledPlanSchema,
  mcpRequestDefinitionSchema,
  type McpAgentInput,
  type McpAuthConfiguration,
  type McpCommonEntries,
  type McpCompiledPlan,
  type McpJsonNode,
  type McpValueBinding,
} from "../lib/mcp-request-definition.js";
import {
  type McpToolEnvelope,
  upstreamHttpToolError,
} from "../lib/mcp-result.js";
import {
  assertPathWithinBase,
  assertSameOriginRedirect,
  assertUpstreamUrlSafe,
} from "../lib/mcp-ssrf.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const READ_METHODS = new Set(["GET", "HEAD"]);

export type McpCallSource = "playground" | "agent" | "platform";

export type McpExecutionMode = "published" | "draft";

export type ExecuteMappedToolInput = {
  serverId: string;
  ownerUserId?: string;
  toolId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  source: McpCallSource;
  credentialSecret: string;
  /**
   * "published" (default) executes the active immutable revision. "draft"
   * materializes the observed draft for owner-only testing and never changes
   * published state.
   */
  mode?: McpExecutionMode;
  /** Draft-mode optimistic check against the observed `mcp_server.draftRevision`. */
  expectedDraftRevision?: number;
  /** Pre-materialized committed configuration; when omitted the executor loads one. */
  snapshot?: McpExecutionSnapshot;
};

export type ExecuteMappedToolResult = {
  /** True only for a completed 2xx upstream response. */
  ok: boolean;
  httpStatus: number | null;
  envelope: McpToolEnvelope;
  durationMs: number;
  callLogId: string | null;
  secretsUsed: string[];
};

// ---------------------------------------------------------------------------
// Server-value loading by id (bindings reference ids, never names).
// ---------------------------------------------------------------------------

export type ResolvedServerValue = {
  name: string;
  value: string;
  kind: "config" | "secret";
};

export async function loadServerValues(
  db: DB,
  serverId: string,
  credentialSecret: string,
): Promise<Map<string, ResolvedServerValue>> {
  const rows = await db
    .select()
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, serverId));
  const map = new Map<string, ResolvedServerValue>();
  for (const row of rows) {
    const kind = row.kind as "config" | "secret";
    const value =
      kind === "secret"
        ? row.ciphertext
          ? decryptCredential(row.ciphertext, credentialSecret)
          : ""
        : (row.value ?? "");
    map.set(row.id, { name: row.name, value, kind });
  }
  return map;
}

async function loadServerValueRefs(
  db: DB,
  serverId: string,
): Promise<CompileServerValueRef[]> {
  const rows = await db
    .select()
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, serverId));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as "config" | "secret",
    owner: row.owner as "manual" | "auth",
  }));
}

function parseCommonEntries(raw: unknown): McpCommonEntries {
  if (!raw) return { headers: [], query: [] };
  const parsed = mcpCommonEntriesSchema.safeParse(raw);
  return parsed.success ? parsed.data : { headers: [], query: [] };
}

function parseAuthConfiguration(raw: unknown): McpAuthConfiguration | null {
  if (!raw) return null;
  const parsed = mcpAuthConfigurationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Compile inputs shared by the gateway (schema derivation) and executor.
// ---------------------------------------------------------------------------

export type ToolCompileInputs = {
  serverValueRefs: CompileServerValueRef[];
  common: McpCommonEntries;
  auth: McpAuthConfiguration | null;
  basePath: string;
};

export async function loadToolCompileInputs(
  db: DB,
  server: McpServer,
): Promise<ToolCompileInputs> {
  const serverValueRefs = await loadServerValueRefs(db, server.id);
  return {
    serverValueRefs,
    common: parseCommonEntries(server.commonEntries),
    auth: parseAuthConfiguration(server.authConfiguration),
    basePath: new URL(server.baseUrl).pathname,
  };
}

/**
 * One immutable, committed view of a server's executable configuration. It is
 * materialized inside a single read-only `REPEATABLE READ` transaction so a
 * runtime request can never combine a server row, compiled plan, or value set
 * from different committed revisions. The transaction ends before any upstream
 * HTTP begins.
 *
 * Published mode reads only the active immutable revision. Draft mode exists
 * solely for owner-only Studio testing and is never used by the product gateway.
 */
export type SnapshotTool = {
  tool: McpTool;
  plan: McpCompiledPlan | null;
  /** Contract fingerprint stored with the published revision tool. */
  contractFingerprint: string | null;
  compileError: AppError | null;
};

export type McpExecutionSnapshot = {
  /** Broad configuration revision of the owning server row at load time. */
  configRevision: number;
  server: McpServer;
  /** Tools available for the selected mode; empty when unavailable. */
  tools: SnapshotTool[];
  serverValues: Map<string, ResolvedServerValue>;
  compileInputs: ToolCompileInputs;
  /** "published" (immutable revision) or "draft" (owner-only testing). */
  revisionMode: McpExecutionMode;
  /** Active revision id; null when unpublished or in draft mode. */
  publishedRevisionId: string | null;
  /** Active revision number; null when unpublished or in draft mode. */
  revisionNumber: number | null;
  /** Aggregate contract fingerprint of the pinned revision. */
  aggregateFingerprint: string | null;
  /** Observed `mcp_server.draftRevision`. */
  draftRevision: number;
};

function revisionToolToMcpTool(
  tool: McpServerRevisionTool,
  serverId: string,
): McpTool {
  return {
    id: tool.sourceToolId,
    serverId,
    name: tool.name,
    title: tool.title,
    description: tool.description,
    method: tool.method,
    requestDefinition: tool.requestDefinition ?? null,
    compiledPlan: tool.compiledPlan ?? null,
    compileStatus: tool.compileStatus ?? null,
    compileIssues: (tool.compileIssues as McpTool["compileIssues"]) ?? null,
    annotations: (tool.annotations as McpTool["annotations"]) ?? null,
    allowMutation: tool.allowMutation,
    enabled: tool.enabled,
    source: tool.source,
    createdAt: tool.createdAt,
    updatedAt: tool.createdAt,
  };
}

function emptyCompileInputs(server: McpServer): ToolCompileInputs {
  return {
    serverValueRefs: [],
    common: { headers: [], query: [] },
    auth: null,
    basePath: safeBasePath(server.baseUrl),
  };
}

function safeBasePath(baseUrl: string): string {
  try {
    return new URL(baseUrl).pathname;
  } catch {
    return "/";
  }
}

function materializePublishedSnapshot(
  server: McpServer,
  revision: McpServerRevision,
  revisionTools: McpServerRevisionTool[],
  revisionConfigs: McpServerRevisionConfig[],
  secretRows: McpServerVariable[],
  credentialSecret: string,
): McpExecutionSnapshot {
  const commonParsed = mcpCommonEntriesSchema.safeParse(revision.commonEntries);
  const common = commonParsed.success
    ? commonParsed.data
    : { headers: [], query: [] };
  const authParsed = mcpAuthConfigurationSchema.safeParse(
    revision.authConfiguration,
  );
  const auth = authParsed.success ? authParsed.data : null;
  const serverValueRefs: CompileServerValueRef[] = revisionConfigs.map(
    (config) => ({
      id: config.sourceValueId,
      name: config.name,
      kind: config.kind as "config" | "secret",
      owner: (config.owner as "manual" | "auth" | null) ?? "manual",
    }),
  );

  const secretById = new Map(secretRows.map((row) => [row.id, row]));
  const serverValues = new Map<string, ResolvedServerValue>();
  for (const config of revisionConfigs) {
    if (config.kind === "secret") {
      const row = secretById.get(config.sourceValueId);
      if (!row) continue;
      const value =
        row.ciphertext !== null && row.ciphertext !== undefined
          ? decryptCredential(row.ciphertext, credentialSecret)
          : "";
      serverValues.set(config.sourceValueId, {
        name: config.name,
        value,
        kind: "secret",
      });
    } else {
      serverValues.set(config.sourceValueId, {
        name: config.name,
        value: config.value ?? "",
        kind: "config",
      });
    }
  }

  const executionServer: McpServer = {
    ...server,
    name: revision.name,
    description: revision.description,
    baseUrl: revision.baseUrl,
    allowedHosts: revision.allowedHosts ?? [],
    commonEntries: revision.commonEntries as McpServer["commonEntries"],
    authConfiguration:
      revision.authConfiguration as McpServer["authConfiguration"],
  };

  const tools: SnapshotTool[] = revisionTools.map((tool) => {
    const parsed = tool.compiledPlan
      ? mcpCompiledPlanSchema.safeParse(tool.compiledPlan)
      : null;
    const plan = parsed && parsed.success ? parsed.data : null;
    return {
      tool: revisionToolToMcpTool(tool, server.id),
      plan,
      contractFingerprint: tool.contractFingerprint ?? null,
      compileError: plan
        ? null
        : appError({
            appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
            message: `Published tool "${tool.name}" has no usable compiled plan.`,
            status: 409,
          }),
    };
  });

  return {
    configRevision: server.configRevision,
    server: executionServer,
    tools,
    serverValues,
    compileInputs: {
      serverValueRefs,
      common,
      auth,
      basePath: safeBasePath(revision.baseUrl),
    },
    revisionMode: "published",
    publishedRevisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    aggregateFingerprint: revision.contractFingerprint,
    draftRevision: server.draftRevision,
  };
}

function unpublishedSnapshot(server: McpServer): McpExecutionSnapshot {
  return {
    configRevision: server.configRevision,
    server,
    tools: [],
    serverValues: new Map(),
    compileInputs: emptyCompileInputs(server),
    revisionMode: "published",
    publishedRevisionId: null,
    revisionNumber: null,
    aggregateFingerprint: null,
    draftRevision: server.draftRevision,
  };
}

export async function loadExecutionSnapshot(
  db: DB,
  input: { serverId: string; credentialSecret: string },
): Promise<McpExecutionSnapshot | null> {
  return db.transaction(
    async (tx) => {
      const [server] = await tx
        .select()
        .from(mcpServer)
        .where(eq(mcpServer.id, input.serverId))
        .limit(1);
      if (!server) return null;
      if (!server.publishedRevisionId) return unpublishedSnapshot(server);

      const [revision] = await tx
        .select()
        .from(mcpServerRevision)
        .where(
          and(
            eq(mcpServerRevision.id, server.publishedRevisionId),
            eq(mcpServerRevision.serverId, server.id),
          ),
        )
        .limit(1);
      // An inconsistent or missing active revision never falls back to mutable
      // draft rows or an older revision; the server advertises no tools.
      if (!revision) {
        captureMcpTelemetry(MCP_TELEMETRY_EVENTS.revisionSnapshotLoadFailed, {
          db,
          properties: {
            serverId: server.id,
            publishedRevisionId: server.publishedRevisionId,
            reason: "missing_active_revision",
          },
        });
        return unpublishedSnapshot(server);
      }

      const revisionTools = await tx
        .select()
        .from(mcpServerRevisionTool)
        .where(eq(mcpServerRevisionTool.revisionId, revision.id))
        .orderBy(asc(mcpServerRevisionTool.toolOrder));
      const revisionConfigs = await tx
        .select()
        .from(mcpServerRevisionConfig)
        .where(eq(mcpServerRevisionConfig.revisionId, revision.id));
      const secretRows = await tx
        .select()
        .from(mcpServerVariable)
        .where(eq(mcpServerVariable.serverId, server.id));

      return materializePublishedSnapshot(
        server,
        revision,
        revisionTools,
        revisionConfigs,
        secretRows,
        input.credentialSecret,
      );
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/**
 * Owner-only draft materialization for the Studio playground. Compiles the
 * current draft without persisting a revision or touching published state.
 */
export async function loadDraftExecutionSnapshot(
  db: DB,
  input: {
    serverId: string;
    credentialSecret: string;
    expectedDraftRevision?: number;
  },
): Promise<McpExecutionSnapshot | null> {
  return db.transaction(
    async (tx) => {
      const [server] = await tx
        .select()
        .from(mcpServer)
        .where(eq(mcpServer.id, input.serverId))
        .limit(1);
      if (!server) return null;
      if (
        input.expectedDraftRevision !== undefined &&
        server.draftRevision !== input.expectedDraftRevision
      ) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT,
          message: "The draft changed while preparing the preview.",
          status: 409,
          details: {
            serverId: server.id,
            draftRevision: server.draftRevision,
            refreshRequired: true,
          },
        });
      }
      const tools = await tx
        .select()
        .from(mcpTool)
        .where(eq(mcpTool.serverId, server.id));
      const compileInputs = await loadToolCompileInputs(tx, server);
      const serverValues = await loadServerValues(
        tx,
        server.id,
        input.credentialSecret,
      );
      const snapshotTools: SnapshotTool[] = tools.map((tool) => {
        try {
          return {
            tool,
            plan: compilePlanForTool(tool, compileInputs),
            contractFingerprint: null,
            compileError: null,
          };
        } catch (error) {
          return {
            tool,
            plan: null,
            contractFingerprint: null,
            compileError: error instanceof AppError ? error : null,
          };
        }
      });
      return {
        configRevision: server.configRevision,
        server,
        tools: snapshotTools,
        serverValues,
        compileInputs,
        revisionMode: "draft" as const,
        publishedRevisionId: null,
        revisionNumber: null,
        aggregateFingerprint: null,
        draftRevision: server.draftRevision,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/**
 * Pure compilation step (no I/O): prefers a stored valid compiled plan, else
 * compiles the stored canonical request definition. A tool with neither fails
 * closed as `MCP_COMPILE_INVALID` and never contacts upstream.
 */
export function compilePlanForTool(
  tool: McpTool,
  inputs: ToolCompileInputs,
): McpCompiledPlan {
  if (tool.compiledPlan && tool.compileStatus === "valid") {
    const parsed = mcpCompiledPlanSchema.safeParse(tool.compiledPlan);
    if (parsed.success) return parsed.data;
  }

  if (tool.requestDefinition) {
    const parsedDefinition = mcpRequestDefinitionSchema.safeParse(
      tool.requestDefinition,
    );
    if (!parsedDefinition.success) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
        message: "The stored request definition is invalid.",
        status: 409,
      });
    }
    const result = compileToolDefinition({
      method: tool.method,
      definition: parsedDefinition.data,
      common: inputs.common,
      auth: inputs.auth,
      serverValues: inputs.serverValueRefs,
      basePath: inputs.basePath,
      allowMutation: tool.allowMutation,
    });
    return assertCompileSuccess(result);
  }

  throw appError({
    appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
    message: "The tool has no stored request definition or compiled plan.",
    status: 409,
  });
}

// ---------------------------------------------------------------------------
// Binding resolution and request construction from a compiled plan.
// ---------------------------------------------------------------------------

type BindingContext = {
  argsByInputId: Map<string, unknown>;
  serverValues: Map<string, ResolvedServerValue>;
  secretsUsed: Set<string>;
};

function toStringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function buildArgsByInputId(
  agentInputs: McpAgentInput[],
  args: Record<string, unknown>,
): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  for (const input of agentInputs) {
    const raw = args[input.name];
    const isAbsent =
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && raw.length === 0 && !input.allowEmpty);
    if (isAbsent) {
      if (input.required) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
          message: `Required input "${input.name}" was not provided.`,
          status: 400,
          details: { placeholder: input.name },
        });
      }
      continue;
    }
    byId.set(input.id, raw);
  }
  return byId;
}

function resolveBindingValue(
  binding: McpValueBinding,
  ctx: BindingContext,
): { value: unknown; present: boolean } {
  if (binding.kind === "literal") {
    return { value: binding.value, present: true };
  }
  if (binding.kind === "serverValue") {
    const resolved = ctx.serverValues.get(binding.serverValueId);
    if (!resolved) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
        message: "A referenced server value is no longer configured.",
        status: 409,
      });
    }
    if (resolved.kind === "secret" && resolved.value.length > 0) {
      ctx.secretsUsed.add(resolved.value);
    }
    const rendered = `${binding.prefix ?? ""}${resolved.value}${binding.suffix ?? ""}`;
    return { value: rendered, present: true };
  }
  const present = ctx.argsByInputId.has(binding.agentInputId);
  return { value: ctx.argsByInputId.get(binding.agentInputId), present };
}

const OMITTED = Symbol("omitted");

function coerceJsonScalar(
  value: unknown,
  jsonType: "string" | "number" | "boolean" | "null" | "any",
): unknown {
  switch (jsonType) {
    case "string":
      return toStringValue(value);
    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      return Number.isFinite(num) ? num : 0;
    }
    case "boolean":
      return typeof value === "boolean" ? value : Boolean(value);
    case "null":
      return null;
    case "any":
      return value;
  }
}

function renderJsonNode(
  node: McpJsonNode,
  ctx: BindingContext,
): unknown | typeof OMITTED {
  if (node.kind === "literal") return node.value;
  if (node.kind === "binding") {
    const resolved = resolveBindingValue(node.binding, ctx);
    if (!resolved.present) {
      return node.omitWhenAbsent ? OMITTED : null;
    }
    return coerceJsonScalar(resolved.value, node.jsonType);
  }
  if (node.kind === "array") {
    const items: unknown[] = [];
    for (const item of node.items) {
      const rendered = renderJsonNode(item, ctx);
      if (rendered !== OMITTED) items.push(rendered);
    }
    return items;
  }
  const obj: Record<string, unknown> = {};
  for (const field of node.fields) {
    const rendered = renderJsonNode(field.value, ctx);
    if (rendered !== OMITTED) obj[field.key] = rendered;
  }
  return obj;
}

function joinUrlPath(basePath: string, toolPath: string): string {
  const left = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const right = toolPath.startsWith("/") ? toolPath : `/${toolPath}`;
  if (!left || left === "") return right;
  return `${left}${right}`;
}

type BuiltRequest = { url: URL; headers: Headers; body: string | undefined };

function buildRequestFromPlan(
  server: McpServer,
  plan: McpCompiledPlan,
  ctx: BindingContext,
): BuiltRequest {
  const base = new URL(server.baseUrl);
  const url = new URL(base.toString());

  let toolPath = "";
  for (const segment of plan.pathSegments) {
    if (segment.source.kind === "literal") {
      toolPath +=
        segment.source.value === null ? "" : String(segment.source.value);
      continue;
    }
    const resolved = resolveBindingValue(segment.source, ctx);
    if (!resolved.present) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
        message: "A required path value is missing.",
        status: 400,
      });
    }
    toolPath += encodeURIComponent(toStringValue(resolved.value));
  }
  url.pathname = joinUrlPath(base.pathname, toolPath || "/");

  const searchParams = new URLSearchParams();
  for (const entry of plan.query) {
    const resolved = resolveBindingValue(entry.source, ctx);
    if (!resolved.present) {
      if (entry.omitWhenAbsent) continue;
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
        message: `Required query value "${entry.name}" is missing.`,
        status: 400,
        details: { placeholder: entry.name },
      });
    }
    searchParams.append(entry.name, toStringValue(resolved.value));
  }
  const search = searchParams.toString();
  if (search) url.search = search;

  const headers = new Headers();
  for (const entry of plan.headers) {
    const resolved = resolveBindingValue(entry.source, ctx);
    if (!resolved.present) {
      if (entry.omitWhenAbsent) continue;
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
        message: `Required header "${entry.name}" is missing.`,
        status: 400,
        details: { placeholder: entry.name },
      });
    }
    headers.set(entry.name, toStringValue(resolved.value));
  }

  let body: string | undefined;
  if (plan.body.bodyType === "json") {
    const rendered = renderJsonNode(plan.body.root, ctx);
    body = JSON.stringify(rendered === OMITTED ? null : rendered);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  } else if (plan.body.bodyType === "form") {
    const form = new URLSearchParams();
    for (const field of plan.body.fields) {
      const resolved = resolveBindingValue(field.source, ctx);
      if (!resolved.present) {
        if (field.omitWhenAbsent) continue;
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
          message: `Required form field "${field.name}" is missing.`,
          status: 400,
          details: { placeholder: field.name },
        });
      }
      form.append(field.name, toStringValue(resolved.value));
    }
    body = form.toString();
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
  } else if (plan.body.bodyType === "raw") {
    let raw = "";
    for (const part of plan.body.parts) {
      if (part.kind === "text") {
        raw += part.value;
        continue;
      }
      const resolved = resolveBindingValue(part.binding, ctx);
      raw += resolved.present ? toStringValue(resolved.value) : "";
    }
    body = raw;
    if (plan.body.contentType && !headers.has("content-type")) {
      headers.set("content-type", plan.body.contentType);
    }
  }

  return { url, headers, body };
}

// ---------------------------------------------------------------------------
// Bounded, deadline-covered upstream fetch with same-origin redirect policy.
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 5;

class UpstreamTimeout extends Error {
  constructor(public readonly innerCause: unknown) {
    super("mcp-upstream-deadline-exceeded");
  }
}

class UpstreamNetworkFailure extends Error {
  constructor(public readonly innerCause: unknown) {
    super("mcp-upstream-network-failure");
  }
}

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("mcp-upstream-deadline-exceeded"));
  }, MCP_UPSTREAM_DEADLINE_MS);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (timedOut) throw new UpstreamTimeout(error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function stripBodyHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  next.delete("content-type");
  return next;
}

type FetchPolicyInput = {
  url: URL;
  method: string;
  headers: Headers;
  body: string | undefined;
  allowedHosts: string[];
  basePathname: string;
  signal: AbortSignal;
  onMutatingSend: () => void;
};

async function fetchWithPolicy(
  input: FetchPolicyInput,
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = input.url;
  let currentMethod = input.method;
  let currentHeaders = input.headers;
  let currentBody = input.body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertUpstreamUrlSafe(currentUrl.toString(), input.allowedHosts);
    assertPathWithinBase(input.basePathname, currentUrl.pathname);

    const sendsBody =
      currentBody !== undefined &&
      currentMethod !== "GET" &&
      currentMethod !== "HEAD";
    if (MUTATING_METHODS.has(currentMethod)) input.onMutatingSend();

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method: currentMethod,
        headers: currentHeaders,
        body: sendsBody ? currentBody : undefined,
        redirect: "manual",
        signal: input.signal,
      });
    } catch (error) {
      throw new UpstreamNetworkFailure(error);
    }

    const location = response.headers.get("location");
    const isRedirect =
      response.status >= 300 && response.status < 400 && Boolean(location);
    if (!isRedirect) {
      return { response, finalUrl: currentUrl };
    }

    await response.body?.cancel().catch(() => undefined);
    const next = assertSameOriginRedirect(currentUrl, location as string);

    const downgradesToGet =
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        currentMethod === "POST");
    if (downgradesToGet) {
      currentMethod = "GET";
      currentBody = undefined;
      currentHeaders = stripBodyHeaders(currentHeaders);
    }
    // 307/308 (and 301/302 for non-POST methods) preserve method and body.

    currentUrl = next;
  }

  throw appError({
    appCode: APP_ERROR_CODES.MCP_REDIRECT_REJECTED,
    message: "Too many redirects.",
    status: 502,
  });
}

async function readCappedBytes(
  response: Response,
  limit: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(0), truncated: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.byteLength === 0) continue;
    const remaining = limit - total;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    const slice =
      value.byteLength > remaining ? value.subarray(0, remaining) : value;
    chunks.push(slice);
    total += slice.byteLength;
    if (slice.byteLength < value.byteLength) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

const TEXTUAL_CONTENT_TYPE_PATTERN =
  /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded)|.*\+(json|xml))/i;

function contentTypeMime(contentType: string | null): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isTextualContentType(contentType: string | null): boolean {
  const mime = contentTypeMime(contentType);
  return mime.length > 0 && TEXTUAL_CONTENT_TYPE_PATTERN.test(mime);
}

function isJsonContentType(contentType: string | null): boolean {
  const mime = contentTypeMime(contentType);
  return mime === "application/json" || mime.endsWith("+json");
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.round((dateMs - Date.now()) / 1000));
  }
  return undefined;
}

function pickSafeHeaders(
  headers: Headers,
  secrets: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of MCP_SAFE_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = redactText(value, secrets);
  }
  return out;
}

function summarizeForCallLog(value: string, secrets: string[]): string {
  return capText(redactText(value, secrets), MCP_LOG_PREVIEW_BYTE_LIMIT).text;
}

function outcomeForAppCode(appCode: string): string {
  switch (appCode) {
    case APP_ERROR_CODES.MCP_TIMEOUT:
      return "timeout";
    case APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE:
      return "indeterminate";
    case APP_ERROR_CODES.MCP_UPSTREAM_ERROR:
      return "connection_failure";
    case APP_ERROR_CODES.MCP_COMPILE_INVALID:
    case APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED:
    case APP_ERROR_CODES.MCP_TOOL_DISABLED:
    case APP_ERROR_CODES.MCP_SERVER_PAUSED:
    case APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED:
      return "validation";
    default:
      return "policy";
  }
}

function phaseForAppCode(appCode: string): string {
  switch (appCode) {
    case APP_ERROR_CODES.MCP_COMPILE_INVALID:
      return "compile";
    case APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED:
    case APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED:
    case APP_ERROR_CODES.MCP_TOOL_DISABLED:
    case APP_ERROR_CODES.MCP_SERVER_PAUSED:
      return "validate";
    case APP_ERROR_CODES.MCP_REDIRECT_REJECTED:
      return "redirect";
    case APP_ERROR_CODES.MCP_PATH_ESCAPE:
    case APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED:
    case APP_ERROR_CODES.MCP_UPSTREAM_ERROR:
    case APP_ERROR_CODES.MCP_TIMEOUT:
    case APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE:
      return "connect";
    default:
      return "validate";
  }
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

export async function executeMappedTool(
  db: DB,
  input: ExecuteMappedToolInput,
): Promise<ExecuteMappedToolResult> {
  // Verify ownership before materializing a snapshot, which resolves and
  // decrypts the owner's server values, so another user's serverId cannot
  // trigger decryption of tenant secrets.
  if (input.source !== "agent") {
    const [owned] = await db
      .select({ id: mcpServer.id })
      .from(mcpServer)
      .where(
        and(
          eq(mcpServer.id, input.serverId),
          eq(mcpServer.userId, input.ownerUserId ?? ""),
        ),
      )
      .limit(1);
    if (!owned) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
        message: "MCP server not found.",
        status: 404,
      });
    }
  }

  const mode = input.mode ?? "published";
  if (mode === "draft" && input.source !== "playground") {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_SCOPE_DENIED,
      message: "Draft execution is available only from the owner playground.",
      status: 403,
    });
  }

  const snapshot =
    input.snapshot ??
    (mode === "draft"
      ? await loadDraftExecutionSnapshot(db, {
          serverId: input.serverId,
          credentialSecret: input.credentialSecret,
          expectedDraftRevision: input.expectedDraftRevision,
        })
      : await loadExecutionSnapshot(db, {
          serverId: input.serverId,
          credentialSecret: input.credentialSecret,
        }));

  if (!snapshot) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
      message: "MCP server not found.",
      status: 404,
    });
  }

  return runMappedTool(db, snapshot, input);
}

/**
 * Executes one mapped tool entirely from a materialized snapshot. No database
 * read occurs here, so no transaction is open while upstream HTTP runs.
 */
async function runMappedTool(
  db: DB,
  snapshot: McpExecutionSnapshot,
  input: ExecuteMappedToolInput,
): Promise<ExecuteMappedToolResult> {
  const started = Date.now();
  const args = input.args ?? {};
  const server = snapshot.server;

  if (input.source !== "agent") {
    if (!input.ownerUserId || server.userId !== input.ownerUserId) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
        message: "MCP server not found.",
        status: 404,
      });
    }
  }

  if (!input.toolId && !input.toolName) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "A tool id or name is required.",
      status: 400,
    });
  }

  const snapshotTool = input.toolId
    ? snapshot.tools.find((candidate) => candidate.tool.id === input.toolId)
    : snapshot.tools.find(
        (candidate) => candidate.tool.name === input.toolName,
      );

  if (!snapshotTool) {
    if (snapshot.revisionMode === "published") {
      captureMcpTelemetry(MCP_TELEMETRY_EVENTS.staleAgentCall, {
        db,
        properties: {
          serverId: server.id,
          reason: "removed_tool",
          lookup: input.toolId ? "id" : "name",
          source: input.source,
          publishedRevisionId: snapshot.publishedRevisionId,
          revisionNumber: snapshot.revisionNumber,
        },
      });
    }
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
      message: "MCP tool not found.",
      status: 404,
      details:
        snapshot.revisionMode === "published"
          ? {
              serverId: server.id,
              publishedRevisionId: snapshot.publishedRevisionId,
              publishedRevisionNumber: snapshot.revisionNumber,
              ...(snapshot.aggregateFingerprint
                ? { currentFingerprint: snapshot.aggregateFingerprint }
                : {}),
              refreshRequired: true,
            }
          : undefined,
    });
  }

  const tool = snapshotTool.tool;

  const callLogId = generateId("mcl");
  let requestSummary: string | null = null;

  const persist = (fields: {
    status: string;
    httpStatus: number | null;
    durationMs: number;
    appCode: string | null;
    phase: string | null;
    outcome: string;
    responseSummary: string | null;
  }): void => {
    enqueueCallLog(db, {
      id: callLogId,
      serverId: server.id,
      toolId: tool.id,
      userId: input.ownerUserId ?? null,
      source: input.source,
      createdAt: new Date(),
      requestSummary,
      publishedRevisionId:
        snapshot.revisionMode === "published"
          ? snapshot.publishedRevisionId
          : null,
      revisionNumber:
        snapshot.revisionMode === "published" ? snapshot.revisionNumber : null,
      aggregateFingerprint:
        snapshot.revisionMode === "published"
          ? snapshot.aggregateFingerprint
          : null,
      toolFingerprint:
        snapshot.revisionMode === "published"
          ? (snapshotTool.contractFingerprint ?? null)
          : null,
      revisionMode: snapshot.revisionMode,
      draftRevision:
        snapshot.revisionMode === "draft" ? snapshot.draftRevision : null,
      ...fields,
    });
  };

  try {
    if (server.status === "paused") {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_SERVER_PAUSED,
        message: "MCP server is paused.",
        status: 403,
      });
    }
    if (!tool.enabled) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TOOL_DISABLED,
        message: "Tool is disabled.",
        status: 403,
      });
    }

    const method = tool.method.toUpperCase();
    const mutating = MUTATING_METHODS.has(method);
    if (mutating && !tool.allowMutation) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
        message: "Mutating this tool is not allowed.",
        status: 403,
      });
    }

    if (!snapshotTool.plan) {
      if (snapshot.revisionMode === "published") {
        captureMcpTelemetry(MCP_TELEMETRY_EVENTS.revisionSnapshotLoadFailed, {
          db,
          properties: {
            serverId: server.id,
            toolId: tool.id,
            publishedRevisionId: snapshot.publishedRevisionId,
            revisionNumber: snapshot.revisionNumber,
            reason: "missing_compiled_plan",
          },
        });
      }
      throw (
        snapshotTool.compileError ??
        appError({
          appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
          message: "The stored tool definition is invalid.",
          status: 409,
        })
      );
    }
    const plan = snapshotTool.plan;
    const serverValues = snapshot.serverValues;
    const argsByInputId = buildArgsByInputId(plan.agentInputs, args);
    const secretsUsed = new Set<string>();
    const bindingCtx: BindingContext = {
      argsByInputId,
      serverValues,
      secretsUsed,
    };

    const sensitiveValues = plan.agentInputs
      .filter((agentInput) => agentInput.sensitive)
      .map((agentInput) => argsByInputId.get(agentInput.id))
      .filter((value): value is unknown => value !== undefined)
      .map((value) => toStringValue(value));
    const redactionValues = () => [...secretsUsed, ...sensitiveValues];

    const built = buildRequestFromPlan(server, plan, bindingCtx);
    const basePathname = new URL(server.baseUrl).pathname;

    requestSummary = summarizeForCallLog(
      JSON.stringify({
        method: plan.method,
        url: built.url.toString(),
        headers: Object.fromEntries(built.headers.entries()),
        body: built.body ?? null,
      }),
      redactionValues(),
    );

    let sentMutatingRequest = false;
    let opResult: {
      response: Response;
      finalUrl: URL;
      bytes: Uint8Array;
      bodyTruncated: boolean;
    };
    try {
      opResult = await withDeadline(async (signal) => {
        const hop = await fetchWithPolicy({
          url: built.url,
          method: plan.method,
          headers: built.headers,
          body: built.body,
          allowedHosts: server.allowedHosts,
          basePathname,
          signal,
          onMutatingSend: () => {
            sentMutatingRequest = true;
          },
        });
        const capped = await readCappedBytes(
          hop.response,
          MCP_RESPONSE_BYTE_LIMIT,
        );
        return {
          response: hop.response,
          finalUrl: hop.finalUrl,
          bytes: capped.bytes,
          bodyTruncated: capped.truncated,
        };
      });
    } catch (error) {
      if (error instanceof UpstreamTimeout) {
        const appCode = sentMutatingRequest
          ? APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE
          : APP_ERROR_CODES.MCP_TIMEOUT;
        throw appError({
          appCode,
          message: sentMutatingRequest
            ? "The mutating request may have completed, but the upstream response timed out."
            : "The upstream request timed out.",
          status: 504,
        });
      }
      if (error instanceof UpstreamNetworkFailure) {
        const appCode = sentMutatingRequest
          ? APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE
          : APP_ERROR_CODES.MCP_UPSTREAM_ERROR;
        throw appError({
          appCode,
          message: sentMutatingRequest
            ? "The mutating request may have completed, but the network connection failed."
            : "Upstream request failed.",
          status: 502,
          cause: error.innerCause,
        });
      }
      throw error;
    }

    const { response, bytes, bodyTruncated } = opResult;
    const contentType = response.headers.get("content-type");
    const safeHeaders = pickSafeHeaders(response.headers, redactionValues());
    const retryAfterSeconds = parseRetryAfterSeconds(
      response.headers.get("retry-after"),
    );
    const failureError = response.ok
      ? undefined
      : upstreamHttpToolError(response.status, {
          method: plan.method,
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
        });

    let envelope: McpToolEnvelope;
    let responseLogText: string;

    if (bytes.byteLength === 0) {
      envelope = {
        ok: response.ok,
        status: response.status,
        contentType,
        headers: safeHeaders,
        truncated: bodyTruncated,
        body: "",
        ...(failureError ? { error: failureError } : {}),
      };
      responseLogText = "";
    } else if (isTextualContentType(contentType)) {
      const rawText = new TextDecoder().decode(bytes);
      const redactedText = redactText(rawText, redactionValues());
      let data: unknown;
      if (isJsonContentType(contentType) && !bodyTruncated) {
        try {
          data = JSON.parse(redactedText);
        } catch {
          data = undefined;
        }
      }
      envelope = {
        ok: response.ok,
        status: response.status,
        contentType,
        headers: safeHeaders,
        truncated: bodyTruncated,
        body: redactedText,
        ...(data !== undefined ? { data } : {}),
        ...(failureError ? { error: failureError } : {}),
      };
      responseLogText = redactedText;
    } else {
      envelope = {
        ok: response.ok,
        status: response.status,
        contentType,
        headers: safeHeaders,
        truncated: bodyTruncated,
        binary: true,
        ...(failureError ? { error: failureError } : {}),
      };
      responseLogText = `<binary ${bytes.byteLength} bytes>`;
    }

    const durationMs = Date.now() - started;
    persist({
      status: response.ok ? "success" : "error",
      httpStatus: response.status,
      durationMs,
      appCode: envelope.error?.code ?? null,
      phase: "complete",
      outcome: response.ok ? "success" : "upstream_error",
      responseSummary: summarizeForCallLog(responseLogText, redactionValues()),
    });

    return {
      ok: response.ok,
      httpStatus: response.status,
      envelope,
      durationMs,
      callLogId,
      secretsUsed: [...secretsUsed],
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof AppError) {
      persist({
        status: "error",
        httpStatus: null,
        durationMs,
        appCode: error.appCode,
        phase: phaseForAppCode(error.appCode) ?? null,
        outcome: outcomeForAppCode(error.appCode),
        responseSummary: null,
      });
      throw error;
    }
    persist({
      status: "error",
      httpStatus: null,
      durationMs,
      appCode: APP_ERROR_CODES.INTERNAL_ERROR,
      phase: "connect",
      outcome: "policy",
      responseSummary: null,
    });
    throw error;
  }
}
