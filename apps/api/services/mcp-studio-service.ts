/**
 * @file Owner-scoped MCP studio control plane.
 */
import type { Paginated, PaginationInput } from "@repo/core";
import {
  mcpAgentToken,
  mcpCallLog,
  mcpServer,
  mcpServerVariable,
  mcpTool,
  type McpAuthConfigurationRow,
  type McpNamedEntryRow,
  type McpPlatformScopeRow,
  type McpRequestTemplate,
  type McpServer,
  type McpServerVariable,
  type McpToolParam,
} from "@repo/db";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  APP_ERROR_CODES,
  AppError,
  appError,
  isAppErrorCode,
} from "../lib/app-error.js";
import {
  allCredentialMappingKeys,
  inferServerAuth,
  inferredAuthOwnedKeys,
  isAuthHeaderName,
  isCredentialQueryName,
  recipeToMapping,
  templatesReferenceVariable,
  type ServerAuthRecipe,
} from "../lib/mcp-auth-recipe.js";
import { generateAgentToken, hashAgentToken } from "../lib/mcp-agent-token.js";
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
import {
  analyzeLegacyTool,
  analyzeLegacyCommonEntries,
  projectCommonEntriesToLegacy,
  projectDefinitionToLegacy,
  renderDefinitionToLegacy,
} from "../lib/mcp-legacy-migrate.js";
import {
  MCP_DEFAULT_PLATFORM_SCOPES,
  MCP_PLATFORM_TOKEN_TTL_MS,
} from "../lib/mcp-policy.js";
import { isForbiddenTransportHeaderName } from "../lib/mcp-policy.js";
import { MCP_MAX_TOOLS_PER_SERVER } from "../lib/mcp-redact.js";
import {
  mcpCommonEntriesSchema,
  mcpRequestDefinitionSchema,
  redactSensitiveExamples,
  regenerateDefinitionIds,
  type McpAuthConfiguration,
  type McpCommonEntries,
  type McpCompileIssue,
  type McpNamedEntry,
  type McpRequestDefinition,
} from "../lib/mcp-request-definition.js";
import { assertUpstreamUrlSafe } from "../lib/mcp-ssrf.js";
import {
  captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS,
} from "../lib/mcp-telemetry.js";
import { assertOwnedStorageAccessUrl } from "../lib/storage.js";
import {
  extractPlaceholders,
  renderTemplate,
  type RenderScope,
} from "../lib/mcp-template.js";
import { paginate } from "../lib/paginate.js";
import { isUserBanned } from "../lib/user-access.js";
import {
  loadVariables,
  MUTATING_METHODS,
  READ_METHODS,
} from "./mcp-executor-service.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type TrafficLight = "draft" | "green" | "yellow" | "red" | "paused";
export type McpServerStatus = "draft" | "live" | "paused";
export type McpToolSource = "manual" | "curl";
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
  name?: string;
  description?: string | null;
  iconImage?: string | null;
  baseUrl?: string;
  status?: McpServerStatus;
  allowedHosts?: string[];
  defaultHeaders?: Record<string, string> | null;
  defaultQuery?: Record<string, string> | null;
};

export type CreateLegacyToolInput = {
  name: string;
  description?: string | null;
  method: McpHttpMethod;
  pathTemplate: string;
  requestTemplate?: McpRequestTemplate;
  params?: McpToolParam[];
  allowMutation?: boolean;
  enabled?: boolean;
};

export type UpdateLegacyToolInput = {
  name?: string;
  description?: string | null;
  method?: McpHttpMethod;
  pathTemplate?: string;
  requestTemplate?: McpRequestTemplate;
  params?: McpToolParam[];
  allowMutation?: boolean;
  enabled?: boolean;
};

/** Canonical typed create contract; the request definition is authoritative. */
export type CreateTypedToolInput = {
  name: string;
  title?: string | null;
  description?: string | null;
  method: McpHttpMethod;
  requestDefinition: McpRequestDefinition;
  allowMutation?: boolean;
  enabled?: boolean;
};

export type UpdateTypedToolInput = {
  name?: string;
  title?: string | null;
  description?: string | null;
  method?: McpHttpMethod;
  requestDefinition?: McpRequestDefinition;
  allowMutation?: boolean;
  enabled?: boolean;
};

export type DuplicateTypedToolInput = {
  name?: string;
  title?: string | null;
  description?: string | null;
  enabled?: boolean;
};

export type TemplateWarning = {
  type: "placeholder_without_param" | "param_without_placeholder";
  name: string;
};

export type SetVariableInput = {
  name: string;
  isSecret: boolean;
  value: string;
};

const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

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
  enabledToolCount: number;
  recentCallStatuses: string[];
}): TrafficLight {
  if (input.status === "paused") return "paused";
  if (input.enabledToolCount === 0) return "draft";
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

async function countEnabledTools(db: DB, serverId: string): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(mcpTool)
    .where(and(eq(mcpTool.serverId, serverId), eq(mcpTool.enabled, true)));
  return row?.count ?? 0;
}

