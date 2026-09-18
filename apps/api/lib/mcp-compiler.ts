/**
 * @file Pure publish-time compiler for versioned MCP request definitions.
 * Resolves every binding by its declared source, enforces namespace and
 * placement invariants, and produces an immutable effective request plan.
 * No database or network I/O happens here.
 */
import { createHash } from "node:crypto";
import { APP_ERROR_CODES, appError } from "./app-error.js";
import { isForbiddenTransportHeaderName } from "./mcp-policy.js";
import type {
  McpAgentInput,
  McpAuthConfiguration,
  McpBehaviorAnnotations,
  McpCommonEntries,
  McpCompiledPlan,
  McpCompileIssue,
  McpJsonNode,
  McpNamedEntry,
  McpPathSegment,
  McpRequestDefinition,
  McpValueBinding,
} from "./mcp-request-definition.js";

export type CompileServerValueRef = {
  id: string;
  name: string;
  kind: "config" | "secret";
  owner: "manual" | "auth";
};

export type CompileContext = {
  method: string;
  definition: McpRequestDefinition;
  common: McpCommonEntries;
  auth: McpAuthConfiguration | null;
  serverValues: CompileServerValueRef[];
  /** Pathname of the server's `baseUrl`. */
  basePath: string;
  allowMutation: boolean;
};

export type CompileResult = {
  ok: boolean;
  plan: McpCompiledPlan | null;
  issues: McpCompileIssue[];
};

