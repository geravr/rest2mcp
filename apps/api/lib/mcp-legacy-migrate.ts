/**
 * @file Legacy `{{name}}` template analysis and dual-write helpers.
 * Converts legacy `pathTemplate` / `requestTemplate` / `params` rows into
 * versioned request definitions without args-first guessing, and renders a
 * versioned definition back into the legacy shape for rollback. Pure
 * functions; no database or network I/O happens here.
 */
import type { McpBodyType, McpRequestTemplate, McpToolParam } from "@repo/db";
import { APP_ERROR_CODES } from "./app-error.js";
import { MCP_REQUEST_DEFINITION_VERSION } from "./mcp-policy.js";
import type {
  McpAgentInput,
  McpCommonEntries,
  McpCompileIssue,
  McpJsonNode,
  McpNamedEntry,
  McpPathSegment,
  McpRequestDefinition,
  McpValueBinding,
} from "./mcp-request-definition.js";

export type LegacyServerValueRef = {
  id: string;
  name: string;
  kind: "config" | "secret";
  owner: "manual" | "auth";
};

export type LegacyToolInput = {
  method: string;
  pathTemplate: string;
  requestTemplate: McpRequestTemplate | null | undefined;
  params: McpToolParam[] | null | undefined;
  serverValues: LegacyServerValueRef[];
};

export type AnalyzeLegacyToolResult = {
  definition: McpRequestDefinition | null;
  issues: McpCompileIssue[];
  unambiguous: boolean;
};

export type AnalyzeLegacyCommonResult = {
  commonEntries: McpCommonEntries | null;
  issues: McpCompileIssue[];
  unambiguous: boolean;
};

type PushIssue = (
  path: string,
  code: string,
  message: string,
  severity?: "error" | "warning",
) => void;

type LegacyAnalysisContext = {
  paramsByName: Map<string, McpToolParam>;
  serverValuesByName: Map<string, LegacyServerValueRef>;
  agentInputsByName: Map<string, McpAgentInput>;
  push: PushIssue;
};

const PLACEHOLDER_GLOBAL = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;
const QUOTED_PLACEHOLDER = /"\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}"/g;

function paramToAgentInput(param: McpToolParam): McpAgentInput {
  return {
    id: param.name,
    name: param.name,
    ...(param.description !== undefined
      ? { description: param.description }
      : {}),
    required: param.required,
    sensitive: param.sensitive ?? false,
    type: param.type,
    ...(param.minimum !== undefined ? { minimum: param.minimum } : {}),
    ...(param.maximum !== undefined ? { maximum: param.maximum } : {}),
    ...(param.minLength !== undefined ? { minLength: param.minLength } : {}),
    ...(param.maxLength !== undefined ? { maxLength: param.maxLength } : {}),
    ...(param.pattern !== undefined ? { pattern: param.pattern } : {}),
    ...(param.enum !== undefined ? { enum: param.enum } : {}),
    ...(param.examples !== undefined ? { examples: param.examples } : {}),
    ...(param.allowEmpty !== undefined ? { allowEmpty: param.allowEmpty } : {}),
  };
}

function registerAgentInput(
  param: McpToolParam,
  ctx: LegacyAnalysisContext,
): string {
  if (!ctx.agentInputsByName.has(param.name)) {
    ctx.agentInputsByName.set(param.name, paramToAgentInput(param));
  }
  return param.name;
}

type ResolvedLegacySource =
  | { kind: "agentInput"; param: McpToolParam }
  | { kind: "serverValue"; value: LegacyServerValueRef }
  | null;

/**
 * Resolves one legacy `{{name}}` placeholder to exactly one declared source.
 * Never guesses: a name matching both a param and a server value, or
 * neither, is reported as an issue and treated as unresolved.
 */
function resolveLegacyName(
  name: string,
  path: string,
  ctx: LegacyAnalysisContext,
): ResolvedLegacySource {
  const param = ctx.paramsByName.get(name);
  const value = ctx.serverValuesByName.get(name);
  if (param && value) {
    ctx.push(
      path,
      APP_ERROR_CODES.MCP_VARIABLE_NAME_CONFLICT,
      `Placeholder "${name}" at ${path} matches both a declared param and a server value; the source is ambiguous.`,
    );
    return null;
  }
  if (param) return { kind: "agentInput", param };
  if (value) return { kind: "serverValue", value };
  ctx.push(
    path,
    APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
    `Placeholder "${name}" at ${path} has no declared param or server value; its source cannot be inferred.`,
  );
  return null;
}

