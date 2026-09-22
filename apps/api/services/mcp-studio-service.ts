/**
 * @file Owner-scoped MCP studio control plane.
 */
import type { Paginated, PaginationInput } from "@repo/core";
import {
  mcpAgentToken,
  mcpCallLog,
  mcpServer,
  mcpServerRevisionConfig,
  mcpServerRevisionTool,
  mcpServerVariable,
  mcpTool,
  mcpToolGroup,
  type McpAuthConfigurationRow,
  type McpNamedEntryRow,
  type McpServer,
  type McpServerVariable,
} from "@repo/db";
import { and, count, desc, eq, ilike, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  APP_ERROR_CODES,
  AppError,
  appError,
  isAppErrorCode,
} from "../lib/app-error.js";
import {
  isAuthHeaderName,
  isCredentialQueryName,
  recipeToMapping,
  type ServerAuthRecipe,
} from "../lib/mcp-auth-recipe.js";
import { generateAgentToken } from "../lib/mcp-agent-token.js";
import type { CompileServerValueRef } from "../lib/mcp-compiler.js";
import { compileToolDefinition } from "../lib/mcp-compiler.js";
import {
  compileAgentToolContract,
  toSerializableContract,
  type McpAgentToolContract,
} from "../lib/mcp-contract.js";
import {
  buildCurlImportDraft,
  detectCurlCredentials,
  previewCurlImport as buildCurlImportPreview,
  type CurlImportMarking,
  type CurlImportPreview,
} from "../lib/mcp-curl-import.js";
import { encryptCredential } from "../lib/mcp-crypto.js";
import { likeContainsPattern, normalizeSearchQuery } from "../lib/like.js";
import {
  MCP_TOOL_GROUP_FILTER_ALL,
  MCP_TOOL_GROUP_FILTER_UNGROUPED,
} from "../lib/mcp-domain-commands.js";
import { isForbiddenTransportHeaderName } from "../lib/mcp-policy.js";
import { getMcpMaxToolsPerServer } from "../lib/mcp-limits.js";
import {
  mcpAuthConfigurationSchema,
  mcpCommonEntriesSchema,
  mcpRequestDefinitionSchema,
  redactSensitiveExamples,
  regenerateDefinitionIds,
  type McpAuthConfiguration,
  type McpCommonEntries,
  type McpCompileIssue,
  type McpNamedEntry,
  type McpRequestDefinition,
  type McpValueBinding,
} from "../lib/mcp-request-definition.js";
import { assertUpstreamUrlSafe } from "../lib/mcp-ssrf.js";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
  type McpTelemetryEvent,
} from "../lib/mcp-telemetry.js";
import { paginate } from "../lib/paginate.js";
import {
  isUniqueViolation,
  withOwnedServerWrite,
} from "./mcp-server-command.js";
import {
  loadAssetAccessPaths,
  markAssetAttached,
  markAssetsDeletePending,
  requireAttachableAsset,
} from "./mcp-asset-service.js";
import {
  loadServerValues,
  MUTATING_METHODS,
  READ_METHODS,
} from "./mcp-executor-service.js";
import {
  buildPublicationCandidate,
  loadDraftAggregate,
  loadRevisionSummary,
} from "./mcp-publishing-service.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

/** Buffers compiler telemetry until the surrounding command commits. */
export type CompileTelemetryEmitter = (
  event: McpTelemetryEvent,
  properties: Record<string, unknown>,
) => void;

/**
 * Buffers compile telemetry and flushes it only after the command commits, so
 * a rolled-back candidate never emits authoritative success telemetry.
 */
function bufferCompileTelemetry(
  db: DB,
  userId: string,
  onCommit: (hook: () => void | Promise<void>) => void,
): CompileTelemetryEmitter {
  const buffered: Array<{
    event: McpTelemetryEvent;
    properties: Record<string, unknown>;
  }> = [];
  onCommit(() => {
    for (const item of buffered) {
      captureMcpTelemetry(item.event, {
        db,
        userId,
        properties: item.properties,
      });
    }
  });
  return (event, properties) => buffered.push({ event, properties });
}

export type TrafficLight = "draft" | "green" | "yellow" | "red" | "paused";
export type McpServerStatus = "draft" | "live" | "paused";
export type McpToolSource = "manual" | "curl" | "openapi";
export type McpHttpMethod =
  "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

export type { ServerAuthRecipe };

export type CreateServerInput = {
  name: string;
  description?: string | null;
  baseUrl: string;
  slug?: string;
  auth?: ServerAuthRecipe;
};

export type UpdateServerInput = {
  expectedRevision: number;
  name?: string;
  description?: string | null;
  iconAssetId?: string | null;
  baseUrl?: string;
  status?: McpServerStatus;
  allowedHosts?: string[];
};

const PUBLISHABLE_SERVER_FIELDS = [
  "name",
  "description",
  "baseUrl",
  "allowedHosts",
] as const satisfies readonly (keyof UpdateServerInput)[];

/** Canonical typed create contract; the request definition is authoritative. */
export type CreateTypedToolInput = {
  expectedRevision: number;
  name: string;
  title?: string | null;
  description?: string | null;
  method: McpHttpMethod;
  requestDefinition: McpRequestDefinition;
  allowMutation?: boolean;
  enabled?: boolean;
  /** Optional Studio group placement; null or absent leaves the tool ungrouped. */
  groupId?: string | null;
};

export type UpdateTypedToolInput = {
  expectedRevision: number;
  name?: string;
  title?: string | null;
  description?: string | null;
  method?: McpHttpMethod;
  requestDefinition?: McpRequestDefinition;
  allowMutation?: boolean;
  enabled?: boolean;
  /** Absent keeps the stored assignment; null ungroups; an id moves the tool. */
  groupId?: string | null;
};

export type DuplicateTypedToolInput = {
  expectedRevision: number;
  name?: string;
  title?: string | null;
  description?: string | null;
  enabled?: boolean;
};

export type CreateVariableInput = {
  expectedRevision: number;
  name: string;
  kind: "config" | "secret";
  value: string;
  description?: string | null;
};

export type UpdateVariableInput = {
  expectedRevision: number;
  value?: string;
  kind?: "config" | "secret";
  description?: string | null;
};

/** Canonical name-keyed create/upsert shape shared with Platform MCP. */
export type SetVariableInput = CreateVariableInput;

const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "server";
}

export function toMcpToolName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message:
        "Tool name must start with a letter and use letters, numbers, or underscores.",
      status: 400,
    });
  }
  return normalized;
}

export function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "baseUrl must be a valid HTTP or HTTPS URL.",
      status: 400,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "baseUrl must be HTTP or HTTPS.",
      status: 400,
    });
  }
  url.hash = "";
  url.search = "";
  return url;
}

/** Origin plus any path prefix, without query, fragment, or trailing slashes. */
export function formatBaseUrl(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

export function deriveAllowedHosts(
  baseUrl: string,
  extra: string[] = [],
): string[] {
  const host = new URL(baseUrl).hostname.toLowerCase();
  const hosts = new Set<string>([
    host,
    ...extra.map((item) => item.toLowerCase()),
  ]);
  return [...hosts];
}

export function mutationDefaults(
  method: string,
  allowMutation?: boolean,
  enabled?: boolean,
): { allowMutation: boolean; enabled: boolean } {
  const upper = method.toUpperCase();
  if (READ_METHODS.has(upper)) {
    return {
      allowMutation: false,
      enabled: enabled ?? true,
    };
  }
  const allowed = allowMutation ?? false;
  return {
    allowMutation: allowed,
    enabled: allowed ? (enabled ?? true) : false,
  };
}

export function deriveTrafficLight(input: {
  status: string;
  publishedRevisionId: string | null;
  recentCallStatuses: string[];
}): TrafficLight {
  if (input.status === "paused") return "paused";
  if (!input.publishedRevisionId) return "draft";
  const recent = input.recentCallStatuses.slice(0, 5);
  if (recent.length === 0) return "green";
  const failed = recent.filter((status) => status !== "success");
  if (failed.length === recent.length) return "red";
  if (failed.length > 0) return "yellow";
  return "green";
}

async function requireOwnedServer(db: DB, userId: string, serverId: string) {
  const [server] = await db
    .select()
    .from(mcpServer)
    .where(and(eq(mcpServer.id, serverId), eq(mcpServer.userId, userId)))
    .limit(1);

  if (!server) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
      message: "MCP server not found.",
      status: 404,
    });
  }
  return server;
}

/**
 * A secret slot referenced by the active published revision is an operational
 * dependency. Deleting it or changing its kind would break live execution even
 * when the draft no longer references it; both require a new publication.
 */
async function assertActiveRevisionDoesNotReferenceSecret(
  db: DB,
  server: McpServer,
  variableId: string,
  action: "deleted" | "converted",
): Promise<void> {
  if (!server.publishedRevisionId) return;
  const [reference] = await db
    .select({ id: mcpServerRevisionConfig.id })
    .from(mcpServerRevisionConfig)
    .where(
      and(
        eq(mcpServerRevisionConfig.revisionId, server.publishedRevisionId),
        eq(mcpServerRevisionConfig.sourceValueId, variableId),
        eq(mcpServerRevisionConfig.kind, "secret"),
      ),
    )
    .limit(1);
  if (!reference) return;
  throw appError({
    appCode: APP_ERROR_CODES.MCP_ACTIVE_SECRET_IN_USE,
    message: `This secret is used by the active published revision and cannot be ${action}.`,
    status: 409,
    details: {
      serverId: server.id,
      publishedRevisionId: server.publishedRevisionId,
    },
  });
}

async function countEnabledTools(db: DB, serverId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(mcpTool)
    .where(and(eq(mcpTool.serverId, serverId), eq(mcpTool.enabled, true)));
  return row?.count ?? 0;
}

async function recentActiveRevisionCallStatuses(
  db: DB,
  serverId: string,
  publishedRevisionId: string,
): Promise<string[]> {
  const rows = await db
    .select({ status: mcpCallLog.status })
    .from(mcpCallLog)
    .where(
      and(
        eq(mcpCallLog.serverId, serverId),
        eq(mcpCallLog.publishedRevisionId, publishedRevisionId),
        inArray(mcpCallLog.source, ["playground", "agent"]),
      ),
    )
    .orderBy(desc(mcpCallLog.createdAt))
    .limit(5);
  return rows.map((row) => row.status);
}

