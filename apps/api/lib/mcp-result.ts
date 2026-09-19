/**
 * @file Single structured MCP tool result contract shared by the product
 * gateway, the playground, and Platform MCP. Success keeps the canonical
 * execution fields; every failure carries one nested `error` object with a
 * stable category, retryability, and location-aware issues. No legacy flat
 * error fields are emitted.
 */
import { z } from "zod";
import { APP_ERROR_CODES, AppError, type AppErrorCode } from "./app-error.js";

export const MCP_TOOL_ERROR_CATEGORIES = [
  "invalid_arguments",
  "policy",
  "auth",
  "not_found",
  "conflict",
  "rate_limit",
  "upstream",
  "timeout",
  "network",
  "internal",
] as const;

export type McpToolErrorCategory = (typeof MCP_TOOL_ERROR_CATEGORIES)[number];

export const mcpToolIssueSchema = z.strictObject({
  /** Corrective location, e.g. `limit` or `args.contact_id`. */
  path: z.string(),
  /** Stable definition-local id of the affected node, when known. */
  id: z.string().optional(),
  /** Stable code the agent can branch on. */
  code: z.string(),
  message: z.string(),
});

export type McpToolIssue = z.infer<typeof mcpToolIssueSchema>;

export const mcpToolErrorSchema = z.strictObject({
  category: z.enum(MCP_TOOL_ERROR_CATEGORIES),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().optional(),
  indeterminate: z.boolean().optional(),
  issues: z.array(mcpToolIssueSchema).optional(),
});

export type McpToolError = z.infer<typeof mcpToolErrorSchema>;

/**
 * Agent-visible result envelope. Success sets `data` or `body`; failure sets
 * `error`. Both share `ok`, `status`, `contentType`, `headers`, and `truncated`
 * so a single advertised output schema validates every completion.
 */
export const mcpToolEnvelopeSchema = z.strictObject({
  ok: z.boolean(),
  status: z.number().int().nullable(),
  contentType: z.string().nullable(),
  data: z.unknown().optional(),
  body: z.string().optional(),
  headers: z.record(z.string(), z.string()),
  truncated: z.boolean(),
  binary: z.boolean().optional(),
  error: mcpToolErrorSchema.optional(),
});

export type McpToolEnvelope = z.infer<typeof mcpToolEnvelopeSchema>;

/** Advertised MCP `outputSchema`, derived from the same runtime validator. */
export const mcpToolOutputJsonSchema = z.toJSONSchema(mcpToolEnvelopeSchema, {
  io: "output",
  target: "draft-2020-12",
});

export type McpErrorContext = {
  /** HTTP status of a completed upstream response, when one exists. */
  status?: number | null;
  /** True when a mutation may have reached upstream without a determinate result. */
  indeterminate?: boolean;
  /** True when the executed method is safe to repeat without side effects. */
  idempotent?: boolean;
  retryAfterSeconds?: number;
};

const INVALID_ARGUMENT_CODES = new Set<string>([
  APP_ERROR_CODES.INVALID_INPUT,
  APP_ERROR_CODES.MCP_COMPILE_INVALID,
  APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
]);

const POLICY_CODES = new Set<string>([
  APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
  APP_ERROR_CODES.MCP_PLAINTEXT_SECRET,
  APP_ERROR_CODES.MCP_SCOPE_DENIED,
  APP_ERROR_CODES.MCP_TOOL_DISABLED,
  APP_ERROR_CODES.MCP_SERVER_PAUSED,
  APP_ERROR_CODES.MCP_DESTRUCTIVE_CONFIRMATION_REQUIRED,
  APP_ERROR_CODES.MCP_AUTH_ACK_REQUIRED,
  APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
  APP_ERROR_CODES.MCP_PATH_ESCAPE,
  APP_ERROR_CODES.MCP_LEGACY_DOWNGRADE_REJECTED,
  APP_ERROR_CODES.MCP_LEGACY_PROJECTION_UNAVAILABLE,
]);

const AUTH_CODES = new Set<string>([
  APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
  APP_ERROR_CODES.ACCOUNT_SUSPENDED,
  APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
]);

const NOT_FOUND_CODES = new Set<string>([
  APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
  APP_ERROR_CODES.MCP_TOOL_NOT_FOUND,
  APP_ERROR_CODES.USER_NOT_FOUND,
]);

const CONFLICT_CODES = new Set<string>([
  APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
  APP_ERROR_CODES.MCP_SERVER_SLUG_CONFLICT,
  APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
  APP_ERROR_CODES.MCP_VALUE_IN_USE,
  APP_ERROR_CODES.MCP_TOOL_DISABLED,
]);