function pathTemplateHasUnsafeSegment(template: string): boolean {
  const stripped = template.replace(PLACEHOLDER_GLOBAL, "\u0000");
  return stripped.split("/").some((part) => part === "..");
}

type PathTemplatePart = { literal: string } | { name: string };

function splitPathTemplate(template: string): PathTemplatePart[] {
  const raw = template.split(PLACEHOLDER_GLOBAL);
  const parts: PathTemplatePart[] = [];
  raw.forEach((chunk, index) => {
    if (index % 2 === 0) {
      if (chunk.length > 0) parts.push({ literal: chunk });
    } else {
      parts.push({ name: chunk });
    }
  });
  return parts;
}

function buildPathSegments(
  template: string,
  ctx: LegacyAnalysisContext,
): McpPathSegment[] {
  const segments: McpPathSegment[] = [];
  splitPathTemplate(template).forEach((part, index) => {
    const path = `pathTemplate[${index}]`;
    if ("literal" in part) {
      segments.push({
        id: `path_${index}`,
        value: { kind: "literal", value: part.literal },
      });
      return;
    }
    const resolved = resolveLegacyName(part.name, path, ctx);
    if (!resolved) return;
    if (resolved.kind === "serverValue") {
      segments.push({
        id: `path_${index}`,
        value: { kind: "serverValue", serverValueId: resolved.value.id },
      });
      return;
    }
    if (resolved.param.required === false) {
      ctx.push(
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `Optional param "${part.name}" at ${path} cannot be used in a path segment.`,
      );
      return;
    }
    const id = registerAgentInput(resolved.param, ctx);
    segments.push({
      id: `path_${index}`,
      value: { kind: "agentInput", agentInputId: id },
    });
  });
  return segments;
}

/**
 * Resolves one named-entry template value (a header or query value string)
 * to a single binding. Only an exact `{{name}}` value, or a server-value
 * placeholder with static literal prefix/suffix text, can be represented;
 * an agent input embedded in surrounding literal text has no equivalent
 * binding shape and is reported as an issue.
 */
function resolveTemplatedValue(
  template: string,
  path: string,
  ctx: LegacyAnalysisContext,
): McpValueBinding | null {
  const matches = [...template.matchAll(PLACEHOLDER_GLOBAL)];
  if (matches.length === 0) {
    return { kind: "literal", value: template };
  }
  if (matches.length > 1) {
    ctx.push(
      path,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `"${template}" at ${path} references more than one placeholder; only a single bound value is supported.`,
    );
    return null;
  }

  const match = matches[0];
  const name = match[1];
  const index = match.index ?? 0;
  const prefix = template.slice(0, index);
  const suffix = template.slice(index + match[0].length);

  const resolved = resolveLegacyName(name, path, ctx);
  if (!resolved) return null;

  if (resolved.kind === "serverValue") {
    return {
      kind: "serverValue",
      serverValueId: resolved.value.id,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
    };
  }

  if (prefix || suffix) {
    ctx.push(
      path,
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      `Agent input "${name}" at ${path} is embedded in surrounding literal text; agent inputs must be the entire value.`,
    );
    return null;
  }
  const id = registerAgentInput(resolved.param, ctx);
  return { kind: "agentInput", agentInputId: id };
}

function buildNamedEntries(
  record: Record<string, string> | null | undefined,
  pathPrefix: string,
  ctx: LegacyAnalysisContext,
  caseInsensitive: boolean,
): McpNamedEntry[] {
  const entries: McpNamedEntry[] = [];
  const seen = new Set<string>();
  let index = 0;
  for (const [name, valueTemplate] of Object.entries(record ?? {})) {
    const key = caseInsensitive ? name.toLowerCase() : name;
    const path = `${pathPrefix}.${name}`;
    if (seen.has(key)) {
      ctx.push(
        path,
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `Duplicate entry name "${name}" in ${pathPrefix} (case-insensitive).`,
      );
      index += 1;
      continue;
    }
    seen.add(key);
    const binding = resolveTemplatedValue(valueTemplate, path, ctx);
    if (binding) {
      entries.push({ id: `${pathPrefix}_${index}`, name, value: binding });
    }
    index += 1;
  }
  return entries;
}

type JsonToken = { name: string; quoted: boolean };

