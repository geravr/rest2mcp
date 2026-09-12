/**
 * @file Shared MCP tool executor used by the gateway, playground, and platform MCP.
 */
import {
  mcpCallLog,
  mcpCredential,
  mcpServer,
  mcpTool,
  type McpParamMap,
} from "@repo/db";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { APP_ERROR_CODES, AppError, appError } from "../lib/app-error.js";
import { decryptCredential } from "../lib/mcp-crypto.js";
import { isSafeToolHeaderName } from "../lib/mcp-curl.js";
import {
  capResponseBody,
  MCP_RESPONSE_LIMIT,
  MCP_UPSTREAM_TIMEOUT_MS,
  summarizeForLog,
} from "../lib/mcp-redact.js";
import {
  assertSameHostRedirect,
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
  ok: boolean;
  httpStatus: number | null;
  body: string;
  truncated: boolean;
  durationMs: number;
  contentType: string | null;
};

function joinUrlPath(basePath: string, toolPath: string): string {
  const left = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const right = toolPath.startsWith("/") ? toolPath : `/${toolPath}`;
  if (!left || left === "") return right;
  return `${left}${right}`;
}

function readArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function applyPathTemplate(
  pathTemplate: string,
  args: Record<string, unknown>,
  paramMap: McpParamMap,
): string {
  return pathTemplate.replace(
    /\{([A-Za-z0-9_]+)\}/g,
    (_, placeholder: string) => {
      const argName = paramMap.path?.[placeholder] ?? placeholder;
      const value = readArg(args, argName);
      if (value === undefined) {
        throw appError({
          appCode: APP_ERROR_CODES.INVALID_INPUT,
          message: `Missing path parameter "${placeholder}".`,
          status: 400,
        });
      }
      return encodeURIComponent(value);
    },
  );
}

function buildUpstreamUrl(
  baseUrl: string,
  pathTemplate: string,
  args: Record<string, unknown>,
  paramMap: McpParamMap,
): URL {
  const base = new URL(baseUrl);
  const path = applyPathTemplate(pathTemplate, args, paramMap);
  const url = new URL(base.toString());
  url.pathname = joinUrlPath(base.pathname, path);

  for (const [key, value] of Object.entries(paramMap.staticQuery ?? {})) {
    url.searchParams.set(key, value);
  }
  for (const [queryKey, argName] of Object.entries(paramMap.query ?? {})) {
    const value = readArg(args, argName);
    if (value !== undefined) {
      url.searchParams.set(queryKey, value);
    }
  }
  return url;
}

function buildHeaders(
  args: Record<string, unknown>,
  paramMap: McpParamMap,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(paramMap.staticHeaders ?? {})) {
    if (!isSafeToolHeaderName(name)) continue;
    headers.set(name, value);
  }
  for (const [headerName, argName] of Object.entries(paramMap.header ?? {})) {
    if (!isSafeToolHeaderName(headerName)) continue;
    const value = readArg(args, argName);
    if (value !== undefined) {
      headers.set(headerName, value);
    }
  }
  return headers;
}

function buildBody(
  method: string,
  args: Record<string, unknown>,
  paramMap: McpParamMap,
): string | undefined {
  if (method === "GET" || method === "HEAD") return undefined;
  if (paramMap.staticBody) return paramMap.staticBody;
  if (args.body !== undefined) {
    return typeof args.body === "string"
      ? args.body
      : JSON.stringify(args.body);
  }
  if (Array.isArray(paramMap.body)) {
    const payload: Record<string, unknown> = {};
    for (const key of paramMap.body) {
      if (args[key] !== undefined) payload[key] = args[key];
    }
    return Object.keys(payload).length > 0
      ? JSON.stringify(payload)
      : undefined;
  }
  if (paramMap.body && typeof paramMap.body === "object") {
    const payload: Record<string, unknown> = {};
    for (const [bodyKey, argName] of Object.entries(paramMap.body)) {
      if (args[argName] !== undefined) payload[bodyKey] = args[argName];
    }
    return Object.keys(payload).length > 0
      ? JSON.stringify(payload)
      : undefined;
  }
  return undefined;
}

function injectCredential(
  url: URL,
  headers: Headers,
  credential: {
    scheme: string;
    headerName: string | null;
    valueLocation: string;
    secret: string;
  },
): void {
  const headerName =
    credential.headerName ??
    (credential.scheme === "bearer" ? "Authorization" : "X-API-Key");

  if (credential.valueLocation === "query") {
    url.searchParams.set(headerName, credential.secret);
    return;
  }

  if (credential.scheme === "bearer") {
    headers.set(headerName, `Bearer ${credential.secret}`);
    return;
  }

  headers.set(headerName, credential.secret);
}

async function readCappedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > MCP_RESPONSE_LIMIT) {
      await reader.cancel();
      break;
    }
  }
  return text;
}

async function fetchWithSafeRedirects(
  url: URL,
  init: RequestInit,
  allowedHosts: string[],
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    await assertUpstreamUrlSafe(current.toString(), allowedHosts);
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) return response;
    current = assertSameHostRedirect(current, location);
    init = { ...init, method: "GET", body: undefined };
  }
  throw appError({
    appCode: APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
    message: "Too many redirects.",
    status: 403,
  });
}

