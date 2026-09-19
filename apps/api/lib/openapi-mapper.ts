/**
 * @file Pure, deterministic mapping from one parsed OpenAPI inventory operation
 * to a canonical MCP request definition plus structured per-operation
 * diagnostics. Never reads the source document, the database, or the network.
 */
import {
  isMcpOpenApiBlockingIssueCode,
  MCP_OPENAPI_ISSUE_CODES,
  type McpOpenApiIssueCode,
} from "@repo/core";
import {
  MCP_COMPILER_READ_METHODS,
  isUnderBasePath,
  normalizeBase,
  normalizePosixPath,
} from "./mcp-compiler.js";
import { isForbiddenTransportHeaderName } from "./mcp-policy.js";
import { MCP_REQUEST_DEFINITION_VERSION } from "./mcp-policy.js";
import {
  MCP_DEFINITION_LIMITS,
  type McpAgentInput,
  type McpBodyDefinition,
  type McpJsonNode,
  type McpNamedEntry,
  type McpPathSegment,
  type McpRequestDefinition,
  type McpValueBinding,
} from "./mcp-request-definition.js";
import { assertHttpUrl } from "./mcp-ssrf.js";
import {
  REDACTION_PLACEHOLDER,
  isCredentialLikeSchemaPosition,
  isCredentialLikeValue,
  redactCredentialText,
} from "./openapi-redact.js";
import {
  mcpOpenApiMethodSchema,
  type McpOpenApiDocumentMetadata,
  type McpOpenApiInventoryOperation,
  type McpOpenApiInventoryParameter,
  type McpOpenApiInventoryRequestBody,
  type McpOpenApiInventoryServer,
  type McpOpenApiMethod,
  type McpOpenApiOperationIssue,
  type McpOpenApiSecurityRequirement,
} from "./openapi-import-contracts.js";

export type MapInventoryOperationInput = {
  operation: McpOpenApiInventoryOperation;
  document: McpOpenApiDocumentMetadata;
  /** Absolute base URL of the selected MCP server (e.g. `https://api.example.com/v1`). */
  serverBaseUrl: string;
  /** Suggested name produced by the document parser; the mapper never re-derives it. */
  suggestedName: string;
  /** MCP-safe names already used by other tools on this server. */
  existingToolNames: readonly string[];
  /** Names already claimed by OTHER selected candidates in this same batch. */
  claimedNames?: readonly string[];
  /** Owner-supplied name override for this operation, already MCP-safe. */
  nameOverride?: string;
};

export type MapInventoryOperationResult = {
  operationKey: string;
  selectable: boolean;
  issues: McpOpenApiOperationIssue[];
  /** Final suggested name honoring `nameOverride`. */
  name: string;
  method?: McpOpenApiMethod;
  path: string;
  tags: string[];
  /** Credential-scrubbed `operation.summary`, when the document declared one. */
  title?: string;
  /** Credential-scrubbed `operation.description`, when the document declared one. */
  description?: string;
  deprecated: boolean;
  security: McpOpenApiSecurityRequirement[];
  /** Present only when the operation is representable. */
  requestDefinition?: McpRequestDefinition;
};

/** Stable issue builder shared by the mapper and its tests. */
export function openApiIssue(
  code: McpOpenApiIssueCode,
  message: string,
  pointer?: string,
): McpOpenApiOperationIssue {
  return {
    code,
    severity: isMcpOpenApiBlockingIssueCode(code) ? "error" : "warning",
    message,
    ...(pointer !== undefined ? { path: pointer } : {}),
  };
}

export { stripSensitiveExamples } from "./openapi-redact.js";

const ISSUE = MCP_OPENAPI_ISSUE_CODES;

const SUPPORTED_METHODS = new Set<string>(mcpOpenApiMethodSchema.options);

const ALLOWED_STRING_FORMATS = new Set([
  "date",
  "date-time",
  "email",
  "uri",
  "uuid",
]);

/** `McpAgentInput.examples` admits at most eight entries. */
const MAX_INPUT_EXAMPLES = 8;

/** Named entries and JSON object keys share the same canonical field cap. */
const MAX_FIELD_NAME_LENGTH = 256;

const RAW_TEMPLATE_LIMIT = 256_000;

const UNSUPPORTED_SCHEMA_KEYWORDS = [
  "$ref",
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "prefixItems",
] as const;

const SCHEMA_LIST_KEYWORDS = ["allOf", "anyOf", "oneOf"] as const;

type JsonRecord = Record<string, unknown>;
type AgentInputType = McpAgentInput["type"];

type InputFields = {
  type: AgentInputType;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: McpAgentInput["format"];
  enum?: Array<string | number | boolean>;
  allowEmpty?: boolean;
  examples?: unknown[];
  sensitive?: boolean;
};