async function recentProductCallStatuses(
  db: DB,
  serverId: string,
): Promise<string[]> {
  const rows = await db
    .select({ status: mcpCallLog.status })
    .from(mcpCallLog)
    .where(
      and(
        eq(mcpCallLog.serverId, serverId),
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
        eq(mcpServerVariable.isSecret, true),
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
};

export async function attachTrafficLight(
  db: DB,
  servers: McpServer[],
): Promise<McpServerWithMeta[]> {
  return Promise.all(
    servers.map(async (server) => {
      const [enabledToolCount, recentCallStatuses, secret, lastCall] =
        await Promise.all([
          countEnabledTools(db, server.id),
          recentProductCallStatuses(db, server.id),
          hasSecretVariable(db, server.id),
          lastCallAt(db, server.id),
        ]);
      return {
        ...server,
        hasSecret: secret,
        enabledToolCount,
        lastCallAt: lastCall,
        trafficLight: deriveTrafficLight({
          status: server.status,
          enabledToolCount,
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
  defaultHeaders: Record<string, string> | null;
  defaultQuery: Record<string, string> | null;
  tools: Array<{
    name: string;
    description: string | null;
    method: string;
    pathTemplate: string;
    requestTemplate: McpRequestTemplate | null;
    params: McpToolParam[] | null;
    allowMutation: boolean;
    enabled: boolean;
    source: string;
  }>;
  variables: Array<{ name: string; isSecret: boolean }>;
}) {
  return {
    name: input.name,
    description: input.description,
    baseUrl: input.baseUrl,
    allowedHosts: input.allowedHosts,
    defaultHeaders: input.defaultHeaders,
    defaultQuery: input.defaultQuery,
    tools: input.tools,
    variables: input.variables,
  };
}

export async function listServers(
  db: DB,
  userId: string,
  input: PaginationInput,
): Promise<Paginated<McpServerWithMeta>> {
  const where = eq(mcpServer.userId, userId);
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
        isSecret: true,
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
      isSecret: true,
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
  valueName: string,
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
  const legacyCommonHit = templatesReferenceVariable(valueName, [
    ...Object.values(server.defaultHeaders ?? {}),
    ...Object.values(server.defaultQuery ?? {}),
  ]);
  if (commonHit || legacyCommonHit) {
    references.push({ kind: "common", id: server.id, name: "Common values" });
  }

  const tools = await db
    .select({
      id: mcpTool.id,
      name: mcpTool.name,
      requestDefinition: mcpTool.requestDefinition,
      pathTemplate: mcpTool.pathTemplate,
      requestTemplate: mcpTool.requestTemplate,
    })
    .from(mcpTool)
    .where(eq(mcpTool.serverId, server.id));

  for (const tool of tools) {
    const definitionHit = definitionReferencesValue(
      tool.requestDefinition,
      valueId,
    );
    const legacyHit = templatesReferenceVariable(valueName, [
      tool.pathTemplate,
      ...Object.values(tool.requestTemplate?.headers ?? {}),
      ...Object.values(tool.requestTemplate?.query ?? {}),
      ...(tool.requestTemplate?.body ? [tool.requestTemplate.body] : []),
    ]);
    if (definitionHit || legacyHit) {
      references.push({ kind: "tool", id: tool.id, name: tool.name });
    }
  }

  return references;
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

function assertNoProtectedAuthOverride(
  server: McpServer,
  headers: Record<string, string> | null | undefined,
  query: Record<string, string> | null | undefined,
): void {
  const protectedKeys = protectedAuthKeys(server);
  for (const key of Object.keys(headers ?? {})) {
    if (protectedKeys.headers.has(key.toLowerCase())) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
        message: `"${key}" is owned by authentication and cannot be set here.`,
        status: 400,
      });
    }
  }
  for (const key of Object.keys(query ?? {})) {
    if (protectedKeys.query.has(key)) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
        message: `"${key}" is owned by authentication and cannot be set here.`,
        status: 400,
      });
    }
  }
}

/**
 * Apply an auth recipe onto an already-loaded server row inside a transaction.
 * Persists an explicit `authConfiguration` referencing auth-owned secret ids
 * and dual-writes the legacy `defaultHeaders`/`defaultQuery` templates for
 * rollback compatibility. Secrets are always created/rotated with
 * `owner: "auth"`; a manual value with a colliding name is never reused,
 * overwritten, or deleted — auth picks a distinct name instead. `none`
 * clears every auth-owned binding (including Custom multi-key setups) but
 * never touches a manual value.
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

  // Ownership tracking prefers the explicit configuration. Servers that
  // predate it (no `authConfiguration` row yet) fall back to the same
  // name-based inference the legacy reader has always used, purely so
  // rotating/clearing auth on those servers keeps working during migration.
  const legacyInferred = previousAuthConfig
    ? null
    : inferServerAuth(server.defaultHeaders, server.defaultQuery);
  const legacyOwnedKeys = legacyInferred
    ? inferredAuthOwnedKeys(legacyInferred)
    : null;
  const legacyAllOwnedKeys =
    !previousAuthConfig && recipe.type === "none"
      ? allCredentialMappingKeys(server.defaultHeaders, server.defaultQuery)
      : null;

  const previousHeaderKeys = previousAuthConfig
    ? previousAuthConfig.bindings
        .filter((binding) => binding.location === "header")
        .map((binding) => binding.key)
    : (legacyAllOwnedKeys?.headerKeys ?? legacyOwnedKeys?.headerKeys ?? []);
  const previousQueryKeys = previousAuthConfig
    ? previousAuthConfig.bindings
        .filter((binding) => binding.location === "query")
        .map((binding) => binding.key)
    : (legacyAllOwnedKeys?.queryKeys ?? legacyOwnedKeys?.queryKeys ?? []);

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
  const previousOwnedVariableNames = new Set<string>();
  if (!previousAuthConfig) {
    for (const name of legacyAllOwnedKeys?.variableNames ??
      (legacyOwnedKeys?.variableName ? [legacyOwnedKeys.variableName] : [])) {
      previousOwnedVariableNames.add(name);
    }
  }

  const nextHeaders: Record<string, string> = {
    ...(server.defaultHeaders ?? {}),
  };
  const nextQuery: Record<string, string> = {
    ...(server.defaultQuery ?? {}),
  };
  for (const key of previousHeaderKeys) delete nextHeaders[key];
  for (const key of previousQueryKeys) delete nextQuery[key];

  let authConfiguration: McpAuthConfigurationRow | null = null;
  let ownedRowId: string | undefined;

  if (mapping.variableName && mapping.plaintext !== null) {
    const previousId = previousAuthConfig?.bindings[0]?.serverValueId;
    const legacyPreviousName = !previousAuthConfig
      ? (legacyOwnedKeys?.variableName ?? null)
      : null;

    let previousRow: McpServerVariable | undefined;
    if (previousId) {
      previousRow = await db
        .select()
        .from(mcpServerVariable)
        .where(eq(mcpServerVariable.id, previousId))
        .limit(1)
        .then((rows) => rows[0]);
    } else if (legacyPreviousName) {
      previousRow = await findVariableByName(db, server.id, legacyPreviousName);
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

    // Rebuild the injected value against the *final* resolved name — a
    // collision-driven rename (manual value protection) must not leave the
    // header/query template pointing at the originally desired name.
    const authValueTemplate =
      recipe.type === "bearer"
        ? `Bearer {{${variableName}}}`
        : recipe.type === "basic"
          ? `Basic {{${variableName}}}`
          : `{{${variableName}}}`;
    for (const headerKey of mapping.headerKeys) {
      nextHeaders[headerKey] = authValueTemplate;
    }
    for (const queryKey of mapping.queryKeys) {
      nextQuery[queryKey] = authValueTemplate;
    }

    authConfiguration = {
      kind: recipe.type,
      bindings: [
        ...mapping.headerKeys.map((key) => ({
          location: "header" as const,
          key,
          serverValueId: ownedRow.id,
        })),
        ...mapping.queryKeys.map((key) => ({
          location: "query" as const,
          key,
          serverValueId: ownedRow.id,
        })),
      ],
      ...(recipe.type === "query" ? { queryExposureAcknowledged: true } : {}),
    };
  }

  const [updated] = await db
    .update(mcpServer)
    .set({
      defaultHeaders: Object.keys(nextHeaders).length > 0 ? nextHeaders : null,
      defaultQuery: Object.keys(nextQuery).length > 0 ? nextQuery : null,
      authConfiguration,
      updatedAt: new Date(),
    })
    .where(eq(mcpServer.id, server.id))
    .returning();

  const cleanupCandidates: Array<() => Promise<McpServerVariable | undefined>> =
    previousOwnedValueIds.size > 0
      ? [...previousOwnedValueIds]
          .filter((id) => id !== ownedRowId)
          .map((id) => async () => {
            const [row] = await db
              .select()
              .from(mcpServerVariable)
              .where(eq(mcpServerVariable.id, id))
              .limit(1);
            return row;
          })
      : [...previousOwnedVariableNames].map((name) => async () => {
          const row = await findVariableByName(db, server.id, name);
          return row?.id === ownedRowId ? undefined : row;
        });

  for (const loadCandidate of cleanupCandidates) {
    const row = await loadCandidate();
    if (!row || row.owner === "manual") continue;
    const references = await findServerValueReferences(
      db,
      updated,
      row.id,
      row.name,
    );
    if (references.length > 0) continue;
    await db.delete(mcpServerVariable).where(eq(mcpServerVariable.id, row.id));
  }

  return updated;
}

export async function setServerAuth(
  db: DB,
  userId: string,
  serverId: string,
  recipe: ServerAuthRecipe,
  credentialSecret: string,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  return db.transaction(async (tx) => {
    const updated = await applyAuthRecipe(tx, server, recipe, credentialSecret);
    const [withMeta] = await attachTrafficLight(tx, [updated]);
    return {
      ...withMeta,
      auth: describeServerAuth(updated),
    };
  });
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

export async function getServer(db: DB, userId: string, serverId: string) {
  const server = await requireOwnedServer(db, userId, serverId);
  const [withMeta] = await attachTrafficLight(db, [server]);
  const tools = await db
    .select()
    .from(mcpTool)
    .where(eq(mcpTool.serverId, server.id))
    .orderBy(desc(mcpTool.createdAt));
  const variables = await listVariables(db, userId, server.id);

  return {
    ...withMeta,
    tools,
    variables,
    auth: describeServerAuth(server),
    recipe: toRecipeTemplate({
      name: server.name,
      description: server.description,
      baseUrl: server.baseUrl,
      allowedHosts: server.allowedHosts,
      defaultHeaders: server.defaultHeaders,
      defaultQuery: server.defaultQuery,
      tools,
      variables: variables.map(({ name, isSecret }) => ({ name, isSecret })),
    }),
  };
}

/** Auth-ish headers must reference a variable; literal secrets are rejected. */
export function assertNoPlaintextSecretHeaders(
  headers: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (isAuthHeaderName(name) && !value.includes("{{")) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
        message: `Header "${name}" looks auth-related. Store the secret in a secret variable and reference it with {{name}}.`,
        status: 400,
      });
    }
  }
}