const RATE_LIMIT_CODES = new Set<string>([
  APP_ERROR_CODES.MCP_RATE_LIMITED,
  APP_ERROR_CODES.OTP_SEND_RATE_LIMITED,
]);

const UPSTREAM_CODES = new Set<string>([
  APP_ERROR_CODES.MCP_UPSTREAM_ERROR,
  APP_ERROR_CODES.MCP_UPSTREAM_HTTP_ERROR,
  APP_ERROR_CODES.MCP_REDIRECT_REJECTED,
  APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE,
]);

/** Maps a stable catalog code to its agent-facing failure category. */
export function categoryForAppCode(code: string): McpToolErrorCategory {
  if (INVALID_ARGUMENT_CODES.has(code)) return "invalid_arguments";
  if (POLICY_CODES.has(code)) return "policy";
  if (AUTH_CODES.has(code)) return "auth";
  if (NOT_FOUND_CODES.has(code)) return "not_found";
  if (RATE_LIMIT_CODES.has(code)) return "rate_limit";
  if (code === APP_ERROR_CODES.MCP_TIMEOUT) return "timeout";
  if (UPSTREAM_CODES.has(code)) return "upstream";
  if (CONFLICT_CODES.has(code)) return "conflict";
  return "internal";
}

/**
 * Central retry classifier. Defaults to non-retryable; only rate limits and
 * determinate read/idempotent transient failures may be retried automatically.
 * Indeterminate mutations are never safe to retry automatically.
 */
export function isRetryableFailure(
  category: McpToolErrorCategory,
  context: Pick<McpErrorContext, "indeterminate" | "idempotent"> = {},
): boolean {
  if (context.indeterminate) return false;
  if (category === "rate_limit") return true;
  if (category === "timeout") return true;
  if (category === "upstream" || category === "network") {
    return context.idempotent === true;
  }
  return false;
}

const READ_IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);

export function methodIsIdempotent(method: string): boolean {
  return READ_IDEMPOTENT_METHODS.has(method.toUpperCase());
}

function appErrorIssues(
  error: AppError,
  category: McpToolErrorCategory,
): McpToolIssue[] | undefined {
  const details = error.details ?? {};
  if (category === "policy" && details.scopes?.length) {
    return details.scopes.map((scope) => ({
      path: "scope",
      code: error.appCode,
      message: `Missing required scope: ${scope}.`,
    }));
  }
  if (details.path === undefined && details.nodeId === undefined) {
    return undefined;
  }
  return [
    {
      path: details.path ?? "arguments",
      ...(details.nodeId !== undefined ? { id: details.nodeId } : {}),
      code: details.issueCode ?? error.appCode,
      message: error.message,
    },
  ];
}

/** Builds the nested error object from an `AppError` plus execution context. */
export function toMcpToolError(
  error: AppError,
  context: McpErrorContext = {},
): McpToolError {
  const category = categoryForAppCode(error.appCode);
  const indeterminate =
    context.indeterminate === true ||
    error.appCode === APP_ERROR_CODES.MCP_MUTATION_INDETERMINATE;
  const retryable = isRetryableFailure(category, {
    indeterminate,
    idempotent: context.idempotent,
  });
  const retryAfterSeconds =
    context.retryAfterSeconds ?? error.details?.retryAfterSeconds;
  const issues = appErrorIssues(error, category);
  return {
    category,
    code: error.appCode,
    message: error.message,
    retryable,
    ...(retryable && retryAfterSeconds !== undefined
      ? { retryAfterSeconds }
      : {}),
    ...(indeterminate ? { indeterminate: true } : {}),
    ...(issues !== undefined ? { issues } : {}),
  };
}

export function errorEnvelope(
  error: McpToolError,
  overrides: Partial<Omit<McpToolEnvelope, "ok" | "error">> = {},
): McpToolEnvelope {
  return {
    ok: false,
    status: overrides.status ?? null,
    contentType: overrides.contentType ?? null,
    ...(overrides.data !== undefined ? { data: overrides.data } : {}),
    ...(overrides.body !== undefined ? { body: overrides.body } : {}),
    headers: overrides.headers ?? {},
    truncated: overrides.truncated ?? false,
    ...(overrides.binary !== undefined ? { binary: overrides.binary } : {}),
    error,
  };
}

/** Redacted, schema-valid fallback used when a path produces a bad envelope. */
export function internalErrorEnvelope(): McpToolEnvelope {
  return errorEnvelope({
    category: "internal",
    code: APP_ERROR_CODES.INTERNAL_ERROR,
    message: "The tool returned an unexpected result.",
    retryable: false,
  });
}