async function hasSecretVariable(db: DB, serverId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: mcpServerVariable.id })
    .from(mcpServerVariable)
    .where(
      and(
        eq(mcpServerVariable.serverId, serverId),
        eq(mcpServerVariable.kind, "secret"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function lastCallAt(db: DB, serverId: string): Promise<Date | null> {
  const [row] = await db
    .select({ createdAt: mcpCallLog.createdAt })
    .from(mcpCallLog)
    .where(eq(mcpCallLog.serverId, serverId))
    .orderBy(desc(mcpCallLog.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}

export type McpServerWithMeta = McpServer & {
  trafficLight: TrafficLight;
  hasSecret: boolean;
  enabledToolCount: number;
  lastCallAt: Date | null;
  /** Same-origin access path for the attached icon asset, or null. */
  iconUrl: string | null;
};

export async function attachTrafficLight(
  db: DB,
  servers: McpServer[],
): Promise<McpServerWithMeta[]> {
  const iconUrls = await loadAssetAccessPaths(
    db,
    servers.map((server) => server.iconAssetId),
  );
  return Promise.all(
    servers.map(async (server) => {
      const [enabledToolCount, recentCallStatuses, secret, lastCall] =
        await Promise.all([
          countEnabledTools(db, server.id),
          server.publishedRevisionId
            ? recentActiveRevisionCallStatuses(
                db,
                server.id,
                server.publishedRevisionId,
              )
            : Promise.resolve([] as string[]),
          hasSecretVariable(db, server.id),
          lastCallAt(db, server.id),
        ]);
      return {
        ...server,
        iconUrl: server.iconAssetId
          ? (iconUrls.get(server.iconAssetId) ?? null)
          : null,
        hasSecret: secret,
        enabledToolCount,
        lastCallAt: lastCall,
        trafficLight: deriveTrafficLight({
          status: server.status,
          publishedRevisionId: server.publishedRevisionId,
          recentCallStatuses,
        }),
      };
    }),
  );
}

export function toRecipeTemplate(input: {
  name: string;
  description: string | null;
  baseUrl: string;
  allowedHosts: string[];
  commonEntries: McpCommonEntries | null;
  authConfiguration: McpAuthConfigurationRow | null;
  tools: Array<{
    name: string;
    title: string | null;
    description: string | null;
    method: string;
    requestDefinition: Record<string, unknown> | null;
    allowMutation: boolean;
    enabled: boolean;
    source: string;
  }>;
  variables: Array<{ name: string; kind: string; owner: string }>;
}) {
  return {
    name: input.name,
    description: input.description,
    baseUrl: input.baseUrl,
    allowedHosts: input.allowedHosts,
    commonEntries: input.commonEntries ?? { headers: [], query: [] },
    authConfiguration: input.authConfiguration,
    tools: input.tools,
    variables: input.variables,
  };
}

export async function listServers(
  db: DB,
  userId: string,
  input: PaginationInput,
  options: { allowedServerIds?: readonly string[] } = {},
): Promise<Paginated<McpServerWithMeta>> {
  if (options.allowedServerIds && options.allowedServerIds.length === 0) {
    return { items: [], page: input.page, pageSize: input.pageSize, total: 0 };
  }
  // Selected-server principals constrain both the page query and the count so
  // pagination totals never leak ungranted servers.
  const where =
    options.allowedServerIds === undefined
      ? eq(mcpServer.userId, userId)
      : and(
          eq(mcpServer.userId, userId),
          inArray(mcpServer.id, [...options.allowedServerIds]),
        );
  const page = await paginate({
    page: input.page,
    pageSize: input.pageSize,
    list: (offset, limit) =>
      db
        .select()
        .from(mcpServer)
        .where(where)
        .orderBy(desc(mcpServer.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ count: count() })
        .from(mcpServer)
        .where(where);
      return row?.count ?? 0;
    },
  });

  return {
    ...page,
    items: await attachTrafficLight(db, page.items),
  };
}

export async function createServer(
  db: DB,
  userId: string,
  input: CreateServerInput,
  credentialSecret?: string,
) {
  const parsed = parseBaseUrl(input.baseUrl);
  const baseUrl = formatBaseUrl(parsed);
  const slug = slugifyName(input.slug ?? input.name);
  const allowedHosts = deriveAllowedHosts(baseUrl);
  const auth = input.auth ?? { type: "none" as const };

  if (auth.type !== "none" && !credentialSecret) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Credential secret is required to store server authentication.",
      status: 500,
    });
  }

  // Validate the recipe before inserting so empty tokens never leave a row.
  if (auth.type !== "none") {
    recipeToMapping(auth);
  }

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(mcpServer)
        .values({
          userId,
          name: input.name.trim(),
          slug,
          description: input.description?.trim() || null,
          baseUrl,
          allowedHosts,
          status: "draft",
        })
        .returning();

      const server =
        auth.type !== "none" && credentialSecret
          ? await applyAuthRecipe(tx, created, auth, credentialSecret)
          : created;

      const [withMeta] = await attachTrafficLight(tx, [server]);
      return withMeta;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_SERVER_SLUG_CONFLICT,
        message: "A server with this slug already exists.",
        status: 409,
      });
    }
    throw error;
  }
}

async function findVariableByName(
  db: DB,
  serverId: string,
  name: string,
): Promise<McpServerVariable | undefined> {
  const [row] = await db
    .select()
    .from(mcpServerVariable)
    .where(
      and(
        eq(mcpServerVariable.serverId, serverId),
        eq(mcpServerVariable.name, name),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Finds a free slot for an auth-owned secret with the recipe's default name,
 * or a distinct name when that one is already taken by a manual value. Never
 * renames or reuses the manual row; auth always ends up owning a distinct
 * value instead. Returns the existing row when the resolved name already
 * belongs to an auth-owned (or legacy, ownerless) value, so the caller can
 * rotate it in place instead of attempting a colliding insert.
 */
async function pickAuthOwnedVariableName(
  db: DB,
  serverId: string,
  desiredName: string,
): Promise<{ name: string; existing?: McpServerVariable }> {
  let attempt = desiredName;
  let suffix = 1;
  for (;;) {
    const existing = await findVariableByName(db, serverId, attempt);
    if (!existing) return { name: attempt };
    if (existing.owner !== "manual") return { name: attempt, existing };
    suffix += 1;
    attempt = `${desiredName}_auth${suffix > 2 ? `_${suffix}` : ""}`;
  }
}

/** Upserts an auth-owned secret by row id (rotate) or creates a fresh one. */
async function upsertAuthSecretVariable(
  db: DB,
  serverId: string,
  name: string,
  plaintext: string,
  credentialSecret: string,
  existingId?: string,
): Promise<{ id: string; name: string }> {
  const ciphertext = encryptCredential(plaintext, credentialSecret);
  if (existingId) {
    const [updated] = await db
      .update(mcpServerVariable)
      .set({
        name,
        kind: "secret",
        owner: "auth",
        value: null,
        ciphertext,
      })
      .where(eq(mcpServerVariable.id, existingId))
      .returning();
    return { id: updated.id, name: updated.name };
  }
  const [created] = await db
    .insert(mcpServerVariable)
    .values({
      serverId,
      name,
      kind: "secret",
      owner: "auth",
      ciphertext,
    })
    .returning();
  return { id: created.id, name: created.name };
}

export type ServerValueReference = {
  kind: "auth" | "common" | "tool";
  id: string;
  name?: string;
};

function bindingReferencesValue(binding: unknown, valueId: string): boolean {
  return (
    !!binding &&
    typeof binding === "object" &&
    (binding as { kind?: unknown }).kind === "serverValue" &&
    (binding as { serverValueId?: unknown }).serverValueId === valueId
  );
}

/** Deep-scans a stored JSON tree (request definition or common entries) for a `serverValue` binding. */
function definitionReferencesValue(node: unknown, valueId: string): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) {
    return node.some((item) => definitionReferencesValue(item, valueId));
  }
  if (bindingReferencesValue(node, valueId)) return true;
  return Object.values(node as Record<string, unknown>).some((value) =>
    definitionReferencesValue(value, valueId),
  );
}

/** Every place (auth, common values, or a tool) that currently uses this server value. */
export async function findServerValueReferences(
  db: DB,
  server: McpServer,
  valueId: string,
): Promise<ServerValueReference[]> {
  const references: ServerValueReference[] = [];

  const authConfig = server.authConfiguration as McpAuthConfigurationRow | null;
  if (
    authConfig &&
    (authConfig.bindings.some((binding) => binding.serverValueId === valueId) ||
      authConfig.basicUsernameValueId === valueId ||
      authConfig.basicPasswordValueId === valueId)
  ) {
    references.push({ kind: "auth", id: server.id, name: "Authentication" });
  }

  const commonEntries = server.commonEntries as {
    headers: McpNamedEntryRow[];
    query: McpNamedEntryRow[];
  } | null;
  const commonHit =
    !!commonEntries &&
    [...commonEntries.headers, ...commonEntries.query].some((entry) =>
      bindingReferencesValue(entry.value, valueId),
    );
  if (commonHit) {
    references.push({ kind: "common", id: server.id, name: "Common values" });
  }

  const tools = await db
    .select({
      id: mcpTool.id,
      name: mcpTool.name,
      requestDefinition: mcpTool.requestDefinition,
    })
    .from(mcpTool)
    .where(eq(mcpTool.serverId, server.id));

  for (const tool of tools) {
    if (definitionReferencesValue(tool.requestDefinition, valueId)) {
      references.push({ kind: "tool", id: tool.id, name: tool.name });
    }
  }

  return references;
}

/**
 * Whether a tool is currently persisted as enabled. Used by Platform publish
 * classification to decide if a candidate update is runtime-effective.
 */
export async function getToolEnabledState(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
): Promise<boolean> {
  await requireOwnedServer(db, userId, serverId);
  const [tool] = await db
    .select({ enabled: mcpTool.enabled })
    .from(mcpTool)
    .where(and(eq(mcpTool.id, toolId), eq(mcpTool.serverId, serverId)))
    .limit(1);
  if (!tool) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
      message: "MCP tool not found.",
      status: 404,
    });
  }
  return tool.enabled;
}