function tokenizeJsonTemplate(template: string): {
  normalized: string;
  tokens: Map<string, JsonToken>;
} {
  const tokens = new Map<string, JsonToken>();
  let counter = 0;
  let normalized = template.replace(
    QUOTED_PLACEHOLDER,
    (_match, name: string) => {
      const token = `@@legacy_ph_${counter++}@@`;
      tokens.set(token, { name, quoted: true });
      return JSON.stringify(token);
    },
  );
  normalized = normalized.replace(
    PLACEHOLDER_GLOBAL,
    (_match, name: string) => {
      const token = `@@legacy_ph_${counter++}@@`;
      tokens.set(token, { name, quoted: false });
      return JSON.stringify(token);
    },
  );
  return { normalized, tokens };
}

function analyzeJsonBody(
  template: string,
  ctx: LegacyAnalysisContext,
): { root: McpJsonNode | null } {
  const { normalized, tokens } = tokenizeJsonTemplate(template);
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    ctx.push(
      "requestTemplate.body",
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
      "Legacy JSON body template is not valid JSON once placeholders are substituted.",
    );
    return { root: null };
  }

  let ok = true;

  function convert(value: unknown, path: string): McpJsonNode {
    if (typeof value === "string" && tokens.has(value)) {
      const { name, quoted } = tokens.get(value) as JsonToken;
      const resolved = resolveLegacyName(name, path, ctx);
      if (!resolved) {
        ok = false;
        return { kind: "literal", jsonType: "null", value: null };
      }
      const binding: McpValueBinding =
        resolved.kind === "serverValue"
          ? { kind: "serverValue", serverValueId: resolved.value.id }
          : {
              kind: "agentInput",
              agentInputId: registerAgentInput(resolved.param, ctx),
            };
      return { kind: "binding", binding, jsonType: quoted ? "string" : "any" };
    }
    if (value === null)
      return { kind: "literal", jsonType: "null", value: null };
    if (typeof value === "string") {
      return { kind: "literal", jsonType: "string", value };
    }
    if (typeof value === "number") {
      return { kind: "literal", jsonType: "number", value };
    }
    if (typeof value === "boolean") {
      return { kind: "literal", jsonType: "boolean", value };
    }
    if (Array.isArray(value)) {
      return {
        kind: "array",
        items: value.map((item, index) => convert(item, `${path}[${index}]`)),
      };
    }
    const record = value as Record<string, unknown>;
    return {
      kind: "object",
      fields: Object.entries(record).map(([key, fieldValue], index) => ({
        id: `body_field_${index}`,
        key,
        value: convert(fieldValue, `${path}.${key}`),
      })),
    };
  }

  const root = convert(parsed, "requestTemplate.body");
  return { root: ok ? root : null };
}

/**
 * Legacy `form`/`raw` bodies are opaque templates (not structured field
 * maps), so they migrate onto the versioned `raw` body escape hatch using
 * namespaced `{{bindingId}}` tokens rather than name-based placeholders.
 */
function analyzeRawBody(
  template: string,
  ctx: LegacyAnalysisContext,
  contentType: string | undefined,
): { body: McpRequestDefinition["body"] | null } {
  const seenNames = new Set<string>();
  const bindings: Array<{ id: string; binding: McpValueBinding }> = [];
  let rewritten = template;
  let ok = true;
  let index = 0;

  for (const match of template.matchAll(PLACEHOLDER_GLOBAL)) {
    const name = match[1];
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    const path = `requestTemplate.body[${name}]`;
    const resolved = resolveLegacyName(name, path, ctx);
    if (!resolved) {
      ok = false;
      continue;
    }
    const bindingId = `raw_${index++}`;
    const binding: McpValueBinding =
      resolved.kind === "serverValue"
        ? { kind: "serverValue", serverValueId: resolved.value.id }
        : {
            kind: "agentInput",
            agentInputId: registerAgentInput(resolved.param, ctx),
          };
    bindings.push({ id: bindingId, binding });
    rewritten = rewritten.split(`{{${name}}}`).join(`{{${bindingId}}}`);
  }

  if (!ok) return { body: null };
  return {
    body: {
      bodyType: "raw",
      ...(contentType ? { contentType } : {}),
      bindings,
      template: rewritten,
    },
  };
}

