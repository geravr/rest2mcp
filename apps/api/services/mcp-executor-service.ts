/**
 * @file Hardened MCP tool executor shared by the gateway, playground, and
 * Platform MCP. Prefers the immutable compiled plan, falls back to compiling
 * a stored request definition, and finally to a legacy-template compatibility
 * reader. Every binding is resolved only from its declared source; one
 * deadline covers address validation, redirects, headers, and body reads.
 */
import {
  generateId,
  mcpServer,
  mcpServerVariable,
  mcpTool,
  type McpServer,
  type McpTool,
} from "@repo/db";
import { and, eq } from "drizzle-orm";
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
  analyzeLegacyCommonEntries,
  analyzeLegacyTool,
} from "../lib/mcp-legacy-migrate.js";
import {
  MCP_LOG_PREVIEW_BYTE_LIMIT,
  MCP_RESPONSE_BYTE_LIMIT,
  MCP_SAFE_RESPONSE_HEADERS,
  MCP_UPSTREAM_DEADLINE_MS,
} from "../lib/mcp-policy.js";
import { capText, redactText } from "../lib/mcp-redact.js";
import type { TemplateVariable } from "../lib/mcp-template.js";
import {
  mcpAuthConfigurationSchema,
  mcpCommonEntriesSchema,
  mcpCompiledPlanSchema,
  mcpRequestDefinitionSchema,
  type McpAgentInput,
  type McpAuthConfiguration,
  type McpCommonEntries,
  type McpCompiledPlan,
  type McpCompileIssue,
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

export type ExecuteMappedToolInput = {
  serverId: string;
  ownerUserId?: string;
  toolId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  source: McpCallSource;
  credentialSecret: string;
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
// Legacy by-name variable loading (unchanged; consumed by mcp-studio-service).
// ---------------------------------------------------------------------------

export async function loadVariables(
  db: DB,
  serverId: string,
  credentialSecret: string,
): Promise<Record<string, TemplateVariable>> {
  const rows = await db
    .select()
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, serverId));
  const variables: Record<string, TemplateVariable> = {};
  for (const row of rows) {
    if (row.isSecret) {
      if (!row.ciphertext) continue;
      variables[row.name] = {
        value: decryptCredential(row.ciphertext, credentialSecret),
        isSecret: true,
      };
    } else {
      variables[row.name] = { value: row.value ?? "", isSecret: false };
    }
  }
  return variables;
}

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
    const kind: "config" | "secret" =
      (row.kind as "config" | "secret" | null) ??
      (row.isSecret ? "secret" : "config");
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
    kind:
      (row.kind as "config" | "secret" | null) ??
      (row.isSecret ? "secret" : "config"),
    owner: (row.owner as "manual" | "auth" | null) ?? "manual",
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
  legacyDefaultHeaders: Record<string, string> | null;
  legacyDefaultQuery: Record<string, string> | null;
};

export async function loadToolCompileInputs(
  db: DB,
  server: McpServer,
): Promise<ToolCompileInputs> {
  const serverValueRefs = await loadServerValueRefs(db, server.id);
  let common = parseCommonEntries(server.commonEntries);
  if (!server.commonEntries && (server.defaultHeaders || server.defaultQuery)) {
    const legacyCommon = analyzeLegacyCommonEntries({
      defaultHeaders: server.defaultHeaders,
      defaultQuery: server.defaultQuery,
      serverValues: serverValueRefs,
    });
    if (legacyCommon.unambiguous && legacyCommon.commonEntries) {
      common = legacyCommon.commonEntries;
    }
  }
  return {
    serverValueRefs,
    common,
    auth: parseAuthConfiguration(server.authConfiguration),
    basePath: new URL(server.baseUrl).pathname,
    legacyDefaultHeaders: server.defaultHeaders,
    legacyDefaultQuery: server.defaultQuery,
  };
}

function throwFirstIssue(
  issues: McpCompileIssue[],
  fallbackMessage: string,
): never {
  const firstError =
    issues.find((issue) => issue.severity === "error") ?? issues[0];
  throw appError({
    appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
    message: firstError?.message ?? fallbackMessage,
    status: 409,
    details: {
      ...(firstError?.path !== undefined ? { path: firstError.path } : {}),
      ...(firstError?.code !== undefined ? { issueCode: firstError.code } : {}),
    },
  });
}

/**
 * Pure compilation step (no I/O): prefers a stored valid compiled plan, else
 * compiles the stored request definition, else compiles a legacy-template
 * compatibility reading. Throws `MCP_COMPILE_INVALID` when none succeed.
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

  const legacy = analyzeLegacyTool({
    method: tool.method,
    pathTemplate: tool.pathTemplate,
    requestTemplate: tool.requestTemplate,
    params: tool.params,
    serverValues: inputs.serverValueRefs,
  });
  if (!legacy.unambiguous || !legacy.definition) {
    throwFirstIssue(
      legacy.issues,
      "The legacy tool template could not be migrated automatically.",
    );
  }

  const legacyCommon = analyzeLegacyCommonEntries({
    defaultHeaders: inputs.legacyDefaultHeaders,
    defaultQuery: inputs.legacyDefaultQuery,
    serverValues: inputs.serverValueRefs,
  });
  if (!legacyCommon.unambiguous || !legacyCommon.commonEntries) {
    throwFirstIssue(
      legacyCommon.issues,
      "The legacy server defaults could not be migrated automatically.",
    );
  }

  const result = compileToolDefinition({
    method: tool.method,
    definition: legacy.definition,
    common: legacyCommon.commonEntries,
    auth: null,
    serverValues: inputs.serverValueRefs,
    basePath: inputs.basePath,
    allowMutation: tool.allowMutation,
  });
  return assertCompileSuccess(result);
}

async function resolveCompiledPlan(
  db: DB,
  server: McpServer,
  tool: McpTool,
): Promise<McpCompiledPlan> {
  const inputs = await loadToolCompileInputs(db, server);
  return compilePlanForTool(tool, inputs);
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
  const started = Date.now();
  const args = input.args ?? {};

  const [server] = await db
    .select()
    .from(mcpServer)
    .where(eq(mcpServer.id, input.serverId))
    .limit(1);

  if (!server) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
      message: "MCP server not found.",
      status: 404,
    });
  }

  if (input.source !== "agent") {
    if (!input.ownerUserId || server.userId !== input.ownerUserId) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
        message: "MCP server not found.",
        status: 404,
      });
    }
  }

  const toolFilter = input.toolId
    ? and(eq(mcpTool.serverId, server.id), eq(mcpTool.id, input.toolId))
    : input.toolName
      ? and(eq(mcpTool.serverId, server.id), eq(mcpTool.name, input.toolName))
      : null;

  if (!toolFilter) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "A tool id or name is required.",
      status: 400,
    });
  }

  const [tool] = await db.select().from(mcpTool).where(toolFilter).limit(1);

  if (!tool) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
      message: "MCP tool not found.",
      status: 404,
    });
  }

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

    const plan = await resolveCompiledPlan(db, server, tool);
    const serverValues = await loadServerValues(
      db,
      server.id,
      input.credentialSecret,
    );
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