/**
 * Whether changing a named server value would alter runtime behavior: the
 * value is referenced by a tool that is currently enabled (a compiled plan), or
 * by server common/auth configuration consumed by an enabled tool.
 */
export async function isServerValueRuntimeEffective(
  db: DB,
  userId: string,
  serverId: string,
  valueName: string,
): Promise<boolean> {
  const server = await requireOwnedServer(db, userId, serverId);
  const variable = await findVariableByName(db, server.id, valueName);
  if (!variable) return false;

  const references = await findServerValueReferences(db, server, variable.id);
  if (references.length === 0) return false;

  const enabledTools = await db
    .select({ id: mcpTool.id })
    .from(mcpTool)
    .where(and(eq(mcpTool.serverId, server.id), eq(mcpTool.enabled, true)));
  if (enabledTools.length === 0) return false;

  const enabledIds = new Set(enabledTools.map((tool) => tool.id));
  return references.some((reference) =>
    reference.kind === "tool"
      ? enabledIds.has(reference.id)
      : // Common/auth references are compiled into every enabled tool.
        true,
  );
}

/** Header/query keys currently owned by authentication; never overridable elsewhere. */
function protectedAuthKeys(server: McpServer): {
  headers: Set<string>;
  query: Set<string>;
} {
  const authConfig = server.authConfiguration as McpAuthConfigurationRow | null;
  const headers = new Set<string>();
  const query = new Set<string>();
  for (const binding of authConfig?.bindings ?? []) {
    if (binding.location === "header") headers.add(binding.key.toLowerCase());
    else query.add(binding.key);
  }
  return { headers, query };
}

function parseCommonEntries(server: McpServer): McpCommonEntries {
  if (!server.commonEntries) return { headers: [], query: [] };
  const parsed = mcpCommonEntriesSchema.safeParse(server.commonEntries);
  return parsed.success ? parsed.data : { headers: [], query: [] };
}

function parseAuthConfiguration(raw: unknown): McpAuthConfiguration | null {
  if (!raw) return null;
  const parsed = mcpAuthConfigurationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Apply an auth recipe onto an already-loaded server row inside a transaction.
 * Persists only the explicit `authConfiguration` referencing auth-owned secret
 * ids. Secrets are always created/rotated with `owner: "auth"`; a manual value
 * with a colliding name is never reused, overwritten, or deleted — auth picks
 * a distinct name instead. `none` clears every auth-owned binding (including
 * Custom multi-key setups) but never touches a manual value.
 */
export async function applyAuthRecipe(
  db: DB,
  server: McpServer,
  recipe: ServerAuthRecipe,
  credentialSecret: string,
): Promise<McpServer> {
  if (recipe.type === "query" && !recipe.queryExposureAcknowledged) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_AUTH_ACK_REQUIRED,
      message:
        "Placing authentication in the query string requires explicit exposure acknowledgement.",
      status: 400,
    });
  }

  const mapping = recipeToMapping(recipe);
  const previousAuthConfig =
    (server.authConfiguration as McpAuthConfigurationRow | null) ?? null;

  const previousOwnedValueIds = new Set<string>();
  for (const binding of previousAuthConfig?.bindings ?? []) {
    previousOwnedValueIds.add(binding.serverValueId);
  }
  if (previousAuthConfig?.basicUsernameValueId) {
    previousOwnedValueIds.add(previousAuthConfig.basicUsernameValueId);
  }
  if (previousAuthConfig?.basicPasswordValueId) {
    previousOwnedValueIds.add(previousAuthConfig.basicPasswordValueId);
  }

  let authConfiguration: McpAuthConfigurationRow | null = null;
  let ownedRowId: string | undefined;

  if (mapping.variableName && mapping.plaintext !== null) {
    const previousId = previousAuthConfig?.bindings[0]?.serverValueId;

    let previousRow: McpServerVariable | undefined;
    if (previousId) {
      previousRow = await db
        .select()
        .from(mcpServerVariable)
        .where(
          and(
            eq(mcpServerVariable.id, previousId),
            eq(mcpServerVariable.serverId, server.id),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);
    }

    // Rotate the same row only when it is still auth-owned *and* the recipe
    // did not change the target name (e.g. bearer -> bearer with a new
    // token). Any other case — including a recipe-type switch — resolves a
    // fresh, possibly renamed, auth-owned slot so a leftover row from the
    // previous recipe never gets silently repurposed under the wrong name.
    const canReuse =
      !!previousRow &&
      previousRow.owner !== "manual" &&
      previousRow.name === mapping.variableName;

    let variableName = mapping.variableName;
    let targetRow = previousRow;
    if (!canReuse) {
      const resolved = await pickAuthOwnedVariableName(
        db,
        server.id,
        mapping.variableName,
      );
      variableName = resolved.name;
      targetRow = resolved.existing;
    }

    const ownedRow = await upsertAuthSecretVariable(
      db,
      server.id,
      variableName,
      mapping.plaintext,
      credentialSecret,
      targetRow?.id,
    );
    ownedRowId = ownedRow.id;

    const prefix =
      recipe.type === "bearer"
        ? "Bearer "
        : recipe.type === "basic"
          ? "Basic "
          : "";
    authConfiguration = {
      kind: recipe.type,
      bindings: [
        ...mapping.headerKeys.map((key) => ({
          location: "header" as const,
          key,
          serverValueId: ownedRow.id,
          ...(prefix ? { prefix } : {}),
        })),
        ...mapping.queryKeys.map((key) => ({
          location: "query" as const,
          key,
          serverValueId: ownedRow.id,
          ...(prefix ? { prefix } : {}),
        })),
      ],
      ...(recipe.type === "query" ? { queryExposureAcknowledged: true } : {}),
    };
  }

  const [updated] = await db
    .update(mcpServer)
    .set({
      authConfiguration,
      updatedAt: new Date(),
    })
    .where(eq(mcpServer.id, server.id))
    .returning();

  for (const id of previousOwnedValueIds) {
    if (id === ownedRowId) continue;
    const [row] = await db
      .select()
      .from(mcpServerVariable)
      .where(eq(mcpServerVariable.id, id))
      .limit(1);
    if (!row || row.owner === "manual") continue;
    const references = await findServerValueReferences(db, updated, row.id);
    if (references.length > 0) continue;
    if (row.kind === "secret") {
      await assertActiveRevisionDoesNotReferenceSecret(
        db,
        updated,
        row.id,
        "deleted",
      );
    }
    await db.delete(mcpServerVariable).where(eq(mcpServerVariable.id, row.id));
  }

  return updated;
}

export async function setServerAuth(
  db: DB,
  userId: string,
  serverId: string,
  expectedRevision: number,
  recipe: ServerAuthRecipe,
  credentialSecret: string,
) {
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision },
    async (ctx) => {
      const updated = await applyAuthRecipe(
        ctx.tx,
        ctx.server,
        recipe,
        credentialSecret,
      );
      await recompileEnabledToolsForServer(ctx.tx, updated);
      const [withMeta] = await attachTrafficLight(ctx.tx, [updated]);
      return {
        ...withMeta,
        auth: describeServerAuth(updated),
      };
    },
    { draftMutation: true },
  );
  return { ...result, revision };
}

/**
 * Auth summary derived from the explicit configuration (name/key only, never
 * the secret value). `protectedKeys` lists header/query keys owned by
 * authentication so Studio editors can mark them read-only elsewhere.
 */
export function describeServerAuth(server: McpServer): {
  type: McpAuthConfigurationRow["kind"];
  protectedKeys: { headers: string[]; query: string[] };
} {
  const authConfig = server.authConfiguration as McpAuthConfigurationRow | null;
  const headers: string[] = [];
  const query: string[] = [];
  for (const binding of authConfig?.bindings ?? []) {
    if (binding.location === "header") headers.push(binding.key);
    else query.push(binding.key);
  }
  return {
    type: authConfig?.kind ?? "none",
    protectedKeys: { headers, query },
  };
}

/** Lightweight name lookups used to verify destructive-op confirmation strings. */
export async function getServerName(
  db: DB,
  userId: string,
  serverId: string,
): Promise<string> {
  const server = await requireOwnedServer(db, userId, serverId);
  return server.name;
}

export async function getToolName(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
): Promise<string> {
  await requireOwnedServer(db, userId, serverId);
  const [tool] = await db
    .select({ name: mcpTool.name })
    .from(mcpTool)
    .where(and(eq(mcpTool.id, toolId), eq(mcpTool.serverId, serverId)))
    .limit(1);
  if (!tool) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
      message: "MCP tool not found.",
      status: 404,
    });
  }
  return tool.name;
}

/**
 * Authoritative compiled HTTP method for a tool, used to classify invocation
 * authority independently of caller-provided annotations.
 */
export async function getToolMethod(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
): Promise<string> {
  await requireOwnedServer(db, userId, serverId);
  const [tool] = await db
    .select({ method: mcpTool.method })
    .from(mcpTool)
    .where(and(eq(mcpTool.id, toolId), eq(mcpTool.serverId, serverId)))
    .limit(1);
  if (!tool) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
      message: "MCP tool not found.",
      status: 404,
    });
  }
  return tool.method;
}

