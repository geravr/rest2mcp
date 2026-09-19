/**
 * @file Bounded, pure OpenAPI 3.0/3.1 document reader: strict JSON parsing,
 * version validation, canonical fingerprinting, local JSON Pointer resolution,
 * and the deterministic operation inventory the canonical mapper consumes.
 *
 * The reader is pure. It never performs a network request or reads the
 * filesystem: every `$ref` that is not a local JSON Pointer becomes a
 * per-operation issue instead of a fetch, and one bad reference never aborts
 * the rest of the document.
 */
import { isStrictRecord } from "@repo/core";
import {
  APP_ERROR_CODES,
  MCP_OPENAPI_ISSUE_CODES,
  MCP_OPENAPI_LIMITS,
} from "@repo/core";
import { appError } from "./app-error.js";
import { contractFingerprint } from "./mcp-contract.js";
import type {
  McpOpenApiDocumentMetadata,
  McpOpenApiInventory,
  McpOpenApiInventoryMediaType,
  McpOpenApiInventoryOperation,
  McpOpenApiInventoryParameter,
  McpOpenApiInventoryRequestBody,
  McpOpenApiInventoryServer,
  McpOpenApiOperationIssue,
  McpOpenApiPointer,
  McpOpenApiSecurityRequirement,
} from "./openapi-import-contracts.js";

/** Fixed walk order for the methods a path item may declare. */
const METHOD_ORDER = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "TRACE",
  "CONNECT",
] as const;

/** Path Item keys that declare an operation the reader inventories. */
const PATH_ITEM_METHOD_KEYS = new Set(
  METHOD_ORDER.map((method) => method.toLowerCase()),
);

/**
 * Path Item fields that declare no operation: they legitimately accompany
 * methods but never constitute a usable Path Item on their own, and a schema
 * object reached through a mistyped pointer commonly carries a bare
 * `description` or `summary`.
 */
const PATH_ITEM_DECORATION_KEYS = new Set([
  "summary",
  "description",
  "servers",
]);

/** Parameter example material the mapper may surface after its own redaction. */
const MAX_PARAMETER_EXAMPLES = 8;

/** Hard ceiling on schema nodes expanded for one operation. */
const MAX_SCHEMA_NODES_PER_OPERATION = 10_000;

const MAX_ISSUE_REFERENCE_LENGTH = 120;

const SECURITY_SCHEME_NAME_MAX = 256;
const SECURITY_SCHEME_TOKEN_MAX = 64;

const OPENAPI_VERSION_PATTERN = /^3\.(0|1)(?:\.\d+)?$/;

/** JSON Schema keywords whose values are schemas, not schemas themselves. */
const SCHEMA_SINGLE_KEYWORDS = new Set([
  "items",
  "additionalProperties",
  "additionalItems",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
]);

const SCHEMA_ARRAY_KEYWORDS = new Set([
  "allOf",
  "anyOf",
  "oneOf",
  "prefixItems",
]);

const SCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

const documentEncoder = new TextEncoder();

type ResolutionBudget = { remaining: number };

type ResolutionContext = {
  root: Record<string, unknown>;
  /** Issues for the operation currently being inventoried. */
  issues: McpOpenApiOperationIssue[];
  budget: ResolutionBudget;
  expandedNodes: number;
  nodeLimitRecorded: boolean;
};

type DocumentSession = {
  root: Record<string, unknown>;
  securitySchemes: Record<string, McpOpenApiSecurityRequirement>;
  documentSecurityDeclaration: unknown;
  documentServers: McpOpenApiInventoryServer[];
  budget: ResolutionBudget;
  /** Blocking diagnostics that cannot be attributed to one operation. */
  documentIssues: McpOpenApiOperationIssue[];
};

type ReferenceLookup =
  | { ok: true; value: unknown; pointer: McpOpenApiPointer; chain: string[] }
  | { ok: false };

type FollowedReferences = {
  value: unknown;
  pointer: McpOpenApiPointer;
  chain: string[];
};

/* ------------------------------------------------------------------------- *
 * Errors
 * ------------------------------------------------------------------------- */

function invalidDocument(message: string): never {
  throw appError({
    appCode: APP_ERROR_CODES.MCP_OPENAPI_INVALID,
    message,
    status: 400,
  });
}

function unsupportedVersion(): never {
  throw appError({
    appCode: APP_ERROR_CODES.MCP_OPENAPI_VERSION_UNSUPPORTED,
    message: "Only OpenAPI 3.0 and 3.1 JSON documents can be imported.",
    status: 400,
    details: { path: "openapi" },
  });
}

function limitExceeded(limit: number, message: string): never {
  throw appError({
    appCode: APP_ERROR_CODES.MCP_OPENAPI_LIMIT_EXCEEDED,
    message,
    status: 400,
    details: { limit },
  });
}