type SchemaResolution =
  | { kind: "scalar"; type: AgentInputType }
  | { kind: "structured"; typeName: "object" | "array" }
  | { kind: "unsupported"; detail: string };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSchema(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function baseMediaType(mediaType: string): string {
  const [base] = mediaType.split(";");
  return (base ?? "").trim().toLowerCase();
}

function isMultipartLikeMediaType(mediaType: string): boolean {
  const base = baseMediaType(mediaType);
  return base.includes("multipart") || base.includes("file");
}

/**
 * Applies the same normalization the document parser uses for tool names:
 * lowercase, non-alphanumeric runs collapse to `_`, and any leading run that is
 * not a letter is removed so the result matches `/^[a-z][a-z0-9_]*$/`.
 */
function normalizeMcpInputName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  let name = slug;
  while (name.length > 0 && !/^[a-z]/.test(name)) {
    name = /^[0-9]/.test(name)
      ? name.replace(/^[0-9]+/, "")
      : name.replace(/^_+/, "");
  }
  return name.length > 0 ? name : "value";
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function isPrimitiveEnumValue(
  value: unknown,
): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

type PrimitiveConstant = {
  jsonType: "string" | "number" | "boolean" | "null";
  value: string | number | boolean | null;
};

/** Narrows a JSON Schema `const` to the primitive literal the canonical model can carry. */
function readSchemaConstant(value: unknown): PrimitiveConstant | null {
  if (value === null) return { jsonType: "null", value: null };
  if (typeof value === "string") return { jsonType: "string", value };
  if (typeof value === "number") return { jsonType: "number", value };
  if (typeof value === "boolean") return { jsonType: "boolean", value };
  return null;
}

function summarizeNames(names: readonly string[], limit = 5): string {
  const shown = names.slice(0, limit).join(", ");
  const hidden = names.length - limit;
  return hidden > 0 ? `${shown} and ${hidden} more` : shown;
}

export function mapInventoryOperation(
  input: MapInventoryOperationInput,
): MapInventoryOperationResult {
  const { operation } = input;
  const issues: McpOpenApiOperationIssue[] = [...operation.issues];
  const addIssue = (
    code: McpOpenApiIssueCode,
    message: string,
    pointer?: string,
  ): void => {
    issues.push(openApiIssue(code, message, pointer));
  };

  const method = operation.method.toUpperCase();
  const supportedMethod = SUPPORTED_METHODS.has(method);
  if (!supportedMethod) {
    addIssue(
      ISSUE.METHOD_UNSUPPORTED,
      `Method "${operation.method}" cannot be executed by the canonical tool model.`,
      operation.pointer,
    );
  }

  const name = input.nameOverride ?? input.suggestedName;
  if (input.existingToolNames.includes(name)) {
    addIssue(
      ISSUE.NAME_CONFLICT,
      `Tool name "${name}" already exists on this server.`,
      operation.pointer,
    );
  }
  if (input.claimedNames?.includes(name)) {
    addIssue(
      ISSUE.DUPLICATE_NAME,
      `Tool name "${name}" is already claimed by another selected operation in this batch.`,
      operation.pointer,
    );
  }

  // ---- Agent input registry ------------------------------------------------
  const agentInputs: McpAgentInput[] = [];
  const inputNameSources = new Map<string, string>();
  let agentInputLimitFlagged = false;
  let jsonNodeCount = 0;
  let jsonNodeLimitFlagged = false;
  let jsonDepthLimitFlagged = false;
  let fieldIdCounter = 0;

  const registerAgentInput = (draft: {
    name: string;
    required: boolean;
    source: string;
    pointer?: string;
    schema?: JsonRecord;
    extraExamples?: unknown[];
    structuredAsJson?: boolean;
    unknownType?: AgentInputType;
    sensitive?: boolean;
  }): McpAgentInput | null => {
    const inputName = normalizeMcpInputName(draft.name);
    const existingSource = inputNameSources.get(inputName);
    if (existingSource !== undefined) {
      addIssue(
        ISSUE.AMBIGUOUS_PARAMETER,
        `${draft.source} and ${existingSource} both map to agent input name "${inputName}".`,
        draft.pointer,
      );
      return null;
    }
    if (agentInputs.length >= MCP_DEFINITION_LIMITS.agentInputs) {
      if (!agentInputLimitFlagged) {
        agentInputLimitFlagged = true;
        addIssue(
          ISSUE.LIMIT_EXCEEDED,
          `A definition supports at most ${MCP_DEFINITION_LIMITS.agentInputs} agent inputs.`,
          operation.pointer,
        );
      }
      return null;
    }
    const fields = buildAgentInputFields(draft.schema ?? {}, {
      label: draft.source,
      pointer: draft.pointer,
      propertyName: draft.name,
      extraExamples: draft.extraExamples,
      structuredAsJson: draft.structuredAsJson,
      unknownType: draft.unknownType ?? "string",
    });
    if (fields === null) return null;

    const sensitive =
      fields.sensitive === true ||
      draft.sensitive === true ||
      isCredentialLikeSchemaPosition(draft.schema ?? {}, draft.name);

    const agentInput: McpAgentInput = {
      id: `ain_${agentInputs.length}`,
      name: inputName,
      required: draft.required,
      sensitive,
      type: fields.type,
      ...(fields.minimum !== undefined ? { minimum: fields.minimum } : {}),
      ...(fields.maximum !== undefined ? { maximum: fields.maximum } : {}),
      ...(fields.minLength !== undefined
        ? { minLength: fields.minLength }
        : {}),
      ...(fields.maxLength !== undefined
        ? { maxLength: fields.maxLength }
        : {}),
      ...(fields.pattern !== undefined ? { pattern: fields.pattern } : {}),
      ...(fields.format !== undefined ? { format: fields.format } : {}),
      ...(fields.enum !== undefined ? { enum: fields.enum } : {}),
      ...(fields.allowEmpty !== undefined
        ? { allowEmpty: fields.allowEmpty }
        : {}),
      ...(fields.examples !== undefined ? { examples: fields.examples } : {}),
    };
    agentInputs.push(agentInput);
    inputNameSources.set(inputName, draft.source);
    return agentInput;
  };

  const resolveSchemaType = (
    schema: JsonRecord,
    unknownType: AgentInputType,
  ): SchemaResolution => {
    const raw = schema.type;
    let names: string[] = [];
    if (typeof raw === "string") {
      names = [raw];
    } else if (Array.isArray(raw)) {
      if (!raw.every((entry): entry is string => typeof entry === "string")) {
        return { kind: "unsupported", detail: "declares an invalid type list" };
      }
      names = raw;
    } else if (raw !== undefined && raw !== null) {
      return { kind: "unsupported", detail: "declares an invalid type" };
    }

    const effective = names.filter((entry) => entry !== "null");
    if (effective.length === 0) {
      if (names.length > 0) {
        return {
          kind: "unsupported",
          detail: 'declares only the "null" type',
        };
      }
      return { kind: "scalar", type: unknownType };
    }
    if (effective.length > 1) {
      return {
        kind: "unsupported",
        detail: `declares multiple types (${effective.join(", ")})`,
      };
    }

    switch (effective[0]) {
      case "string":
        return { kind: "scalar", type: "string" };
      case "integer":
        return { kind: "scalar", type: "integer" };
      case "number":
        return { kind: "scalar", type: "number" };
      case "boolean":
        return { kind: "scalar", type: "boolean" };
      case "object":
        return { kind: "structured", typeName: "object" };
      case "array":
        return { kind: "structured", typeName: "array" };
      default:
        return {
          kind: "unsupported",
          detail: `declares the unsupported type "${effective[0]}"`,
        };
    }
  };

  /**
   * Collects example/default material for one agent input. A credential-bearing
   * position drops all of it because the value is supplied per call; elsewhere
   * only credential-shaped values are dropped. Both cases warn, so the owner is
   * never handed a silently narrowed contract.
   */
  const collectExamples = (
    schema: JsonRecord,
    propertyName: string,
    extraExamples: readonly unknown[],
    label: string,
    pointer: string | undefined,
  ): unknown[] => {
    const credentialBearing = isCredentialLikeSchemaPosition(
      schema,
      propertyName,
    );
    const candidates: unknown[] = [
      ...extraExamples,
      schema.example,
      ...(Array.isArray(schema.examples) ? schema.examples : []),
      schema.default,
    ];
    const examples: unknown[] = [];
    let removed = 0;
    for (const candidate of candidates) {
      if (candidate === undefined) continue;
      if (credentialBearing || isCredentialLikeValue(candidate)) {
        removed += 1;
        continue;
      }
      examples.push(candidate);
    }
    if (removed > 0) {
      addIssue(
        ISSUE.METADATA_IGNORED,
        credentialBearing
          ? `The example/default material declared by ${label} was removed because the position is credential-bearing; the value is supplied per call instead.`
          : `Credential-like example/default values declared by ${label} were removed.`,
        pointer,
      );
    }
    return examples.slice(0, MAX_INPUT_EXAMPLES);
  };

  const buildAgentInputFields = (
    schema: JsonRecord,
    options: {
      label: string;
      pointer?: string;
      propertyName: string;
      extraExamples?: readonly unknown[];
      structuredAsJson?: boolean;
      unknownType: AgentInputType;
    },
  ): InputFields | null => {
    for (const keyword of UNSUPPORTED_SCHEMA_KEYWORDS) {
      if (schema[keyword] === undefined) continue;
      addIssue(
        ISSUE.UNSUPPORTED_SCHEMA,
        keyword === "$ref"
          ? `${options.label} still contains an unresolved $ref.`
          : `${options.label} declares "${keyword}", which the canonical model cannot represent.`,
        options.pointer,
      );
      return null;
    }

    const resolution = resolveSchemaType(schema, options.unknownType);
    if (resolution.kind === "unsupported") {
      addIssue(
        ISSUE.UNSUPPORTED_SCHEMA,
        `${options.label} ${resolution.detail}.`,
        options.pointer,
      );
      return null;
    }

    let type: AgentInputType;
    if (resolution.kind === "structured") {
      if (options.structuredAsJson !== true) {
        addIssue(
          ISSUE.UNSUPPORTED_SCHEMA,
          `${options.label} is a structured ${resolution.typeName} value the canonical parameter model cannot carry.`,
          options.pointer,
        );
        return null;
      }
      type = "json";
    } else {
      type = resolution.type;
    }

    const fields: InputFields = { type };
    if (type === "string") {
      const format =
        typeof schema.format === "string" ? schema.format : undefined;
      if (format !== undefined && ALLOWED_STRING_FORMATS.has(format)) {
        fields.format = format as McpAgentInput["format"];
      }
      const minLength = readNonNegativeInteger(schema.minLength);
      if (minLength !== undefined) {
        fields.minLength = minLength;
        if (minLength === 0) fields.allowEmpty = true;
      }
      const maxLength = readNonNegativeInteger(schema.maxLength);
      if (maxLength !== undefined) fields.maxLength = maxLength;
      const pattern =
        typeof schema.pattern === "string" ? schema.pattern : undefined;
      if (pattern !== undefined && pattern.length > 0) {
        if (pattern.length > 512) {
          addIssue(
            ISSUE.UNSUPPORTED_SCHEMA,
            `${options.label} declares a "pattern" longer than 512 characters.`,
            options.pointer,
          );
          return null;
        }
        if (isCredentialLikeValue(pattern)) {
          addIssue(
            ISSUE.METADATA_IGNORED,
            `A credential-like "pattern" declared by ${options.label} was removed and is not advertised.`,
            options.pointer,
          );
        } else {
          fields.pattern = pattern;
        }
      }
    } else if (type === "number" || type === "integer") {
      const minimum = readFiniteNumber(schema.minimum);
      if (minimum !== undefined) fields.minimum = minimum;
      const maximum = readFiniteNumber(schema.maximum);
      if (maximum !== undefined) fields.maximum = maximum;
    }

    if (type !== "json") {
      const enumValues = schema.enum;
      if (Array.isArray(enumValues) && enumValues.length > 0) {
        const primitives = enumValues.filter(isPrimitiveEnumValue);
        if (primitives.length !== enumValues.length) {
          addIssue(
            ISSUE.UNSUPPORTED_SCHEMA,
            `${options.label} declares an enum with values the canonical model cannot carry.`,
            options.pointer,
          );
          return null;
        }
        const credentialBearing = isCredentialLikeSchemaPosition(
          schema,
          options.propertyName,
        );
        const kept = credentialBearing
          ? []
          : primitives.filter((value) => !isCredentialLikeValue(value));
        if (kept.length === 0) {
          fields.sensitive = true;
          addIssue(
            ISSUE.METADATA_IGNORED,
            credentialBearing
              ? `Credential-like enum values declared by ${options.label} were removed (the position is credential-bearing); the value is supplied per call instead.`
              : `Credential-like enum values declared by ${options.label} were removed; the value is supplied per call instead.`,
            options.pointer,
          );
        } else {
          if (kept.length !== primitives.length) {
            addIssue(
              ISSUE.METADATA_IGNORED,
              `Credential-like enum values declared by ${options.label} were removed; the enum was narrowed to the remaining values.`,
              options.pointer,
            );
          }
          fields.enum = kept;
        }
      }
      const examples = collectExamples(
        schema,
        options.propertyName,
        options.extraExamples ?? [],
        options.label,
        options.pointer,
      );
      if (examples.length > 0) fields.examples = examples;
    }

    return fields;
  };

  // ---- Server boundary ------------------------------------------------------
  const selectedServer = ((): { origin: string; basePath: string } | null => {
    try {
      const url = assertHttpUrl(input.serverBaseUrl);
      return { origin: url.origin, basePath: normalizeBase(url.pathname) };
    } catch {
      addIssue(
        ISSUE.FOREIGN_ORIGIN,
        "The selected server base URL is not an absolute HTTP(S) URL.",
        operation.pointer,
      );
      return null;
    }
  })();

  const resolveServerTemplate = (
    server: McpOpenApiInventoryServer,
  ): string | null => {
    const variables = new Map(
      server.variables.map((entry) => [entry.name, entry]),
    );
    let unresolved: string | undefined;
    let credentialDefault: string | undefined;
    const resolved = server.url.replace(
      /\{([^}]*)\}/g,
      (whole, variableName: string) => {
        const variable = variables.get(variableName);
        if (!variable || variable.default === undefined) {
          unresolved = variableName;
          return whole;
        }
        if (isCredentialLikeValue(variable.default)) {
          credentialDefault ??= variableName;
          return whole;
        }
        return variable.default;
      },
    );
    if (credentialDefault !== undefined) {
      addIssue(
        ISSUE.AMBIGUOUS_SERVER,
        `Server variable "${credentialDefault}" declares a default that looks like a credential and is never inlined into the path; supply the value explicitly instead.`,
        server.pointer,
      );
      return null;
    }
    if (unresolved !== undefined) {
      addIssue(
        ISSUE.AMBIGUOUS_SERVER,
        `Server variable "${unresolved}" has no default value and cannot be resolved against the selected server.`,
        server.pointer,
      );
      return null;
    }
    return resolved;
  };

  const resolveRelativePath = (): string | null => {
    if (selectedServer === null) return null;

    const declaredPath = operation.path.startsWith("/")
      ? operation.path
      : `/${operation.path}`;
    const effectiveServer = operation.servers[0];
    let prefixPath = selectedServer.basePath;

    if (effectiveServer !== undefined) {
      const serverUrl = resolveServerTemplate(effectiveServer);
      if (serverUrl === null) return null;
      let parsed: URL;
      try {
        parsed = assertHttpUrl(serverUrl);
      } catch {
        addIssue(
          ISSUE.FOREIGN_ORIGIN,
          `The operation server "${effectiveServer.url}" is not a usable HTTP(S) URL.`,
          effectiveServer.pointer,
        );
        return null;
      }
      if (parsed.origin !== selectedServer.origin) {
        addIssue(
          ISSUE.FOREIGN_ORIGIN,
          `The operation server origin "${parsed.origin}" does not match the selected server origin "${selectedServer.origin}".`,
          effectiveServer.pointer,
        );
        return null;
      }
      prefixPath = parsed.pathname.endsWith("/")
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname;
    }

    const effectivePath = normalizePosixPath(`${prefixPath}${declaredPath}`);
    if (!isUnderBasePath(effectivePath, selectedServer.basePath)) {
      addIssue(
        ISSUE.FOREIGN_ORIGIN,
        `The operation path "${operation.path}" is outside the selected server base path "${selectedServer.basePath}".`,
        operation.pointer,
      );
      return null;
    }
    const relative =
      selectedServer.basePath === "/"
        ? effectivePath
        : effectivePath.slice(selectedServer.basePath.length);
    if (relative === "") return "/";
    return relative.startsWith("/") ? relative : `/${relative}`;
  };

  // ---- Parameters -----------------------------------------------------------
  const checkParameterSerialization = (
    param: McpOpenApiInventoryParameter,
  ): boolean => {
    const location = param.in;
    const expectedStyle = location === "query" ? "form" : "simple";
    if (param.style !== undefined && param.style !== expectedStyle) {
      addIssue(
        ISSUE.UNSUPPORTED_SERIALIZATION,
        `The ${location} parameter "${param.name}" declares style "${param.style}"; only the default "${expectedStyle}" style is representable.`,
        param.pointer,
      );
      return false;
    }
    const supportsExplode = location === "query";
    if (!supportsExplode && param.explode === true) {
      addIssue(
        ISSUE.UNSUPPORTED_SERIALIZATION,
        `The ${location} parameter "${param.name}" declares explode=true; the canonical executor reproduces plain serialization only.`,
        param.pointer,
      );
      return false;
    }
    if (supportsExplode && param.explode === false) {
      addIssue(
        ISSUE.UNSUPPORTED_SERIALIZATION,
        `The ${location} parameter "${param.name}" declares explode=false; only the default explode=true is representable.`,
        param.pointer,
      );
      return false;
    }
    return true;
  };

  const mapParameterBinding = (
    param: McpOpenApiInventoryParameter,
  ): McpValueBinding | null => {
    if (!checkParameterSerialization(param)) return null;
    const agentInput = registerAgentInput({
      name: param.name,
      required: param.in === "path" ? true : param.required,
      source: `The ${param.in} parameter "${param.name}"`,
      pointer: param.pointer,
      schema: param.schema,
      extraExamples: param.examples,
    });
    if (agentInput === null) return null;
    return { kind: "agentInput", agentInputId: agentInput.id };
  };

  const pathParameterByName = new Map<string, McpOpenApiInventoryParameter>();
  const queryParameters: McpOpenApiInventoryParameter[] = [];
  const headerParameters: McpOpenApiInventoryParameter[] = [];

  for (const param of operation.parameters) {
    if (param.in === "cookie") {
      addIssue(
        ISSUE.COOKIE_PARAMETER,
        `The cookie parameter "${param.name}" cannot be represented by the canonical executor.`,
        param.pointer,
      );
      continue;
    }
    if (param.deprecated) {
      addIssue(
        ISSUE.DEPRECATED,
        `The ${param.in} parameter "${param.name}" is marked deprecated.`,
        param.pointer,
      );
    }
    if (param.in === "path") {
      if (pathParameterByName.has(param.name)) {
        addIssue(
          ISSUE.AMBIGUOUS_PARAMETER,
          `The path parameter "${param.name}" is declared more than once.`,
          param.pointer,
        );
        continue;
      }
      pathParameterByName.set(param.name, param);
      continue;
    }
    if (param.in === "query") {
      queryParameters.push(param);
      continue;
    }
    headerParameters.push(param);
  }

  const relativePath = resolveRelativePath();
  const pathSegments: McpPathSegment[] | null =
    relativePath === null ? null : [];

  const synthesizePathBinding = (
    placeholderName: string,
  ): McpValueBinding | null => {
    const label = `The path parameter "${placeholderName}"`;
    const agentInput = registerAgentInput({
      name: placeholderName,
      required: true,
      source: label,
    });
    if (agentInput === null) return null;
    return { kind: "agentInput", agentInputId: agentInput.id };
  };

  if (relativePath !== null && pathSegments !== null) {
    const matchedPathParameters = new Set<string>();
    const templateParts = relativePath
      .split(/(\{[^}]*\})/)
      .filter((part) => part.length > 0);
    for (const part of templateParts) {
      const placeholder = /^\{([^}]*)\}$/.exec(part);
      if (placeholder === null) {
        pathSegments.push({
          id: `path_${pathSegments.length}`,
          value: { kind: "literal", value: part },
        });
        continue;
      }
      const placeholderName = placeholder[1] ?? "";
      const declared = pathParameterByName.get(placeholderName);
      if (declared !== undefined) matchedPathParameters.add(placeholderName);
      const binding =
        declared !== undefined
          ? mapParameterBinding(declared)
          : synthesizePathBinding(placeholderName);
      if (binding === null) continue;
      pathSegments.push({ id: `path_${pathSegments.length}`, value: binding });
    }

    for (const [parameterName, param] of pathParameterByName) {
      if (matchedPathParameters.has(parameterName)) continue;
      addIssue(
        ISSUE.AMBIGUOUS_PARAMETER,
        `The path parameter "${parameterName}" has no matching placeholder in "${operation.path}".`,
        param.pointer,
      );
    }

    if (pathSegments.length > MCP_DEFINITION_LIMITS.pathSegments) {
      addIssue(
        ISSUE.LIMIT_EXCEEDED,
        `A definition supports at most ${MCP_DEFINITION_LIMITS.pathSegments} path segments.`,
        operation.pointer,
      );
    }
  }

  const query: McpNamedEntry[] = [];
  for (const param of queryParameters) {
    if (param.name.length > MAX_FIELD_NAME_LENGTH) {
      addIssue(
        ISSUE.UNREPRESENTABLE_REQUEST,
        `The query parameter name exceeds ${MAX_FIELD_NAME_LENGTH} characters.`,
        param.pointer,
      );
      continue;
    }
    const binding = mapParameterBinding(param);
    if (binding === null) continue;
    query.push({
      id: `query_${query.length}`,
      name: param.name,
      value: binding,
      ...(param.required ? {} : { omitWhenAbsent: true }),
    });
  }
  if (query.length > MCP_DEFINITION_LIMITS.namedEntries) {
    addIssue(
      ISSUE.LIMIT_EXCEEDED,
      `A definition supports at most ${MCP_DEFINITION_LIMITS.namedEntries} query entries.`,
      operation.pointer,
    );
  }

  const headers: McpNamedEntry[] = [];
  for (const param of headerParameters) {
    if (isForbiddenTransportHeaderName(param.name.toLowerCase())) {
      addIssue(
        ISSUE.UNREPRESENTABLE_REQUEST,
        `The header parameter "${param.name}" is reserved for the transport layer and cannot be set per request.`,
        param.pointer,
      );
      continue;
    }
    if (param.name.length > MAX_FIELD_NAME_LENGTH) {
      addIssue(
        ISSUE.UNREPRESENTABLE_REQUEST,
        `The header parameter name exceeds ${MAX_FIELD_NAME_LENGTH} characters.`,
        param.pointer,
      );
      continue;
    }
    const binding = mapParameterBinding(param);
    if (binding === null) continue;
    headers.push({
      id: `header_${headers.length}`,
      name: param.name,
      value: binding,
      ...(param.required ? {} : { omitWhenAbsent: true }),
    });
  }
  if (headers.length > MCP_DEFINITION_LIMITS.namedEntries) {
    addIssue(
      ISSUE.LIMIT_EXCEEDED,
      `A definition supports at most ${MCP_DEFINITION_LIMITS.namedEntries} header entries.`,
      operation.pointer,
    );
  }

  // ---- Request body ---------------------------------------------------------
  let body: McpBodyDefinition | null = { bodyType: "none" };
  const ignoredMetadata: string[] = [];
  const omittedReadOnlyProperties: string[] = [];
  const alwaysSentOptionalProperties: string[] = [];

  const flagJsonNodeLimit = (message: string): null => {
    if (!jsonNodeLimitFlagged) {
      jsonNodeLimitFlagged = true;
      addIssue(ISSUE.LIMIT_EXCEEDED, message, operation.pointer);
    }
    return null;
  };

  const flagJsonDepthLimit = (message: string): null => {
    if (!jsonDepthLimitFlagged) {
      jsonDepthLimitFlagged = true;
      addIssue(ISSUE.LIMIT_EXCEEDED, message, operation.pointer);
    }
    return null;
  };

  const buildJsonNode = (
    schema: JsonRecord,
    context: "root" | "field" | "item",
    label: string,
    required: boolean,
    depth: number,
    pointer: string | undefined,
  ): McpJsonNode | null => {
    jsonNodeCount += 1;
    if (jsonNodeCount > MCP_DEFINITION_LIMITS.jsonNodes) {
      return flagJsonNodeLimit(
        `A JSON body supports at most ${MCP_DEFINITION_LIMITS.jsonNodes} nodes.`,
      );
    }
    if (depth > MCP_DEFINITION_LIMITS.jsonDepth) {
      return flagJsonDepthLimit(
        `A JSON body supports at most ${MCP_DEFINITION_LIMITS.jsonDepth} levels of nesting.`,
      );
    }

    for (const keyword of UNSUPPORTED_SCHEMA_KEYWORDS) {
      if (schema[keyword] === undefined) continue;
      addIssue(
        ISSUE.UNSUPPORTED_SCHEMA,
        keyword === "$ref"
          ? `${label} still contains an unresolved $ref.`
          : `${label} declares "${keyword}", which the canonical model cannot represent.`,
        pointer,
      );
      return null;
    }

    const constant = readSchemaConstant(schema.const);
    if (constant !== null) {
      const credentialConstant =
        isCredentialLikeSchemaPosition(
          schema,
          context === "root" ? undefined : label,
        ) || isCredentialLikeValue(constant.value);
      if (!credentialConstant) {
        return {
          kind: "literal",
          jsonType: constant.jsonType,
          value: constant.value,
        };
      }
      addIssue(
        ISSUE.METADATA_IGNORED,
        `A credential-like constant declared by ${label} was replaced by a sensitive input supplied per call.`,
        pointer,
      );
      const constantInputRequired = context === "field" ? required : true;
      const constantInput = registerAgentInput({
        name: context === "root" ? "body" : label,
        required: constantInputRequired,
        source: label,
        pointer,
        schema,
        sensitive: true,
        structuredAsJson: true,
        unknownType: "json",
      });
      if (constantInput === null) return null;
      return {
        kind: "binding",
        binding: { kind: "agentInput", agentInputId: constantInput.id },
        jsonType: "any",
        ...(context === "field" && !required ? { omitWhenAbsent: true } : {}),
      };
    }

    const resolution = resolveSchemaType(schema, "json");
    if (resolution.kind === "unsupported") {
      addIssue(
        ISSUE.UNSUPPORTED_SCHEMA,
        `${label} ${resolution.detail}.`,
        pointer,
      );
      return null;
    }

    if (resolution.kind === "structured") {
      return resolution.typeName === "object"
        ? buildObjectNode(schema, context, label, required, depth, pointer)
        : buildArrayNode(schema, context, label, required, depth, pointer);
    }

    const inputRequired = context === "field" ? required : true;
    const agentInput = registerAgentInput({
      name: context === "root" ? "body" : label,
      required: inputRequired,
      source: label,
      pointer,
      schema,
      unknownType: "json",
    });
    if (agentInput === null) return null;
    let jsonType: "string" | "number" | "boolean" | "any" = "string";
    if (resolution.type === "integer" || resolution.type === "number") {
      jsonType = "number";
    } else if (resolution.type === "boolean") {
      jsonType = "boolean";
    } else if (resolution.type === "json") {
      jsonType = "any";
    }
    return {
      kind: "binding",
      binding: { kind: "agentInput", agentInputId: agentInput.id },
      jsonType,
      ...(context === "field" && !required ? { omitWhenAbsent: true } : {}),
    };
  };

  const buildObjectNode = (
    schema: JsonRecord,
    context: "root" | "field" | "item",
    label: string,
    required: boolean,
    depth: number,
    pointer: string | undefined,
  ): McpJsonNode | null => {
    if (schema.additionalProperties !== undefined) {
      addIssue(
        ISSUE.UNSUPPORTED_SCHEMA,
        `${label} declares "additionalProperties", which the canonical body graph cannot represent faithfully.`,
        pointer,
      );
      return null;
    }

    const properties = isRecord(schema.properties)
      ? schema.properties
      : undefined;
    if (properties === undefined) {
      const agentInput = registerAgentInput({
        name: context === "root" ? "body" : label,
        required: context === "field" ? required : true,
        source: label,
        pointer,
        schema,
        structuredAsJson: true,
        unknownType: "json",
      });
      if (agentInput === null) return null;
      return {
        kind: "binding",
        binding: { kind: "agentInput", agentInputId: agentInput.id },
        jsonType: "any",
        ...(context === "field" && !required ? { omitWhenAbsent: true } : {}),
      };
    }

    const requiredKeys = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter(
            (key): key is string => typeof key === "string",
          )
        : [],
    );
    for (const key of requiredKeys) {
      if (key in properties) continue;
      addIssue(
        ISSUE.AMBIGUOUS_PARAMETER,
        `${label} requires the property "${key}", which is not declared in "properties".`,
        pointer,
      );
      return null;
    }

    const fields: Array<{
      id: string;
      key: string;
      value: McpJsonNode;
    }> = [];
    for (const [key, rawChild] of Object.entries(properties)) {
      if (key.length > MAX_FIELD_NAME_LENGTH) {
        addIssue(
          ISSUE.UNREPRESENTABLE_REQUEST,
          `${label} declares a property name longer than ${MAX_FIELD_NAME_LENGTH} characters.`,
          pointer,
        );
        return null;
      }
      const child = asSchema(rawChild);
      if (child.readOnly === true) {
        omittedReadOnlyProperties.push(key);
        continue;
      }
      const childRequired = requiredKeys.has(key);
      const value = buildJsonNode(
        child,
        "field",
        key,
        childRequired,
        depth + 1,
        pointer,
      );
      if (value === null) return null;
      if (
        !childRequired &&
        value.kind !== "binding" &&
        value.kind !== "literal"
      ) {
        alwaysSentOptionalProperties.push(key);
      }
      fieldIdCounter += 1;
      fields.push({ id: `field_${fieldIdCounter}`, key, value });
    }

    return { kind: "object", fields };
  };

  const buildArrayNode = (
    schema: JsonRecord,
    context: "root" | "field" | "item",
    label: string,
    required: boolean,
    depth: number,
    pointer: string | undefined,
  ): McpJsonNode | null => {
    const items = schema.items;
    if (items === undefined || items === null || Array.isArray(items)) {
      const agentInput = registerAgentInput({
        name: context === "root" ? "body" : label,
        required: context === "field" ? required : true,
        source: label,
        pointer,
        schema,
        structuredAsJson: true,
        unknownType: "json",
      });
      if (agentInput === null) return null;
      return {
        kind: "binding",
        binding: { kind: "agentInput", agentInputId: agentInput.id },
        jsonType: "any",
        ...(context === "field" && !required ? { omitWhenAbsent: true } : {}),
      };
    }

    const itemNode = buildJsonNode(
      asSchema(items),
      "item",
      label,
      true,
      depth + 1,
      pointer,
    );
    if (itemNode === null) return null;
    return { kind: "array", items: [itemNode] };
  };

  const mapRequestBody = (
    requestBody: McpOpenApiInventoryRequestBody,
  ): McpBodyDefinition | null => {
    const declared = requestBody.mediaTypes;
    const jsonTypes = declared.filter(
      (entry) => baseMediaType(entry.mediaType) === "application/json",
    );
    const formTypes = declared.filter(
      (entry) =>
        baseMediaType(entry.mediaType) === "application/x-www-form-urlencoded",
    );
    const rawTypes = declared.filter(
      (entry) => baseMediaType(entry.mediaType) === "text/plain",
    );

    const selected = jsonTypes[0] ?? formTypes[0] ?? rawTypes[0];
    if (selected === undefined) {
      if (declared.length === 0) {
        addIssue(
          ISSUE.UNREPRESENTABLE_REQUEST,
          "The request body declares no media type.",
          requestBody.pointer,
        );
        return null;
      }
      const multipart = declared.some((entry) =>
        isMultipartLikeMediaType(entry.mediaType),
      );
      addIssue(
        multipart ? ISSUE.MULTIPART_BODY : ISSUE.UNREPRESENTABLE_REQUEST,
        multipart
          ? `The request body requires multipart or file upload (${summarizeNames(declared.map((entry) => entry.mediaType))}).`
          : `The request body declares no media type the canonical model can represent (${summarizeNames(declared.map((entry) => entry.mediaType))}).`,
        requestBody.pointer,
      );
      return null;
    }

    const ignored = declared.filter((entry) => entry !== selected);
    if (ignored.length > 0) {
      ignoredMetadata.push(
        `unmapped request media types (${summarizeNames(ignored.map((entry) => entry.mediaType))})`,
      );
    }
    if (!requestBody.required) {
      ignoredMetadata.push(
        "an optional request body (the canonical model always sends the body)",
      );
    }

    const selectedMediaType = baseMediaType(selected.mediaType);
    const schema = asSchema(selected.schema);
    for (const keyword of ["xml", "externalDocs", "discriminator"] as const) {
      if (schema[keyword] === undefined) continue;
      ignoredMetadata.push(`the schema keyword "${keyword}"`);
    }

    if (selectedMediaType === "application/json") {
      const root = buildJsonNode(
        schema,
        "root",
        "The JSON request body",
        true,
        1,
        selected.pointer,
      );
      if (root === null) return null;
      return { bodyType: "json", root };
    }

    if (selectedMediaType === "application/x-www-form-urlencoded") {
      const properties = schema.properties;
      if (!isRecord(properties)) {
        addIssue(
          ISSUE.UNREPRESENTABLE_REQUEST,
          "The form-urlencoded body does not declare an object schema with properties.",
          requestBody.pointer,
        );
        return null;
      }
      const requiredKeys = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter(
              (key): key is string => typeof key === "string",
            )
          : [],
      );
      for (const key of requiredKeys) {
        if (key in properties) continue;
        addIssue(
          ISSUE.AMBIGUOUS_PARAMETER,
          `The form body requires the field "${key}", which is not declared in "properties".`,
          requestBody.pointer,
        );
        return null;
      }

      const fields: McpNamedEntry[] = [];
      for (const [key, rawProperty] of Object.entries(properties)) {
        if (key.length > MAX_FIELD_NAME_LENGTH) {
          addIssue(
            ISSUE.UNREPRESENTABLE_REQUEST,
            `The form field name exceeds ${MAX_FIELD_NAME_LENGTH} characters.`,
            requestBody.pointer,
          );
          return null;
        }
        const property = asSchema(rawProperty);
        if (property.readOnly === true) {
          omittedReadOnlyProperties.push(key);
          continue;
        }
        const fieldRequired = requiredKeys.has(key);
        const agentInput = registerAgentInput({
          name: key,
          required: fieldRequired,
          source: `The form field "${key}"`,
          pointer: requestBody.pointer,
          schema: property,
        });
        if (agentInput === null) return null;
        fieldIdCounter += 1;
        fields.push({
          id: `field_${fieldIdCounter}`,
          name: key,
          value: { kind: "agentInput", agentInputId: agentInput.id },
          ...(fieldRequired ? {} : { omitWhenAbsent: true }),
        });
      }
      return { bodyType: "form", fields };
    }

    const constant =
      typeof schema.const === "string" ? schema.const : undefined;
    const credentialConstant =
      constant !== undefined &&
      (isCredentialLikeSchemaPosition(schema, undefined) ||
        isCredentialLikeValue(constant));
    if (constant !== undefined && !credentialConstant) {
      if (constant.length > RAW_TEMPLATE_LIMIT) {
        addIssue(
          ISSUE.UNREPRESENTABLE_REQUEST,
          `The raw request body exceeds ${RAW_TEMPLATE_LIMIT} characters.`,
          requestBody.pointer,
        );
        return null;
      }
      return {
        bodyType: "raw",
        contentType: selectedMediaType,
        bindings: [],
        template: constant,
      };
    }
    if (credentialConstant) {
      addIssue(
        ISSUE.METADATA_IGNORED,
        "A credential-like constant declared by the raw request body was replaced by a sensitive input supplied per call.",
        requestBody.pointer,
      );
    }

    for (const keyword of SCHEMA_LIST_KEYWORDS) {
      if (schema[keyword] === undefined) continue;
      addIssue(
        ISSUE.UNSUPPORTED_SCHEMA,
        `The raw request body declares "${keyword}", which the canonical model cannot represent.`,
        requestBody.pointer,
      );
      return null;
    }

    const agentInput = registerAgentInput({
      name: "body",
      required: true,
      source: "The raw request body",
      pointer: requestBody.pointer,
      sensitive:
        credentialConstant || isCredentialLikeSchemaPosition(schema, undefined),
      unknownType: "string",
    });
    if (agentInput === null) return null;
    const bindingId = "raw_0";
    return {
      bodyType: "raw",
      contentType: selectedMediaType,
      bindings: [
        {
          id: bindingId,
          binding: { kind: "agentInput", agentInputId: agentInput.id },
        },
      ],
      template: `{{${bindingId}}}`,
    };
  };

  const requestBody = operation.requestBody;
  if (requestBody !== undefined && supportedMethod) {
    if (MCP_COMPILER_READ_METHODS.has(method)) {
      addIssue(
        ISSUE.UNREPRESENTABLE_REQUEST,
        `${method} requests cannot declare a request body.`,
        requestBody.pointer,
      );
    } else {
      body = mapRequestBody(requestBody);
    }
  }

  if (omittedReadOnlyProperties.length > 0) {
    ignoredMetadata.push(
      `read-only body properties (${summarizeNames(omittedReadOnlyProperties)})`,
    );
  }
  if (alwaysSentOptionalProperties.length > 0) {
    ignoredMetadata.push(
      `optional structured body properties that cannot be omitted (${summarizeNames(alwaysSentOptionalProperties)})`,
    );
  }
  if (ignoredMetadata.length > 0) {
    addIssue(
      ISSUE.METADATA_IGNORED,
      `Safely ignored while mapping this operation: ${ignoredMetadata.join("; ")}.`,
      operation.pointer,
    );
  }

  // ---- Document text ---------------------------------------------------------
  // Summary, description, and tags are the only prose that reaches the
  // persisted row and agent-visible metadata, so credential-shaped spans are
  // replaced there. The check is value-shaped, never name-based, and warns.
  const redactedTextParts: string[] = [];
  let droppedTagCount = 0;
  const noteTextRedaction = (part: string): void => {
    if (!redactedTextParts.includes(part)) redactedTextParts.push(part);
  };
  const sanitizeText = (text: string, part: string): string => {
    const sanitized = redactCredentialText(text);
    if (sanitized.redacted) noteTextRedaction(part);
    return sanitized.text;
  };

  const title =
    operation.summary === undefined
      ? undefined
      : sanitizeText(operation.summary, "the operation summary");
  const description =
    operation.description === undefined
      ? undefined
      : sanitizeText(operation.description, "the operation description");

  const tags: string[] = [];
  for (const tag of operation.tags) {
    const sanitized = redactCredentialText(tag);
    if (!sanitized.redacted) {
      tags.push(tag);
      continue;
    }
    noteTextRedaction("the operation tags");
    const remainder = sanitized.text
      .split(REDACTION_PLACEHOLDER)
      .join("")
      .trim();
    if (remainder.length > 0) tags.push(sanitized.text);
    else droppedTagCount += 1;
  }

  if (redactedTextParts.length > 0) {
    const dropped =
      droppedTagCount > 0
        ? ` ${droppedTagCount} credential-only tag(s) were dropped rather than kept empty.`
        : "";
    addIssue(
      ISSUE.METADATA_IGNORED,
      `Credential-shaped values in ${redactedTextParts.join(" and ")} were replaced with "${REDACTION_PLACEHOLDER}" before this operation was recorded.${dropped}`,
      operation.pointer,
    );
  }

  // ---- Result ----------------------------------------------------------------
  if (operation.deprecated) {
    addIssue(
      ISSUE.DEPRECATED,
      "The operation is marked deprecated.",
      operation.pointer,
    );
  }

  const blocked = issues.some((issue) => issue.severity === "error");
  return {
    operationKey: operation.operationKey,
    selectable: !blocked,
    issues,
    name,
    ...(supportedMethod ? { method: method as McpOpenApiMethod } : {}),
    path: operation.path,
    tags,
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    deprecated: operation.deprecated,
    security: operation.security.map((requirement) => ({ ...requirement })),
    ...(!blocked && pathSegments !== null && body !== null
      ? {
          requestDefinition: {
            version: MCP_REQUEST_DEFINITION_VERSION,
            pathSegments,
            query,
            headers,
            body,
            agentInputs,
          } satisfies McpRequestDefinition,
        }
      : {}),
  };
}