export async function getServer(db: DB, userId: string, serverId: string) {
  const server = await requireOwnedServer(db, userId, serverId);
  const [withMeta] = await attachTrafficLight(db, [server]);
  const tools = await db
    .select()
    .from(mcpTool)
    .where(eq(mcpTool.serverId, server.id))
    .orderBy(desc(mcpTool.createdAt));
  const variables = await listVariables(db, userId, server.id);

  const aggregate = await loadDraftAggregate(db, { userId, serverId });
  const candidate = buildPublicationCandidate(aggregate);
  const activeRevision = server.publishedRevisionId
    ? await loadRevisionSummary(db, server.id, server.publishedRevisionId)
    : null;

  const publishedToolRows = server.publishedRevisionId
    ? await db
        .select({
          sourceToolId: mcpServerRevisionTool.sourceToolId,
          name: mcpServerRevisionTool.name,
          title: mcpServerRevisionTool.title,
          description: mcpServerRevisionTool.description,
          method: mcpServerRevisionTool.method,
          requestDefinition: mcpServerRevisionTool.requestDefinition,
          allowMutation: mcpServerRevisionTool.allowMutation,
          enabled: mcpServerRevisionTool.enabled,
        })
        .from(mcpServerRevisionTool)
        .where(eq(mcpServerRevisionTool.revisionId, server.publishedRevisionId))
    : [];

  return {
    ...withMeta,
    tools,
    variables,
    limits: { maxToolsPerServer: getMcpMaxToolsPerServer() },
    publishedRevisionNumber: activeRevision?.revisionNumber ?? null,
    publishedTools: publishedToolRows
      .filter((entry) => entry.enabled)
      .map((entry) => ({
        id: entry.sourceToolId,
        name: entry.name,
        title: entry.title,
        description: entry.description,
        method: entry.method,
        requestDefinition: entry.requestDefinition,
        allowMutation: entry.allowMutation,
      })),
    dirty: activeRevision
      ? activeRevision.candidateFingerprint !== candidate.candidateFingerprint
      : true,
    publishReady: candidate.ready,
    auth: describeServerAuth(server),
    recipe: toRecipeTemplate({
      name: server.name,
      description: server.description,
      baseUrl: server.baseUrl,
      allowedHosts: server.allowedHosts,
      commonEntries: (server.commonEntries as McpCommonEntries | null) ?? null,
      authConfiguration:
        (server.authConfiguration as McpAuthConfigurationRow | null) ?? null,
      tools,
      variables: variables.map(({ name, kind, owner }) => ({
        name,
        kind,
        owner,
      })),
    }),
  };
}

export async function updateServer(
  db: DB,
  userId: string,
  serverId: string,
  input: UpdateServerInput,
) {
  const draftMutation = PUBLISHABLE_SERVER_FIELDS.some(
    (field) => input[field] !== undefined,
  );
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const server = ctx.server;
      const nextBaseUrl = input.baseUrl
        ? formatBaseUrl(parseBaseUrl(input.baseUrl))
        : server.baseUrl;
      const allowedHosts = input.allowedHosts
        ? deriveAllowedHosts(nextBaseUrl, input.allowedHosts)
        : input.baseUrl
          ? deriveAllowedHosts(nextBaseUrl, server.allowedHosts)
          : server.allowedHosts;

      const previousIconAssetId = server.iconAssetId ?? null;
      let nextIconAssetId = previousIconAssetId;
      if (input.iconAssetId !== undefined) {
        if (input.iconAssetId === null) {
          nextIconAssetId = null;
        } else if (input.iconAssetId !== previousIconAssetId) {
          const asset = await requireAttachableAsset(
            ctx.tx,
            userId,
            input.iconAssetId,
          );
          nextIconAssetId = asset.id;
          await markAssetAttached(ctx.tx, userId, asset.id);
        }
      }

      const [updated] = await ctx.tx
        .update(mcpServer)
        .set({
          name: input.name?.trim() ?? server.name,
          description:
            input.description === undefined
              ? server.description
              : input.description?.trim() || null,
          iconAssetId: nextIconAssetId,
          baseUrl: nextBaseUrl,
          allowedHosts,
          status: input.status ?? server.status,
        })
        .where(eq(mcpServer.id, server.id))
        .returning();

      if (previousIconAssetId && previousIconAssetId !== nextIconAssetId) {
        await markAssetsDeletePending(ctx.tx, [previousIconAssetId]);
      }

      const [withMeta] = await attachTrafficLight(ctx.tx, [updated]);
      return withMeta;
    },
    { draftMutation },
  );

  return { ...result, revision };
}

/** Reads the canonical typed common entries for a server. */
export async function getServerCommon(
  db: DB,
  userId: string,
  serverId: string,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  return { common: parseCommonEntries(server) };
}

/**
 * Canonically writes ordered typed common entries and atomically refreshes
 * every affected enabled tool's compiled plan. Rejects with per-tool
 * diagnostics and writes nothing when any enabled tool becomes invalid.
 */
export async function updateServerCommon(
  db: DB,
  userId: string,
  serverId: string,
  input: { expectedRevision: number; common: McpCommonEntries },
) {
  const parsedCommon = mcpCommonEntriesSchema.parse(input.common);
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => applyServerCommonWrite(ctx.tx, ctx.server, parsedCommon),
    { draftMutation: true },
  );
  return { ...result, revision };
}

/**
 * Candidate-aggregate write for common entries: validates, compiles every
 * affected enabled tool against the candidate configuration, and persists the
 * source change plus all compiled plans in the caller's transaction.
 */
async function applyServerCommonWrite(
  db: DB,
  server: McpServer,
  parsedCommon: McpCommonEntries,
) {
  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const serverValueById = new Map(serverValues.map((v) => [v.id, v]));
  const protectedKeys = protectedAuthKeys(server);

  const issues: McpCompileIssue[] = [];
  const pushIssue = (
    path: string,
    code: string,
    message: string,
    id?: string,
  ) => {
    issues.push({
      path,
      code,
      message,
      severity: "error",
      ...(id ? { id } : {}),
    });
  };

  const validateEntries = (
    entries: McpNamedEntry[],
    location: "headers" | "query",
  ) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const path = `common.${location}[${index}]`;
      const key =
        location === "headers" ? entry.name.toLowerCase() : entry.name;
      if (seen.has(key)) {
        pushIssue(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `Repeated common ${location} name "${entry.name}".`,
          entry.id,
        );
      }
      seen.add(key);
      if (location === "headers" && isForbiddenTransportHeaderName(key)) {
        pushIssue(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `"${entry.name}" is a forbidden transport header.`,
          entry.id,
        );
      }
      if (location === "headers" && protectedKeys.headers.has(key)) {
        pushIssue(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `"${entry.name}" is owned by authentication and cannot be set here.`,
          entry.id,
        );
      }
      if (location === "query" && protectedKeys.query.has(entry.name)) {
        pushIssue(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `"${entry.name}" is owned by authentication and cannot be set here.`,
          entry.id,
        );
      }
      if (
        entry.value.kind === "serverValue" &&
        !serverValueById.has(entry.value.serverValueId)
      ) {
        pushIssue(
          path,
          APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
          `Server value "${entry.value.serverValueId}" does not exist on this server.`,
          entry.id,
        );
      }
    });
  };

  validateEntries(parsedCommon.headers, "headers");
  validateEntries(parsedCommon.query, "query");
  issues.push(
    ...collectPlaintextCredentialIssues(parsedCommon.headers, "headers"),
    ...collectPlaintextCredentialIssues(parsedCommon.query, "query"),
  );

  if (issues.some((issue) => issue.severity === "error")) {
    const first =
      issues.find((issue) => issue.severity === "error") ?? issues[0];
    throw appError({
      appCode:
        first && isAppErrorCode(first.code)
          ? first.code
          : APP_ERROR_CODES.MCP_COMPILE_INVALID,
      message: first?.message ?? "The common request values are invalid.",
      status: 400,
      details: {
        ...(first?.path !== undefined ? { path: first.path } : {}),
        ...(first?.id !== undefined ? { nodeId: first.id } : {}),
        ...(first?.code !== undefined ? { issueCode: first.code } : {}),
      },
    });
  }

  const authConfiguration = parseAuthConfiguration(server.authConfiguration);
  const basePath = (() => {
    try {
      return new URL(server.baseUrl).pathname || "/";
    } catch {
      return "/";
    }
  })();

  const enabledTools = await db
    .select()
    .from(mcpTool)
    .where(and(eq(mcpTool.serverId, server.id), eq(mcpTool.enabled, true)));

  const maxToolsPerServer = getMcpMaxToolsPerServer();
  if (enabledTools.length > maxToolsPerServer) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: `A server cannot have more than ${maxToolsPerServer} enabled tools.`,
      status: 400,
    });
  }

  const toolFailures: Array<{ toolId: string; name: string }> = [];
  const compiledUpdates: Array<{
    toolId: string;
    plan: Record<string, unknown> | null;
    issues: McpCompileIssue[];
    annotations: Record<string, unknown> | null;
  }> = [];

  for (const tool of enabledTools) {
    const parsedDefinition = tool.requestDefinition
      ? mcpRequestDefinitionSchema.safeParse(tool.requestDefinition)
      : null;
    if (!parsedDefinition?.success) {
      toolFailures.push({ toolId: tool.id, name: tool.name });
      continue;
    }
    const result = compileToolDefinition({
      method: tool.method,
      definition: parsedDefinition.data,
      common: parsedCommon,
      auth: authConfiguration,
      serverValues,
      basePath,
      allowMutation: tool.allowMutation,
    });
    if (!result.ok) {
      toolFailures.push({ toolId: tool.id, name: tool.name });
      continue;
    }
    compiledUpdates.push({
      toolId: tool.id,
      plan: result.plan as unknown as Record<string, unknown>,
      issues: result.issues,
      annotations:
        (result.plan?.annotations as Record<string, unknown> | undefined) ??
        null,
    });
  }

  if (toolFailures.length > 0) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
      message:
        "The common request values would invalidate enabled tools; no changes were saved.",
      status: 409,
      details: {
        references: toolFailures.map((failure) => ({
          kind: "tool",
          id: failure.toolId,
          name: failure.name,
        })),
      },
    });
  }

  await db
    .update(mcpServer)
    .set({
      commonEntries: parsedCommon as unknown as {
        headers: McpNamedEntryRow[];
        query: McpNamedEntryRow[];
      },
    })
    .where(eq(mcpServer.id, server.id));

  for (const update of compiledUpdates) {
    await db
      .update(mcpTool)
      .set({
        compiledPlan: update.plan,
        compileIssues: update.issues,
        annotations: update.annotations,
        compileStatus: "valid",
      })
      .where(eq(mcpTool.id, update.toolId));
  }

  return {
    common: parsedCommon,
    affectedToolCount: enabledTools.length,
  };
}

/**
 * Deletes a server and every row that belongs to it. Call logs are removed
 * explicitly (their FK is `set null`) so no invisible rows survive. The
 * attached icon asset is marked for durable post-commit cleanup.
 */