function pushIssue(
  issues: McpOpenApiOperationIssue[],
  code: string,
  message: string,
  path: McpOpenApiPointer,
): void {
  const duplicate = issues.some(
    (issue) =>
      issue.code === code && issue.path === path && issue.message === message,
  );
  if (duplicate) return;
  issues.push({ code, severity: "error", message, path });
}

function describeReference(reference: string): string {
  return reference.length > MAX_ISSUE_REFERENCE_LENGTH
    ? `${reference.slice(0, MAX_ISSUE_REFERENCE_LENGTH - 3)}...`
    : reference;
}

/* ------------------------------------------------------------------------- *
 * JSON Pointer helpers
 * ------------------------------------------------------------------------- */

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function decodePointerSegment(segment: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return decoded.replace(/~1/g, "/").replace(/~0/g, "~");
}

function lookupPointer(
  root: Record<string, unknown>,
  reference: string,
): unknown {
  let current: unknown = root;
  for (const rawSegment of reference.slice(2).split("/")) {
    const segment = decodePointerSegment(rawSegment);
    if (segment === null) return undefined;
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined;
      current = current[Number(segment)];
    } else if (isStrictRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

function isReferenceNode(value: unknown): value is { $ref: string } {
  return isStrictRecord(value) && typeof value["$ref"] === "string";
}

/* ------------------------------------------------------------------------- *
 * Document depth bound
 * ------------------------------------------------------------------------- */

type DepthWalkEntry = {
  value: unknown;
  /** Object/array nesting level: the document root is level 0. */
  depth: number;
  pointer: string;
};

function isContainer(value: unknown): value is object {
  return isStrictRecord(value) || Array.isArray(value);
}

/**
 * Rejects documents nested deeper than `maxDocumentDepth` before any recursive
 * reader sees them: fingerprinting and schema expansion recurse per nesting
 * level and overflow the call stack on hostile input. The walk itself uses an
 * explicit stack, so the bound cannot overflow while enforcing the bound.
 */
function assertDocumentDepth(root: unknown): void {
  const stack: DepthWalkEntry[] = [{ value: root, depth: 0, pointer: "" }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) return;
    if (entry.depth > MCP_OPENAPI_LIMITS.maxDocumentDepth) {
      throw appError({
        appCode: APP_ERROR_CODES.MCP_OPENAPI_LIMIT_EXCEEDED,
        message: `The OpenAPI document nests more than ${MCP_OPENAPI_LIMITS.maxDocumentDepth} levels deep.`,
        status: 400,
        details: {
          limit: MCP_OPENAPI_LIMITS.maxDocumentDepth,
          path: entry.pointer,
        },
      });
    }

    // Only containers can nest further; leaves cannot exceed any depth.
    const node = entry.value;
    if (Array.isArray(node)) {
      for (let index = node.length - 1; index >= 0; index -= 1) {
        const child = node[index];
        if (!isContainer(child)) continue;
        stack.push({
          value: child,
          depth: entry.depth + 1,
          pointer: `${entry.pointer}/${index}`,
        });
      }
      continue;
    }
    if (!isStrictRecord(node)) continue;
    const keys = Object.keys(node);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      const child = node[key];
      if (!isContainer(child)) continue;
      stack.push({
        value: child,
        depth: entry.depth + 1,
        pointer: `${entry.pointer}/${escapePointerSegment(key)}`,
      });
    }
  }
}

/* ------------------------------------------------------------------------- *
 * Bounded local reference resolution
 * ------------------------------------------------------------------------- */

function lookupLocalReference(
  reference: string,
  ctx: ResolutionContext,
  pointer: McpOpenApiPointer,
  chain: readonly string[],
): ReferenceLookup {
  const label = describeReference(reference);
  if (!reference.startsWith("#/")) {
    pushIssue(
      ctx.issues,
      MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
      `Reference "${label}" is outside the submitted document.`,
      pointer,
    );
    return { ok: false };
  }
  const targetPointer = reference.slice(1);
  if (chain.includes(targetPointer)) {
    pushIssue(
      ctx.issues,
      MCP_OPENAPI_ISSUE_CODES.CYCLIC_REFERENCE,
      `Reference "${label}" re-enters a reference that is still being resolved.`,
      pointer,
    );
    return { ok: false };
  }
  if (chain.length >= MCP_OPENAPI_LIMITS.maxRefDepth) {
    pushIssue(
      ctx.issues,
      MCP_OPENAPI_ISSUE_CODES.LIMIT_EXCEEDED,
      `Reference resolution exceeded ${MCP_OPENAPI_LIMITS.maxRefDepth} hops.`,
      pointer,
    );
    return { ok: false };
  }
  if (ctx.budget.remaining <= 0) {
    pushIssue(
      ctx.issues,
      MCP_OPENAPI_ISSUE_CODES.LIMIT_EXCEEDED,
      `The document exceeded ${MCP_OPENAPI_LIMITS.maxRefResolutions} reference resolutions.`,
      pointer,
    );
    return { ok: false };
  }
  ctx.budget.remaining -= 1;

  const target = lookupPointer(ctx.root, reference);
  if (target === undefined) {
    pushIssue(
      ctx.issues,
      MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
      `Reference "${label}" does not resolve inside the submitted document.`,
      pointer,
    );
    return { ok: false };
  }
  return {
    ok: true,
    value: target,
    pointer: targetPointer,
    chain: [...chain, targetPointer],
  };
}

