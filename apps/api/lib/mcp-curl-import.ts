/**
 * @file Safe, side-effect-free curl-to-endpoint importer. Preview and draft
 * building are pure functions: they never touch the database, never create
 * or rotate server values/authentication, and only ever describe one
 * endpoint. Value selections are identified by a stable `location` +
 * `occurrenceId` pair recomputed deterministically from the curl text, never
 * by matching a literal value globally.
 */
import { APP_ERROR_CODES, appError } from "./app-error.js";
import {
  isUnderBasePath,
  normalizeBase,
  normalizePosixPath,
} from "./mcp-compiler.js";
import {
  type CurlCredential,
  type CurlCredentialKind,
  parseCurlCommand,
} from "./mcp-curl.js";
import { MCP_REQUEST_DEFINITION_VERSION } from "./mcp-policy.js";
import type {
  McpAgentInput,
  McpBodyDefinition,
  McpJsonNode,
  McpNamedEntry,
  McpPathSegment,
  McpRequestDefinition,
  McpValueBinding,
} from "./mcp-request-definition.js";

export type CurlImportBodyKind = "json" | "form" | "raw";
export type CurlImportLocation = "path" | "query" | "header" | "form" | "json";

export type CurlImportOccurrence = {
  occurrenceId: string;
  location: CurlImportLocation;
  key?: string;
  jsonPath?: string;
  value: string;
};

export type CurlImportCredentialDiagnostic = {
  kind: CurlCredentialKind;
  headerName: string;
};

export type CurlImportPreview = {
  method: string;
  /** Path beneath the server base path, always starting with "/". */
  relativePath: string;
  query: Array<{ key: string; value: string }>;
  headers: Array<{ name: string; value: string }>;
  body: { bodyType: CurlImportBodyKind; raw: string } | null;
  occurrences: CurlImportOccurrence[];
  excludedCredentials: CurlImportCredentialDiagnostic[];
  excludedTransportHeaders: string[];
};

export type CurlImportMarkingAs = "literal" | "serverValue" | "agentInput";

export type CurlImportMarking = {
  location: CurlImportLocation | "raw";
  key?: string;
  jsonPath?: string;
  occurrenceId: string;
  as: CurlImportMarkingAs;
  name?: string;
  agentInput?: McpAgentInput;
};

export type CurlImportServerValueRef = {
  id: string;
  name: string;
};

export type CurlImportDraft = {
  method: string;
  requestDefinition: McpRequestDefinition;
  suggestedName: string;
  credentials: CurlImportCredentialDiagnostic[];
};

function invalidCurl(message: string): never {
  throw appError({
    appCode: APP_ERROR_CODES.MCP_CURL_INVALID,
    message,
    status: 400,
  });
}

/** Exact origin match plus base-path confinement — never a text-prefix strip. */
function resolveRelativePath(serverBaseUrl: string, target: URL): string {
  const base = new URL(serverBaseUrl);
  if (target.origin !== base.origin) {
    invalidCurl(
      `Curl target origin "${target.origin}" does not match the server origin "${base.origin}".`,
    );
  }

  const normalizedBase = normalizeBase(base.pathname);
  const normalizedTarget = normalizePosixPath(target.pathname || "/");
  if (!isUnderBasePath(normalizedTarget, normalizedBase)) {
    invalidCurl(
      `Curl path "${target.pathname}" is outside the server base path "${base.pathname}".`,
    );
  }

  const relative =
    normalizedBase === "/"
      ? normalizedTarget
      : normalizedTarget.slice(normalizedBase.length);
  if (relative === "") return "/";
  return relative.startsWith("/") ? relative : `/${relative}`;
}

function inferBodyKind(
  headers: Array<{ name: string; value: string }>,
  body: string | null,
): CurlImportBodyKind | undefined {
  if (body === null) return undefined;
  const contentType = headers.find(
    (h) => h.name.toLowerCase() === "content-type",
  )?.value;
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    return "form";
  }
  if (contentType?.toLowerCase().includes("json")) return "json";
  try {
    JSON.parse(body);
    return "json";
  } catch {
    return "raw";
  }
}