export async function deleteServer(
  db: DB,
  userId: string,
  serverId: string,
  expectedRevision: number,
) {
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision },
    async (ctx) => {
      const server = ctx.server;
      await markAssetsDeletePending(ctx.tx, [server.iconAssetId]);
      await ctx.tx.delete(mcpCallLog).where(eq(mcpCallLog.serverId, server.id));
      await ctx.tx.delete(mcpTool).where(eq(mcpTool.serverId, server.id));
      await ctx.tx
        .delete(mcpServerVariable)
        .where(eq(mcpServerVariable.serverId, server.id));
      await ctx.tx
        .delete(mcpAgentToken)
        .where(eq(mcpAgentToken.serverId, server.id));
      await ctx.tx.delete(mcpServer).where(eq(mcpServer.id, server.id));
      return { id: server.id, deleted: true as const };
    },
    { finalizeRevision: false },
  );
  return { ...result, revision };
}

async function promoteServerIfReady(
  db: DB,
  serverId: string,
  currentStatus: string,
) {
  if (currentStatus !== "draft") return;
  const enabled = await countEnabledTools(db, serverId);
  if (enabled > 0) {
    await db
      .update(mcpServer)
      .set({ status: "live" })
      .where(eq(mcpServer.id, serverId));
  }
}

export async function listTools(
  db: DB,
  userId: string,
  serverId: string,
  input: PaginationInput & { group?: string; q?: string },
) {
  await requireOwnedServer(db, userId, serverId);
  const q = normalizeSearchQuery(input.q);
  const conditions = [
    eq(mcpTool.serverId, serverId),
    q ? ilike(mcpTool.name, likeContainsPattern(q)) : undefined,
  ];
  if (input.group === MCP_TOOL_GROUP_FILTER_UNGROUPED) {
    conditions.push(isNull(mcpTool.groupId));
  } else if (
    input.group !== undefined &&
    input.group !== MCP_TOOL_GROUP_FILTER_ALL
  ) {
    conditions.push(eq(mcpTool.groupId, input.group));
  }
  // One predicate for the page and the count, so the two can never diverge.
  const where = and(...conditions);
  return paginate({
    page: input.page,
    pageSize: input.pageSize,
    list: (offset, limit) =>
      db
        .select()
        .from(mcpTool)
        .where(where)
        .orderBy(desc(mcpTool.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ count: count() })
        .from(mcpTool)
        .where(where);
      return row?.count ?? 0;
    },
  });
}

async function assertToolCapacity(db: DB, serverId: string) {
  const [row] = await db
    .select({ count: count() })
    .from(mcpTool)
    .where(eq(mcpTool.serverId, serverId));
  const limit = getMcpMaxToolsPerServer();
  if ((row?.count ?? 0) >= limit) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: `A server cannot have more than ${limit} tools.`,
      status: 400,
    });
  }
}

/**
 * Owner-scoped group lookup inside the caller's transaction. The same-server
 * predicate is mandatory so a foreign group is indistinguishable from a
 * missing one.
 */
async function findOwnedGroupId(
  db: DB,
  serverId: string,
  groupId: string,
): Promise<string | null> {
  const [group] = await db
    .select({ id: mcpToolGroup.id })
    .from(mcpToolGroup)
    .where(
      and(eq(mcpToolGroup.id, groupId), eq(mcpToolGroup.serverId, serverId)),
    )
    .limit(1);
  return group?.id ?? null;
}

/**
 * Resolves an optional placement. `null` or an absent value means ungrouped; a
 * missing, stale, or foreign group fails as not found without revealing whether
 * the group exists elsewhere.
 */
async function resolveGroupPlacement(
  db: DB,
  serverId: string,
  groupId: string | null | undefined,
): Promise<string | null> {
  if (typeof groupId !== "string" || groupId.length === 0) return null;
  const found = await findOwnedGroupId(db, serverId, groupId);
  if (!found) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
      message: "MCP tool group not found.",
      status: 404,
      details: { serverId },
    });
  }
  return found;
}

/** Translate a tool-name uniqueness violation to a stable, secret-safe conflict. */
function rethrowToolNameConflict(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
      message: "A tool with this name already exists on the server.",
      status: 409,
    });
  }
  throw error;
}

/**
 * Typed entries may bind a server value, but a literal credential-shaped value
 * must still reference a variable rather than embed a plaintext secret.
 */
function collectPlaintextCredentialIssues(
  entries: McpNamedEntry[],
  location: "headers" | "query",
): McpCompileIssue[] {
  const issues: McpCompileIssue[] = [];
  entries.forEach((entry, index) => {
    if (entry.value.kind !== "literal") return;
    const credentialKey =
      location === "headers"
        ? isAuthHeaderName(entry.name)
        : isCredentialQueryName(entry.name);
    if (!credentialKey) return;
    const value = entry.value.value;
    if (typeof value === "string" && !value.includes("{{")) {
      issues.push({
        path: `${location}[${index}]`,
        id: entry.id,
        code: APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
        message: `${location === "headers" ? "Header" : "Query parameter"} "${entry.name}" looks credential-related. Store the secret in a secret variable and reference it instead of embedding it literally.`,
        severity: "error",
      });
    }
  });
  return issues;
}

type CompiledToolPersistence = {
  requestDefinition: Record<string, unknown> | null;
  compiledPlan: Record<string, unknown> | null;
  compileStatus: "valid" | "invalid";
  compileIssues: Array<{
    path: string;
    id?: string;
    code: string;
    message: string;
    severity: "error" | "warning";
  }>;
  annotations: Record<string, unknown> | null;
  enabled: boolean;
};

function throwTypedCompileInvalid(
  issues: CompiledToolPersistence["compileIssues"],
): never {
  const first = issues.find((issue) => issue.severity === "error") ?? issues[0];
  throw appError({
    appCode:
      first && isAppErrorCode(first.code)
        ? first.code
        : APP_ERROR_CODES.MCP_COMPILE_INVALID,
    message:
      first?.message ?? "The typed request definition failed to compile.",
    status: 400,
    details: {
      ...(first?.path !== undefined ? { path: first.path } : {}),
      ...(first?.id !== undefined ? { nodeId: first.id } : {}),
      ...(first?.code !== undefined ? { issueCode: first.code } : {}),
    },
  });
}

type TypedToolPersistence = CompiledToolPersistence & {
  ok: boolean;
  /** Compiled agent-visible contract, or null when compilation is not ready. */
  contract: McpAgentToolContract | null;
};

/**
 * Validates server-value references against the selected server's catalog and
 * compiles the typed definition with the candidate common entries and auth
 * configuration. Pure with respect to the tool row: performs no writes.
 */
async function compileTypedToolForPersistence(
  db: DB,
  server: McpServer,
  input: {
    name: string;
    title?: string | null;
    description?: string | null;
    method: McpHttpMethod;
    definition: McpRequestDefinition;
    allowMutation: boolean;
    enabled: boolean;
  },
  emitTelemetry?: CompileTelemetryEmitter,
): Promise<TypedToolPersistence> {
  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const commonEntries = parseCommonEntries(server);
  const authConfiguration = parseAuthConfiguration(server.authConfiguration);
  const basePath = (() => {
    try {
      return new URL(server.baseUrl).pathname || "/";
    } catch {
      return "/";
    }
  })();

  const compileResult = compileToolDefinition({
    method: input.method,
    definition: input.definition,
    common: commonEntries,
    auth: authConfiguration,
    serverValues,
    basePath,
    allowMutation: input.allowMutation,
  });

  const plaintextSecretIssues = [
    ...collectPlaintextCredentialIssues(input.definition.headers, "headers"),
    ...collectPlaintextCredentialIssues(input.definition.query, "query"),
  ];
  const compileIssues: CompiledToolPersistence["compileIssues"] = [
    ...compileResult.issues,
    ...plaintextSecretIssues,
  ];

  const contractResult =
    compileResult.ok && compileResult.plan
      ? compileAgentToolContract({
          name: input.name,
          title: input.title,
          description: input.description,
          method: input.method,
          plan: compileResult.plan,
        })
      : null;
  if (contractResult) {
    compileIssues.push(...contractResult.issues);
  }

  const emit: CompileTelemetryEmitter =
    emitTelemetry ??
    ((event, properties) =>
      captureMcpTelemetry(event, { db, userId: server.userId, properties }));

  const ok =
    compileResult.ok &&
    plaintextSecretIssues.length === 0 &&
    contractResult?.ok === true;
  if (!ok) {
    emit(MCP_TELEMETRY_EVENTS.typedCompileFailed, {
      serverId: server.id,
      method: input.method,
      issueCodes: compileResult.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code)
        .slice(0, 10),
    });
  }

  return {
    requestDefinition: input.definition as unknown as Record<string, unknown>,
    compiledPlan:
      (compileResult.plan as Record<string, unknown> | null) ?? null,
    compileStatus: ok ? "valid" : "invalid",
    compileIssues,
    annotations:
      (compileResult.plan?.annotations as
        Record<string, unknown> | undefined) ?? null,
    enabled: ok && input.enabled,
    ok,
    contract: contractResult?.contract ?? null,
  };
}

function assertSupportedMethod(method: McpHttpMethod): void {
  if (![...READ_METHODS, ...MUTATING_METHODS].includes(method)) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Unsupported HTTP method.",
      status: 400,
    });
  }
}

/** Canonical typed create; persists definition, plan, status, and issues atomically. */
export async function createTool(
  db: DB,
  userId: string,
  serverId: string,
  input: CreateTypedToolInput,
  source: McpToolSource = "manual",
) {
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const server = ctx.server;
      await assertToolCapacity(ctx.tx, server.id);
      const name = toMcpToolName(input.name);
      const method = input.method.toUpperCase() as McpHttpMethod;
      assertSupportedMethod(method);
      const flags = mutationDefaults(
        method,
        input.allowMutation,
        input.enabled,
      );
      const groupId = await resolveGroupPlacement(
        ctx.tx,
        server.id,
        input.groupId,
      );
      const emit = bufferCompileTelemetry(db, userId, ctx.onCommit);
      const compiled = await compileTypedToolForPersistence(
        ctx.tx,
        server,
        {
          name,
          title: input.title,
          description: input.description,
          method,
          definition: input.requestDefinition,
          allowMutation: flags.allowMutation,
          enabled: flags.enabled,
        },
        emit,
      );
      if (!compiled.ok && flags.enabled)
        throwTypedCompileInvalid(compiled.compileIssues);

      try {
        const [created] = await ctx.tx
          .insert(mcpTool)
          .values({
            serverId: server.id,
            name,
            title: input.title?.trim() || null,
            description: input.description?.trim() || null,
            method,
            requestDefinition: compiled.requestDefinition,
            compiledPlan: compiled.compiledPlan,
            compileStatus: compiled.compileStatus,
            compileIssues: compiled.compileIssues,
            annotations: compiled.annotations,
            allowMutation: flags.allowMutation,
            enabled: compiled.enabled,
            source,
            groupId,
          })
          .returning();
        await promoteServerIfReady(ctx.tx, server.id, server.status);
        return {
          ...created,
          compileIssues: compiled.compileIssues,
        };
      } catch (error) {
        rethrowToolNameConflict(error);
      }
    },
    { draftMutation: true },
  );
  return { ...result, revision };
}