function followReferences(
  value: unknown,
  ctx: ResolutionContext,
  pointer: McpOpenApiPointer,
  chain: readonly string[],
): FollowedReferences | null {
  let current = value;
  let currentPointer = pointer;
  let currentChain = [...chain];
  while (isReferenceNode(current)) {
    const lookup = lookupLocalReference(
      current["$ref"],
      ctx,
      currentPointer,
      currentChain,
    );
    if (!lookup.ok) return null;
    current = lookup.value;
    currentPointer = lookup.pointer;
    currentChain = lookup.chain;
  }
  return { value: current, pointer: currentPointer, chain: currentChain };
}

function consumeSchemaNode(
  ctx: ResolutionContext,
  pointer: McpOpenApiPointer,
): boolean {
  ctx.expandedNodes += 1;
  if (ctx.expandedNodes <= MAX_SCHEMA_NODES_PER_OPERATION) return true;
  if (!ctx.nodeLimitRecorded) {
    ctx.nodeLimitRecorded = true;
    pushIssue(
      ctx.issues,
      MCP_OPENAPI_ISSUE_CODES.LIMIT_EXCEEDED,
      `The operation expands more than ${MAX_SCHEMA_NODES_PER_OPERATION} schema nodes.`,
      pointer,
    );
  }
  return false;
}

function resolveSchemaNode(
  value: unknown,
  ctx: ResolutionContext,
  pointer: McpOpenApiPointer,
  chain: readonly string[],
): unknown {
  if (!consumeSchemaNode(ctx, pointer)) return value;
  const followed = followReferences(value, ctx, pointer, chain);
  if (!followed) return value;
  const { value: target, pointer: basePointer, chain: nextChain } = followed;

  if (Array.isArray(target)) {
    return target.map((item, index) =>
      resolveSchemaNode(item, ctx, `${basePointer}/${index}`, nextChain),
    );
  }
  if (!isStrictRecord(target)) return target;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(target)) {
    const childPointer = `${basePointer}/${escapePointerSegment(key)}`;
    if (SCHEMA_SINGLE_KEYWORDS.has(key)) {
      result[key] =
        isStrictRecord(child) || Array.isArray(child)
          ? resolveSchemaNode(child, ctx, childPointer, nextChain)
          : child;
    } else if (SCHEMA_ARRAY_KEYWORDS.has(key) && Array.isArray(child)) {
      result[key] = child.map((item, index) =>
        resolveSchemaNode(item, ctx, `${childPointer}/${index}`, nextChain),
      );
    } else if (SCHEMA_MAP_KEYWORDS.has(key) && isStrictRecord(child)) {
      const schemas: Record<string, unknown> = {};
      for (const [name, subschema] of Object.entries(child)) {
        schemas[name] = resolveSchemaNode(
          subschema,
          ctx,
          `${childPointer}/${escapePointerSegment(name)}`,
          nextChain,
        );
      }
      result[key] = schemas;
    } else {
      result[key] = child;
    }
  }
  return result;
}

function resolveContentMap(
  content: Record<string, unknown>,
  ctx: ResolutionContext,
  pointer: McpOpenApiPointer,
  chain: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [mediaType, media] of Object.entries(content)) {
    result[mediaType] = resolveStructuredNode(
      media,
      ctx,
      `${pointer}/${escapePointerSegment(mediaType)}`,
      chain,
    ).value;
  }
  return result;
}

/**
 * Resolves a parameter, request body, or media type node: its own `$ref`
 * chain, its `schema`, and its nested `content` entries. Every other key is
 * carried through untouched so examples stay data.
 */
function resolveStructuredNode(
  value: unknown,
  ctx: ResolutionContext,
  pointer: McpOpenApiPointer,
  chain: readonly string[],
): FollowedReferences {
  const followed = followReferences(value, ctx, pointer, chain);
  if (!followed) return { value, pointer, chain: [...chain] };
  const { value: target, pointer: basePointer, chain: nextChain } = followed;
  if (!consumeSchemaNode(ctx, basePointer) || !isStrictRecord(target)) {
    return { value: target, pointer: basePointer, chain: nextChain };
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(target)) {
    const childPointer = `${basePointer}/${escapePointerSegment(key)}`;
    if (key === "schema") {
      result[key] = resolveSchemaNode(child, ctx, childPointer, nextChain);
    } else if (key === "content" && isStrictRecord(child)) {
      result[key] = resolveContentMap(child, ctx, childPointer, nextChain);
    } else {
      result[key] = child;
    }
  }
  return { value: result, pointer: basePointer, chain: nextChain };
}