export async function executeMappedTool(
  db: DB,
  input: ExecuteMappedToolInput,
): Promise<ExecuteMappedToolResult> {
  const started = Date.now();
  const args = input.args ?? {};
  const secrets: string[] = [];

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

  const persistLog = async (entry: {
    status: string;
    httpStatus: number | null;
    appCode: string | null;
    requestSummary: string | null;
    responseSummary: string | null;
  }) => {
    await db.insert(mcpCallLog).values({
      serverId: server.id,
      toolId: tool.id,
      source: input.source,
      status: entry.status,
      httpStatus: entry.httpStatus,
      durationMs: Date.now() - started,
      appCode: entry.appCode,
      requestSummary: entry.requestSummary,
      responseSummary: entry.responseSummary,
    });
  };

  try {
    if (server.status === "paused") {
      throw appError({
        appCode: APP_ERROR_CODES.INVALID_INPUT,
        message: "Server is paused.",
        status: 400,
      });
    }

    if (!tool.enabled) {
      throw appError({
        appCode: APP_ERROR_CODES.INVALID_INPUT,
        message: "Tool is disabled.",
        status: 400,
      });
    }

    const method = tool.method.toUpperCase();
    if (MUTATING_METHODS.has(method) && !tool.allowMutation) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
        message: "Mutating this tool is not allowed.",
        status: 403,
      });
    }

    const paramMap = tool.paramMap ?? {};
    const url = buildUpstreamUrl(
      server.baseUrl,
      tool.pathTemplate,
      args,
      paramMap,
    );
    const headers = buildHeaders(args, paramMap);
    const body = buildBody(method, args, paramMap);
    if (body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const [credential] = await db
      .select()
      .from(mcpCredential)
      .where(eq(mcpCredential.serverId, server.id))
      .limit(1);

    if (credential) {
      if (!credential.ciphertext) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_CREDENTIAL_REQUIRED,
          message: "This tool requires an upstream credential.",
          status: 400,
        });
      }
      const secret = decryptCredential(
        credential.ciphertext,
        input.credentialSecret,
      );
      secrets.push(secret);
      injectCredential(url, headers, {
        scheme: credential.scheme,
        headerName: credential.headerName,
        valueLocation: credential.valueLocation,
        secret,
      });
    }

    await assertUpstreamUrlSafe(url.toString(), server.allowedHosts);

    const requestSummary = summarizeForLog(
      JSON.stringify({
        method,
        url: url.toString(),
        headers: Object.fromEntries(headers.entries()),
        body: body ?? null,
      }),
      secrets,
    );

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      MCP_UPSTREAM_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetchWithSafeRedirects(
        url,
        {
          method,
          headers,
          body: method === "GET" || method === "HEAD" ? undefined : body,
          signal: controller.signal,
        },
        server.allowedHosts,
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      await persistLog({
        status: "error",
        httpStatus: null,
        appCode: APP_ERROR_CODES.MCP_UPSTREAM_ERROR,
        requestSummary,
        responseSummary: null,
      });
      throw appError({
        appCode: APP_ERROR_CODES.MCP_UPSTREAM_ERROR,
        message: "Upstream request failed.",
        status: 502,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    const rawBody = await readCappedBody(response);
    const capped = capResponseBody(rawBody);
    const responseSummary = summarizeForLog(capped.text, secrets);
    const durationMs = Date.now() - started;

    if (!response.ok) {
      await persistLog({
        status: "error",
        httpStatus: response.status,
        appCode: APP_ERROR_CODES.MCP_UPSTREAM_ERROR,
        requestSummary,
        responseSummary,
      });
      throw appError({
        appCode: APP_ERROR_CODES.MCP_UPSTREAM_ERROR,
        message: `Upstream responded with ${response.status}.`,
        status: 502,
      });
    }

    await persistLog({
      status: "success",
      httpStatus: response.status,
      appCode: null,
      requestSummary,
      responseSummary,
    });

    return {
      ok: true,
      httpStatus: response.status,
      body: capped.text,
      truncated: capped.truncated,
      durationMs,
      contentType: response.headers.get("content-type"),
    };
  } catch (error) {
    if (error instanceof AppError) {
      if (error.appCode !== APP_ERROR_CODES.MCP_UPSTREAM_ERROR) {
        await persistLog({
          status: "error",
          httpStatus: null,
          appCode: error.appCode,
          requestSummary: summarizeForLog(
            JSON.stringify({ serverId: server.id, tool: tool.name, args }),
            secrets,
          ),
          responseSummary: null,
        });
      }
      throw error;
    }

    await persistLog({
      status: "error",
      httpStatus: null,
      appCode: APP_ERROR_CODES.INTERNAL_ERROR,
      requestSummary: summarizeForLog(
        JSON.stringify({ serverId: server.id, tool: tool.name, args }),
        secrets,
      ),
      responseSummary: null,
    });
    throw error;
  }
}
