/**
 * @file Owner-scoped MCP studio control plane.
 */
import type { Paginated, PaginationInput } from "@repo/core";
import {
  mcpAgentToken,
  mcpCallLog,
  mcpCredential,
  mcpServer,
  mcpTool,
  type McpParamMap,
  type McpServer,
} from "@repo/db";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import { generateAgentToken, hashAgentToken } from "../lib/mcp-agent-token.js";
import { encryptCredential } from "../lib/mcp-crypto.js";
import { parseCurlCommand } from "../lib/mcp-curl.js";
import { MCP_MAX_TOOLS_PER_SERVER } from "../lib/mcp-redact.js";
import { paginate } from "../lib/paginate.js";
import { isUserBanned } from "../lib/user-access.js";
import { MUTATING_METHODS, READ_METHODS } from "./mcp-executor-service.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type TrafficLight = "draft" | "green" | "yellow" | "red" | "paused";
export type McpServerStatus = "draft" | "live" | "paused";
export type McpCredentialScheme = "bearer" | "api_key" | "header";
export type McpValueLocation = "header" | "query";
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
  baseUrl?: string;
  status?: McpServerStatus;
  allowedHosts?: string[];
};

export type CreateToolInput = {
  name: string;
  description?: string | null;
  method: McpHttpMethod;
  pathTemplate: string;
  paramMap?: McpParamMap;
  allowMutation?: boolean;
  enabled?: boolean;
};

export type UpdateToolInput = {
  name?: string;
  description?: string | null;
  method?: McpHttpMethod;
  pathTemplate?: string;
  paramMap?: McpParamMap;
  allowMutation?: boolean;
  enabled?: boolean;
};

export type SetCredentialInput = {
  scheme: McpCredentialScheme;
  headerName?: string | null;
  valueLocation: McpValueLocation;
  secret?: string;
};

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

async function hasCredential(db: DB, serverId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: mcpCredential.id })
    .from(mcpCredential)
    .where(eq(mcpCredential.serverId, serverId))
    .limit(1);
  return Boolean(row);
}

export type McpServerWithMeta = McpServer & {
  trafficLight: TrafficLight;
  hasSecret: boolean;
};