/** Dry-run typed compile preview: no persistence, no legacy template translation. */
export async function previewToolCompile(
  db: DB,
  userId: string,
  serverId: string,
  input: {
    name?: string;
    title?: string | null;
    description?: string | null;
    method: McpHttpMethod;
    requestDefinition: McpRequestDefinition;
    allowMutation?: boolean;
  },
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const method = input.method.toUpperCase() as McpHttpMethod;
  assertSupportedMethod(method);
  const flags = mutationDefaults(method, input.allowMutation, false);
  const compiled = await compileTypedToolForPersistence(db, server, {
    name: input.name ? toMcpToolName(input.name) : "tool",
    title: input.title,
    description: input.description,
    method,
    definition: input.requestDefinition,
    allowMutation: flags.allowMutation,
    enabled: false,
  });
  return {
    ok: compiled.ok,
    ready: compiled.ok,
    issues: compiled.compileIssues,
    plan: redactSensitiveExamples(compiled.compiledPlan) as Record<
      string,
      unknown
    > | null,
    contract: compiled.contract
      ? toSerializableContract(compiled.contract)
      : null,
  };
}

/** Loads a tool for editing from its canonical typed definition. */
export async function getToolEditorState(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
) {
  await requireOwnedServer(db, userId, serverId);
  const [tool] = await db
    .select()
    .from(mcpTool)
    .where(and(eq(mcpTool.id, toolId), eq(mcpTool.serverId, serverId)))
    .limit(1);
  if (!tool) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
      message: "MCP tool not found.",
      status: 404,
    });
  }

  const issueRows = (tool.compileIssues ??
    []) as CompiledToolPersistence["compileIssues"];
  const parsed = tool.requestDefinition
    ? mcpRequestDefinitionSchema.safeParse(tool.requestDefinition)
    : null;
  return {
    toolId: tool.id,
    typed: parsed?.success === true,
    definition: parsed?.success ? parsed.data : null,
    method: tool.method,
    name: tool.name,
    title: tool.title,
    description: tool.description,
    enabled: tool.enabled,
    allowMutation: tool.allowMutation,
    compileIssues: issueRows,
  };
}

/** Canonical typed update; preserves definition-local ids from the payload. */
export async function updateTool(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
  input: UpdateTypedToolInput,
) {
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const server = ctx.server;
      const [existing] = await ctx.tx
        .select()
        .from(mcpTool)
        .where(and(eq(mcpTool.id, toolId), eq(mcpTool.serverId, serverId)))
        .limit(1);
      if (!existing) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
          message: "MCP tool not found.",
          status: 404,
        });
      }

      const method = (
        input.method ?? existing.method
      ).toUpperCase() as McpHttpMethod;
      assertSupportedMethod(method);

      let definition: McpRequestDefinition;
      if (input.requestDefinition !== undefined) {
        definition = input.requestDefinition;
      } else if (existing.requestDefinition) {
        const parsed = mcpRequestDefinitionSchema.safeParse(
          existing.requestDefinition,
        );
        if (!parsed.success) {
          throw appError({
            appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
            message: "The stored request definition is invalid.",
            status: 409,
          });
        }
        definition = parsed.data;
      } else {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
          message: "This tool has no typed request definition.",
          status: 409,
        });
      }

      const flags = mutationDefaults(
        method,
        input.allowMutation ?? existing.allowMutation,
        input.enabled ?? existing.enabled,
      );
      const nextName = input.name ? toMcpToolName(input.name) : existing.name;
      const nextTitle =
        input.title === undefined
          ? existing.title
          : input.title?.trim() || null;
      const nextDescription =
        input.description === undefined
          ? existing.description
          : input.description?.trim() || null;
      // Only an explicit `groupId` key touches the assignment, so an unrelated
      // edit can never silently move the tool.
      const placement =
        input.groupId === undefined
          ? undefined
          : await resolveGroupPlacement(ctx.tx, server.id, input.groupId);
      const emit = bufferCompileTelemetry(db, userId, ctx.onCommit);
      const compiled = await compileTypedToolForPersistence(
        ctx.tx,
        server,
        {
          name: nextName,
          title: nextTitle,
          description: nextDescription,
          method,
          definition,
          allowMutation: flags.allowMutation,
          enabled: flags.enabled,
        },
        emit,
      );
      if (!compiled.ok && flags.enabled)
        throwTypedCompileInvalid(compiled.compileIssues);

      try {
        const [updated] = await ctx.tx
          .update(mcpTool)
          .set({
            name: nextName,
            title: nextTitle,
            description: nextDescription,
            method,
            requestDefinition: compiled.requestDefinition,
            compiledPlan: compiled.compiledPlan,
            compileStatus: compiled.compileStatus,
            compileIssues: compiled.compileIssues,
            annotations: compiled.annotations,
            allowMutation: flags.allowMutation,
            enabled: compiled.enabled,
            ...(placement !== undefined ? { groupId: placement } : {}),
          })
          .where(eq(mcpTool.id, existing.id))
          .returning();
        await promoteServerIfReady(ctx.tx, server.id, server.status);
        return {
          ...updated,
          compileIssues: compiled.compileIssues,
        };
      } catch (error) {
        rethrowToolNameConflict(error);
      }
    },
    { draftMutation: true },
  );
  return { ...result, revision };
}

/** Duplicates a tool, regenerating definition-local ids and preserving server-value ids. */
export async function duplicateTool(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
  input: DuplicateTypedToolInput,
) {
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const server = ctx.server;
      const [existing] = await ctx.tx
        .select()
        .from(mcpTool)
        .where(and(eq(mcpTool.id, toolId), eq(mcpTool.serverId, serverId)))
        .limit(1);
      if (!existing) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
          message: "MCP tool not found.",
          status: 404,
        });
      }
      await assertToolCapacity(ctx.tx, server.id);
      // The copy inherits the source placement only while that group still
      // exists on this server; a deleted or stale group degrades to ungrouped.
      const groupId = existing.groupId
        ? await findOwnedGroupId(ctx.tx, server.id, existing.groupId)
        : null;
      const parsed = existing.requestDefinition
        ? mcpRequestDefinitionSchema.safeParse(existing.requestDefinition)
        : null;
      if (!parsed?.success) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
          message: "This tool has no valid typed request definition.",
          status: 409,
        });
      }

      const definition = regenerateDefinitionIds(parsed.data);
      const method = existing.method.toUpperCase() as McpHttpMethod;
      const flags = mutationDefaults(
        method,
        existing.allowMutation,
        input.enabled ?? existing.enabled,
      );
      const baseName = input.name ?? `${existing.name}_copy`;
      const nextName = toMcpToolName(baseName);
      const nextTitle =
        input.title === undefined
          ? existing.title
          : input.title?.trim() || null;
      const nextDescription =
        input.description === undefined
          ? existing.description
          : input.description?.trim() || null;
      const emit = bufferCompileTelemetry(db, userId, ctx.onCommit);
      const compiled = await compileTypedToolForPersistence(
        ctx.tx,
        server,
        {
          name: nextName,
          title: nextTitle,
          description: nextDescription,
          method,
          definition,
          allowMutation: flags.allowMutation,
          enabled: flags.enabled,
        },
        emit,
      );
      if (!compiled.ok && flags.enabled)
        throwTypedCompileInvalid(compiled.compileIssues);

      try {
        const [created] = await ctx.tx
          .insert(mcpTool)
          .values({
            serverId: server.id,
            name: nextName,
            title: nextTitle,
            description: nextDescription,
            method,
            requestDefinition: compiled.requestDefinition,
            compiledPlan: compiled.compiledPlan,
            compileStatus: compiled.compileStatus,
            compileIssues: compiled.compileIssues,
            annotations: compiled.annotations,
            allowMutation: flags.allowMutation,
            enabled: compiled.enabled,
            source: existing.source,
            groupId,
          })
          .returning();
        await promoteServerIfReady(ctx.tx, server.id, server.status);
        return {
          ...created,
          compileIssues: compiled.compileIssues,
        };
      } catch (error) {
        rethrowToolNameConflict(error);
      }
    },
    { draftMutation: true },
  );
  return { ...result, revision };
}

async function loadCompileServerValueRefs(
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

/**
 * Recompiles every enabled tool against the server's candidate common entries
 * and authentication configuration inside the caller's transaction. Used by
 * server-wide invalidations (common values, authentication) where the closure
 * is all enabled tools. Throws before persisting anything when any tool fails.
 */
async function recompileEnabledToolsForServer(
  db: DB,
  server: McpServer,
): Promise<void> {
  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const common = parseCommonEntries(server);
  const auth = parseAuthConfiguration(server.authConfiguration);
  const basePath = (() => {
    try {
      return new URL(server.baseUrl).pathname || "/";
    } catch {
      return "/";
    }
  })();

  const enabledTools = await db
    .select()
    .from(mcpTool)
    .where(and(eq(mcpTool.serverId, server.id), eq(mcpTool.enabled, true)));

  const failures: Array<{ toolId: string; name: string }> = [];
  const updates: Array<{
    toolId: string;
    plan: Record<string, unknown> | null;
    issues: McpCompileIssue[];
    annotations: Record<string, unknown> | null;
  }> = [];

  for (const tool of enabledTools) {
    const parsedDefinition = tool.requestDefinition
      ? mcpRequestDefinitionSchema.safeParse(tool.requestDefinition)
      : null;
    if (!parsedDefinition?.success) {
      failures.push({ toolId: tool.id, name: tool.name });
      continue;
    }
    const result = compileToolDefinition({
      method: tool.method,
      definition: parsedDefinition.data,
      common,
      auth,
      serverValues,
      basePath,
      allowMutation: tool.allowMutation,
    });
    if (!result.ok) {
      failures.push({ toolId: tool.id, name: tool.name });
      continue;
    }
    updates.push({
      toolId: tool.id,
      plan: result.plan as unknown as Record<string, unknown>,
      issues: result.issues,
      annotations:
        (result.plan?.annotations as Record<string, unknown> | undefined) ??
        null,
    });
  }

  if (failures.length > 0) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
      message:
        "This change would invalidate enabled tools; no changes were saved.",
      status: 409,
      details: {
        references: failures.map((failure) => ({
          kind: "tool",
          id: failure.toolId,
          name: failure.name,
        })),
      },
    });
  }

  for (const update of updates) {
    await db
      .update(mcpTool)
      .set({
        compiledPlan: update.plan,
        compileIssues: update.issues,
        annotations: update.annotations,
        compileStatus: "valid",
      })
      .where(eq(mcpTool.id, update.toolId));
  }
}