/* ------------------------------------------------------------------------- *
 * Document metadata
 * ------------------------------------------------------------------------- */

function readPrimitiveString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function readPrimitiveStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readPrimitiveString(item))
    .filter((item): item is string => item !== undefined);
}

function readServers(
  value: unknown,
  pointer: McpOpenApiPointer,
): McpOpenApiInventoryServer[] {
  if (!Array.isArray(value)) return [];
  const servers: McpOpenApiInventoryServer[] = [];
  value.forEach((entry, index) => {
    if (!isStrictRecord(entry)) return;
    const url = entry["url"];
    if (typeof url !== "string" || url.length === 0) return;

    const variables: McpOpenApiInventoryServer["variables"] = [];
    const declarations = entry["variables"];
    if (isStrictRecord(declarations)) {
      for (const [name, declaration] of Object.entries(declarations)) {
        if (!isStrictRecord(declaration)) continue;
        const variable: McpOpenApiInventoryServer["variables"][number] = {
          name,
        };
        const fallback = readPrimitiveString(declaration["default"]);
        if (fallback !== undefined) variable.default = fallback;
        const values = readPrimitiveStringList(declaration["enum"]);
        if (values.length > 0) variable.values = values;
        variables.push(variable);
      }
    }
    servers.push({ url, variables, pointer: `${pointer}/${index}` });
  });
  return servers;
}

function readSecuritySchemeType(
  value: unknown,
): McpOpenApiSecurityRequirement["type"] {
  switch (value) {
    case "http":
    case "apiKey":
    case "oauth2":
    case "openIdConnect":
    case "mutualTLS":
      return value;
    default:
      return "unknown";
  }
}

/**
 * Secret-safe projection of `components.securitySchemes`. Only the scheme
 * name, type, placement, and HTTP scheme cross this boundary; flow URLs,
 * descriptions, and every credential-bearing keyword stay out.
 */
function readSecuritySchemes(
  components: unknown,
): Record<string, McpOpenApiSecurityRequirement> {
  const schemes: Record<string, McpOpenApiSecurityRequirement> = {};
  if (!isStrictRecord(components)) return schemes;
  const declarations = components["securitySchemes"];
  if (!isStrictRecord(declarations)) return schemes;

  for (const [name, declaration] of Object.entries(declarations)) {
    if (name.length === 0 || name.length > SECURITY_SCHEME_NAME_MAX) continue;
    const source = isStrictRecord(declaration) ? declaration : {};
    const requirement: McpOpenApiSecurityRequirement = {
      name,
      type: readSecuritySchemeType(source["type"]),
    };
    const placement = source["in"];
    if (
      placement === "header" ||
      placement === "query" ||
      placement === "cookie"
    ) {
      requirement.in = placement;
    }
    const scheme = source["scheme"];
    if (
      typeof scheme === "string" &&
      scheme.length > 0 &&
      scheme.length <= SECURITY_SCHEME_TOKEN_MAX
    ) {
      requirement.scheme = scheme;
    }
    schemes[name] = requirement;
  }
  return schemes;
}

function readSecurityRequirements(
  value: unknown,
  schemes: Record<string, McpOpenApiSecurityRequirement>,
): McpOpenApiSecurityRequirement[] {
  if (!Array.isArray(value)) return [];
  const requirements: McpOpenApiSecurityRequirement[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isStrictRecord(entry)) continue;
    for (const name of Object.keys(entry)) {
      if (seen.has(name) || name.length > SECURITY_SCHEME_NAME_MAX) continue;
      seen.add(name);
      requirements.push(schemes[name] ?? { name, type: "unknown" });
    }
  }
  return requirements;
}

/* ------------------------------------------------------------------------- *
 * Operation inventory
 * ------------------------------------------------------------------------- */

function readParameterExamples(node: Record<string, unknown>): unknown[] {
  const examples: unknown[] = [];
  const push = (value: unknown): void => {
    if (examples.length < MAX_PARAMETER_EXAMPLES) examples.push(value);
  };

  const declared = node["examples"];
  if (Array.isArray(declared)) {
    for (const entry of declared) push(entry);
  } else if (isStrictRecord(declared)) {
    for (const entry of Object.values(declared)) {
      push(isStrictRecord(entry) && "value" in entry ? entry["value"] : entry);
    }
  }
  if ("example" in node) push(node["example"]);

  const schema = node["schema"];
  if (isStrictRecord(schema)) {
    if ("default" in schema) push(schema["default"]);
    if ("example" in schema) push(schema["example"]);
    const schemaExamples = schema["examples"];
    if (Array.isArray(schemaExamples)) {
      for (const entry of schemaExamples) push(entry);
    }
  }
  return examples;
}