export async function updateServer(
  db: DB,
  userId: string,
  serverId: string,
  input: UpdateServerInput,
  appOrigin: string,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  if (
    (input.defaultHeaders !== undefined || input.defaultQuery !== undefined) &&
    server.commonEntries
  ) {
    const serverValues = await loadCompileServerValueRefs(db, server.id);
    const projection = projectCommonEntriesToLegacy(
      server.commonEntries as McpCommonEntries,
      Object.fromEntries(serverValues.map((value) => [value.id, value.name])),
    );
    throw appError({
      appCode: projection.projectable
        ? APP_ERROR_CODES.MCP_LEGACY_DOWNGRADE_REJECTED
        : APP_ERROR_CODES.MCP_LEGACY_PROJECTION_UNAVAILABLE,
      message:
        "This server already uses typed common entries; edit them through the typed common-values command.",
      status: 409,
    });
  }
  const nextBaseUrl = input.baseUrl
    ? formatBaseUrl(parseBaseUrl(input.baseUrl))
    : server.baseUrl;
  const allowedHosts = input.allowedHosts
    ? deriveAllowedHosts(nextBaseUrl, input.allowedHosts)
    : input.baseUrl
      ? deriveAllowedHosts(nextBaseUrl, server.allowedHosts)
      : server.allowedHosts;

  if (input.defaultHeaders) {
    assertNoPlaintextSecretHeaders(input.defaultHeaders);
  }
  if (input.defaultHeaders !== undefined || input.defaultQuery !== undefined) {
    assertNoProtectedAuthOverride(
      server,
      input.defaultHeaders,
      input.defaultQuery,
    );
  }

  let nextIconImage = server.iconImage ?? null;
  if (input.iconImage !== undefined) {
    if (input.iconImage === null) {
      nextIconImage = null;
    } else {
      assertOwnedStorageAccessUrl(
        input.iconImage,
        {
          user: { id: userId },
        },
        appOrigin,
      );
      nextIconImage = input.iconImage;
    }
  }

  const [updated] = await db
    .update(mcpServer)
    .set({
      name: input.name?.trim() ?? server.name,
      description:
        input.description === undefined
          ? server.description
          : input.description?.trim() || null,
      iconImage: nextIconImage,
      baseUrl: nextBaseUrl,
      allowedHosts,
      status: input.status ?? server.status,
      defaultHeaders:
        input.defaultHeaders === undefined
          ? server.defaultHeaders
          : input.defaultHeaders,
      defaultQuery:
        input.defaultQuery === undefined
          ? server.defaultQuery
          : input.defaultQuery,
    })
    .where(eq(mcpServer.id, server.id))
    .returning();

  const [withMeta] = await attachTrafficLight(db, [updated]);
  return withMeta;
}

/** Reads the canonical typed common entries for a server. */
export async function getServerCommon(
  db: DB,
  userId: string,
  serverId: string,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const common: McpCommonEntries =
    (server.commonEntries as McpCommonEntries | null) ??
    resolveCommonEntriesForCompile(server, serverValues);
  const names = Object.fromEntries(
    serverValues.map((value) => [value.id, value.name]),
  );
  const projection = projectCommonEntriesToLegacy(common, names);
  return {
    common,
    legacyProjectable: projection.projectable,
    projectionIssues: projection.issues,
  };
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
  input: { common: McpCommonEntries },
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const parsedCommon = mcpCommonEntriesSchema.parse(input.common);
  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const serverValueById = new Map(serverValues.map((v) => [v.id, v]));
  const names = Object.fromEntries(
    serverValues.map((value) => [value.id, value.name]),
  );
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

  const projection = projectCommonEntriesToLegacy(parsedCommon, names);
  const authConfiguration =
    (server.authConfiguration as unknown as McpAuthConfiguration | null) ??
    null;
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

  if (enabledTools.length > MCP_MAX_TOOLS_PER_SERVER) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: `A server cannot have more than ${MCP_MAX_TOOLS_PER_SERVER} enabled tools.`,
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
    if (!tool.requestDefinition) {
      if (!projection.projectable) {
        toolFailures.push({ toolId: tool.id, name: tool.name });
      }
      continue;
    }
    const parsedDefinition = mcpRequestDefinitionSchema.safeParse(
      tool.requestDefinition,
    );
    if (!parsedDefinition.success) {
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

  const legacyDefaultHeaders = { ...(projection.defaultHeaders ?? {}) };
  for (const [key, value] of Object.entries(server.defaultHeaders ?? {})) {
    if (protectedKeys.headers.has(key.toLowerCase())) {
      legacyDefaultHeaders[key] = value;
    }
  }
  const legacyDefaultQuery = { ...(projection.defaultQuery ?? {}) };
  for (const [key, value] of Object.entries(server.defaultQuery ?? {})) {
    if (protectedKeys.query.has(key)) {
      legacyDefaultQuery[key] = value;
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(mcpServer)
      .set({
        commonEntries: parsedCommon as unknown as {
          headers: McpNamedEntryRow[];
          query: McpNamedEntryRow[];
        },
        defaultHeaders: projection.projectable
          ? legacyDefaultHeaders
          : server.defaultHeaders,
        defaultQuery: projection.projectable
          ? legacyDefaultQuery
          : server.defaultQuery,
      })
      .where(eq(mcpServer.id, server.id));

    for (const update of compiledUpdates) {
      await tx
        .update(mcpTool)
        .set({
          compiledPlan: update.plan,
          compileIssues: update.issues,
          annotations: update.annotations,
          compileStatus: "valid",
        })
        .where(eq(mcpTool.id, update.toolId));
    }
  });

  return {
    common: parsedCommon,
    legacyProjectable: projection.projectable,
    projectionIssues: projection.issues,
    affectedToolCount: enabledTools.length,
  };
}

/**
 * Deletes a server and every row that belongs to it. Call logs are removed
 * explicitly (their FK is `set null`) so no invisible rows survive.
 */
export async function deleteServer(db: DB, userId: string, serverId: string) {
  const server = await requireOwnedServer(db, userId, serverId);
  await db.transaction(async (tx) => {
    await tx.delete(mcpCallLog).where(eq(mcpCallLog.serverId, server.id));
    await tx.delete(mcpTool).where(eq(mcpTool.serverId, server.id));
    await tx
      .delete(mcpServerVariable)
      .where(eq(mcpServerVariable.serverId, server.id));
    await tx.delete(mcpAgentToken).where(eq(mcpAgentToken.serverId, server.id));
    await tx.delete(mcpServer).where(eq(mcpServer.id, server.id));
  });
  return { id: server.id, deleted: true };
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
  input: PaginationInput,
) {
  await requireOwnedServer(db, userId, serverId);
  const where = eq(mcpTool.serverId, serverId);
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
  if ((row?.count ?? 0) >= MCP_MAX_TOOLS_PER_SERVER) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: `A server cannot have more than ${MCP_MAX_TOOLS_PER_SERVER} tools.`,
      status: 400,
    });
  }
}