const READ_METHODS = new Set(["GET", "HEAD"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Never settable per-request: reserved for the transport layer. */
const isForbiddenHeaderName = isForbiddenTransportHeaderName;

type CompiledEntry = {
  name: string;
  source: McpValueBinding;
  omitWhenAbsent?: boolean;
};

type CompiledFormField = CompiledEntry;

type CompiledHeader = CompiledEntry & { protected?: boolean };

type PushIssue = (
  path: string,
  code: string,
  message: string,
  severity?: "error" | "warning",
) => void;

/**
 * Recursive-descent-free POSIX path normalizer used only to check literal
 * base-path confinement at compile time (dynamic bindings are re-checked by
 * the executor once their runtime value is known).
 */
export function normalizePosixPath(path: string): string {
  const isAbsolute = path.startsWith("/");
  const stack: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(part);
  }
  const joined = stack.join("/");
  return isAbsolute ? `/${joined}` : joined;
}

export function normalizeBase(basePath: string): string {
  const withLeading = basePath.startsWith("/") ? basePath : `/${basePath}`;
  const normalized = normalizePosixPath(withLeading);
  return normalized === "" ? "/" : normalized;
}

export function isUnderBasePath(
  normalizedPath: string,
  normalizedBase: string,
): boolean {
  if (normalizedBase === "/") return normalizedPath.startsWith("/");
  return (
    normalizedPath === normalizedBase ||
    normalizedPath.startsWith(`${normalizedBase}/`)
  );
}

/** Opaque token standing in for a runtime-resolved (non-literal) segment. */
const DYNAMIC_PATH_TOKEN = "\u0000dynamic\u0000";

function checkBasePathConfinement(
  basePath: string,
  segments: McpPathSegment[],
): boolean {
  const base = normalizeBase(basePath);
  let simulated = base;
  for (const segment of segments) {
    simulated +=
      segment.value.kind === "literal"
        ? String(segment.value.value)
        : DYNAMIC_PATH_TOKEN;
  }
  return isUnderBasePath(normalizePosixPath(simulated), base);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeDefinitionHash(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function deriveAnnotations(
  method: string,
  author: McpBehaviorAnnotations | undefined,
): McpBehaviorAnnotations {
  const isRead = READ_METHODS.has(method);
  const defaults: Required<McpBehaviorAnnotations> = {
    readOnlyHint: isRead,
    destructiveHint: method === "DELETE",
    idempotentHint:
      method === "GET" ||
      method === "HEAD" ||
      method === "PUT" ||
      method === "DELETE",
    openWorldHint: true,
  };
  return {
    readOnlyHint: author?.readOnlyHint ?? defaults.readOnlyHint,
    destructiveHint: author?.destructiveHint ?? defaults.destructiveHint,
    idempotentHint: author?.idempotentHint ?? defaults.idempotentHint,
    openWorldHint: author?.openWorldHint ?? defaults.openWorldHint,
  };
}

export function compileToolDefinition(ctx: CompileContext): CompileResult {
  const issues: McpCompileIssue[] = [];
  const push: PushIssue = (path, code, message, severity = "error") => {
    issues.push({ path, code, message, severity });
  };

  const method = ctx.method.toUpperCase();
  const serverValueById = new Map(ctx.serverValues.map((v) => [v.id, v]));
  const serverValueNames = new Set(ctx.serverValues.map((v) => v.name));
  const agentInputById = new Map<string, McpAgentInput>();
  const agentInputsByName = new Map<string, McpAgentInput[]>();
  const usedAgentInputIds = new Set<string>();

  for (const input of ctx.definition.agentInputs) {
    if (agentInputById.has(input.id)) {
      push(
        "agentInputs",
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `Agent input id "${input.id}" is declared more than once.`,
      );
      continue;
    }
    agentInputById.set(input.id, input);
    const byName = agentInputsByName.get(input.name) ?? [];
    byName.push(input);
    agentInputsByName.set(input.name, byName);

    if (
      input.required &&
      input.type === "string" &&
      input.minLength === 0 &&
      input.allowEmpty !== true
    ) {
      push(
        `agentInputs.${input.name}`,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `Required string input "${input.name}" permits an empty value; set allowEmpty to confirm intent.`,
      );
    }
  }

  for (const [name, declared] of agentInputsByName) {
    if (declared.length > 1) {
      push(
        `agentInputs.${name}`,
        APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
        `Agent input name "${name}" is declared more than once with different ids.`,
      );
    }
    if (serverValueNames.has(name)) {
      push(
        `agentInputs.${name}`,
        APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
        `Agent input name "${name}" collides with a server value name.`,
      );
    }
  }

  function resolveBinding(
    binding: McpValueBinding,
    path: string,
    options: { allowAuthOwned?: boolean } = {},
  ): void {
    if (binding.kind === "literal") return;
    if (binding.kind === "serverValue") {
      const value = serverValueById.get(binding.serverValueId);
      if (!value) {
        push(
          path,
          APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
          `Server value "${binding.serverValueId}" referenced at ${path} does not exist.`,
        );
        return;
      }
      if (value.owner === "auth" && !options.allowAuthOwned) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `Server value "${value.name}" is owned by authentication and can only be referenced through the auth configuration.`,
        );
      }
      return;
    }
    const input = agentInputById.get(binding.agentInputId);
    if (!input) {
      push(
        path,
        APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
        `Agent input "${binding.agentInputId}" referenced at ${path} is not declared.`,
      );
      return;
    }
    usedAgentInputIds.add(binding.agentInputId);
  }

  function isSecretBinding(binding: McpValueBinding): boolean {
    return (
      binding.kind === "serverValue" &&
      serverValueById.get(binding.serverValueId)?.kind === "secret"
    );
  }

  function isOptionalAgentInput(binding: McpValueBinding): boolean {
    if (binding.kind !== "agentInput") return false;
    const input = agentInputById.get(binding.agentInputId);
    return input?.required === false;
  }

  // ---- Path segments ----------------------------------------------------
  for (const [index, segment] of ctx.definition.pathSegments.entries()) {
    const path = `pathSegments[${index}]`;
    resolveBinding(segment.value, path);
    if (isSecretBinding(segment.value)) {
      push(
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        "Secret values cannot be placed in path segments.",
      );
    }
    if (isOptionalAgentInput(segment.value)) {
      push(
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        "Optional agent inputs cannot be used in path segments; path segments cannot be omitted.",
      );
    }
  }

  if (!checkBasePathConfinement(ctx.basePath, ctx.definition.pathSegments)) {
    push(
      "pathSegments",
      APP_ERROR_CODES.MCP_PATH_ESCAPE,
      "The literal path segments would escape the server base path.",
    );
  }

  // ---- Auth configuration -------------------------------------------------
  const authProtectedHeaderNames = new Set<string>();
  const authProtectedHeaderKeys: string[] = [];
  const authProtectedQueryKeys: string[] = [];
  const authHeaderEntries: CompiledHeader[] = [];
  const authQueryEntries: CompiledEntry[] = [];

  if (ctx.auth) {
    for (const [index, binding] of ctx.auth.bindings.entries()) {
      const path = `auth.bindings[${index}]`;
      const value = serverValueById.get(binding.serverValueId);
      if (!value) {
        push(
          path,
          APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
          `Authentication references unknown server value "${binding.serverValueId}".`,
        );
        continue;
      }

      if (binding.location === "header") {
        const lowerKey = binding.key.toLowerCase();
        if (isForbiddenHeaderName(lowerKey)) {
          push(
            path,
            APP_ERROR_CODES.MCP_COMPILE_INVALID,
            `"${binding.key}" cannot be used for authentication.`,
          );
          continue;
        }
        if (authProtectedHeaderNames.has(lowerKey)) {
          push(
            path,
            APP_ERROR_CODES.MCP_COMPILE_INVALID,
            `Authentication defines header "${binding.key}" more than once.`,
          );
          continue;
        }
        authProtectedHeaderNames.add(lowerKey);
        authProtectedHeaderKeys.push(binding.key);
        authHeaderEntries.push({
          name: binding.key,
          source: {
            kind: "serverValue",
            serverValueId: binding.serverValueId,
            ...(binding.prefix !== undefined ? { prefix: binding.prefix } : {}),
            ...(binding.suffix !== undefined ? { suffix: binding.suffix } : {}),
          },
          protected: true,
        });
      } else {
        if (authProtectedQueryKeys.includes(binding.key)) {
          push(
            path,
            APP_ERROR_CODES.MCP_COMPILE_INVALID,
            `Authentication defines query key "${binding.key}" more than once.`,
          );
          continue;
        }
        if (value.kind === "secret" && !ctx.auth.queryExposureAcknowledged) {
          push(
            path,
            APP_ERROR_CODES.MCP_AUTH_ACK_REQUIRED,
            `Placing secret "${value.name}" in the query string requires explicit exposure acknowledgement.`,
          );
        }
        authProtectedQueryKeys.push(binding.key);
        authQueryEntries.push({
          name: binding.key,
          source: {
            kind: "serverValue",
            serverValueId: binding.serverValueId,
            ...(binding.prefix !== undefined ? { prefix: binding.prefix } : {}),
            ...(binding.suffix !== undefined ? { suffix: binding.suffix } : {}),
          },
        });
      }
    }

    if (ctx.auth.kind === "basic") {
      for (const [field, id] of [
        ["basicUsernameValueId", ctx.auth.basicUsernameValueId],
        ["basicPasswordValueId", ctx.auth.basicPasswordValueId],
      ] as const) {
        if (id && !serverValueById.has(id)) {
          push(
            `auth.${field}`,
            APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
            `Basic authentication references unknown server value "${id}".`,
          );
        }
      }
    }
  }

  // ---- Header / query merge (common -> tool -> auth) ---------------------
  function validateNamedEntry(
    entry: { name: string; value: McpValueBinding; omitWhenAbsent?: boolean },
    path: string,
    allowSecret: boolean,
  ): void {
    resolveBinding(entry.value, path);
    if (!allowSecret && isSecretBinding(entry.value)) {
      push(
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `Secret values must be delivered through the auth configuration, not a direct binding at ${path}.`,
      );
    }
    if (entry.omitWhenAbsent) {
      const validOmit =
        entry.value.kind === "agentInput" && isOptionalAgentInput(entry.value);
      if (!validOmit) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `Omission is only supported for an entry bound entirely to one optional agent input (${path}).`,
        );
      }
    }
  }

  function mergeEntries(
    common: McpNamedEntry[],
    tool: McpNamedEntry[],
    pathPrefix: { common: string; tool: string },
    caseInsensitive: boolean,
    forbidden: boolean,
    protectedNames: Set<string>,
    allowSecret: boolean,
  ): CompiledEntry[] {
    const normalize = (name: string) =>
      caseInsensitive ? name.toLowerCase() : name;

    const seenCommon = new Map<string, McpNamedEntry>();
    for (const entry of common) {
      const key = normalize(entry.name);
      const path = `${pathPrefix.common}.${entry.name}`;
      if (seenCommon.has(key)) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `Duplicate common entry name "${entry.name}".`,
        );
        continue;
      }
      seenCommon.set(key, entry);
      if (forbidden && isForbiddenHeaderName(key)) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `"${entry.name}" is a forbidden transport header.`,
        );
      }
      if (protectedNames.has(key)) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `"${entry.name}" is owned by authentication and cannot be set here.`,
        );
      }
      validateNamedEntry(entry, path, allowSecret);
    }

    const seenTool = new Map<string, McpNamedEntry>();
    for (const entry of tool) {
      const key = normalize(entry.name);
      const path = `${pathPrefix.tool}.${entry.name}`;
      if (seenTool.has(key)) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `Duplicate entry name "${entry.name}".`,
        );
        continue;
      }
      seenTool.set(key, entry);
      if (forbidden && isForbiddenHeaderName(key)) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `"${entry.name}" is a forbidden transport header.`,
        );
      }
      if (protectedNames.has(key)) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `"${entry.name}" is owned by authentication and cannot be overridden.`,
        );
      }
      validateNamedEntry(entry, path, allowSecret);
    }

    const merged: CompiledEntry[] = [];
    for (const [key, entry] of seenCommon) {
      if (seenTool.has(key)) continue;
      merged.push(toCompiledEntry(entry));
    }
    for (const entry of seenTool.values()) {
      merged.push(toCompiledEntry(entry));
    }
    return merged;
  }

  function toCompiledEntry(entry: McpNamedEntry): CompiledEntry {
    return {
      name: entry.name,
      source: entry.value,
      ...(entry.omitWhenAbsent ? { omitWhenAbsent: true } : {}),
    };
  }

  const effectiveHeaders = mergeEntries(
    ctx.common.headers,
    ctx.definition.headers,
    { common: "common.headers", tool: "headers" },
    true,
    true,
    authProtectedHeaderNames,
    true,
  );

  const effectiveQuery = mergeEntries(
    ctx.common.query,
    ctx.definition.query,
    { common: "common.query", tool: "query" },
    false,
    false,
    new Set(authProtectedQueryKeys),
    false,
  );

  const headerPlan: CompiledHeader[] = [
    ...effectiveHeaders,
    ...authHeaderEntries,
  ];
  const queryPlan: CompiledEntry[] = [...effectiveQuery, ...authQueryEntries];

  // ---- Body ---------------------------------------------------------------
  const isBodylessMethod = READ_METHODS.has(method);
  if (isBodylessMethod && ctx.definition.body.bodyType !== "none") {
    push(
      "body",
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `${method} requests cannot declare a body.`,
    );
  }

  function literalMatchesType(
    value: string | number | boolean | null,
    jsonType: "string" | "number" | "boolean" | "null",
  ): boolean {
    switch (jsonType) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "boolean":
        return typeof value === "boolean";
      case "null":
        return value === null;
    }
  }

  function isJsonTypeCompatible(
    inputType: McpAgentInput["type"],
    jsonType: "string" | "number" | "boolean" | "null" | "any",
  ): boolean {
    if (jsonType === "any" || jsonType === "null") return true;
    if (inputType === "json") return true;
    if (jsonType === "string") return inputType === "string";
    if (jsonType === "number")
      return inputType === "number" || inputType === "integer";
    if (jsonType === "boolean") return inputType === "boolean";
    return true;
  }

  function compileJsonNode(
    node: McpJsonNode,
    path: string,
    context: "root" | "field" | "item",
  ): void {
    if (node.kind === "literal") {
      if (!literalMatchesType(node.value, node.jsonType)) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `Literal value at ${path} does not match declared JSON type "${node.jsonType}".`,
        );
      }
      return;
    }
    if (node.kind === "binding") {
      resolveBinding(node.binding, path);
      if (node.binding.kind === "agentInput" && node.jsonType !== "any") {
        const input = agentInputById.get(node.binding.agentInputId);
        if (input && !isJsonTypeCompatible(input.type, node.jsonType)) {
          push(
            path,
            APP_ERROR_CODES.MCP_COMPILE_INVALID,
            `Agent input "${input.name}" type "${input.type}" is incompatible with JSON type "${node.jsonType}" at ${path}.`,
          );
        }
      }
      if (node.omitWhenAbsent) {
        const validOmit =
          context === "field" &&
          node.binding.kind === "agentInput" &&
          isOptionalAgentInput(node.binding);
        if (!validOmit) {
          push(
            path,
            APP_ERROR_CODES.MCP_COMPILE_INVALID,
            `Optional omission at ${path} is only supported for a full object field bound to one optional agent input.`,
          );
        }
      }
      return;
    }
    if (node.kind === "object") {
      const seenKeys = new Set<string>();
      for (const field of node.fields) {
        const fieldPath = `${path}.${field.key}`;
        if (seenKeys.has(field.key)) {
          push(
            fieldPath,
            APP_ERROR_CODES.MCP_COMPILE_INVALID,
            `Duplicate JSON object key "${field.key}" at ${path}.`,
          );
        }
        seenKeys.add(field.key);

        const nodeLevelOmit =
          field.value.kind === "binding" && field.value.omitWhenAbsent === true;
        const fieldOmit = field.omitWhenAbsent === true || nodeLevelOmit;
        if (fieldOmit) {
          const isAgentBinding =
            field.value.kind === "binding" &&
            field.value.binding.kind === "agentInput";
          const optionalInput =
            isAgentBinding &&
            field.value.kind === "binding" &&
            field.value.binding.kind === "agentInput" &&
            isOptionalAgentInput(field.value.binding);
          if (!isAgentBinding || !optionalInput) {
            push(
              fieldPath,
              APP_ERROR_CODES.MCP_COMPILE_INVALID,
              `Optional field omission at ${fieldPath} requires the field to be bound entirely to one optional agent input.`,
            );
          }
        }
        compileJsonNode(field.value, fieldPath, "field");
      }
      return;
    }
    // array
    node.items.forEach((item, index) => {
      compileJsonNode(item, `${path}[${index}]`, "item");
    });
  }

  let compiledBody: McpCompiledPlan["body"] = { bodyType: "none" };
  const bodyDefinition = ctx.definition.body;

  if (bodyDefinition.bodyType === "json") {
    compileJsonNode(bodyDefinition.root, "body.root", "root");
    compiledBody = { bodyType: "json", root: bodyDefinition.root };
  } else if (bodyDefinition.bodyType === "form") {
    const seen = new Set<string>();
    const fields: CompiledFormField[] = [];
    for (const [index, field] of bodyDefinition.fields.entries()) {
      const path = `body.fields[${index}]`;
      if (seen.has(field.name)) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          `Duplicate form field "${field.name}".`,
        );
        continue;
      }
      seen.add(field.name);
      validateNamedEntry(field, path, true);
      fields.push(toCompiledEntry(field));
    }
    compiledBody = { bodyType: "form", fields };
  } else if (bodyDefinition.bodyType === "raw") {
    for (const [index, entry] of bodyDefinition.bindings.entries()) {
      const path = `body.bindings[${index}]`;
      resolveBinding(entry.binding, path);
      if (isOptionalAgentInput(entry.binding)) {
        push(
          path,
          APP_ERROR_CODES.MCP_COMPILE_INVALID,
          "Raw bodies do not support optional agent inputs; there is no per-binding omission mechanism.",
        );
      }
    }

    const parts: Array<
      | { kind: "text"; value: string }
      | { kind: "binding"; binding: McpValueBinding }
    > = [];
    if (bodyDefinition.bindings.length === 0) {
      parts.push({ kind: "text", value: bodyDefinition.template });
    } else {
      const byId = new Map(
        bodyDefinition.bindings.map((b) => [b.id, b.binding] as const),
      );
      const sortedIds = [...byId.keys()].sort((a, b) => b.length - a.length);
      const pattern = new RegExp(
        `\\{\\{(${sortedIds.map(escapeRegExp).join("|")})\\}\\}`,
        "g",
      );
      let lastIndex = 0;
      const usedIds = new Set<string>();
      for (const match of bodyDefinition.template.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > lastIndex) {
          parts.push({
            kind: "text",
            value: bodyDefinition.template.slice(lastIndex, index),
          });
        }
        const id = match[1];
        usedIds.add(id);
        const binding = byId.get(id);
        if (binding) parts.push({ kind: "binding", binding });
        lastIndex = index + match[0].length;
      }
      if (lastIndex < bodyDefinition.template.length) {
        parts.push({
          kind: "text",
          value: bodyDefinition.template.slice(lastIndex),
        });
      }
      for (const id of byId.keys()) {
        if (!usedIds.has(id)) {
          push(
            "body.bindings",
            APP_ERROR_CODES.MCP_COMPILE_INVALID,
            `Raw body binding "${id}" is declared but never referenced by the template.`,
          );
        }
      }
    }

    compiledBody = {
      bodyType: "raw",
      ...(bodyDefinition.contentType
        ? { contentType: bodyDefinition.contentType }
        : {}),
      parts,
    };
  }

  // ---- Unused agent inputs -------------------------------------------------
  for (const input of ctx.definition.agentInputs) {
    if (!usedAgentInputIds.has(input.id)) {
      push(
        `agentInputs.${input.name}`,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `Agent input "${input.name}" is declared but not referenced by any binding.`,
      );
    }
  }

  // ---- Mutation metadata ----------------------------------------------------
  if (READ_METHODS.has(method) && ctx.allowMutation) {
    push(
      "allowMutation",
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `${method} tools cannot have mutation permission enabled.`,
    );
  }

  const annotations = deriveAnnotations(method, ctx.definition.annotations);

  const ok = issues.every((issue) => issue.severity !== "error");

  const plan: McpCompiledPlan = {
    version: ctx.definition.version,
    method,
    pathSegments: ctx.definition.pathSegments.map((segment) => ({
      source: segment.value,
      encode: true as const,
    })),
    query: queryPlan,
    headers: headerPlan,
    body: compiledBody,
    agentInputs: ctx.definition.agentInputs,
    annotations,
    protectedKeys: {
      headers: authProtectedHeaderKeys,
      query: authProtectedQueryKeys,
    },
    compiledAt: new Date().toISOString(),
    definitionHash: "",
  };

  plan.definitionHash = computeDefinitionHash({
    version: plan.version,
    method: plan.method,
    pathSegments: plan.pathSegments,
    query: plan.query,
    headers: plan.headers,
    body: plan.body,
    agentInputs: plan.agentInputs,
    annotations: plan.annotations,
    protectedKeys: plan.protectedKeys,
  });

  return { ok, plan: ok ? plan : null, issues };
}

/** Reused by callers who already have a `CompileContext` but want deterministic hashing without full compilation output. */
export function assertCompileSuccess(result: CompileResult): McpCompiledPlan {
  if (result.ok && result.plan) return result.plan;
  const firstError =
    result.issues.find((issue) => issue.severity === "error") ??
    result.issues[0];
  throw appError({
    appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
    message: firstError?.message ?? "Tool definition failed to compile.",
    status: 400,
    details: {
      ...(firstError?.path !== undefined ? { path: firstError.path } : {}),
      ...(firstError?.code !== undefined ? { issueCode: firstError.code } : {}),
    },
  });
}

export const MCP_COMPILER_MUTATING_METHODS = MUTATING_METHODS;
export const MCP_COMPILER_READ_METHODS = READ_METHODS;