function readParameter(
  node: unknown,
  pointer: McpOpenApiPointer,
): McpOpenApiInventoryParameter | undefined {
  if (!isStrictRecord(node)) return undefined;
  const name = node["name"];
  const location = node["in"];
  if (typeof name !== "string" || name.length === 0) return undefined;
  if (
    location !== "path" &&
    location !== "query" &&
    location !== "header" &&
    location !== "cookie"
  ) {
    return undefined;
  }

  const parameter: McpOpenApiInventoryParameter = {
    name,
    in: location,
    // A path parameter can never be omitted, so a missing `required` is true.
    required: location === "path" || node["required"] === true,
    deprecated: node["deprecated"] === true,
    pointer,
  };
  const schema = node["schema"];
  if (isStrictRecord(schema)) parameter.schema = schema;
  const style = node["style"];
  if (typeof style === "string") parameter.style = style;
  const explode = node["explode"];
  if (typeof explode === "boolean") parameter.explode = explode;
  const examples = readParameterExamples(node);
  if (examples.length > 0) parameter.examples = examples;
  return parameter;
}

function describeUnreadableParameter(
  node: unknown,
  pointer: McpOpenApiPointer,
): string {
  if (!isStrictRecord(node)) {
    return `The parameter value at "${pointer}" is not an object.`;
  }
  const name = node["name"];
  if (typeof name !== "string" || name.length === 0) {
    return `The parameter at "${pointer}" declares no name.`;
  }
  return `The parameter "${name}" at "${pointer}" declares an unsupported "in" location.`;
}

type ReadParametersResult = {
  parameters: McpOpenApiInventoryParameter[];
  /** Declared parameters that were dropped instead of silently omitted. */
  issues: McpOpenApiOperationIssue[];
};

function readParameters(
  source: unknown,
  sourcePointer: McpOpenApiPointer,
  ctx: ResolutionContext,
  chain: readonly string[],
): ReadParametersResult {
  if (!Array.isArray(source)) return { parameters: [], issues: [] };
  const parameters: McpOpenApiInventoryParameter[] = [];
  const issues: McpOpenApiOperationIssue[] = [];
  source.forEach((entry, index) => {
    const declaredPointer = `${sourcePointer}/${index}`;
    const resolved = resolveStructuredNode(entry, ctx, declaredPointer, chain);
    const parameter = readParameter(resolved.value, resolved.pointer);
    if (parameter) {
      parameters.push(parameter);
      return;
    }
    // An unresolved `$ref` already carries its own blocking reference issue;
    // anything else here is a declared parameter the importer cannot read.
    if (isReferenceNode(resolved.value)) return;
    const path = resolved.pointer;
    issues.push({
      code: MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_PARAMETER,
      severity: "error",
      message: `${describeUnreadableParameter(resolved.value, path)} The declared parameter was not imported.`,
      path,
    });
  });
  return { parameters, issues };
}

function mergeParameters(
  pathLevel: McpOpenApiInventoryParameter[],
  operationLevel: McpOpenApiInventoryParameter[],
): McpOpenApiInventoryParameter[] {
  const merged: McpOpenApiInventoryParameter[] = [];
  const positionByKey = new Map<string, number>();
  const apply = (parameter: McpOpenApiInventoryParameter): void => {
    const key = `${parameter.in}\u0000${parameter.name}`;
    const existing = positionByKey.get(key);
    if (existing === undefined) {
      positionByKey.set(key, merged.length);
      merged.push(parameter);
    } else {
      merged[existing] = parameter;
    }
  };
  for (const parameter of pathLevel) apply(parameter);
  for (const parameter of operationLevel) apply(parameter);
  return merged;
}

function readRequestBody(
  node: unknown,
  pointer: McpOpenApiPointer,
): McpOpenApiInventoryRequestBody | undefined {
  if (!isStrictRecord(node)) return undefined;
  const content = isStrictRecord(node["content"]) ? node["content"] : {};
  const mediaTypes: McpOpenApiInventoryMediaType[] = [];
  for (const [mediaType, media] of Object.entries(content)) {
    const schema = isStrictRecord(media) ? media["schema"] : undefined;
    mediaTypes.push({
      mediaType,
      ...(isStrictRecord(schema) ? { schema } : {}),
      pointer: `${pointer}/content/${escapePointerSegment(mediaType)}`,
    });
  }
  return {
    required: node["required"] === true,
    mediaTypes,
    pointer,
  };
}