async function listVariableNames(
  db: DB,
  serverId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ name: mcpServerVariable.name })
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, serverId));
  return new Set(rows.map((row) => row.name));
}

export function collectTemplateWarnings(input: {
  pathTemplate: string;
  requestTemplate: McpRequestTemplate;
  params: McpToolParam[];
  variableNames: Set<string>;
}): TemplateWarning[] {
  const placeholders = new Set<string>([
    ...extractPlaceholders(input.pathTemplate),
    ...Object.values(input.requestTemplate.query ?? {}).flatMap(
      extractPlaceholders,
    ),
    ...Object.values(input.requestTemplate.headers ?? {}).flatMap(
      extractPlaceholders,
    ),
    ...(input.requestTemplate.body
      ? extractPlaceholders(input.requestTemplate.body)
      : []),
  ]);
  const paramNames = new Set(input.params.map((param) => param.name));
  const warnings: TemplateWarning[] = [];
  for (const name of placeholders) {
    if (!paramNames.has(name) && !input.variableNames.has(name)) {
      warnings.push({ type: "placeholder_without_param", name });
    }
  }
  for (const name of paramNames) {
    if (!placeholders.has(name)) {
      warnings.push({ type: "param_without_placeholder", name });
    }
  }
  return warnings;
}

function validateToolTemplates(input: {
  pathTemplate: string;
  requestTemplate: McpRequestTemplate;
}): void {
  assertNoPlaintextSecretHeaders(input.requestTemplate.headers ?? {});
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
  compileStatus: "valid" | "invalid" | "legacy";
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

async function compileLegacyToolForPersistence(
  db: DB,
  server: McpServer,
  input: {
    method: string;
    pathTemplate: string;
    requestTemplate: McpRequestTemplate;
    params: McpToolParam[];
    allowMutation: boolean;
    enabled: boolean;
  },
): Promise<CompiledToolPersistence> {
  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const analysis = analyzeLegacyTool({
    method: input.method,
    pathTemplate: input.pathTemplate,
    requestTemplate: input.requestTemplate,
    params: input.params,
    serverValues,
  });

  if (!analysis.unambiguous || !analysis.definition) {
    return {
      requestDefinition: null,
      compiledPlan: null,
      compileStatus: "invalid",
      compileIssues: analysis.issues,
      annotations: null,
      enabled: false,
    };
  }

  const commonEntries = resolveCommonEntriesForCompile(server, serverValues);
  const authConfiguration =
    (server.authConfiguration as unknown as McpAuthConfiguration | null) ??
    null;
  const compileResult = compileToolDefinition({
    method: input.method,
    definition: analysis.definition,
    common: commonEntries,
    auth: authConfiguration,
    serverValues,
    basePath: (() => {
      try {
        return new URL(server.baseUrl).pathname || "/";
      } catch {
        return "/";
      }
    })(),
    allowMutation: input.allowMutation,
  });

  const issues = [...analysis.issues, ...compileResult.issues];
  const ok = compileResult.ok;
  return {
    requestDefinition: analysis.definition as unknown as Record<
      string,
      unknown
    >,
    compiledPlan:
      (compileResult.plan as Record<string, unknown> | null) ?? null,
    compileStatus: ok ? "valid" : "invalid",
    compileIssues: issues,
    annotations:
      (compileResult.plan?.annotations as
        Record<string, unknown> | undefined) ?? null,
    enabled: ok ? input.enabled : false,
  };
}

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
  /** Legacy compatibility fields written only when the projection is lossless. */
  compatibility: {
    pathTemplate: string;
    requestTemplate: McpRequestTemplate | null;
    params: McpToolParam[] | null;
    projectable: boolean;
  };
};

/**
 * Validates server-value references against the selected server's catalog,
 * compiles the typed definition with the candidate common entries and auth
 * configuration, and computes the lossless legacy compatibility projection.
 * Pure with respect to the tool row: performs no writes.
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
): Promise<TypedToolPersistence> {
  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const serverValueNames = Object.fromEntries(
    serverValues.map((value) => [value.id, value.name]),
  );
  const commonEntries = resolveCommonEntriesForCompile(server, serverValues);
  const authConfiguration =
    (server.authConfiguration as unknown as McpAuthConfiguration | null) ??
    null;
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

  const projection = projectDefinitionToLegacy(
    input.definition,
    input.method,
    serverValueNames,
  );
  if (!projection.projectable) {
    compileIssues.push(...projection.issues);
  }

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

  const ok =
    compileResult.ok &&
    plaintextSecretIssues.length === 0 &&
    contractResult?.ok === true;
  if (!ok) {
    captureMcpTelemetry(MCP_TELEMETRY_EVENTS.typedCompileFailed, {
      db,
      userId: server.userId,
      properties: {
        serverId: server.id,
        method: input.method,
        issueCodes: compileResult.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.code)
          .slice(0, 10),
      },
    });
  }
  if (!projection.projectable) {
    captureMcpTelemetry(MCP_TELEMETRY_EVENTS.definitionNotProjectable, {
      db,
      userId: server.userId,
      properties: {
        serverId: server.id,
        method: input.method,
        issueCodes: projection.issues.map((issue) => issue.code).slice(0, 10),
      },
    });
  }
  const fallbackPathTemplate = projection.projectable
    ? (projection.projection?.pathTemplate ?? "")
    : renderDefinitionToLegacy(input.definition, input.method, serverValueNames)
        .pathTemplate;

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
    compatibility: {
      pathTemplate: fallbackPathTemplate,
      requestTemplate: projection.projectable
        ? (projection.projection?.requestTemplate ?? null)
        : null,
      params: projection.projectable
        ? (projection.projection?.params ?? null)
        : null,
      projectable: projection.projectable,
    },
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
  const server = await requireOwnedServer(db, userId, serverId);
  await assertToolCapacity(db, server.id);
  const name = toMcpToolName(input.name);
  const method = input.method.toUpperCase() as McpHttpMethod;
  assertSupportedMethod(method);
  const flags = mutationDefaults(method, input.allowMutation, input.enabled);
  const compiled = await compileTypedToolForPersistence(db, server, {
    name,
    title: input.title,
    description: input.description,
    method,
    definition: input.requestDefinition,
    allowMutation: flags.allowMutation,
    enabled: flags.enabled,
  });
  if (!compiled.ok && flags.enabled)
    throwTypedCompileInvalid(compiled.compileIssues);

  try {
    const [created] = await db
      .insert(mcpTool)
      .values({
        serverId: server.id,
        name,
        title: input.title?.trim() || null,
        description: input.description?.trim() || null,
        method,
        pathTemplate: compiled.compatibility.pathTemplate,
        requestTemplate: compiled.compatibility.requestTemplate,
        params: compiled.compatibility.params,
        requestDefinition: compiled.requestDefinition,
        compiledPlan: compiled.compiledPlan,
        compileStatus: compiled.compileStatus,
        compileIssues: compiled.compileIssues,
        annotations: compiled.annotations,
        allowMutation: flags.allowMutation,
        enabled: compiled.enabled,
        source,
      })
      .returning();
    await promoteServerIfReady(db, server.id, server.status);
    return {
      ...created,
      warnings: [],
      compileIssues: compiled.compileIssues,
      compatibilityProjectable: compiled.compatibility.projectable,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
        message: "A tool with this name already exists on the server.",
        status: 409,
      });
    }
    throw error;
  }
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
    compatibilityProjectable: compiled.compatibility.projectable,
  };
}

/**
 * Loads a tool for editing. Typed tools return their canonical definition;
 * legacy-only tools return the backend conversion draft or blocking issues.
 */