export function analyzeLegacyTool(
  input: LegacyToolInput,
): AnalyzeLegacyToolResult {
  const issues: McpCompileIssue[] = [];
  const push: PushIssue = (path, code, message, severity = "error") => {
    issues.push({ path, code, message, severity });
  };

  const ctx: LegacyAnalysisContext = {
    paramsByName: new Map((input.params ?? []).map((p) => [p.name, p])),
    serverValuesByName: new Map(input.serverValues.map((v) => [v.name, v])),
    agentInputsByName: new Map(),
    push,
  };

  if (pathTemplateHasUnsafeSegment(input.pathTemplate)) {
    push(
      "pathTemplate",
      APP_ERROR_CODES.MCP_PATH_ESCAPE,
      'The legacy path template contains an unsafe ".." segment.',
    );
  }

  const pathSegments = buildPathSegments(input.pathTemplate, ctx);
  const headers = buildNamedEntries(
    input.requestTemplate?.headers,
    "requestTemplate.headers",
    ctx,
    true,
  );
  const query = buildNamedEntries(
    input.requestTemplate?.query,
    "requestTemplate.query",
    ctx,
    false,
  );

  const method = input.method.toUpperCase();
  const isBodyless = method === "GET" || method === "HEAD";
  let body: McpRequestDefinition["body"] = { bodyType: "none" };

  if (input.requestTemplate?.body != null) {
    if (isBodyless) {
      push(
        "requestTemplate.body",
        APP_ERROR_CODES.MCP_COMPILE_INVALID,
        `${method} requests cannot declare a body.`,
      );
    } else {
      const bodyType = input.requestTemplate.bodyType ?? "json";
      if (bodyType === "json") {
        const result = analyzeJsonBody(input.requestTemplate.body, ctx);
        if (result.root) body = { bodyType: "json", root: result.root };
      } else {
        const result = analyzeRawBody(
          input.requestTemplate.body,
          ctx,
          undefined,
        );
        if (result.body) body = result.body;
      }
    }
  }

  const unambiguous = !issues.some((issue) => issue.severity === "error");
  if (!unambiguous) {
    return { definition: null, issues, unambiguous: false };
  }

  const definition: McpRequestDefinition = {
    version: MCP_REQUEST_DEFINITION_VERSION,
    pathSegments,
    query,
    headers,
    body,
    agentInputs: [...ctx.agentInputsByName.values()],
  };

  return { definition, issues, unambiguous: true };
}

/**
 * Server-wide common entries never expose an agent input, so this shares
 * the named-entry resolver with an empty param map: a placeholder can only
 * resolve to a server value or remain an unambiguous literal.
 */
export function analyzeLegacyCommonEntries(input: {
  defaultHeaders: Record<string, string> | null | undefined;
  defaultQuery: Record<string, string> | null | undefined;
  serverValues: LegacyServerValueRef[];
}): AnalyzeLegacyCommonResult {
  const issues: McpCompileIssue[] = [];
  const push: PushIssue = (path, code, message, severity = "error") => {
    issues.push({ path, code, message, severity });
  };
  const ctx: LegacyAnalysisContext = {
    paramsByName: new Map(),
    serverValuesByName: new Map(input.serverValues.map((v) => [v.name, v])),
    agentInputsByName: new Map(),
    push,
  };

  const headers = buildNamedEntries(
    input.defaultHeaders,
    "common.headers",
    ctx,
    true,
  );
  const query = buildNamedEntries(
    input.defaultQuery,
    "common.query",
    ctx,
    false,
  );

  const unambiguous = !issues.some((issue) => issue.severity === "error");
  if (!unambiguous) {
    return { commonEntries: null, issues, unambiguous: false };
  }
  return { commonEntries: { headers, query }, issues, unambiguous: true };
}

function toLegacyParamType(type: McpAgentInput["type"]): McpToolParam["type"] {
  return type === "integer" ? "number" : type;
}

function renderBindingToLegacyString(
  binding: McpValueBinding,
  serverValueNames: Record<string, string> | undefined,
  agentInputsById: Map<string, McpAgentInput>,
): string {
  if (binding.kind === "literal") {
    return binding.value === null ? "" : String(binding.value);
  }
  if (binding.kind === "serverValue") {
    const name =
      serverValueNames?.[binding.serverValueId] ?? binding.serverValueId;
    return `${binding.prefix ?? ""}{{${name}}}${binding.suffix ?? ""}`;
  }
  const name =
    agentInputsById.get(binding.agentInputId)?.name ?? binding.agentInputId;
  return `{{${name}}}`;
}