type BuildOperationInput = {
  method: string;
  path: string;
  operationPointer: McpOpenApiPointer;
  pathItemPointer: McpOpenApiPointer;
  pathItemChain: readonly string[];
  rawOperation: Record<string, unknown>;
  pathItemParameters: unknown;
  pathItemServers: unknown;
  session: DocumentSession;
  ctx: ResolutionContext;
};

function buildOperation(
  input: BuildOperationInput,
): McpOpenApiInventoryOperation {
  const { rawOperation, session, ctx } = input;

  const pathItemParameters = readParameters(
    input.pathItemParameters,
    `${input.pathItemPointer}/parameters`,
    ctx,
    input.pathItemChain,
  );
  const operationParameters = readParameters(
    rawOperation["parameters"],
    `${input.operationPointer}/parameters`,
    ctx,
    input.pathItemChain,
  );
  // Path-level parameter issues are reported on every operation under the path
  // item, so a dropped declaration is never hidden behind a sibling operation.
  for (const issue of [
    ...pathItemParameters.issues,
    ...operationParameters.issues,
  ]) {
    pushIssue(
      ctx.issues,
      issue.code,
      issue.message,
      issue.path ?? input.operationPointer,
    );
  }
  const parameters = mergeParameters(
    pathItemParameters.parameters,
    operationParameters.parameters,
  );

  let requestBody: McpOpenApiInventoryRequestBody | undefined;
  const rawRequestBody = rawOperation["requestBody"];
  if (rawRequestBody !== undefined && isStrictRecord(rawRequestBody)) {
    const resolvedBody = resolveStructuredNode(
      rawRequestBody,
      ctx,
      `${input.operationPointer}/requestBody`,
      input.pathItemChain,
    );
    requestBody = readRequestBody(resolvedBody.value, resolvedBody.pointer);
  }

  const tags: string[] = [];
  const declaredTags = rawOperation["tags"];
  if (Array.isArray(declaredTags)) {
    for (const tag of declaredTags) {
      if (typeof tag !== "string" || tag.length === 0) continue;
      if (!tags.includes(tag)) tags.push(tag);
    }
  }

  const operationId = rawOperation["operationId"];
  const stableOperationId =
    typeof operationId === "string" && operationId.trim().length > 0
      ? operationId
      : undefined;

  const effectiveSecurity = Array.isArray(rawOperation["security"])
    ? rawOperation["security"]
    : session.documentSecurityDeclaration;

  const operation: McpOpenApiInventoryOperation = {
    operationKey: stableOperationId ?? `${input.method} ${input.path}`,
    method: input.method,
    path: input.path,
    tags,
    deprecated: rawOperation["deprecated"] === true,
    parameters,
    security: readSecurityRequirements(
      effectiveSecurity,
      session.securitySchemes,
    ),
    servers: [
      ...readServers(
        rawOperation["servers"],
        `${input.operationPointer}/servers`,
      ),
      ...readServers(input.pathItemServers, `${input.pathItemPointer}/servers`),
      ...session.documentServers,
    ],
    issues: ctx.issues,
    pointer: input.operationPointer,
  };
  if (stableOperationId !== undefined)
    operation.operationId = stableOperationId;

  const summary = rawOperation["summary"];
  if (typeof summary === "string" && summary.trim().length > 0) {
    operation.summary = summary;
  }
  const description = rawOperation["description"];
  if (typeof description === "string" && description.trim().length > 0) {
    operation.description = description;
  }
  if (requestBody) operation.requestBody = requestBody;
  return operation;
}

function createResolutionContext(session: DocumentSession): ResolutionContext {
  return {
    root: session.root,
    issues: [],
    budget: session.budget,
    expandedNodes: 0,
    nodeLimitRecorded: false,
  };
}

function countDeclaredOperations(paths: Record<string, unknown>): number {
  let count = 0;
  for (const pathItem of Object.values(paths)) {
    if (!isStrictRecord(pathItem)) continue;
    for (const method of METHOD_ORDER) {
      if (isStrictRecord(pathItem[method.toLowerCase()])) count += 1;
    }
  }
  return count;
}

type ResolvedPathItem = {
  /** Node whose method keys are inventoried: the resolved target, or the raw declaration when resolution failed. */
  pathItem: Record<string, unknown>;
  pointer: McpOpenApiPointer;
  chain: readonly string[];
  /** Set when a declared `$ref` did not resolve to a usable Path Item Object. */
  failure?: McpOpenApiOperationIssue;
};

/**
 * Whether a successfully resolved `$ref` target is a Path Item Object.
 *
 * A target counts only when it declares at least one method key or a
 * `parameters` field. Decoration (`summary`, `description`, `servers`) and
 * specification extensions accompany methods but never make a usable Path Item
 * on their own: a schema object reached through a mistyped pointer commonly
 * carries a bare `description`, so accepting it as a Path Item would drop the
 * path without a diagnostic. Foreign keys disqualify the node for the same
 * reason.
 */