export async function getToolEditorState(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
) {
  const server = await requireOwnedServer(db, userId, serverId);
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
  if (tool.requestDefinition) {
    const parsed = mcpRequestDefinitionSchema.safeParse(tool.requestDefinition);
    return {
      toolId: tool.id,
      typed: true,
      definition: parsed.success ? parsed.data : null,
      issues: issueRows,
      conversionDraft: null,
      conversionIssues: [],
    };
  }

  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const analysis = analyzeLegacyTool({
    method: tool.method,
    pathTemplate: tool.pathTemplate,
    requestTemplate: tool.requestTemplate,
    params: tool.params,
    serverValues,
  });
  captureMcpTelemetry(MCP_TELEMETRY_EVENTS.legacyConversion, {
    db,
    userId,
    properties: {
      serverId: server.id,
      toolId: tool.id,
      unambiguous: analysis.unambiguous,
      issueCount: analysis.issues.length,
    },
  });
  return {
    toolId: tool.id,
    typed: false,
    definition: null,
    issues: issueRows,
    conversionDraft: analysis.definition,
    conversionIssues: analysis.issues,
  };
}

function isTypedToolRow(tool: { requestDefinition: unknown }): boolean {
  return Boolean(tool.requestDefinition);
}

/** Canonical typed update; preserves definition-local ids from the payload. */
export async function updateTool(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
  input: UpdateTypedToolInput,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const [existing] = await db
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
      appCode: APP_ERROR_CODES.MCP_LEGACY_DOWNGRADE_REJECTED,
      message:
        "A typed definition is required to update this tool; submit a converted definition first.",
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
    input.title === undefined ? existing.title : input.title?.trim() || null;
  const nextDescription =
    input.description === undefined
      ? existing.description
      : input.description?.trim() || null;
  const compiled = await compileTypedToolForPersistence(db, server, {
    name: nextName,
    title: nextTitle,
    description: nextDescription,
    method,
    definition,
    allowMutation: flags.allowMutation,
    enabled: flags.enabled,
  });
  if (!compiled.ok && flags.enabled)
    throwTypedCompileInvalid(compiled.compileIssues);

  try {
    const [updated] = await db
      .update(mcpTool)
      .set({
        name: nextName,
        title: nextTitle,
        description: nextDescription,
        method,
        pathTemplate: compiled.compatibility.pathTemplate,
        requestTemplate: compiled.compatibility.requestTemplate,
        params: compiled.compatibility.params,
        requestDefinition: compiled.requestDefinition,
        compiledPlan: compiled.compiledPlan,
        compileStatus: compiled.compileStatus,
        compileIssues: compiled.compileIssues,
        annotations: compiled.annotations,
        allowMutation: flags.allowMutation,
        enabled: compiled.enabled,
      })
      .where(eq(mcpTool.id, existing.id))
      .returning();
    return {
      ...updated,
      warnings: [],
      compileIssues: compiled.compileIssues,
      compatibilityProjectable: compiled.compatibility.projectable,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
        message: "A tool with this name already exists on the server.",
        status: 409,
      });
    }
    throw error;
  }
}

/** Duplicates a tool, regenerating definition-local ids and preserving server-value ids. */
export async function duplicateTool(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
  input: DuplicateTypedToolInput = {},
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const [existing] = await db
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
  await assertToolCapacity(db, server.id);
  if (!isTypedToolRow(existing) || !existing.requestDefinition) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_LEGACY_DOWNGRADE_REJECTED,
      message:
        "This tool has no typed definition; convert it before duplicating.",
      status: 409,
    });
  }
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
    input.title === undefined ? existing.title : input.title?.trim() || null;
  const nextDescription =
    input.description === undefined
      ? existing.description
      : input.description?.trim() || null;
  const compiled = await compileTypedToolForPersistence(db, server, {
    name: nextName,
    title: nextTitle,
    description: nextDescription,
    method,
    definition,
    allowMutation: flags.allowMutation,
    enabled: flags.enabled,
  });
  if (!compiled.ok && flags.enabled)
    throwTypedCompileInvalid(compiled.compileIssues);

  try {
    const [created] = await db
      .insert(mcpTool)
      .values({
        serverId: server.id,
        name: nextName,
        title: nextTitle,
        description: nextDescription,
        method,
        pathTemplate: compiled.compatibility.pathTemplate,
        requestTemplate: compiled.compatibility.requestTemplate,
        params: compiled.compatibility.params,
        requestDefinition: compiled.requestDefinition,
        compiledPlan: compiled.compiledPlan,
        compileStatus: compiled.compileStatus,
        compileIssues: compiled.compileIssues,
        annotations: compiled.annotations,
        allowMutation: flags.allowMutation,
        enabled: compiled.enabled,
        source: existing.source,
      })
      .returning();
    await promoteServerIfReady(db, server.id, server.status);
    return {
      ...created,
      warnings: [],
      compileIssues: compiled.compileIssues,
      compatibilityProjectable: compiled.compatibility.projectable,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
        message: "A tool with this name already exists on the server.",
        status: 409,
      });
    }
    throw error;
  }
}