function collectJsonOccurrences(
  value: unknown,
  path: string,
  out: CurlImportOccurrence[],
): void {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const text = String(value);
    if (text.length === 0) return;
    out.push({
      occurrenceId: `json:${path}`,
      location: "json",
      jsonPath: path,
      value: text,
    });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectJsonOccurrences(item, `${path}[${index}]`, out),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      collectJsonOccurrences(item, path ? `${path}.${key}` : key, out);
    }
  }
}

type ParsedForImport = {
  parsed: ReturnType<typeof parseCurlCommand>;
  relativePath: string;
  bodyKind: CurlImportBodyKind | undefined;
  queryEntries: Array<{ key: string; value: string }>;
};

function parseForImport(serverBaseUrl: string, curl: string): ParsedForImport {
  const parsed = parseCurlCommand(curl);
  const relativePath = resolveRelativePath(serverBaseUrl, parsed.url);
  const bodyKind = inferBodyKind(parsed.headers, parsed.body);
  const queryEntries = [...parsed.url.searchParams].map(([key, value]) => ({
    key,
    value,
  }));
  return { parsed, relativePath, bodyKind, queryEntries };
}

function buildOccurrences(
  relativePath: string,
  queryEntries: Array<{ key: string; value: string }>,
  headers: Array<{ name: string; value: string }>,
  body: string | null,
  bodyKind: CurlImportBodyKind | undefined,
): CurlImportOccurrence[] {
  const occurrences: CurlImportOccurrence[] = [];

  relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .forEach((segment, index) => {
      occurrences.push({
        occurrenceId: `path:${index}`,
        location: "path",
        value: segment,
      });
    });

  const perQueryKey = new Map<string, number>();
  for (const { key, value } of queryEntries) {
    if (!value) continue;
    const occurrenceIndex = perQueryKey.get(key) ?? 0;
    perQueryKey.set(key, occurrenceIndex + 1);
    occurrences.push({
      occurrenceId: `query:${key}:${occurrenceIndex}`,
      location: "query",
      key,
      value,
    });
  }

  const perHeaderName = new Map<string, number>();
  for (const { name, value } of headers) {
    if (!value) continue;
    const lower = name.toLowerCase();
    const occurrenceIndex = perHeaderName.get(lower) ?? 0;
    perHeaderName.set(lower, occurrenceIndex + 1);
    occurrences.push({
      occurrenceId: `header:${lower}:${occurrenceIndex}`,
      location: "header",
      key: name,
      value,
    });
  }

  if (body !== null) {
    if (bodyKind === "json") {
      try {
        collectJsonOccurrences(JSON.parse(body), "", occurrences);
      } catch {
        // Unparseable JSON text stays reportable but unmarkable.
      }
    } else if (bodyKind === "form") {
      const perField = new Map<string, number>();
      for (const [key, value] of new URLSearchParams(body)) {
        if (!value) continue;
        const occurrenceIndex = perField.get(key) ?? 0;
        perField.set(key, occurrenceIndex + 1);
        occurrences.push({
          occurrenceId: `form:${key}:${occurrenceIndex}`,
          location: "form",
          key,
          value,
        });
      }
    }
  }

  return occurrences;
}

/** Pure dry-run parse: sanitized draft shape plus every markable occurrence. */
export function previewCurlImport(
  serverBaseUrl: string,
  curl: string,
): CurlImportPreview {
  const { parsed, relativePath, bodyKind, queryEntries } = parseForImport(
    serverBaseUrl,
    curl,
  );
  const occurrences = buildOccurrences(
    relativePath,
    queryEntries,
    parsed.headers,
    parsed.body,
    bodyKind,
  );

  return {
    method: parsed.method,
    relativePath,
    query: queryEntries,
    headers: parsed.headers,
    body:
      parsed.body !== null
        ? { bodyType: bodyKind ?? "raw", raw: parsed.body }
        : null,
    occurrences,
    excludedCredentials: parsed.credentials.map((credential) => ({
      kind: credential.kind,
      headerName: credential.headerName,
    })),
    excludedTransportHeaders: parsed.excludedTransportHeaders,
  };
}