/** Owner-scoped dry-run; writes nothing and never returns a credential value. */
export async function previewCurlImport(
  db: DB,
  userId: string,
  serverId: string,
  curl: string,
): Promise<CurlImportPreview> {
  const server = await requireOwnedServer(db, userId, serverId);
  return buildCurlImportPreview(server.baseUrl, curl);
}

export type ConfirmCurlImportInput = {
  expectedRevision: number;
  curl: string;
  name?: string;
  description?: string | null;
  markings?: CurlImportMarking[];
  /** Optional Studio group for the imported draft; null or absent is ungrouped. */
  groupId?: string | null;
};

export type ConfirmCurlImportOptions = {
  /** Platform MCP must reject secret-bearing curl entirely instead of excluding it. */
  rejectCredentials?: boolean;
};

/**
 * Imports one endpoint from curl as a single disabled draft tool inside the
 * server aggregate transaction. Never creates, rotates, or overwrites server
 * values, authentication, or defaults — detected credentials are excluded and
 * reported by kind/header name only, never by value.
 */
export async function confirmCurlImport(
  db: DB,
  userId: string,
  serverId: string,
  input: ConfirmCurlImportInput,
  options: ConfirmCurlImportOptions = {},
) {
  if (
    options.rejectCredentials &&
    detectCurlCredentials(input.curl).length > 0
  ) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
      message:
        "Curl commands containing credentials are not accepted here; configure authentication in Studio.",
      status: 400,
    });
  }

  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const server = ctx.server;
      const serverValues = await loadCompileServerValueRefs(ctx.tx, server.id);
      const draft = buildCurlImportDraft({
        serverBaseUrl: server.baseUrl,
        curl: input.curl,
        markings: input.markings ?? [],
        serverValues: serverValues.map(({ id, name }) => ({ id, name })),
      });

      await assertToolCapacity(ctx.tx, server.id);
      const groupId = await resolveGroupPlacement(
        ctx.tx,
        server.id,
        input.groupId,
      );
      const name = toMcpToolName(input.name ?? draft.suggestedName);
      const basePath = new URL(server.baseUrl).pathname;
      const commonEntries = parseCommonEntries(server);
      const authConfiguration = parseAuthConfiguration(
        server.authConfiguration,
      );

      const compileResult = compileToolDefinition({
        method: draft.method,
        definition: draft.requestDefinition,
        common: commonEntries,
        auth: authConfiguration,
        serverValues,
        basePath,
        allowMutation: false,
      });

      try {
        const [row] = await ctx.tx
          .insert(mcpTool)
          .values({
            serverId: server.id,
            name,
            description: input.description?.trim() || null,
            method: draft.method,
            requestDefinition: draft.requestDefinition as unknown as Record<
              string,
              unknown
            >,
            compiledPlan: compileResult.ok
              ? (compileResult.plan as unknown as Record<string, unknown>)
              : null,
            compileStatus: compileResult.ok ? "valid" : "invalid",
            compileIssues: compileResult.issues,
            annotations: compileResult.ok
              ? (compileResult.plan?.annotations ?? null)
              : null,
            allowMutation: false,
            enabled: false,
            source: "curl",
            groupId,
          })
          .returning();
        return {
          ...row,
          compileOk: compileResult.ok,
          issues: compileResult.issues,
          excludedCredentials: draft.credentials,
        };
      } catch (error) {
        rethrowToolNameConflict(error);
      }
    },
    { draftMutation: true },
  );
  return { ...result, revision };
}

const TEST_CONNECTION_TIMEOUT_MS = 5_000;

export type TestConnectionResult = {
  ok: boolean;
  httpStatus: number | null;
  durationMs: number;
  appCode?: string;
};

function renderCommonBinding(
  binding: McpValueBinding,
  serverValues: Map<string, { name: string; value: string; kind: string }>,
): string {
  if (binding.kind === "literal") {
    return binding.value === null ? "" : String(binding.value);
  }
  if (binding.kind === "serverValue") {
    const resolved = serverValues.get(binding.serverValueId);
    if (!resolved) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
        message: "A referenced server value is no longer configured.",
        status: 409,
      });
    }
    return `${binding.prefix ?? ""}${resolved.value}${binding.suffix ?? ""}`;
  }
  throw appError({
    appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
    message: "Agent inputs are not valid in server common entries.",
    status: 400,
  });
}

/**
 * Connectivity probe: GET the baseUrl through the same SSRF guard and
 * allowlist as execution, rendering canonical common entries and the explicit
 * auth configuration with secrets resolved at execution. Any HTTP response
 * (including 401) proves reachability. Never writes a call-log row.
 */
export async function testConnection(
  db: DB,
  userId: string,
  serverId: string,
  credentialSecret: string,
): Promise<TestConnectionResult> {
  const server = await requireOwnedServer(db, userId, serverId);
  const started = Date.now();
  const finish = (
    ok: boolean,
    httpStatus: number | null,
    appCode?: string,
  ): TestConnectionResult => ({
    ok,
    httpStatus,
    durationMs: Date.now() - started,
    ...(appCode ? { appCode } : {}),
  });

  try {
    const url = await assertUpstreamUrlSafe(
      server.baseUrl,
      server.allowedHosts,
    );
    const serverValues = await loadServerValues(
      db,
      server.id,
      credentialSecret,
    );
    const common = parseCommonEntries(server);
    const auth = parseAuthConfiguration(server.authConfiguration);

    const headers = new Headers();
    for (const entry of common.headers) {
      headers.set(entry.name, renderCommonBinding(entry.value, serverValues));
    }
    const search = new URLSearchParams();
    for (const entry of common.query) {
      search.set(entry.name, renderCommonBinding(entry.value, serverValues));
    }
    for (const binding of auth?.bindings ?? []) {
      const rendered = renderCommonBinding(
        {
          kind: "serverValue",
          serverValueId: binding.serverValueId,
          ...(binding.prefix !== undefined ? { prefix: binding.prefix } : {}),
          ...(binding.suffix !== undefined ? { suffix: binding.suffix } : {}),
        },
        serverValues,
      );
      if (binding.location === "header") {
        headers.set(binding.key, rendered);
      } else {
        search.set(binding.key, rendered);
      }
    }
    if ([...search.keys()].length > 0) {
      url.search = search.toString();
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      TEST_CONNECTION_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: controller.signal,
      });
      await response.body?.cancel();
      return finish(true, response.status);
    } catch {
      return finish(false, null, APP_ERROR_CODES.MCP_UPSTREAM_ERROR);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof AppError) {
      return finish(false, null, error.appCode);
    }
    throw error;
  }
}

/** Historical call logs survive the tools with a null `toolId` (FK set null). */
export async function deleteTools(
  db: DB,
  userId: string,
  serverId: string,
  toolIds: string[],
  expectedRevision: number,
) {
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision },
    async (ctx) => {
      const deleted = await ctx.tx
        .delete(mcpTool)
        .where(
          and(inArray(mcpTool.id, toolIds), eq(mcpTool.serverId, serverId)),
        )
        .returning({ id: mcpTool.id });
      // One command deletes all requested tools or none: a partially deleted
      // selection would silently desync the caller's expected scope.
      if (deleted.length !== new Set(toolIds).size) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
          message: "MCP tool not found.",
          status: 404,
        });
      }
      return { ids: deleted.map((tool) => tool.id), deleted: true as const };
    },
    { draftMutation: true },
  );
  return { ...result, revision };
}

function validateVariableName(raw: string): string {
  const name = raw.trim();
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message:
        "Variable name must start with a letter and use lowercase letters, numbers, or underscores.",
      status: 400,
    });
  }
  return name;
}

function toVariableView(
  row: McpServerVariable,
  options: { includeValue?: boolean } = {},
) {
  const kind = row.kind as "config" | "secret";
  return {
    id: row.id,
    name: row.name,
    kind,
    owner: row.owner as "manual" | "auth",
    description: row.description ?? null,
    hasValue: kind === "secret" ? Boolean(row.ciphertext) : row.value !== null,
    ...(options.includeValue && kind === "config" ? { value: row.value } : {}),
  };
}

export async function listVariables(db: DB, userId: string, serverId: string) {
  await requireOwnedServer(db, userId, serverId);
  const rows = await db
    .select()
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, serverId))
    .orderBy(desc(mcpServerVariable.createdAt));
  return rows.map((row) => toVariableView(row, { includeValue: true }));
}

export async function createVariable(
  db: DB,
  userId: string,
  serverId: string,
  input: CreateVariableInput,
  credentialSecret: string,
) {
  const name = validateVariableName(input.name);
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      try {
        const [created] = await ctx.tx
          .insert(mcpServerVariable)
          .values({
            serverId,
            name,
            kind: input.kind,
            owner: "manual",
            description: input.description?.trim() || null,
            value: input.kind === "config" ? input.value : null,
            ciphertext:
              input.kind === "secret"
                ? encryptCredential(input.value, credentialSecret)
                : null,
          })
          .returning();
        return toVariableView(created, { includeValue: true });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw appError({
            appCode: APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
            message: "A variable with this name already exists on the server.",
            status: 409,
          });
        }
        throw error;
      }
    },
    { draftMutation: true },
  );
  return { ...result, revision };
}

/**
 * Applies a canonical value write to an existing row. `owner` is always
 * preserved. Secret -> config requires a new value; config -> secret may reuse
 * the current readable value.
 */