/** Error-side envelope schema, matching the shared failure contract. */
export const mcpToolErrorEnvelopeSchema = z.strictObject({
  ok: z.literal(false),
  status: z.number().int().nullable(),
  contentType: z.string().nullable(),
  data: z.unknown().optional(),
  body: z.string().optional(),
  headers: z.record(z.string(), z.string()),
  truncated: z.boolean(),
  binary: z.boolean().optional(),
  error: mcpToolErrorSchema,
});

/** Typed success envelope for tools whose `data` has an explicit schema. */
export function successEnvelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.strictObject({
    ok: z.literal(true),
    status: z.number().int().nullable(),
    contentType: z.string().nullable(),
    data,
    headers: z.record(z.string(), z.string()),
    truncated: z.boolean(),
  });
}

export type McpCallToolResult = {
  isError?: true;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
};

/**
 * Validates one envelope against the advertised output schema and serializes
 * both MCP `content` text and `structuredContent` from the same safe object.
 * A schema-invalid envelope falls back to the minimal internal-error envelope
 * and reports the defect to the caller's telemetry hook.
 */
export function buildMcpToolResult(
  envelope: McpToolEnvelope,
  options: {
    onDefect?: (reason: string) => void;
    validator?: z.ZodType<Record<string, unknown>>;
  } = {},
): McpCallToolResult {
  let safe = envelope;
  const validator =
    options.validator ??
    (mcpToolEnvelopeSchema as unknown as z.ZodType<Record<string, unknown>>);
  const parsed = validator.safeParse(envelope);
  if (!parsed.success) {
    options.onDefect?.(
      parsed.error.issues[0]?.message ??
        "Tool result failed schema validation.",
    );
    safe = internalErrorEnvelope();
  } else {
    // Emit the schema projection, not the raw object, so undeclared fields
    // never reach `content`/`structuredContent`.
    safe = parsed.data as McpToolEnvelope;
  }
  const payload = safe as Record<string, unknown>;
  return {
    ...(safe.error ? { isError: true as const } : {}),
    content: [{ type: "text" as const, text: JSON.stringify(safe) }],
    structuredContent: payload,
  };
}

/**
 * Normalizes Zod validation issues into location-aware diagnostics. Only the
 * corrective field path and expected constraint are returned; received values
 * are never echoed.
 */
export function zodErrorToIssues(
  error: z.ZodError,
  nameToId?: Map<string, string>,
): McpToolIssue[] {
  return error.issues.map((issue) => {
    const segments = issue.path.map((segment) => String(segment));
    const root = segments[0];
    return {
      path: segments.length > 0 ? segments.join(".") : "arguments",
      ...(root !== undefined && nameToId?.get(root) !== undefined
        ? { id: nameToId.get(root)! }
        : {}),
      code: APP_ERROR_CODES.INVALID_INPUT,
      message: issue.message,
    };
  });
}

export function invalidArgumentsEnvelope(
  error: z.ZodError,
  nameToId?: Map<string, string>,
): McpToolEnvelope {
  return errorEnvelope({
    category: "invalid_arguments",
    code: APP_ERROR_CODES.INVALID_INPUT,
    message: "Invalid tool arguments.",
    retryable: false,
    issues: zodErrorToIssues(error, nameToId),
  });
}

/**
 * Maps a completed non-2xx upstream response to the structured error contract.
 * A completed HTTP response never uses `MCP_UPSTREAM_ERROR`.
 */
export function upstreamHttpToolError(
  status: number,
  context: { method: string; retryAfterSeconds?: number },
): McpToolError {
  const idempotent = methodIsIdempotent(context.method);
  const category: McpToolErrorCategory =
    status === 401 || status === 407
      ? "auth"
      : status === 403
        ? "policy"
        : status === 404
          ? "not_found"
          : status === 409
            ? "conflict"
            : status === 429
              ? "rate_limit"
              : status === 408 || status === 504
                ? "timeout"
                : "upstream";
  // A completed timeout on a non-idempotent method may already have been
  // applied upstream, so it is indeterminate and never automatically retryable.
  const indeterminate = !idempotent && category === "timeout";
  const retryable = isRetryableFailure(category, { idempotent, indeterminate });
  return {
    category,
    code: APP_ERROR_CODES.MCP_UPSTREAM_HTTP_ERROR,
    message:
      category === "auth"
        ? "Upstream authentication failed."
        : category === "rate_limit"
          ? "Upstream rate limit was exceeded."
          : `Upstream responded with status ${status}.`,
    retryable,
    ...(retryable && context.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: context.retryAfterSeconds }
      : {}),
    ...(indeterminate ? { indeterminate: true } : {}),
  };
}

export type { AppErrorCode };
