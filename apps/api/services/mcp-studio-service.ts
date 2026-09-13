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
  type McpRequestTemplate,
  type McpServer,
  type McpToolParam,
} from "@repo/db";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { APP_ERROR_CODES, AppError, appError } from "../lib/app-error.js";
import { generateAgentToken, hashAgentToken } from "../lib/mcp-agent-token.js";
import { encryptCredential } from "../lib/mcp-crypto.js";
import { isAuthHeaderName, parseCurlCommand } from "../lib/mcp-curl.js";
import { MCP_MAX_TOOLS_PER_SERVER } from "../lib/mcp-redact.js";
import { assertUpstreamUrlSafe } from "../lib/mcp-ssrf.js";
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

export type CreateServerInput = {
  name: string;
  description?: string | null;
  baseUrl: string;
  slug?: string;
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

export type CreateToolInput = {
  name: string;
  description?: string | null;
  method: McpHttpMethod;
  pathTemplate: string;
  requestTemplate?: McpRequestTemplate;
  params?: McpToolParam[];
  allowMutation?: boolean;
  enabled?: boolean;
};

export type UpdateToolInput = {
  name?: string;
  description?: string | null;
  method?: McpHttpMethod;
  pathTemplate?: string;
  requestTemplate?: McpRequestTemplate;
  params?: McpToolParam[];
  allowMutation?: boolean;
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
) {
  const parsed = parseBaseUrl(input.baseUrl);
  const baseUrl = formatBaseUrl(parsed);
  const slug = slugifyName(input.slug ?? input.name);
  const allowedHosts = deriveAllowedHosts(baseUrl);

  try {
    const [created] = await db
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

    const [withMeta] = await attachTrafficLight(db, [created]);
    return withMeta;
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

export async function createTool(
  db: DB,
  userId: string,
  serverId: string,
  input: CreateToolInput,
  source: McpToolSource = "manual",
) {
  const server = await requireOwnedServer(db, userId, serverId);
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
        allowMutation: flags.allowMutation,
        enabled: flags.enabled,
        source,
      })
      .returning();
    await promoteServerIfReady(db, server.id, server.status);
    return { ...created, warnings };
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

export function toolPathFromCurl(
  serverBaseUrl: string,
  curlUrl: string,
): {
  pathTemplate: string;
  query: Record<string, string>;
} {
  const target = new URL(curlUrl);
  const base = new URL(serverBaseUrl);
  let pathTemplate = target.pathname || "/";
  if (
    target.origin === base.origin &&
    pathTemplate.startsWith(base.pathname) &&
    base.pathname !== "/"
  ) {
    pathTemplate = pathTemplate.slice(base.pathname.length) || "/";
    if (!pathTemplate.startsWith("/")) pathTemplate = `/${pathTemplate}`;
  }
  const query: Record<string, string> = {};
  target.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return { pathTemplate, query };
}

function inferBodyType(
  headers: Record<string, string>,
  body: string | null,
): "json" | "form" | "raw" | undefined {
  if (body === null) return undefined;
  const contentType = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === "content-type",
  )?.[1];
  if (contentType?.includes("application/x-www-form-urlencoded")) return "form";
  if (contentType?.toLowerCase().includes("json")) return "json";
  return "raw";
}

/** Deterministic variable name for a credential captured from curl. */
export function capturedVariableName(
  scheme: "bearer" | "api_key" | "header",
  headerName: string,
): string {
  if (scheme === "bearer") return "api_token";
  if (scheme === "api_key") return "api_key";
  const slug = headerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return VARIABLE_NAME_PATTERN.test(slug) ? slug : "auth_secret";
}

async function upsertCapturedVariable(
  db: DB,
  serverId: string,
  name: string,
  plaintext: string,
  isSecret: boolean,
  credentialSecret: string,
): Promise<void> {
  const stored = isSecret
    ? {
        isSecret: true,
        value: null,
        ciphertext: encryptCredential(plaintext, credentialSecret),
      }
    : { isSecret: false, value: plaintext, ciphertext: null };
  const [existing] = await db
    .select({ id: mcpServerVariable.id })
    .from(mcpServerVariable)
    .where(
      and(
        eq(mcpServerVariable.serverId, serverId),
        eq(mcpServerVariable.name, name),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(mcpServerVariable)
      .set(stored)
      .where(eq(mcpServerVariable.id, existing.id));
    return;
  }
  await db.insert(mcpServerVariable).values({ serverId, name, ...stored });
}

export type CurlMarkableValue = {
  value: string;
  location: "path" | "query" | "header" | "body";
  /** Query key, header name, or JSON path for body values; null otherwise. */
  key: string | null;
};

export type CurlPreview = {
  method: McpHttpMethod;
  pathTemplate: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string | null;
  bodyType: "json" | "form" | "raw" | undefined;
  auth: {
    scheme: "bearer" | "api_key" | "header";
    headerName: string;
    value: string;
    variableName: string;
  } | null;
  values: CurlMarkableValue[];
};

function collectJsonLeafValues(
  value: unknown,
  path: string,
  out: CurlMarkableValue[],
  seen: Set<string>,
): void {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const text = String(value);
    if (text.length === 0) return;
    const dedupeKey = `${path} ${text}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({ value: text, location: "body", key: path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectJsonLeafValues(item, `${path}[${index}]`, out, seen),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      collectJsonLeafValues(item, path ? `${path}.${key}` : key, out, seen);
    }
  }
}

function collectBodyValues(
  body: string,
  bodyType: "json" | "form" | "raw" | undefined,
): CurlMarkableValue[] {
  if (bodyType === "json") {
    try {
      const parsed: unknown = JSON.parse(body);
      const out: CurlMarkableValue[] = [];
      collectJsonLeafValues(parsed, "", out, new Set());
      return out;
    } catch {
      return [{ value: body, location: "body", key: null }];
    }
  }
  if (bodyType === "form") {
    const out: CurlMarkableValue[] = [];
    for (const [key, value] of new URLSearchParams(body)) {
      if (value) out.push({ value, location: "body", key });
    }
    return out;
  }
  return [{ value: body, location: "body", key: null }];
}

function collectPathValues(pathTemplate: string): CurlMarkableValue[] {
  const seen = new Set<string>();
  const out: CurlMarkableValue[] = [];
  for (const segment of pathTemplate.split("/")) {
    if (!segment || seen.has(segment)) continue;
    seen.add(segment);
    out.push({ value: segment, location: "path", key: null });
  }
  return out;
}

/** Pure dry-run parse: the would-be tool shape plus every markable literal. */
export function parseCurlPreview(
  serverBaseUrl: string,
  curl: string,
): CurlPreview {
  const parsed = parseCurlCommand(curl);
  const { pathTemplate, query } = toolPathFromCurl(serverBaseUrl, parsed.url);
  const bodyType = inferBodyType(parsed.headers, parsed.body);
  const suggestion = parsed.credentialSuggestion;

  const values: CurlMarkableValue[] = [
    ...collectPathValues(pathTemplate),
    ...Object.entries(query)
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => ({ value, location: "query" as const, key })),
    ...Object.entries(parsed.headers)
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => ({ value, location: "header" as const, key })),
    ...(parsed.body !== null ? collectBodyValues(parsed.body, bodyType) : []),
  ];

  return {
    method: parsed.method.toUpperCase() as McpHttpMethod,
    pathTemplate,
    query,
    headers: parsed.headers,
    body: parsed.body,
    bodyType,
    auth: suggestion
      ? {
          scheme: suggestion.scheme,
          headerName: suggestion.headerName,
          value: suggestion.value,
          variableName: capturedVariableName(
            suggestion.scheme,
            suggestion.headerName,
          ),
        }
      : null,
    values,
  };
}

/** Owner-scoped dry-run; writes nothing. */
export async function previewCurlImport(
  db: DB,
  userId: string,
  serverId: string,
  curl: string,
): Promise<CurlPreview> {
  const server = await requireOwnedServer(db, userId, serverId);
  return parseCurlPreview(server.baseUrl, curl);
}

export type CurlValueMarking = {
  value: string;
  as: "param" | "variable";
  name: string;
  isSecret?: boolean;
};

export type CreateToolFromCurlInput = {
  curl: string;
  name?: string;
  description?: string | null;
  markings?: CurlValueMarking[];
};

const PARAM_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

function assertMarkingName(marking: CurlValueMarking): void {
  const pattern =
    marking.as === "variable" ? VARIABLE_NAME_PATTERN : PARAM_NAME_PATTERN;
  if (!pattern.test(marking.name)) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: `Marking name "${marking.name}" is not a valid ${marking.as} name.`,
      status: 400,
    });
  }
}

export async function createToolFromCurl(
  db: DB,
  userId: string,
  serverId: string,
  input: CreateToolFromCurlInput,
  credentialSecret: string,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const parsed = parseCurlCommand(input.curl);
  const curlTarget = toolPathFromCurl(server.baseUrl, parsed.url);
  const query = curlTarget.query;
  let pathTemplate = curlTarget.pathTemplate;
  const method = parsed.method.toUpperCase() as McpHttpMethod;
  const inferredName =
    input.name ??
    `${method.toLowerCase()}_${
      pathTemplate
        .replace(/^\//, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "request"
    }`;

  const bodyType = inferBodyType(parsed.headers, parsed.body);
  const headers: Record<string, string> = { ...parsed.headers };
  let body = parsed.body;
  const suggestion = parsed.credentialSuggestion;

  // Longest values first so short values cannot partially rewrite long ones.
  const markings = [...(input.markings ?? [])].sort(
    (a, b) => b.value.length - a.value.length,
  );
  for (const marking of markings) assertMarkingName(marking);

  // Same markable inventory the preview surfaced, so each marked literal is
  // rewritten only where it was found — a short value like "1" must not
  // rewrite unrelated path segments, query keys, headers, or body text.
  const markables: CurlMarkableValue[] = [
    ...collectPathValues(pathTemplate),
    ...Object.entries(query)
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => ({ value, location: "query" as const, key })),
    ...Object.entries(headers)
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => ({ value, location: "header" as const, key })),
    ...(body !== null ? collectBodyValues(body, bodyType) : []),
  ];

  const substituteAt = (markable: CurlMarkableValue, name: string) => {
    const placeholder = `{{${name}}}`;
    if (markable.location === "path") {
      // Path markables are whole segments; never rewrite inside one.
      pathTemplate = pathTemplate
        .split("/")
        .map((segment) => (segment === markable.value ? placeholder : segment))
        .join("/");
      return;
    }
    if (markable.location === "query" && markable.key !== null) {
      const current = query[markable.key];
      if (current !== undefined) {
        query[markable.key] = current.split(markable.value).join(placeholder);
      }
      return;
    }
    if (markable.location === "header" && markable.key !== null) {
      const current = headers[markable.key];
      if (current !== undefined) {
        headers[markable.key] = current.split(markable.value).join(placeholder);
      }
      return;
    }
    if (body !== null) body = body.split(markable.value).join(placeholder);
  };

  const substitute = (value: string, name: string) => {
    if (!value) return;
    const markable = markables.find((entry) => entry.value === value);
    if (markable) substituteAt(markable, name);
  };

  // The peeled credential is a substring of its own header value, so it
  // never matches a whole markable; rewrite it inside that header only.
  const substituteAuth = (value: string, name: string) => {
    if (!suggestion) return;
    const current = headers[suggestion.headerName];
    if (!current) return;
    headers[suggestion.headerName] = current.split(value).join(`{{${name}}}`);
  };

  const params: McpToolParam[] = [];
  const capturedParams: string[] = [];
  const capturedVariables: string[] = [];
  let capturedVariable: string | null = null;
  let capturedHeader: string | null = null;

  if (suggestion) {
    const authMarking = markings.find(
      (marking) => marking.value === suggestion.value,
    );
    capturedHeader = suggestion.headerName;
    const renderHeaderValue = (name: string) =>
      suggestion.scheme === "bearer" ? `Bearer {{${name}}}` : `{{${name}}}`;

    if (authMarking?.as === "param") {
      substituteAuth(suggestion.value, authMarking.name);
      params.push({ name: authMarking.name, required: true, type: "string" });
      capturedParams.push(authMarking.name);
      const defaultHeaders = {
        ...(server.defaultHeaders ?? {}),
        [suggestion.headerName]: renderHeaderValue(authMarking.name),
      };
      await db
        .update(mcpServer)
        .set({ defaultHeaders })
        .where(eq(mcpServer.id, server.id));
    } else {
      const variableName =
        authMarking?.name ??
        capturedVariableName(suggestion.scheme, suggestion.headerName);
      await upsertCapturedVariable(
        db,
        server.id,
        variableName,
        suggestion.value,
        authMarking?.isSecret ?? true,
        credentialSecret,
      );
      substituteAuth(suggestion.value, variableName);
      capturedVariable = variableName;
      capturedVariables.push(variableName);
      const defaultHeaders = {
        ...(server.defaultHeaders ?? {}),
        [suggestion.headerName]: renderHeaderValue(variableName),
      };
      await db
        .update(mcpServer)
        .set({ defaultHeaders })
        .where(eq(mcpServer.id, server.id));
    }
  }

  for (const marking of markings) {
    if (suggestion && marking.value === suggestion.value) continue;
    substitute(marking.value, marking.name);
    if (marking.as === "param") {
      params.push({ name: marking.name, required: true, type: "string" });
      capturedParams.push(marking.name);
    } else {
      await upsertCapturedVariable(
        db,
        server.id,
        marking.name,
        marking.value,
        marking.isSecret ?? false,
        credentialSecret,
      );
      capturedVariables.push(marking.name);
    }
  }

  const requestTemplate: McpRequestTemplate = {
    ...(Object.keys(query).length > 0 ? { query } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(body !== null ? { body, bodyType } : {}),
  };

  const tool = await createTool(
    db,
    userId,
    serverId,
    {
      name: inferredName,
      description: input.description ?? null,
      method,
      pathTemplate,
      requestTemplate,
      params,
    },
    "curl",
  );

  return {
    ...tool,
    capturedVariable,
    capturedHeader,
    capturedVariables,
    capturedParams,
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

export async function updateTool(
  db: DB,
  userId: string,
  serverId: string,
  toolId: string,
  input: UpdateToolInput,
) {
  await requireOwnedServer(db, userId, serverId);
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
        allowMutation: flags.allowMutation,
        enabled: flags.enabled,
      })
      .where(eq(mcpTool.id, existing.id))
      .returning();
    return { ...updated, warnings };
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
 * `isSecret` (upsert path) also transitions the storage mode.
 */
export async function updateVariable(
  db: DB,
  userId: string,
  serverId: string,
  name: string,
  input: { value: string; isSecret?: boolean },
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
  await db
    .update(mcpServerVariable)
    .set(
      nextIsSecret
        ? {
            isSecret: true,
            value: null,
            ciphertext: encryptCredential(input.value, credentialSecret),
          }
        : { isSecret: false, value: input.value, ciphertext: null },
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
  await requireOwnedServer(db, userId, serverId);
  const [deleted] = await db
    .delete(mcpServerVariable)
    .where(
      and(
        eq(mcpServerVariable.serverId, serverId),
        eq(mcpServerVariable.name, name),
      ),
    )
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

export async function createPlatformToken(
  db: DB,
  userId: string,
  name?: string,
) {
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

  const generated = generateAgentToken();
  const [created] = await db
    .insert(mcpAgentToken)
    .values({
      userId,
      serverId: null,
      kind: "platform",
      name: name?.trim() || "Platform token",
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

export async function getPlatformTokenMeta(db: DB, userId: string) {
  const [token] = await db
    .select({
      id: mcpAgentToken.id,
      name: mcpAgentToken.name,
      prefix: mcpAgentToken.prefix,
      createdAt: mcpAgentToken.createdAt,
      lastUsedAt: mcpAgentToken.lastUsedAt,
      revokedAt: mcpAgentToken.revokedAt,
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