async function mutateVariableRecord(
  db: DB,
  server: McpServer,
  existing: McpServerVariable,
  input: {
    kind?: "config" | "secret";
    value?: string;
    description?: string | null;
  },
  credentialSecret: string,
): Promise<{ updated: McpServerVariable; isPureSecretRotation: boolean }> {
  const existingKind = existing.kind as "config" | "secret";
  const nextKind = input.kind ?? existingKind;
  const hasValue = input.value !== undefined;

  if (existingKind === "secret" && nextKind === "config" && !hasValue) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message:
        "A new value is required to convert a secret into a plaintext config value.",
      status: 400,
    });
  }
  if (
    existingKind !== "secret" &&
    nextKind === "secret" &&
    !hasValue &&
    existing.value === null
  ) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "A value is required to store this variable as a secret.",
      status: 400,
    });
  }

  const isPureSecretRotation =
    existingKind === "secret" && nextKind === "secret" && hasValue;

  if (existingKind === "secret" && nextKind === "config") {
    await assertActiveRevisionDoesNotReferenceSecret(
      db,
      server,
      existing.id,
      "converted",
    );
  }

  let value: string | null = null;
  let ciphertext: string | null = null;
  if (nextKind === "secret") {
    if (hasValue) {
      ciphertext = encryptCredential(input.value!, credentialSecret);
    } else if (existingKind === "secret") {
      ciphertext = existing.ciphertext;
    } else {
      ciphertext = encryptCredential(existing.value ?? "", credentialSecret);
    }
  } else {
    value = hasValue ? input.value! : existing.value;
  }

  const [updated] = await db
    .update(mcpServerVariable)
    .set({
      kind: nextKind,
      owner: existing.owner,
      description:
        input.description === undefined
          ? existing.description
          : input.description?.trim() || null,
      value,
      ciphertext,
    })
    .where(eq(mcpServerVariable.id, existing.id))
    .returning();

  // Value-only rotation keeps structural plans; a kind transition can change
  // secret-required placements, so recompile the enabled closure.
  if (nextKind !== existingKind) {
    await recompileEnabledToolsForServer(db, server);
  }

  return { updated, isPureSecretRotation };
}

/** Write-only value rotation keyed by stable value id. */
export async function updateVariable(
  db: DB,
  userId: string,
  serverId: string,
  valueId: string,
  input: UpdateVariableInput,
  credentialSecret: string,
) {
  let isPureSecretRotation = false;
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const [existing] = await ctx.tx
        .select()
        .from(mcpServerVariable)
        .where(
          and(
            eq(mcpServerVariable.serverId, serverId),
            eq(mcpServerVariable.id, valueId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw appError({
          appCode: APP_ERROR_CODES.INVALID_INPUT,
          message: "Variable not found on this server.",
          status: 404,
        });
      }

      const mutated = await mutateVariableRecord(
        ctx.tx,
        ctx.server,
        existing,
        {
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
        },
        credentialSecret,
      );
      isPureSecretRotation = mutated.isPureSecretRotation;
      return toVariableView(mutated.updated, { includeValue: true });
    },
    {
      get draftMutation() {
        return !isPureSecretRotation;
      },
    },
  );
  return { ...result, revision };
}

/** Creates the variable or updates it when the name already exists. */
export async function setVariable(
  db: DB,
  userId: string,
  serverId: string,
  input: SetVariableInput,
  credentialSecret: string,
) {
  const name = validateVariableName(input.name);
  let isPureSecretRotation = false;
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision: input.expectedRevision },
    async (ctx) => {
      const [existing] = await ctx.tx
        .select()
        .from(mcpServerVariable)
        .where(
          and(
            eq(mcpServerVariable.serverId, serverId),
            eq(mcpServerVariable.name, name),
          ),
        )
        .limit(1);

      if (existing) {
        const mutated = await mutateVariableRecord(
          ctx.tx,
          ctx.server,
          existing,
          {
            kind: input.kind,
            value: input.value,
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
          },
          credentialSecret,
        );
        isPureSecretRotation = mutated.isPureSecretRotation;
        return toVariableView(mutated.updated, { includeValue: true });
      }

      try {
        const [created] = await ctx.tx
          .insert(mcpServerVariable)
          .values({
            serverId,
            name,
            kind: input.kind,
            owner: "manual",
            description: input.description?.trim() || null,
            value: input.kind === "config" ? input.value : null,
            ciphertext:
              input.kind === "secret"
                ? encryptCredential(input.value, credentialSecret)
                : null,
          })
          .returning();
        return toVariableView(created, { includeValue: true });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw appError({
            appCode: APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
            message: "A variable with this name already exists on the server.",
            status: 409,
          });
        }
        throw error;
      }
    },
    {
      get draftMutation() {
        return !isPureSecretRotation;
      },
    },
  );
  return { ...result, revision };
}

export async function deleteVariable(
  db: DB,
  userId: string,
  serverId: string,
  valueId: string,
  expectedRevision: number,
) {
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision },
    async (ctx) => {
      const [variable] = await ctx.tx
        .select()
        .from(mcpServerVariable)
        .where(
          and(
            eq(mcpServerVariable.serverId, serverId),
            eq(mcpServerVariable.id, valueId),
          ),
        )
        .limit(1);
      if (!variable) {
        throw appError({
          appCode: APP_ERROR_CODES.INVALID_INPUT,
          message: "Variable not found on this server.",
          status: 404,
        });
      }

      const references = await findServerValueReferences(
        ctx.tx,
        ctx.server,
        variable.id,
      );
      if (references.length > 0) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_VALUE_IN_USE,
          message: `"${variable.name}" is still referenced and cannot be deleted.`,
          status: 409,
          details: { references },
        });
      }

      // A secret slot referenced by the active published revision is an
      // operational dependency: deleting it would break live execution even
      // when the draft no longer references it. Config values are snapshotted
      // into the revision, so they remain deletable.
      if ((variable.kind as "config" | "secret") === "secret") {
        await assertActiveRevisionDoesNotReferenceSecret(
          ctx.tx,
          ctx.server,
          variable.id,
          "deleted",
        );
      }

      await ctx.tx
        .delete(mcpServerVariable)
        .where(eq(mcpServerVariable.id, variable.id));
      return { id: variable.id, name: variable.name, deleted: true as const };
    },
    { draftMutation: true },
  );
  return { ...result, revision };
}

export function buildConnectionSnippet(apiOrigin: string, serverId: string) {
  const origin = apiOrigin.replace(/\/$/, "");
  return {
    url: `${origin}/mcp/${serverId}`,
    authorization: "Bearer <agent-token>",
    instructions:
      "Add this URL as a Streamable HTTP MCP server and send the agent token as a Bearer token.",
  };
}

export async function getConnectionSnippet(
  db: DB,
  userId: string,
  serverId: string,
  apiOrigin: string,
) {
  await requireOwnedServer(db, userId, serverId);
  return buildConnectionSnippet(apiOrigin, serverId);
}

export async function createServerToken(
  db: DB,
  userId: string,
  serverId: string,
  expectedRevision: number,
  name?: string,
) {
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision },
    async (ctx) => {
      const generated = generateAgentToken();
      const [created] = await ctx.tx
        .insert(mcpAgentToken)
        .values({
          userId,
          serverId,
          kind: "server",
          name: name?.trim() || "Agent token",
          tokenHash: generated.hash,
          prefix: generated.prefix,
        })
        .returning();

      return {
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        token: generated.raw,
        createdAt: created.createdAt,
      };
    },
  );
  return { ...result, revision };
}

export async function listServerTokens(
  db: DB,
  userId: string,
  serverId: string,
) {
  await requireOwnedServer(db, userId, serverId);
  const tokens = await db
    .select({
      id: mcpAgentToken.id,
      name: mcpAgentToken.name,
      prefix: mcpAgentToken.prefix,
      createdAt: mcpAgentToken.createdAt,
      lastUsedAt: mcpAgentToken.lastUsedAt,
      revokedAt: mcpAgentToken.revokedAt,
      expiresAt: mcpAgentToken.expiresAt,
    })
    .from(mcpAgentToken)
    .where(
      and(
        eq(mcpAgentToken.userId, userId),
        eq(mcpAgentToken.serverId, serverId),
        eq(mcpAgentToken.kind, "server"),
      ),
    )
    .orderBy(desc(mcpAgentToken.createdAt));
  return tokens;
}

export async function revokeServerToken(
  db: DB,
  userId: string,
  serverId: string,
  tokenId: string,
  expectedRevision: number,
) {
  const { result, revision } = await withOwnedServerWrite(
    db,
    { userId, serverId, expectedRevision },
    async (ctx) => {
      const [updated] = await ctx.tx
        .update(mcpAgentToken)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(mcpAgentToken.id, tokenId),
            eq(mcpAgentToken.userId, userId),
            eq(mcpAgentToken.serverId, serverId),
            eq(mcpAgentToken.kind, "server"),
          ),
        )
        .returning({ id: mcpAgentToken.id });
      if (!updated) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
          message: "Agent token not found.",
          status: 404,
        });
      }
      return { id: updated.id, revoked: true as const };
    },
  );
  return { ...result, revision };
}

export async function listCallLogs(
  db: DB,
  userId: string,
  serverId: string,
  input: PaginationInput,
) {
  await requireOwnedServer(db, userId, serverId);
  const where = eq(mcpCallLog.serverId, serverId);
  return paginate({
    page: input.page,
    pageSize: input.pageSize,
    list: (offset, limit) =>
      db
        .select({
          id: mcpCallLog.id,
          toolId: mcpCallLog.toolId,
          source: mcpCallLog.source,
          status: mcpCallLog.status,
          httpStatus: mcpCallLog.httpStatus,
          durationMs: mcpCallLog.durationMs,
          appCode: mcpCallLog.appCode,
          requestSummary: mcpCallLog.requestSummary,
          responseSummary: mcpCallLog.responseSummary,
          createdAt: mcpCallLog.createdAt,
        })
        .from(mcpCallLog)
        .where(where)
        .orderBy(desc(mcpCallLog.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ count: count() })
        .from(mcpCallLog)
        .where(where);
      return row?.count ?? 0;
    },
  });
}

export function resolveApiOrigin(req: Request, apiOrigin?: string): string {
  if (apiOrigin) return apiOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}