export async function createLegacyTool(
  db: DB,
  userId: string,
  serverId: string,
  input: CreateLegacyToolInput,
  source: McpToolSource = "manual",
) {
  const server = await requireOwnedServer(db, userId, serverId);
  captureMcpTelemetry(MCP_TELEMETRY_EVENTS.legacyCompatWrite, {
    db,
    userId,
    properties: { serverId: server.id, operation: "create" },
  });
  await assertToolCapacity(db, server.id);
  const name = toMcpToolName(input.name);
  const method = input.method.toUpperCase() as McpHttpMethod;
  if (![...READ_METHODS, ...MUTATING_METHODS].includes(method)) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Unsupported HTTP method.",
      status: 400,
    });
  }
  const flags = mutationDefaults(method, input.allowMutation, input.enabled);
  const pathTemplate = input.pathTemplate.startsWith("/")
    ? input.pathTemplate
    : `/${input.pathTemplate}`;
  const requestTemplate = input.requestTemplate ?? {};
  const params = input.params ?? [];
  validateToolTemplates({ pathTemplate, requestTemplate });
  const warnings = collectTemplateWarnings({
    pathTemplate,
    requestTemplate,
    params,
    variableNames: await listVariableNames(db, server.id),
  });
  const compiled = await compileLegacyToolForPersistence(db, server, {
    method,
    pathTemplate,
    requestTemplate,
    params,
    allowMutation: flags.allowMutation,
    enabled: flags.enabled,
  });

  try {
    const [created] = await db
      .insert(mcpTool)
      .values({
        serverId: server.id,
        name,
        description: input.description?.trim() || null,
        method,
        pathTemplate,
        requestTemplate,
        params,
        requestDefinition: compiled.requestDefinition,
        compiledPlan: compiled.compiledPlan,
        compileStatus: compiled.compileStatus,
        compileIssues: compiled.compileIssues,
        annotations: compiled.annotations,
        allowMutation: flags.allowMutation,
        enabled: compiled.enabled,
        source,
      })
      .returning();
    await promoteServerIfReady(db, server.id, server.status);
    return { ...created, warnings, compileIssues: compiled.compileIssues };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
        message: "A tool with this name already exists on the server.",
        status: 409,
      });
    }
    throw error;
  }
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
    kind:
      (row.kind as "config" | "secret" | null) ??
      (row.isSecret ? "secret" : "config"),
    owner: (row.owner as "manual" | "auth" | null) ?? "manual",
  }));
}

/**
 * Legacy defaults may still carry auth-owned keys that are now injected
 * through `authConfiguration`; exclude them so the inferred common entries
 * match what the write validators accept.
 */
function excludeAuthOwnedCommonEntries(
  server: McpServer,
  common: McpCommonEntries,
): McpCommonEntries {
  if (!server.authConfiguration) return common;
  const protectedKeys = protectedAuthKeys(server);
  return {
    headers: common.headers.filter(
      (entry) => !protectedKeys.headers.has(entry.name.toLowerCase()),
    ),
    query: common.query.filter((entry) => !protectedKeys.query.has(entry.name)),
  };
}

/**
 * Prefer explicit commonEntries; otherwise compile unambiguous legacy
 * defaultHeaders/defaultQuery so unmigrated servers keep server-wide defaults
 * in the cached compiled plan.
 */
function resolveCommonEntriesForCompile(
  server: McpServer,
  serverValues: CompileServerValueRef[],
): McpCommonEntries {
  if (server.commonEntries) {
    return server.commonEntries as McpCommonEntries;
  }
  const analysis = analyzeLegacyCommonEntries({
    defaultHeaders: server.defaultHeaders,
    defaultQuery: server.defaultQuery,
    serverValues,
  });
  if (analysis.unambiguous && analysis.commonEntries) {
    return excludeAuthOwnedCommonEntries(server, analysis.commonEntries);
  }
  return { headers: [], query: [] };
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
  curl: string;
  name?: string;
  description?: string | null;
  markings?: CurlImportMarking[];
};

export type ConfirmCurlImportOptions = {
  /** Platform MCP must reject secret-bearing curl entirely instead of excluding it. */
  rejectCredentials?: boolean;
};

/**
 * Imports one endpoint from curl as a single disabled draft tool, created in
 * one transaction. Never creates, rotates, or overwrites server values,
 * authentication, or defaults — detected credentials are excluded and
 * reported by kind/header name only, never by value.
 */
export async function confirmCurlImport(
  db: DB,
  userId: string,
  serverId: string,
  input: ConfirmCurlImportInput,
  options: ConfirmCurlImportOptions = {},
) {
  const server = await requireOwnedServer(db, userId, serverId);

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

  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const draft = buildCurlImportDraft({
    serverBaseUrl: server.baseUrl,
    curl: input.curl,
    markings: input.markings ?? [],
    serverValues: serverValues.map(({ id, name }) => ({ id, name })),
  });

  await assertToolCapacity(db, server.id);
  const name = toMcpToolName(input.name ?? draft.suggestedName);
  const basePath = new URL(server.baseUrl).pathname;
  const commonEntries: McpCommonEntries =
    (server.commonEntries as McpCommonEntries | null) ?? {
      headers: [],
      query: [],
    };
  const authConfiguration =
    (server.authConfiguration as unknown as McpAuthConfiguration | null) ??
    null;

  const compileResult = compileToolDefinition({
    method: draft.method,
    definition: draft.requestDefinition,
    common: commonEntries,
    auth: authConfiguration,
    serverValues,
    basePath,
    allowMutation: false,
  });

  const serverValueNamesById = Object.fromEntries(
    serverValues.map((value) => [value.id, value.name]),
  );
  const projection = projectDefinitionToLegacy(
    draft.requestDefinition,
    draft.method,
    serverValueNamesById,
  );
  const compileIssues = [
    ...compileResult.issues,
    ...(projection.projectable ? [] : projection.issues),
  ];
  const fallbackLegacy = renderDefinitionToLegacy(
    draft.requestDefinition,
    draft.method,
    serverValueNamesById,
  );

  try {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(mcpTool)
        .values({
          serverId: server.id,
          name,
          description: input.description?.trim() || null,
          method: draft.method,
          pathTemplate:
            projection.projection?.pathTemplate ?? fallbackLegacy.pathTemplate,
          requestTemplate: projection.projection?.requestTemplate ?? null,
          params: projection.projection?.params ?? null,
          requestDefinition: draft.requestDefinition as unknown as Record<
            string,
            unknown
          >,
          compiledPlan: compileResult.ok
            ? (compileResult.plan as unknown as Record<string, unknown>)
            : null,
          compileStatus: compileResult.ok ? "valid" : "invalid",
          compileIssues,
          annotations: compileResult.ok
            ? (compileResult.plan?.annotations ?? null)
            : null,
          allowMutation: false,
          enabled: false,
          source: "curl",
        })
        .returning();
      return row;
    });

    return {
      ...created,
      compileOk: compileResult.ok,
      issues: compileResult.issues,
      excludedCredentials: draft.credentials,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
        message: "A tool with this name already exists on the server.",
        status: 409,
      });
    }
    throw error;
  }
}

/** Backward-compatible name for {@link confirmCurlImport}. */
export const createToolFromCurl = confirmCurlImport;

export type PreviewLegacyToolCompileInput = {
  method: McpHttpMethod;
  pathTemplate: string;
  requestTemplate?: McpRequestTemplate;
  params?: McpToolParam[];
  allowMutation?: boolean;
};

/**
 * Explicit legacy compatibility preview retained during the migration window.
 * Analyzes the legacy `{{name}}` shape, then runs the publish-time compiler
 * against the server's current values, common entries, and auth configuration.
 * Never persists anything.
 */