function isPathItemObject(value: unknown): value is Record<string, unknown> {
  if (!isStrictRecord(value)) return false;
  let usable = false;
  for (const key of Object.keys(value)) {
    if (key === "parameters" || PATH_ITEM_METHOD_KEYS.has(key)) {
      usable = true;
      continue;
    }
    if (
      key === "$ref" ||
      PATH_ITEM_DECORATION_KEYS.has(key) ||
      key.startsWith("x-")
    ) {
      continue;
    }
    return false;
  }
  return usable;
}

/**
 * Resolves one Path Item for inventory. A Path Item may legally declare a
 * `$ref` next to its own method keys, so an unresolvable reference falls back
 * to the raw node and its declared methods still produce operations; the
 * failure itself becomes a document-level blocker. A reference that resolves
 * to something other than a Path Item Object — a schema reached through a
 * mistyped pointer, for example — fails the same way instead of vanishing as
 * a path with zero operations.
 *
 * Only a declared `$ref` can fail. A path item without one that declares no
 * method and no `parameters` declares no operations, and skipping it silently
 * is the correct reading: nothing was unreadable, there was simply nothing
 * declared.
 */
function resolvePathItem(
  rawPathItem: Record<string, unknown>,
  declaredPointer: McpOpenApiPointer,
  session: DocumentSession,
): ResolvedPathItem {
  const issues: McpOpenApiOperationIssue[] = [];
  const followed = followReferences(
    rawPathItem,
    { ...createResolutionContext(session), issues },
    declaredPointer,
    [],
  );
  if (followed !== null && isPathItemObject(followed.value)) {
    return {
      pathItem: followed.value,
      pointer: followed.pointer,
      chain: followed.chain,
    };
  }
  if (!isReferenceNode(rawPathItem)) {
    return { pathItem: rawPathItem, pointer: declaredPointer, chain: [] };
  }

  const declaredReference = rawPathItem["$ref"];
  const failure: McpOpenApiOperationIssue = issues[0] ?? {
    code: MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
    severity: "error",
    message: `Reference "${describeReference(
      declaredReference,
    )}" does not resolve to a Path Item object.`,
    path: declaredPointer,
  };
  for (const issue of issues.length > 0 ? issues : [failure]) {
    pushIssue(
      session.documentIssues,
      issue.code,
      issue.message,
      issue.path ?? declaredPointer,
    );
  }
  return {
    pathItem: rawPathItem,
    pointer: declaredPointer,
    chain: [],
    failure,
  };
}

function readOperations(
  paths: Record<string, unknown>,
  session: DocumentSession,
): McpOpenApiInventoryOperation[] {
  const operations: McpOpenApiInventoryOperation[] = [];
  let declaredOperationCount = 0;
  // Only declared methods spend the operation budget: a placeholder is a
  // diagnostic, and a document already at the limit must not become
  // unimportable because one path item is unreadable.
  const pushOperation = (operation: McpOpenApiInventoryOperation): void => {
    if (declaredOperationCount >= MCP_OPENAPI_LIMITS.maxOperations) {
      limitExceeded(
        MCP_OPENAPI_LIMITS.maxOperations,
        `The OpenAPI document declares more than ${MCP_OPENAPI_LIMITS.maxOperations} operations.`,
      );
    }
    declaredOperationCount += 1;
    operations.push(operation);
  };

  for (const pathKey of Object.keys(paths).sort()) {
    const rawPathItem = paths[pathKey];
    if (!isStrictRecord(rawPathItem)) continue;
    const declaredPointer = `/paths/${escapePointerSegment(pathKey)}`;
    const resolvedPathItem = resolvePathItem(
      rawPathItem,
      declaredPointer,
      session,
    );
    const pathItem = resolvedPathItem.pathItem;
    const pathItemPointer = resolvedPathItem.pointer;
    const pathItemChain = resolvedPathItem.chain;
    const operationCountBefore = operations.length;

    for (const method of METHOD_ORDER) {
      const rawOperation = pathItem[method.toLowerCase()];
      if (!isStrictRecord(rawOperation)) continue;
      pushOperation(
        buildOperation({
          method,
          path: pathKey,
          operationPointer: `${pathItemPointer}/${method.toLowerCase()}`,
          pathItemPointer,
          pathItemChain,
          rawOperation,
          pathItemParameters: pathItem["parameters"],
          pathItemServers: pathItem["servers"],
          session,
          ctx: createResolutionContext(session),
        }),
      );
    }

    // The failure is already recorded as a document issue; the placeholder
    // only keeps a path whose methods could not be read visible. A path that
    // still yielded operations is visible on its own and needs no phantom row.
    if (
      resolvedPathItem.failure !== undefined &&
      operations.length === operationCountBefore
    ) {
      // The placeholder's `method` is intentionally empty: the real methods of
      // an unreadable Path Item are unknowable, and the mapper blocks every
      // method it cannot execute.
      operations.push({
        operationKey: `* ${pathKey}`,
        method: "",
        path: pathKey,
        tags: [],
        deprecated: false,
        parameters: [],
        security: [],
        servers: [],
        issues: [resolvedPathItem.failure],
        pointer: declaredPointer,
      });
    }
  }
  return operations;
}