export async function attachTrafficLight(
  db: DB,
  servers: McpServer[],
): Promise<McpServerWithMeta[]> {
  return Promise.all(
    servers.map(async (server) => {
      const [enabledToolCount, recentCallStatuses, secret] = await Promise.all([
        countEnabledTools(db, server.id),
        recentProductCallStatuses(db, server.id),
        hasCredential(db, server.id),
      ]);
      return {
        ...server,
        hasSecret: secret,
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
  tools: Array<{
    name: string;
    description: string | null;
    method: string;
    pathTemplate: string;
    paramMap: McpParamMap;
    allowMutation: boolean;
    enabled: boolean;
    source: string;
  }>;
  credential: {
    scheme: string;
    headerName: string | null;
    valueLocation: string;
  } | null;
}) {
  return {
    name: input.name,
    description: input.description,
    baseUrl: input.baseUrl,
    allowedHosts: input.allowedHosts,
    tools: input.tools,
    credentialScheme: input.credential,
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
  const slug = slugifyName(input.slug ?? input.name);
  const allowedHosts = deriveAllowedHosts(parsed.origin);

  try {
    const [created] = await db
      .insert(mcpServer)
      .values({
        userId,
        name: input.name.trim(),
        slug,
        description: input.description?.trim() || null,
        baseUrl: parsed.origin,
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
  const [credential] = await db
    .select({
      scheme: mcpCredential.scheme,
      headerName: mcpCredential.headerName,
      valueLocation: mcpCredential.valueLocation,
    })
    .from(mcpCredential)
    .where(eq(mcpCredential.serverId, server.id))
    .limit(1);

  return {
    ...withMeta,
    tools,
    credential: credential
      ? { ...credential, hasSecret: true }
      : {
          hasSecret: false,
          scheme: null,
          headerName: null,
          valueLocation: null,
        },
    recipe: toRecipeTemplate({
      name: server.name,
      description: server.description,
      baseUrl: server.baseUrl,
      allowedHosts: server.allowedHosts,
      tools,
      credential,
    }),
  };
}

export async function updateServer(
  db: DB,
  userId: string,
  serverId: string,
  input: UpdateServerInput,
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const nextBaseUrl = input.baseUrl
    ? parseBaseUrl(input.baseUrl).origin
    : server.baseUrl;
  const allowedHosts = input.allowedHosts
    ? deriveAllowedHosts(nextBaseUrl, input.allowedHosts)
    : input.baseUrl
      ? deriveAllowedHosts(nextBaseUrl, server.allowedHosts)
      : server.allowedHosts;

  const [updated] = await db
    .update(mcpServer)
    .set({
      name: input.name?.trim() ?? server.name,
      description:
        input.description === undefined
          ? server.description
          : input.description?.trim() || null,
      baseUrl: nextBaseUrl,
      allowedHosts,
      status: input.status ?? server.status,
    })
    .where(eq(mcpServer.id, server.id))
    .returning();

  const [withMeta] = await attachTrafficLight(db, [updated]);
  return withMeta;
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

  try {
    const [created] = await db
      .insert(mcpTool)
      .values({
        serverId: server.id,
        name,
        description: input.description?.trim() || null,
        method,
        pathTemplate: input.pathTemplate.startsWith("/")
          ? input.pathTemplate
          : `/${input.pathTemplate}`,
        paramMap: input.paramMap ?? {},
        allowMutation: flags.allowMutation,
        enabled: flags.enabled,
        source,
      })
      .returning();
    await promoteServerIfReady(db, server.id, server.status);
    return created;
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
  staticQuery: Record<string, string>;
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
  const staticQuery: Record<string, string> = {};
  target.searchParams.forEach((value, key) => {
    staticQuery[key] = value;
  });
  return { pathTemplate, staticQuery };
}

export async function createToolFromCurl(
  db: DB,
  userId: string,
  serverId: string,
  input: { curl: string; name?: string; description?: string | null },
) {
  const server = await requireOwnedServer(db, userId, serverId);
  const parsed = parseCurlCommand(input.curl);
  const { pathTemplate, staticQuery } = toolPathFromCurl(
    server.baseUrl,
    parsed.url,
  );
  const method = parsed.method.toUpperCase() as McpHttpMethod;
  const inferredName =
    input.name ??
    `${method.toLowerCase()}_${
      pathTemplate
        .replace(/^\//, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "request"
    }`;

  return createTool(
    db,
    userId,
    serverId,
    {
      name: inferredName,
      description: input.description ?? null,
      method,
      pathTemplate,
      paramMap: {
        staticQuery,
        staticHeaders: parsed.headers,
        staticBody: parsed.body,
      },
    },
    "curl",
  );
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
        pathTemplate: input.pathTemplate ?? existing.pathTemplate,
        paramMap: input.paramMap ?? existing.paramMap,
        allowMutation: flags.allowMutation,
        enabled: flags.enabled,
      })
      .where(eq(mcpTool.id, existing.id))
      .returning();
    return updated;
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

export async function setCredential(
  db: DB,
  userId: string,
  serverId: string,
  input: SetCredentialInput,
  credentialSecret: string,
) {
  await requireOwnedServer(db, userId, serverId);
  const headerName =
    input.headerName ??
    (input.scheme === "bearer" ? "Authorization" : "X-API-Key");
  const nextSecret = input.secret?.trim() ?? "";

  const [existing] = await db
    .select({ id: mcpCredential.id, ciphertext: mcpCredential.ciphertext })
    .from(mcpCredential)
    .where(eq(mcpCredential.serverId, serverId))
    .limit(1);

  if (!existing && !nextSecret) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_CREDENTIAL_REQUIRED,
      message: "An upstream credential is required.",
      status: 400,
    });
  }

  if (existing) {
    await db
      .update(mcpCredential)
      .set({
        scheme: input.scheme,
        headerName,
        valueLocation: input.valueLocation,
        ciphertext: nextSecret
          ? encryptCredential(nextSecret, credentialSecret)
          : existing.ciphertext,
      })
      .where(eq(mcpCredential.id, existing.id));
  } else {
    await db.insert(mcpCredential).values({
      serverId,
      scheme: input.scheme,
      headerName,
      valueLocation: input.valueLocation,
      ciphertext: encryptCredential(nextSecret, credentialSecret),
    });
  }

  return {
    hasSecret: true,
    scheme: input.scheme,
    headerName,
    valueLocation: input.valueLocation,
  };
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