export async function previewLegacyToolCompile(
  db: DB,
  userId: string,
  serverId: string,
  input: PreviewLegacyToolCompileInput,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  captureMcpTelemetry(MCP_TELEMETRY_EVENTS.legacyCompatWrite, {
    db,
    userId,
    properties: { serverId: server.id, operation: "preview" },
  });
  const serverValues = await loadCompileServerValueRefs(db, server.id);
  const method = input.method.toUpperCase() as McpHttpMethod;
  const pathTemplate = input.pathTemplate.startsWith("/")
    ? input.pathTemplate
    : `/${input.pathTemplate}`;
  const requestTemplate = input.requestTemplate ?? {};
  const params = input.params ?? [];

  const analysis = analyzeLegacyTool({
    method,
    pathTemplate,
    requestTemplate,
    params,
    serverValues,
  });

  if (!analysis.unambiguous || !analysis.definition) {
    return { ok: false, issues: analysis.issues, plan: null };
  }

  const commonEntries = resolveCommonEntriesForCompile(server, serverValues);
  const authConfiguration =
    (server.authConfiguration as unknown as McpAuthConfiguration | null) ??
    null;
  const basePath = new URL(server.baseUrl).pathname;

  const compileResult = compileToolDefinition({
    method,
    definition: analysis.definition,
    common: commonEntries,
    auth: authConfiguration,
    serverValues,
    basePath,
    allowMutation: input.allowMutation ?? false,
  });

  return {
    ok: compileResult.ok,
    issues: [...analysis.issues, ...compileResult.issues],
    plan: compileResult.plan as Record<string, unknown> | null,
  };
}

const TEST_CONNECTION_TIMEOUT_MS = 5_000;

export type TestConnectionResult = {
  ok: boolean;
  httpStatus: number | null;
  durationMs: number;
  appCode?: string;
};

/**
 * Connectivity probe: GET the baseUrl through the same SSRF guard and
 * allowlist as execution, with server defaults rendered. Any HTTP response
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
    const scope: RenderScope = {
      args: {},
      variables: await loadVariables(db, server.id, credentialSecret),
      secretsUsed: new Set<string>(),
    };

    const queryParts: string[] = [];
    for (const [key, valueTemplate] of Object.entries(
      server.defaultQuery ?? {},
    )) {
      const rendered = renderTemplate(valueTemplate, "query", scope);
      queryParts.push(`${encodeURIComponent(key)}=${rendered}`);
    }
    if (queryParts.length > 0) {
      url.search = queryParts.join("&");
    }

    const headers = new Headers();
    for (const [name, valueTemplate] of Object.entries(
      server.defaultHeaders ?? {},
    )) {
      headers.set(name, renderTemplate(valueTemplate, "header", scope));
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

export async function updateLegacyTool(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
  input: UpdateLegacyToolInput,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const [existing] = await db
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

  // A typed record is authoritative: legacy-only writers cannot downgrade it.
  if (existing.requestDefinition) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_LEGACY_DOWNGRADE_REJECTED,
      message:
        "This tool already has a typed request definition; legacy template updates are rejected.",
      status: 409,
    });
  }

  captureMcpTelemetry(MCP_TELEMETRY_EVENTS.legacyCompatWrite, {
    db,
    userId,
    properties: {
      serverId: server.id,
      operation: "update",
      toolId: existing.id,
    },
  });

  const method = (
    input.method ?? existing.method
  ).toUpperCase() as McpHttpMethod;
  const flags = mutationDefaults(
    method,
    input.allowMutation ?? existing.allowMutation,
    input.enabled ?? existing.enabled,
  );
  const pathTemplate = input.pathTemplate ?? existing.pathTemplate;
  const requestTemplate =
    input.requestTemplate ?? existing.requestTemplate ?? {};
  const params = input.params ?? existing.params ?? [];
  validateToolTemplates({ pathTemplate, requestTemplate });
  const warnings = collectTemplateWarnings({
    pathTemplate,
    requestTemplate,
    params,
    variableNames: await listVariableNames(db, serverId),
  });
  const compiled = await compileLegacyToolForPersistence(db, server, {
    method,
    pathTemplate,
    requestTemplate,
    params,
    allowMutation: flags.allowMutation,
    enabled: flags.enabled,
  });

  try {
    const [updated] = await db
      .update(mcpTool)
      .set({
        name: input.name ? toMcpToolName(input.name) : existing.name,
        description:
          input.description === undefined
            ? existing.description
            : input.description?.trim() || null,
        method,
        pathTemplate,
        requestTemplate,
        params,
        requestDefinition: compiled.requestDefinition,
        compiledPlan: compiled.compiledPlan,
        compileStatus: compiled.compileStatus,
        compileIssues: compiled.compileIssues,
        annotations: compiled.annotations,
        allowMutation: flags.allowMutation,
        enabled: compiled.enabled,
      })
      .where(eq(mcpTool.id, existing.id))
      .returning();
    return { ...updated, warnings, compileIssues: compiled.compileIssues };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
        message: "A tool with this name already exists on the server.",
        status: 409,
      });
    }
    throw error;
  }
}

/** Historical call logs survive the tool with a null `toolId` (FK set null). */
export async function deleteTool(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
) {
  await requireOwnedServer(db, userId, serverId);
  const [deleted] = await db
    .delete(mcpTool)
    .where(and(eq(mcpTool.id, toolId), eq(mcpTool.serverId, serverId)))
    .returning({ id: mcpTool.id });
  if (!deleted) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
      message: "MCP tool not found.",
      status: 404,
    });
  }
  return { id: deleted.id, deleted: true };
}

export async function listVariables(db: DB, userId: string, serverId: string) {
  await requireOwnedServer(db, userId, serverId);
  const rows = await db
    .select()
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, serverId))
    .orderBy(desc(mcpServerVariable.createdAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isSecret: row.isSecret,
    /** "config" | "secret" — falls back to the legacy `isSecret` flag. */
    kind:
      (row.kind as "config" | "secret" | null) ??
      (row.isSecret ? "secret" : "config"),
    /** "manual" | "auth" — auth-owned values are protected in Studio editors. */
    owner: (row.owner as "manual" | "auth" | null) ?? "manual",
    description: row.description ?? null,
    hasValue: row.isSecret ? Boolean(row.ciphertext) : row.value !== null,
    ...(row.isSecret ? {} : { value: row.value }),
  }));
}

export async function createVariable(
  db: DB,
  userId: string,
  serverId: string,
  input: SetVariableInput,
  credentialSecret: string,
) {
  await requireOwnedServer(db, userId, serverId);
  const name = input.name.trim();
  if (!VARIABLE_NAME_PATTERN.test(name)) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message:
        "Variable name must start with a letter and use lowercase letters, numbers, or underscores.",
      status: 400,
    });
  }

  try {
    const [created] = await db
      .insert(mcpServerVariable)
      .values({
        serverId,
        name,
        isSecret: input.isSecret,
        value: input.isSecret ? null : input.value,
        ciphertext: input.isSecret
          ? encryptCredential(input.value, credentialSecret)
          : null,
      })
      .returning();
    return {
      id: created.id,
      name: created.name,
      isSecret: created.isSecret,
      hasValue: true,
      ...(created.isSecret ? {} : { value: created.value }),
    };
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
}

/**
 * Write-only value rotation; the stored value is never read back. Passing
 * `isSecret` also transitions the storage mode. A secret row requires a new
 * value. Flipping plaintext to secret may reuse the visible stored value.
 */