/** Every credential curl parsing detected, for reject-on-secret call sites. */
export function detectCurlCredentials(curl: string): CurlCredential[] {
  return parseCurlCommand(curl).credentials;
}

function buildJsonNode(
  value: unknown,
  path: string,
  bindingByOccurrenceId: Map<string, McpValueBinding>,
): McpJsonNode {
  if (value === null) return { kind: "literal", jsonType: "null", value: null };

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    const binding = bindingByOccurrenceId.get(`json:${path}`);
    if (binding) {
      const jsonType =
        typeof value === "string"
          ? "string"
          : typeof value === "number"
            ? "number"
            : "boolean";
      return { kind: "binding", binding, jsonType };
    }
    if (typeof value === "string") {
      return { kind: "literal", jsonType: "string", value };
    }
    if (typeof value === "number") {
      return { kind: "literal", jsonType: "number", value };
    }
    return { kind: "literal", jsonType: "boolean", value };
  }

  if (Array.isArray(value)) {
    return {
      kind: "array",
      items: value.map((item, index) =>
        buildJsonNode(item, `${path}[${index}]`, bindingByOccurrenceId),
      ),
    };
  }

  const record = value as Record<string, unknown>;
  return {
    kind: "object",
    fields: Object.entries(record).map(([key, fieldValue], index) => ({
      id: `body_field_${index}`,
      key,
      value: buildJsonNode(
        fieldValue,
        path ? `${path}.${key}` : key,
        bindingByOccurrenceId,
      ),
    })),
  };
}

