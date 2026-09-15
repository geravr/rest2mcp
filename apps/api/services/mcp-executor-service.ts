/**
 * @file Shared MCP tool executor used by the gateway, playground, and platform MCP.
 * Builds upstream requests by rendering templates with args + server variables.
 */
import {
  mcpCallLog,
  mcpServer,
  mcpServerVariable,
  mcpTool,
  type McpRequestTemplate,
  type McpServer,
  type McpTool,
} from "@repo/db";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { APP_ERROR_CODES, AppError, appError } from "../lib/app-error.js";
import { decryptCredential } from "../lib/mcp-crypto.js";
import {
  capResponseBody,
  MCP_RESPONSE_LIMIT,
  MCP_UPSTREAM_TIMEOUT_MS,
  redactText,
  summarizeForLog,
} from "../lib/mcp-redact.js";
import {
  assertSameHostRedirect,
  assertUpstreamUrlSafe,
} from "../lib/mcp-ssrf.js";
import {
  renderTemplate,
  type RenderScope,
  type TemplateVariable,
} from "../lib/mcp-template.js";

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
  /** Id of the persisted call-log row, so the playground can link to it. */
  callLogId: string | null;
};

function joinUrlPath(basePath: string, toolPath: string): string {
  const left = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const right = toolPath.startsWith("/") ? toolPath : `/${toolPath}`;
  if (!left || left === "") return right;
  return `${left}${right}`;
}

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

function buildRequest(
  server: McpServer,
  tool: McpTool,
  scope: RenderScope,
): { url: URL; headers: Headers; body: string | undefined } {
  const template: McpRequestTemplate = tool.requestTemplate ?? {};
  const method = tool.method.toUpperCase();

  const base = new URL(server.baseUrl);
  const url = new URL(base.toString());
  url.pathname = joinUrlPath(
    base.pathname,
    renderTemplate(tool.pathTemplate, "path", scope),
  );

  const queryEntries: Record<string, string> = {
    ...(server.defaultQuery ?? {}),
    ...(template.query ?? {}),
  };
  const queryParts: string[] = [];
  for (const [key, valueTemplate] of Object.entries(queryEntries)) {
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
  for (const [name, valueTemplate] of Object.entries(template.headers ?? {})) {
    headers.set(name, renderTemplate(valueTemplate, "header", scope));
  }

  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD" && template.body != null) {
    const bodyType = template.bodyType ?? "json";
    body = renderTemplate(template.body, bodyType, scope);
    if (!headers.has("content-type")) {
      if (bodyType === "json") {
        headers.set("content-type", "application/json");
      } else if (bodyType === "form") {
        headers.set("content-type", "application/x-www-form-urlencoded");
      }
    }
  }

  return { url, headers, body };
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
  const scope: RenderScope = {
    args,
    variables: {},
    secretsUsed: new Set<string>(),
  };

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

  const secrets = () => [...scope.secretsUsed];

  const persistLog = async (entry: {
    status: string;
    httpStatus: number | null;
    appCode: string | null;
    requestSummary: string | null;
    responseSummary: string | null;
  }): Promise<string | null> => {
    const [row] = await db
      .insert(mcpCallLog)
      .values({
        serverId: server.id,
        toolId: tool.id,
        source: input.source,
        status: entry.status,
        httpStatus: entry.httpStatus,
        durationMs: Date.now() - started,
        appCode: entry.appCode,
        requestSummary: entry.requestSummary,
        responseSummary: entry.responseSummary,
      })
      .returning({ id: mcpCallLog.id });
    return row?.id ?? null;
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

    scope.variables = await loadVariables(
      db,
      server.id,
      input.credentialSecret,
    );
    const { url, headers, body } = buildRequest(server, tool, scope);

    await assertUpstreamUrlSafe(url.toString(), server.allowedHosts);

    const requestSummary = summarizeForLog(
      JSON.stringify({
        method,
        url: url.toString(),
        headers: Object.fromEntries(headers.entries()),
        body: body ?? null,
      }),
      secrets(),
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
    const responseSummary = summarizeForLog(capped.text, secrets());
    const durationMs = Date.now() - started;
    const ok = response.ok;

    const callLogId = await persistLog({
      status: ok ? "success" : "error",
      httpStatus: response.status,
      appCode: ok ? null : APP_ERROR_CODES.MCP_UPSTREAM_ERROR,
      requestSummary,
      responseSummary,
    });

    return {
      ok,
      httpStatus: response.status,
      body: redactText(capped.text, secrets()),
      truncated: capped.truncated,
      durationMs,
      contentType: response.headers.get("content-type"),
      callLogId,
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
            secrets(),
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
        secrets(),
      ),
      responseSummary: null,
    });
    throw error;
  }
}