export async function updateVariable(
  db: DB,
  userId: string,
  serverId: string,
  name: string,
  input: { value?: string; isSecret?: boolean },
  credentialSecret: string,
) {
  await requireOwnedServer(db, userId, serverId);
  const [existing] = await db
    .select()
    .from(mcpServerVariable)
    .where(
      and(
        eq(mcpServerVariable.serverId, serverId),
        eq(mcpServerVariable.name, name),
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

  const nextIsSecret = input.isSecret ?? existing.isSecret;
  const hasValue = input.value !== undefined;
  if ((existing.isSecret || !nextIsSecret) && !hasValue) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message:
        "A new value is required to rotate a secret or to store a variable as plaintext.",
      status: 400,
    });
  }

  const nextValue = (hasValue ? input.value : existing.value) ?? "";
  await db
    .update(mcpServerVariable)
    .set(
      nextIsSecret
        ? {
            isSecret: true,
            value: null,
            ciphertext: encryptCredential(nextValue, credentialSecret),
          }
        : { isSecret: false, value: nextValue, ciphertext: null },
    )
    .where(eq(mcpServerVariable.id, existing.id));

  return { name: existing.name, isSecret: nextIsSecret, hasValue: true };
}

/** Creates the variable or rotates its value when the name already exists. */
export async function setVariable(
  db: DB,
  userId: string,
  serverId: string,
  input: SetVariableInput,
  credentialSecret: string,
) {
  await requireOwnedServer(db, userId, serverId);
  const [existing] = await db
    .select({ name: mcpServerVariable.name })
    .from(mcpServerVariable)
    .where(
      and(
        eq(mcpServerVariable.serverId, serverId),
        eq(mcpServerVariable.name, input.name.trim()),
      ),
    )
    .limit(1);
  if (existing) {
    return updateVariable(
      db,
      userId,
      serverId,
      existing.name,
      { value: input.value, isSecret: input.isSecret },
      credentialSecret,
    );
  }
  return createVariable(db, userId, serverId, input, credentialSecret);
}

export async function deleteVariable(
  db: DB,
  userId: string,
  serverId: string,
  name: string,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const [variable] = await db
    .select()
    .from(mcpServerVariable)
    .where(
      and(
        eq(mcpServerVariable.serverId, serverId),
        eq(mcpServerVariable.name, name),
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
    db,
    server,
    variable.id,
    variable.name,
  );
  if (references.length > 0) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_VALUE_IN_USE,
      message: `"${name}" is still referenced and cannot be deleted.`,
      status: 409,
      details: { references },
    });
  }

  const [deleted] = await db
    .delete(mcpServerVariable)
    .where(eq(mcpServerVariable.id, variable.id))
    .returning({ id: mcpServerVariable.id });
  if (!deleted) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Variable not found on this server.",
      status: 404,
    });
  }
  return { name, deleted: true };
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
  name?: string,
) {
  await requireOwnedServer(db, userId, serverId);
  const generated = generateAgentToken();
  const [created] = await db
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
) {
  await requireOwnedServer(db, userId, serverId);
  const [updated] = await db
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
  return { id: updated.id, revoked: true };
}

export type CreatePlatformTokenInput = {
  name?: string;
  scopes?: McpPlatformScopeRow[];
  expiresInDays?: number;
};

/**
 * Atomic replace: revoke + insert run in one transaction, so a failed insert
 * leaves the previous active token untouched instead of revoking it first.
 */
export async function createPlatformToken(
  db: DB,
  userId: string,
  input: CreatePlatformTokenInput | string = {},
) {
  const normalized: CreatePlatformTokenInput =
    typeof input === "string" ? { name: input } : input;
  const scopes = normalized.scopes ?? [...MCP_DEFAULT_PLATFORM_SCOPES];
  const expiresAt = new Date(
    Date.now() +
      (normalized.expiresInDays
        ? normalized.expiresInDays * 24 * 60 * 60 * 1000
        : MCP_PLATFORM_TOKEN_TTL_MS),
  );

  const generated = generateAgentToken();
  const created = await db.transaction(async (tx) => {
    await tx
      .update(mcpAgentToken)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(mcpAgentToken.userId, userId),
          eq(mcpAgentToken.kind, "platform"),
          isNull(mcpAgentToken.revokedAt),
        ),
      );

    const [row] = await tx
      .insert(mcpAgentToken)
      .values({
        userId,
        serverId: null,
        kind: "platform",
        name: normalized.name?.trim() || "Platform token",
        tokenHash: generated.hash,
        prefix: generated.prefix,
        scopes,
        expiresAt,
      })
      .returning();
    return row;
  });

  return {
    id: created.id,
    name: created.name,
    prefix: created.prefix,
    scopes,
    expiresAt: created.expiresAt,
    token: generated.raw,
    createdAt: created.createdAt,
  };
}

/**
 * Migration helper: legacy platform tokens issued before scoping existed
 * (`scopes IS NULL`) are treated as invalid and revoked here. Call this once
 * from a migration/seed step; owners must recreate a scoped token afterward.
 * Server-scoped agent tokens are never touched.
 */
export async function revokeUnscopedPlatformTokens(db: DB): Promise<number> {
  const revoked = await db
    .update(mcpAgentToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mcpAgentToken.kind, "platform"),
        isNull(mcpAgentToken.scopes),
        isNull(mcpAgentToken.revokedAt),
      ),
    )
    .returning({ id: mcpAgentToken.id });
  return revoked.length;
}

export async function getPlatformTokenMeta(db: DB, userId: string) {
  const [token] = await db
    .select({
      id: mcpAgentToken.id,
      name: mcpAgentToken.name,
      prefix: mcpAgentToken.prefix,
      createdAt: mcpAgentToken.createdAt,
      lastUsedAt: mcpAgentToken.lastUsedAt,
      revokedAt: mcpAgentToken.revokedAt,
      scopes: mcpAgentToken.scopes,
      expiresAt: mcpAgentToken.expiresAt,
    })
    .from(mcpAgentToken)
    .where(
      and(
        eq(mcpAgentToken.userId, userId),
        eq(mcpAgentToken.kind, "platform"),
        isNull(mcpAgentToken.revokedAt),
      ),
    )
    .orderBy(desc(mcpAgentToken.createdAt))
    .limit(1);

  return token ?? null;
}

export async function revokePlatformToken(db: DB, userId: string) {
  await db
    .update(mcpAgentToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mcpAgentToken.userId, userId),
        eq(mcpAgentToken.kind, "platform"),
        isNull(mcpAgentToken.revokedAt),
      ),
    );
  return { revoked: true };
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

export async function authenticateAgentToken(
  db: DB,
  rawToken: string,
  expected: { kind: "server"; serverId: string } | { kind: "platform" },
) {
  const tokenHash = hashAgentToken(rawToken);
  const [token] = await db
    .select()
    .from(mcpAgentToken)
    .where(eq(mcpAgentToken.tokenHash, tokenHash))
    .limit(1);

  const reject = (): never => {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
      message: "Agent token is invalid.",
      status: 401,
    });
  };

  if (!token || token.revokedAt) reject();
  if (token.expiresAt && token.expiresAt.getTime() < Date.now()) reject();
  if (token.kind !== expected.kind) reject();
  if (expected.kind === "server" && token.serverId !== expected.serverId) {
    reject();
  }
  // Legacy platform tokens issued before scoping are treated as invalid;
  // owners must recreate a scoped token.
  if (expected.kind === "platform" && !token.scopes) reject();
  if (await isUserBanned(db, token.userId)) {
    throw appError({
      appCode: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
      message: "Your account has been suspended.",
      status: 403,
    });
  }

  await db
    .update(mcpAgentToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(mcpAgentToken.id, token.id));

  return token;
}

export function resolveApiOrigin(req: Request, apiOrigin?: string): string {
  if (apiOrigin) return apiOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}