function suggestToolName(method: string, relativePath: string): string {
  const slug = relativePath
    .replace(/^\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${method.toLowerCase()}_${slug || "request"}`;
}

/**
 * Builds the versioned request definition for exactly one endpoint. Only
 * `serverValue` markings that resolve to an *already existing* server value
 * name are honored — this function never creates, rotates, or infers a
 * secret. Re-run with the same curl text and markings to get the same
 * definition; occurrence ids are derived from parse order, not stored state.
 */
export function buildCurlImportDraft(input: {
  serverBaseUrl: string;
  curl: string;
  markings: CurlImportMarking[];
  serverValues: CurlImportServerValueRef[];
}): CurlImportDraft {
  const { parsed, relativePath, bodyKind, queryEntries } = parseForImport(
    input.serverBaseUrl,
    input.curl,
  );
  const occurrences = buildOccurrences(
    relativePath,
    queryEntries,
    parsed.headers,
    parsed.body,
    bodyKind,
  );
  const occurrenceById = new Map(
    occurrences.map((occurrence) => [occurrence.occurrenceId, occurrence]),
  );
  const serverValuesByName = new Map(
    input.serverValues.map((value) => [value.name, value]),
  );

  const agentInputs: McpAgentInput[] = [];
  const bindingByOccurrenceId = new Map<string, McpValueBinding>();

  for (const marking of input.markings) {
    if (marking.location === "raw") continue;
    const occurrence = occurrenceById.get(marking.occurrenceId);
    if (!occurrence || occurrence.location !== marking.location) {
      invalidCurl(
        `Marking references an unknown occurrence "${marking.occurrenceId}".`,
      );
    }
    if (marking.as === "literal") continue;

    if (marking.as === "serverValue") {
      if (!marking.name) {
        invalidCurl("A serverValue marking requires a name.");
      }
      const ref = serverValuesByName.get(marking.name);
      if (!ref) {
        throw appError({
          appCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
          message: `Server value "${marking.name}" does not exist on this server.`,
          status: 400,
        });
      }
      bindingByOccurrenceId.set(marking.occurrenceId, {
        kind: "serverValue",
        serverValueId: ref.id,
      });
      continue;
    }

    if (!marking.agentInput) {
      invalidCurl("An agentInput marking requires an agentInput definition.");
    }
    agentInputs.push(marking.agentInput);
    bindingByOccurrenceId.set(marking.occurrenceId, {
      kind: "agentInput",
      agentInputId: marking.agentInput.id,
    });
  }

  const pathSegments: McpPathSegment[] = relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment, index) => {
      const binding = bindingByOccurrenceId.get(`path:${index}`);
      return {
        id: `path_${index}`,
        value: binding ?? { kind: "literal", value: segment },
      };
    });

  const query: McpNamedEntry[] = [];
  const perQueryKey = new Map<string, number>();
  for (const { key, value } of queryEntries) {
    if (!value) continue;
    const occurrenceIndex = perQueryKey.get(key) ?? 0;
    perQueryKey.set(key, occurrenceIndex + 1);
    const binding = bindingByOccurrenceId.get(
      `query:${key}:${occurrenceIndex}`,
    ) ?? {
      kind: "literal" as const,
      value,
    };
    query.push({
      id: `query_${key}_${occurrenceIndex}`,
      name: key,
      value: binding,
    });
  }

  const headers: McpNamedEntry[] = [];
  const perHeaderName = new Map<string, number>();
  for (const { name, value } of parsed.headers) {
    if (!value) continue;
    const lower = name.toLowerCase();
    const occurrenceIndex = perHeaderName.get(lower) ?? 0;
    perHeaderName.set(lower, occurrenceIndex + 1);
    const binding = bindingByOccurrenceId.get(
      `header:${lower}:${occurrenceIndex}`,
    ) ?? {
      kind: "literal" as const,
      value,
    };
    headers.push({
      id: `header_${lower}_${occurrenceIndex}`,
      name,
      value: binding,
    });
  }

  const method = parsed.method.toUpperCase();
  const isBodyless = method === "GET" || method === "HEAD";
  let body: McpBodyDefinition = { bodyType: "none" };

  if (parsed.body !== null && !isBodyless) {
    if (bodyKind === "json") {
      let parsedJson: unknown;
      let jsonOk = true;
      try {
        parsedJson = JSON.parse(parsed.body);
      } catch {
        jsonOk = false;
      }
      body = jsonOk
        ? {
            bodyType: "json",
            root: buildJsonNode(parsedJson, "", bindingByOccurrenceId),
          }
        : { bodyType: "raw", bindings: [], template: parsed.body };
    } else if (bodyKind === "form") {
      const fields: McpNamedEntry[] = [];
      const perField = new Map<string, number>();
      for (const [key, value] of new URLSearchParams(parsed.body)) {
        if (!value) continue;
        const occurrenceIndex = perField.get(key) ?? 0;
        perField.set(key, occurrenceIndex + 1);
        const binding = bindingByOccurrenceId.get(
          `form:${key}:${occurrenceIndex}`,
        ) ?? {
          kind: "literal" as const,
          value,
        };
        fields.push({
          id: `form_${key}_${occurrenceIndex}`,
          name: key,
          value: binding,
        });
      }
      body = { bodyType: "form", fields };
    } else {
      body = { bodyType: "raw", bindings: [], template: parsed.body };
    }
  }

  const requestDefinition: McpRequestDefinition = {
    version: MCP_REQUEST_DEFINITION_VERSION,
    pathSegments,
    query,
    headers,
    body,
    agentInputs,
  };

  return {
    method,
    requestDefinition,
    suggestedName: suggestToolName(method, relativePath),
    credentials: parsed.credentials.map((credential) => ({
      kind: credential.kind,
      headerName: credential.headerName,
    })),
  };
}