function readDocumentVersion(root: Record<string, unknown>): "3.0" | "3.1" {
  const declared = root["openapi"];
  if (typeof declared === "string") {
    const match = OPENAPI_VERSION_PATTERN.exec(declared);
    if (match) return match[1] === "1" ? "3.1" : "3.0";
  }
  return unsupportedVersion();
}

/* ------------------------------------------------------------------------- *
 * Public surface
 * ------------------------------------------------------------------------- */

/**
 * Parses and validates a bounded OpenAPI 3.0/3.1 JSON document into an
 * inventory. Document-level failures throw `AppError`; a single unresolvable,
 * external, cyclic, or over-limit reference only marks its operation.
 */
export function parseOpenApiDocument(text: string): McpOpenApiInventory {
  if (
    documentEncoder.encode(text).byteLength >
    MCP_OPENAPI_LIMITS.maxDocumentBytes
  ) {
    limitExceeded(
      MCP_OPENAPI_LIMITS.maxDocumentBytes,
      "The OpenAPI document exceeds the maximum accepted size.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalidDocument("The submitted OpenAPI source is not valid JSON.");
  }
  if (!isStrictRecord(parsed)) {
    invalidDocument("The OpenAPI document must be a JSON object.");
  }
  assertDocumentDepth(parsed);

  const version = readDocumentVersion(parsed);
  const info = parsed["info"];
  if (!isStrictRecord(info)) {
    invalidDocument("The OpenAPI document must declare an `info` object.");
  }
  const paths = parsed["paths"];
  if (!isStrictRecord(paths)) {
    invalidDocument("The OpenAPI document must declare a `paths` object.");
  }
  if (countDeclaredOperations(paths) > MCP_OPENAPI_LIMITS.maxOperations) {
    limitExceeded(
      MCP_OPENAPI_LIMITS.maxOperations,
      `The OpenAPI document declares more than ${MCP_OPENAPI_LIMITS.maxOperations} operations.`,
    );
  }

  const securitySchemes = readSecuritySchemes(parsed["components"]);
  const documentSecurityDeclaration = parsed["security"];
  const documentIssues: McpOpenApiOperationIssue[] = [];
  const session: DocumentSession = {
    root: parsed,
    securitySchemes,
    documentSecurityDeclaration,
    documentServers: readServers(parsed["servers"], "/servers"),
    budget: { remaining: MCP_OPENAPI_LIMITS.maxRefResolutions },
    documentIssues,
  };

  const document: McpOpenApiDocumentMetadata = {
    version,
    fingerprint: canonicalDocumentFingerprint(parsed),
    servers: session.documentServers,
    securitySchemes,
    security: readSecurityRequirements(
      documentSecurityDeclaration,
      securitySchemes,
    ),
  };
  const title = info["title"];
  if (typeof title === "string") document.title = title;
  const description = info["description"];
  if (typeof description === "string") document.description = description;

  return {
    document,
    operations: readOperations(paths, session),
    documentIssues,
  };
}

/**
 * Canonical, key-sorted fingerprint of a parsed document. It reuses the shared
 * contract fingerprint, so any two documents with the same content produce the
 * same value regardless of JSON key order.
 */
export function canonicalDocumentFingerprint(value: unknown): string {
  return contractFingerprint(value);
}

/**
 * Deterministic MCP-safe tool name suggestion: `operationId` first, else
 * METHOD plus path. Collisions are never resolved here; the caller owns the
 * collision policy.
 */
export function suggestMcpToolName(operation: {
  method: string;
  path: string;
  operationId?: string;
}): string {
  const declaredId = operation.operationId;
  const source =
    typeof declaredId === "string" && declaredId.trim().length > 0
      ? declaredId
      : `${operation.method.toLowerCase()} ${operation.path}`;

  let name = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  while (name.length > 0 && !/^[a-z]/.test(name)) {
    name = /^[0-9]/.test(name)
      ? name.replace(/^[0-9]+/, "")
      : name.replace(/^_+/, "");
  }
  if (name.length === 0) {
    const fallback = source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    name = fallback.length > 0 ? `op_${fallback}` : "op_operation";
  }

  return name.slice(0, 80).replace(/_+$/g, "");
}