function jsonNodeToLegacyTemplateText(
  node: McpJsonNode,
  render: (binding: McpValueBinding) => string,
): string {
  if (node.kind === "literal") return JSON.stringify(node.value);
  if (node.kind === "binding") {
    const rendered = render(node.binding);
    return node.jsonType === "string" ? `"${rendered}"` : rendered;
  }
  if (node.kind === "array") {
    return `[${node.items
      .map((item) => jsonNodeToLegacyTemplateText(item, render))
      .join(",")}]`;
  }
  return `{${node.fields
    .map(
      (field) =>
        `${JSON.stringify(field.key)}:${jsonNodeToLegacyTemplateText(field.value, render)}`,
    )
    .join(",")}}`;
}

/**
 * Renders a versioned definition back into the legacy shape so a rollback
 * to pre-compiler code can still execute newly authored tools. `raw` bodies
 * are only rewritten when the template still contains the declared
 * `{{bindingId}}` tokens; unrecognized tokens are left untouched.
 */
export function legacyTemplateFromDefinition(
  definition: McpRequestDefinition,
  method: string,
  serverValueNames?: Record<string, string>,
): {
  pathTemplate: string;
  requestTemplate: McpRequestTemplate;
  params: McpToolParam[];
} {
  const agentInputsById = new Map(
    definition.agentInputs.map((input) => [input.id, input]),
  );
  const render = (binding: McpValueBinding) =>
    renderBindingToLegacyString(binding, serverValueNames, agentInputsById);

  const pathTemplate = definition.pathSegments
    .map((segment) => render(segment.value))
    .join("");

  const headers: Record<string, string> = {};
  for (const entry of definition.headers) {
    headers[entry.name] = render(entry.value);
  }
  const query: Record<string, string> = {};
  for (const entry of definition.query) {
    query[entry.name] = render(entry.value);
  }

  let body: string | null = null;
  let bodyType: McpBodyType | undefined;

  if (definition.body.bodyType === "json") {
    body = jsonNodeToLegacyTemplateText(definition.body.root, render);
    bodyType = "json";
  } else if (definition.body.bodyType === "form") {
    body = definition.body.fields
      .map(
        (field) =>
          `${encodeURIComponent(field.name)}=${encodeURIComponent(render(field.value))}`,
      )
      .join("&");
    bodyType = "form";
  } else if (definition.body.bodyType === "raw") {
    const byId = new Map(
      definition.body.bindings.map((b) => [b.id, b.binding] as const),
    );
    body = definition.body.template.replace(
      /\{\{([^}]+)\}\}/g,
      (whole, id: string) => {
        const binding = byId.get(id);
        return binding ? render(binding) : whole;
      },
    );
    bodyType = "raw";
  }

  const requestTemplate: McpRequestTemplate = {
    ...(Object.keys(query).length > 0 ? { query } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(body !== null ? { body, bodyType } : {}),
  };

  const params: McpToolParam[] = definition.agentInputs.map((input) => ({
    name: input.name,
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    required: input.required,
    type: toLegacyParamType(input.type),
    ...(input.sensitive ? { sensitive: true } : {}),
    ...(input.minimum !== undefined ? { minimum: input.minimum } : {}),
    ...(input.maximum !== undefined ? { maximum: input.maximum } : {}),
    ...(input.minLength !== undefined ? { minLength: input.minLength } : {}),
    ...(input.maxLength !== undefined ? { maxLength: input.maxLength } : {}),
    ...(input.pattern !== undefined ? { pattern: input.pattern } : {}),
    ...(input.enum !== undefined ? { enum: input.enum } : {}),
    ...(input.examples !== undefined ? { examples: input.examples } : {}),
    ...(input.allowEmpty !== undefined ? { allowEmpty: input.allowEmpty } : {}),
  }));

  return { pathTemplate, requestTemplate, params };
}

export function legacyDefaultsFromCommonEntries(
  common: McpCommonEntries,
  serverValueNames?: Record<string, string>,
): {
  defaultHeaders: Record<string, string>;
  defaultQuery: Record<string, string>;
} {
  const render = (binding: McpValueBinding) =>
    renderBindingToLegacyString(binding, serverValueNames, new Map());

  const defaultHeaders: Record<string, string> = {};
  for (const entry of common.headers) {
    defaultHeaders[entry.name] = render(entry.value);
  }
  const defaultQuery: Record<string, string> = {};
  for (const entry of common.query) {
    defaultQuery[entry.name] = render(entry.value);
  }
  return { defaultHeaders, defaultQuery };
}
