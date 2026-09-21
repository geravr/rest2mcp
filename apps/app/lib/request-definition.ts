/**
 * @file Client-side typed request-definition model and adapters between the
 * Studio request builder state and the canonical versioned definition.
 *
 * The backend is authoritative for validation and compilation; this module
 * only preserves stable ids, primitive JSON types, and ordered entries across
 * load, edit, preview, and submit.
 */
import type {
  AgentInputFormat,
  AgentMeta,
  PathPart,
  SourceRow,
} from "./value-origin";
import { PLACEHOLDER_PATTERN } from "./value-origin";

export const REQUEST_DEFINITION_VERSION = 2 as const;

export type ClientBinding =
  | { kind: "literal"; value: string | number | boolean | null }
  | {
      kind: "serverValue";
      serverValueId: string;
      prefix?: string;
      suffix?: string;
    }
  | { kind: "agentInput"; agentInputId: string };

export type ClientNamedEntry = {
  id: string;
  name: string;
  value: ClientBinding;
  omitWhenAbsent?: boolean;
  serialization?: { style: "form"; explode: boolean };
};

export type ClientJsonNode =
  | {
      kind: "literal";
      jsonType: "string" | "number" | "boolean" | "null";
      value: string | number | boolean | null;
    }
  | {
      kind: "binding";
      binding: ClientBinding;
      jsonType: "string" | "number" | "boolean" | "null" | "any";
      omitWhenAbsent?: boolean;
    }
  | {
      kind: "object";
      fields: Array<{
        id: string;
        key: string;
        value: ClientJsonNode;
        omitWhenAbsent?: boolean;
      }>;
    }
  | { kind: "array"; items: ClientJsonNode[] };

export type ClientAgentInputType =
  "string" | "number" | "boolean" | "integer" | "json" | "array";

export type ClientAgentInputItems = {
  type: "string" | "number" | "boolean" | "integer" | "json";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: AgentInputFormat;
  enum?: Array<string | number | boolean>;
  allowEmpty?: boolean;
};

export type ClientAgentInput = {
  id: string;
  name: string;
  description?: string;
  required: boolean;
  sensitive: boolean;
  type: ClientAgentInputType;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: AgentInputFormat;
  enum?: Array<string | number | boolean>;
  examples?: unknown[];
  allowEmpty?: boolean;
  items?: ClientAgentInputItems;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
};

export type ClientBodyDefinition =
  | { bodyType: "none" }
  | { bodyType: "json"; root: ClientJsonNode }
  | { bodyType: "form"; fields: ClientNamedEntry[] }
  | {
      bodyType: "raw";
      contentType?: string;
      bindings: Array<{ id: string; binding: ClientBinding }>;
      template: string;
    };

export type ClientRequestDefinition = {
  version: typeof REQUEST_DEFINITION_VERSION;
  pathSegments: Array<{ id: string; value: ClientBinding }>;
  query: ClientNamedEntry[];
  headers: ClientNamedEntry[];
  body: ClientBodyDefinition;
  agentInputs: ClientAgentInput[];
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type ClientCommonEntries = {
  headers: ClientNamedEntry[];
  query: ClientNamedEntry[];
};

export type BodyType = "none" | "json" | "form" | "raw";

export type ServerValueLookup = {
  /** Server value id -> display name. */
  nameById: Record<string, string>;
  /** Display name -> server value id. */
  idByName: Record<string, string>;
};

/** Structural guard for a persisted typed definition coming from the API. */
export function isClientRequestDefinition(
  value: unknown,
): value is ClientRequestDefinition {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === REQUEST_DEFINITION_VERSION &&
    Array.isArray(record.pathSegments) &&
    Array.isArray(record.query) &&
    Array.isArray(record.headers) &&
    Array.isArray(record.agentInputs) &&
    record.body !== null &&
    typeof record.body === "object"
  );
}

export function buildServerValueLookup(
  variables: Array<{ id: string; name: string }>,
): ServerValueLookup {
  const nameById: Record<string, string> = {};
  const idByName: Record<string, string> = {};
  for (const value of variables) {
    nameById[value.id] = value.name;
    idByName[value.name] = value.id;
  }
  return { nameById, idByName };
}

let definitionIdCounter = 0;

/** Centralized opaque id factory; ids stay unique within one client session. */
export function createDefinitionId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  definitionIdCounter += 1;
  return `${prefix}_${random}${definitionIdCounter.toString(36)}`;
}

export function agentMetaToInput(
  meta: AgentMeta,
  id: string,
): ClientAgentInput {
  const baseType = meta.type;
  const preservedType =
    meta.inputType &&
    (meta.inputType === "integer" ? "number" : meta.inputType) === baseType
      ? meta.inputType
      : undefined;
  return {
    id,
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {}),
    required: meta.required,
    sensitive: meta.sensitive ?? false,
    type: preservedType ?? baseType,
    ...(meta.minimum !== undefined ? { minimum: meta.minimum } : {}),
    ...(meta.maximum !== undefined ? { maximum: meta.maximum } : {}),
    ...(meta.minLength !== undefined ? { minLength: meta.minLength } : {}),
    ...(meta.maxLength !== undefined ? { maxLength: meta.maxLength } : {}),
    ...(meta.pattern !== undefined ? { pattern: meta.pattern } : {}),
    ...(meta.type === "string" && meta.format !== undefined
      ? { format: meta.format }
      : {}),
    ...(meta.enum !== undefined ? { enum: meta.enum } : {}),
    ...(meta.examples !== undefined ? { examples: meta.examples } : {}),
    ...(meta.allowEmpty !== undefined ? { allowEmpty: meta.allowEmpty } : {}),
    ...(meta.items !== undefined ? { items: meta.items } : {}),
    ...(meta.minItems !== undefined ? { minItems: meta.minItems } : {}),
    ...(meta.maxItems !== undefined ? { maxItems: meta.maxItems } : {}),
    ...(meta.uniqueItems !== undefined
      ? { uniqueItems: meta.uniqueItems }
      : {}),
  };
}

export function inputToAgentMeta(input: ClientAgentInput): AgentMeta {
  return {
    name: input.name,
    description: input.description,
    type: input.type === "integer" ? "number" : input.type,
    inputType: input.type,
    required: input.required,
    sensitive: input.sensitive,
    minimum: input.minimum,
    maximum: input.maximum,
    minLength: input.minLength,
    maxLength: input.maxLength,
    pattern: input.pattern,
    format: input.format,
    enum: input.enum,
    examples: input.examples,
    allowEmpty: input.allowEmpty,
    items: input.items,
    minItems: input.minItems,
    maxItems: input.maxItems,
    uniqueItems: input.uniqueItems,
  };
}

/** Internal normalized origin used while converting definitions to form rows. */
type FormOrigin =
  | { kind: "fixed"; value: string }
  | {
      kind: "variable";
      name: string;
      prefix: string;
      suffix?: string;
      serverValueId: string;
    }
  | { kind: "agent"; id: string; meta: AgentMeta };

function bindingToOrigin(
  binding: ClientBinding,
  lookup: ServerValueLookup,
  agentInputById: Map<string, ClientAgentInput>,
): FormOrigin {
  if (binding.kind === "literal") {
    return {
      kind: "fixed",
      value: binding.value === null ? "" : String(binding.value),
    };
  }
  if (binding.kind === "serverValue") {
    return {
      kind: "variable",
      name: lookup.nameById[binding.serverValueId] ?? binding.serverValueId,
      prefix: binding.prefix ?? "",
      suffix: binding.suffix,
      serverValueId: binding.serverValueId,
    };
  }
  const input = agentInputById.get(binding.agentInputId);
  return {
    kind: "agent",
    id: binding.agentInputId,
    meta: input
      ? inputToAgentMeta(input)
      : {
          name: binding.agentInputId,
          type: "string",
          required: true,
        },
  };
}

function originToPathPart(origin: FormOrigin, nodeId?: string): PathPart {
  if (origin.kind === "fixed") {
    return { kind: "text", value: origin.value, ...(nodeId ? { nodeId } : {}) };
  }
  if (origin.kind === "variable") {
    return {
      kind: "variable",
      name: origin.name,
      prefix: origin.prefix,
      suffix: origin.suffix,
      serverValueId: origin.serverValueId,
      ...(nodeId ? { nodeId } : {}),
    };
  }
  return {
    kind: "agent",
    id: origin.id,
    ...(nodeId ? { nodeId } : {}),
    ...origin.meta,
  };
}

function originToSourceRow(key: string, origin: FormOrigin): SourceRow {
  if (origin.kind === "fixed") {
    return { key, origin: "fixed", value: origin.value };
  }
  if (origin.kind === "variable") {
    return {
      key,
      origin: "variable",
      name: origin.name,
      prefix: origin.prefix,
      suffix: origin.suffix,
      serverValueId: origin.serverValueId,
    };
  }
  return { key, origin: "agent", id: origin.id, ...origin.meta };
}

export function definitionToPathParts(
  definition: ClientRequestDefinition,
  lookup: ServerValueLookup,
): PathPart[] {
  const agentInputById = new Map(
    definition.agentInputs.map((input) => [input.id, input]),
  );
  const parts: PathPart[] = [];
  for (const segment of definition.pathSegments) {
    const origin = bindingToOrigin(segment.value, lookup, agentInputById);
    if (origin.kind === "fixed") {
      const previous = parts[parts.length - 1];
      if (previous?.kind === "text") {
        previous.value += origin.value;
        if (!previous.nodeId) previous.nodeId = segment.id;
      } else {
        parts.push({ kind: "text", value: origin.value, nodeId: segment.id });
      }
    } else {
      parts.push(originToPathPart(origin, segment.id));
    }
  }
  if (parts.length === 0) parts.push({ kind: "text", value: "" });
  return parts;
}

export function definitionToSourceRows(
  entries: ClientNamedEntry[],
  lookup: ServerValueLookup,
  agentInputById: Map<string, ClientAgentInput>,
): SourceRow[] {
  return entries.map((entry) => ({
    ...originToSourceRow(
      entry.name,
      bindingToOrigin(entry.value, lookup, agentInputById),
    ),
    nodeId: entry.id,
    ...(entry.omitWhenAbsent ? { omitWhenAbsent: true } : {}),
    ...(entry.serialization ? { serialization: entry.serialization } : {}),
  }));
}

export function definitionAgentInputs(
  definition: ClientRequestDefinition,
): Map<string, ClientAgentInput> {
  return new Map(definition.agentInputs.map((input) => [input.id, input]));
}

/**
 * Display-only path summary derived from typed path segments. Never persisted
 * and never used as an authoring source. Server values render their stable id
 * (never a resolved secret); agent inputs render their public name.
 */
export function summarizeDefinitionPath(
  definition: ClientRequestDefinition,
  serverValueNameById: Record<string, string> = {},
): string {
  const agentInputNameById = new Map(
    definition.agentInputs.map((input) => [input.id, input.name]),
  );
  return definition.pathSegments
    .map((segment) => {
      const binding = segment.value;
      if (binding.kind === "literal") {
        return binding.value === null ? "" : String(binding.value);
      }
      if (binding.kind === "serverValue") {
        const name =
          serverValueNameById[binding.serverValueId] ?? binding.serverValueId;
        return `${binding.prefix ?? ""}{{${name}}}${binding.suffix ?? ""}`;
      }
      const name =
        agentInputNameById.get(binding.agentInputId) ?? binding.agentInputId;
      return `{{${name}}}`;
    })
    .join("");
}

function jsonLiteralNode(value: string): ClientJsonNode {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed === null) {
        return { kind: "literal", jsonType: "null", value: null };
      }
      if (typeof parsed === "number") {
        return { kind: "literal", jsonType: "number", value: parsed };
      }
      if (typeof parsed === "boolean") {
        return { kind: "literal", jsonType: "boolean", value: parsed };
      }
      if (typeof parsed === "string") {
        return { kind: "literal", jsonType: "string", value: parsed };
      }
    } catch {
      // treat as a plain string literal
    }
  }
  return { kind: "literal", jsonType: "string", value };
}

function jsonNodeToPlainValue(node: ClientJsonNode): unknown {
  if (node.kind === "literal") return node.value;
  if (node.kind === "binding") {
    if (node.binding.kind === "serverValue") {
      return `{{${node.binding.serverValueId}}}`;
    }
    if (node.binding.kind === "agentInput") {
      return `{{${node.binding.agentInputId}}}`;
    }
    return node.binding.value;
  }
  if (node.kind === "array") return node.items.map(jsonNodeToPlainValue);
  return Object.fromEntries(
    node.fields.map((field) => [field.key, jsonNodeToPlainValue(field.value)]),
  );
}

export type BodyFormState = {
  bodyType: BodyType;
  formRows: SourceRow[];
  jsonRows: SourceRow[];
  jsonAdvanced: boolean;
  advancedBody: string;
};

function sourceRowToJsonPlainValue(row: SourceRow): unknown {
  if (row.origin === "fixed") {
    const trimmed = row.value.trim();
    if (trimmed.length > 0) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (
          parsed === null ||
          typeof parsed === "number" ||
          typeof parsed === "boolean" ||
          typeof parsed === "string"
        ) {
          return parsed;
        }
      } catch {
        // treat as a plain string literal
      }
    }
    return row.value;
  }
  if (row.origin === "variable") {
    return `{{${row.serverValueId ?? row.name}}}`;
  }
  return `{{${row.id ?? row.name}}}`;
}

/** Serializes structured JSON rows into an advanced-body text representation. */
export function sourceRowsToJsonText(rows: SourceRow[]): string {
  const entries = rows
    .filter((row) => row.key.trim().length > 0)
    .map(
      (row) =>
        [row.key.trim(), sourceRowToJsonPlainValue(row)] as [string, unknown],
    );
  return JSON.stringify(Object.fromEntries(entries), null, 2);
}

/** True when advanced JSON text is a flat object of primitive/token values. */
export function isFlatJsonText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return false;
    }
    return Object.values(parsed as Record<string, unknown>).every(
      (value) =>
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    );
  } catch {
    return false;
  }
}

/**
 * Parses flat advanced JSON into structured rows using stable binding ids
 * only; unknown tokens stay literal text. Returns null for non-flat text.
 */
export function jsonTextToSourceRows(
  text: string,
  lookup: ServerValueLookup,
  agentInputById: Map<string, ClientAgentInput>,
): SourceRow[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const rows: SourceRow[] = [];
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      rows.push({ key, origin: "fixed", value: JSON.stringify(value) });
      continue;
    }
    if (typeof value !== "string") return null;
    const token = /^\{\{([^}]+)\}\}$/.exec(value)?.[1];
    if (token) {
      const variableName = lookup.nameById[token];
      if (variableName) {
        rows.push({
          key,
          origin: "variable",
          name: variableName,
          prefix: "",
          serverValueId: token,
        });
        continue;
      }
      const agent = agentInputById.get(token);
      if (agent) {
        rows.push({
          key,
          origin: "agent",
          id: agent.id,
          ...inputToAgentMeta(agent),
        });
        continue;
      }
    }
    rows.push({ key, origin: "fixed", value });
  }
  return rows;
}

export function definitionToBodyState(
  definition: ClientRequestDefinition,
  lookup: ServerValueLookup,
): BodyFormState {
  const agentInputById = definitionAgentInputs(definition);
  if (definition.body.bodyType === "form") {
    return {
      bodyType: "form",
      formRows: definitionToSourceRows(
        definition.body.fields,
        lookup,
        agentInputById,
      ),
      jsonRows: [],
      jsonAdvanced: false,
      advancedBody: "",
    };
  }
  if (definition.body.bodyType === "raw") {
    return {
      bodyType: "raw",
      formRows: [],
      jsonRows: [],
      jsonAdvanced: true,
      advancedBody: definition.body.template,
    };
  }
  if (definition.body.bodyType === "json") {
    const root = definition.body.root;
    if (root.kind === "object") {
      const rows: SourceRow[] = [];
      for (const field of root.fields) {
        if (field.value.kind === "object" || field.value.kind === "array") {
          return {
            bodyType: "json",
            formRows: [],
            jsonRows: [],
            jsonAdvanced: true,
            advancedBody: JSON.stringify(jsonNodeToPlainValue(root), null, 2),
          };
        }
        const fieldNode = field.value;
        const row: SourceRow =
          fieldNode.kind === "literal"
            ? {
                key: field.key,
                origin: "fixed",
                value: JSON.stringify(fieldNode.value),
              }
            : {
                ...originToSourceRow(
                  field.key,
                  bindingToOrigin(fieldNode.binding, lookup, agentInputById),
                ),
                jsonType: fieldNode.jsonType,
              };
        rows.push({
          ...row,
          nodeId: field.id,
          ...(field.omitWhenAbsent ? { omitWhenAbsent: true } : {}),
        });
      }
      return {
        bodyType: "json",
        formRows: [],
        jsonRows: rows,
        jsonAdvanced: false,
        advancedBody: "",
      };
    }
    return {
      bodyType: "json",
      formRows: [],
      jsonRows: [],
      jsonAdvanced: true,
      advancedBody: JSON.stringify(jsonNodeToPlainValue(root), null, 2),
    };
  }
  return {
    bodyType: "none",
    formRows: [],
    jsonRows: [],
    jsonAdvanced: false,
    advancedBody: "",
  };
}

// ---------------------------------------------------------------------------
// Form state -> definition
// ---------------------------------------------------------------------------

export type FormStateToDefinitionInput = {
  pathParts: PathPart[];
  query: SourceRow[];
  headers: SourceRow[];
  bodyType: BodyType;
  formRows: SourceRow[];
  jsonRows: SourceRow[];
  jsonAdvanced: boolean;
  advancedBody: string;
  serverValueIdByName: Record<string, string>;
  agentInputId: (name: string) => string;
  existingAgentInputs?: ClientAgentInput[];
  /** Names that should be treated as declared agent inputs in raw bodies. */
  agentNames?: Set<string>;
  /** Existing raw binding ids from a loaded definition, preserved on save. */
  existingRawBindings?: Map<string, ClientBinding>;
  /** Existing raw body content type, preserved on save. */
  existingRawContentType?: string;
  /** Existing recursive JSON root, preserved when the advanced editor is used. */
  existingJsonRoot?: ClientJsonNode;
  /** When false, assign fresh entry/field ids (client-side duplicate). */
  reuseNodeIds?: boolean;
  /** Stable id resolver for rows/parts created during this session. */
  resolveNodeId?: (source: object, prefix: string) => string;
  agentDrafts?: Record<string, AgentMeta>;
  annotations?: ClientRequestDefinition["annotations"];
};

type BuildContext = {
  serverValueIdByName: Record<string, string>;
  agentInputId: (name: string) => string;
  agentInputs: Map<string, ClientAgentInput>;
  agentDrafts: Record<string, AgentMeta>;
  existingAgentInputsById: Map<string, ClientAgentInput>;
};

function registerAgent(
  meta: AgentMeta,
  existingId: string | undefined,
  ctx: BuildContext,
): string {
  const id = existingId ?? ctx.agentInputId(meta.name);
  // Always reflect the latest edited metadata for that id.
  ctx.agentInputs.set(id, agentMetaToInput(meta, id));
  return id;
}

type BindingSource =
  | { kind: "fixed"; value: string }
  | {
      kind: "variable";
      name: string;
      prefix?: string;
      suffix?: string;
      serverValueId?: string;
    }
  | { kind: "agent"; id?: string; meta: AgentMeta };

function metaOf(input: {
  name: string;
  description?: string;
  type: AgentMeta["type"];
  inputType?: AgentMeta["inputType"];
  required: boolean;
  sensitive?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: AgentInputFormat;
  enum?: Array<string | number | boolean>;
  examples?: unknown[];
  allowEmpty?: boolean;
  items?: AgentMeta["items"];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}): AgentMeta {
  return {
    name: input.name,
    description: input.description,
    type: input.type,
    inputType: input.inputType,
    required: input.required,
    sensitive: input.sensitive,
    minimum: input.minimum,
    maximum: input.maximum,
    minLength: input.minLength,
    maxLength: input.maxLength,
    pattern: input.pattern,
    format: input.format,
    enum: input.enum,
    examples: input.examples,
    allowEmpty: input.allowEmpty,
    items: input.items,
    minItems: input.minItems,
    maxItems: input.maxItems,
    uniqueItems: input.uniqueItems,
  };
}

function rowToSource(row: SourceRow): BindingSource {
  if (row.origin === "fixed") return { kind: "fixed", value: row.value };
  if (row.origin === "variable") {
    return {
      kind: "variable",
      name: row.name,
      prefix: row.prefix,
      suffix: row.suffix,
      serverValueId: row.serverValueId,
    };
  }
  return { kind: "agent", id: row.id, meta: metaOf(row) };
}

function partToSource(
  part: Extract<PathPart, { kind: "variable" | "agent" }>,
): BindingSource {
  if (part.kind === "variable") {
    return {
      kind: "variable",
      name: part.name,
      prefix: part.prefix,
      suffix: part.suffix,
      serverValueId: part.serverValueId,
    };
  }
  return { kind: "agent", id: part.id, meta: metaOf(part) };
}

function sourceToBinding(
  source: BindingSource,
  ctx: BuildContext,
): ClientBinding {
  if (source.kind === "fixed") {
    return { kind: "literal", value: source.value };
  }
  if (source.kind === "variable") {
    const id =
      source.serverValueId ??
      ctx.serverValueIdByName[source.name] ??
      source.name;
    return {
      kind: "serverValue",
      serverValueId: id,
      ...(source.prefix ? { prefix: source.prefix } : {}),
      ...(source.suffix ? { suffix: source.suffix } : {}),
    };
  }
  const id = registerAgent(source.meta, source.id, ctx);
  return { kind: "agentInput", agentInputId: id };
}

function jsonTypeForAgent(
  meta: AgentMeta,
): "string" | "number" | "boolean" | "null" | "any" {
  if (meta.type === "string") return "string";
  if (meta.type === "number") return "number";
  if (meta.type === "boolean") return "boolean";
  return "any";
}

function bindingTokenString(binding: ClientBinding): string | null {
  if (binding.kind === "serverValue") return binding.serverValueId;
  if (binding.kind === "agentInput") return binding.agentInputId;
  return null;
}

type ExistingJsonIndex = {
  fieldIds: Map<string, Array<{ id: string; omitWhenAbsent?: boolean }>>;
  bindings: Map<
    string,
    {
      binding: ClientBinding;
      jsonType: "string" | "number" | "boolean" | "null" | "any";
    }
  >;
};

function collectExistingJson(
  node: ClientJsonNode,
  index: ExistingJsonIndex,
  key = "",
): void {
  if (node.kind === "literal") return;
  if (node.kind === "binding") {
    const token = bindingTokenString(node.binding);
    if (token && !index.bindings.has(token)) {
      index.bindings.set(token, {
        binding: node.binding,
        jsonType: node.jsonType,
      });
    }
    return;
  }
  if (node.kind === "array") {
    node.items.forEach((item) => collectExistingJson(item, index, key));
    return;
  }
  for (const field of node.fields) {
    const queue = index.fieldIds.get(field.key) ?? [];
    queue.push({
      id: field.id,
      ...(field.omitWhenAbsent ? { omitWhenAbsent: true } : {}),
    });
    index.fieldIds.set(field.key, queue);
    collectExistingJson(field.value, index, field.key);
  }
}

/**
 * Rebuilds a recursive JSON body from the advanced textarea, mapping
 * `{{token}}` placeholders back to their existing bindings or resolvable
 * server values / agent inputs. Returns null when the text is not valid JSON.
 */
function parseAdvancedJsonBody(
  text: string,
  ctx: BuildContext,
  existingRoot: ClientJsonNode | undefined,
  agentNames: Set<string>,
): ClientJsonNode | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const index: ExistingJsonIndex = {
    fieldIds: new Map(),
    bindings: new Map(),
  };
  if (existingRoot) collectExistingJson(existingRoot, index);
  const serverValueIds = new Set(Object.values(ctx.serverValueIdByName));

  const convert = (value: unknown): ClientJsonNode => {
    if (value === null)
      return { kind: "literal", jsonType: "null", value: null };
    if (typeof value === "string") {
      const tokenMatch = /^\{\{([^}]+)\}\}$/.exec(value);
      if (tokenMatch) {
        const token = tokenMatch[1];
        const existing = index.bindings.get(token);
        if (existing) {
          if (existing.binding.kind === "agentInput") {
            const known = ctx.existingAgentInputsById.get(
              existing.binding.agentInputId,
            );
            if (known) ctx.agentInputs.set(known.id, known);
          }
          return {
            kind: "binding",
            binding: existing.binding,
            jsonType: existing.jsonType,
          };
        }
        if (serverValueIds.has(token)) {
          return {
            kind: "binding",
            binding: { kind: "serverValue", serverValueId: token },
            jsonType: "string",
          };
        }
        const knownAgent =
          ctx.existingAgentInputsById.get(token) ?? ctx.agentInputs.get(token);
        if (knownAgent) {
          ctx.agentInputs.set(knownAgent.id, knownAgent);
          return {
            kind: "binding",
            binding: { kind: "agentInput", agentInputId: knownAgent.id },
            jsonType: "string",
          };
        }
        const variableId = ctx.serverValueIdByName[token];
        if (variableId) {
          return {
            kind: "binding",
            binding: { kind: "serverValue", serverValueId: variableId },
            jsonType: "string",
          };
        }
        if (agentNames.has(token) || ctx.agentDrafts[token]) {
          const id = registerAgent(
            ctx.agentDrafts[token] ?? {
              name: token,
              type: "string",
              required: true,
            },
            undefined,
            ctx,
          );
          return {
            kind: "binding",
            binding: { kind: "agentInput", agentInputId: id },
            jsonType: "string",
          };
        }
      }
      return { kind: "literal", jsonType: "string", value };
    }
    if (typeof value === "number") {
      return { kind: "literal", jsonType: "number", value };
    }
    if (typeof value === "boolean") {
      return { kind: "literal", jsonType: "boolean", value };
    }
    if (Array.isArray(value)) {
      return { kind: "array", items: value.map((item) => convert(item)) };
    }
    const record = value as Record<string, unknown>;
    return {
      kind: "object",
      fields: Object.entries(record).map(([key, entryValue]) => {
        const queue = index.fieldIds.get(key);
        const existing = queue?.shift();
        return {
          id: existing?.id ?? createDefinitionId("field"),
          key,
          value: convert(entryValue),
          ...(existing?.omitWhenAbsent ? { omitWhenAbsent: true } : {}),
        };
      }),
    };
  };

  return convert(parsed);
}

function rowToJsonField(
  row: SourceRow,
  ctx: BuildContext,
  reuseNodeIds: boolean,
  resolveNodeId?: (source: object, prefix: string) => string,
): {
  id: string;
  key: string;
  value: ClientJsonNode;
  omitWhenAbsent?: boolean;
} {
  const id = reuseNodeIds
    ? (row.nodeId ??
      resolveNodeId?.(row, "field") ??
      createDefinitionId("field"))
    : createDefinitionId("field");
  const key = row.key.trim();
  const omit = row.omitWhenAbsent ? { omitWhenAbsent: true } : {};
  if (row.origin === "fixed") {
    return {
      id,
      key,
      value: jsonLiteralNode(row.value),
      ...omit,
    };
  }
  const binding = sourceToBinding(rowToSource(row), ctx);
  return {
    id,
    key,
    value: {
      kind: "binding",
      binding,
      jsonType:
        row.jsonType ??
        (row.origin === "agent" ? jsonTypeForAgent(row) : "string"),
    },
    ...omit,
  };
}

export function formStateToDefinition(
  input: FormStateToDefinitionInput,
): ClientRequestDefinition {
  const ctx: BuildContext = {
    serverValueIdByName: input.serverValueIdByName,
    agentInputId: input.agentInputId,
    agentInputs: new Map(),
    agentDrafts: input.agentDrafts ?? {},
    existingAgentInputsById: new Map(
      (input.existingAgentInputs ?? []).map((agentInput) => [
        agentInput.id,
        agentInput,
      ]),
    ),
  };

  const pathSegments = input.pathParts
    .filter((part) => part.kind === "text" || part.name.length > 0)
    .map((part) => ({
      id:
        input.reuseNodeIds === false
          ? createDefinitionId("path")
          : (part.nodeId ??
            input.resolveNodeId?.(part, "path") ??
            createDefinitionId("path")),
      value:
        part.kind === "text"
          ? ({ kind: "literal", value: part.value } as const)
          : sourceToBinding(partToSource(part), ctx),
    }));

  const buildEntries = (
    rows: SourceRow[],
    allowQuerySerialization = false,
  ): ClientNamedEntry[] =>
    rows
      .filter((row) => row.key.trim().length > 0)
      .map((row) => {
        const isArrayAgent =
          allowQuerySerialization &&
          row.origin === "agent" &&
          (row.type === "array" || row.inputType === "array");
        const serialization = row.serialization
          ? row.serialization
          : isArrayAgent
            ? { style: "form" as const, explode: true }
            : undefined;
        return {
          id:
            input.reuseNodeIds === false
              ? createDefinitionId("entry")
              : (row.nodeId ??
                input.resolveNodeId?.(row, "entry") ??
                createDefinitionId("entry")),
          name: row.key.trim(),
          value:
            row.origin === "fixed"
              ? ({ kind: "literal", value: row.value } as const)
              : sourceToBinding(rowToSource(row), ctx),
          ...(row.omitWhenAbsent ? { omitWhenAbsent: true } : {}),
          ...(serialization ? { serialization } : {}),
        };
      });

  const agentNames = input.agentNames ?? new Set<string>();
  const serverValueIds = new Set(Object.values(ctx.serverValueIdByName));

  const buildRawBody = (
    text: string,
    asJson: boolean,
  ): ClientBodyDefinition => {
    const rawBindings: Array<{ id: string; binding: ClientBinding }> = [];
    const seen = new Map<string, string>();
    const pushedIds = new Set<string>();
    const template = text.replace(
      PLACEHOLDER_PATTERN,
      (whole, token: string) => {
        const existingBinding = input.existingRawBindings?.get(token);
        if (existingBinding) {
          if (!pushedIds.has(token)) {
            pushedIds.add(token);
            rawBindings.push({ id: token, binding: existingBinding });
            if (existingBinding.kind === "agentInput") {
              const known = ctx.existingAgentInputsById.get(
                existingBinding.agentInputId,
              );
              if (known) {
                ctx.agentInputs.set(known.id, known);
              } else {
                registerAgent(
                  ctx.agentDrafts[existingBinding.agentInputId] ?? {
                    name: existingBinding.agentInputId,
                    type: "string",
                    required: true,
                  },
                  existingBinding.agentInputId,
                  ctx,
                );
              }
            }
          }
          return whole;
        }
        const existing = seen.get(token);
        if (existing) return `{{${existing}}}`;
        const variableId =
          ctx.serverValueIdByName[token] ??
          (serverValueIds.has(token) ? token : undefined);
        const bindingId = createDefinitionId("raw");
        if (variableId) {
          rawBindings.push({
            id: bindingId,
            binding: { kind: "serverValue", serverValueId: variableId },
          });
        } else if (
          agentNames.has(token) ||
          ctx.agentDrafts[token] ||
          ctx.existingAgentInputsById.has(token)
        ) {
          const known = ctx.existingAgentInputsById.get(token);
          const id = registerAgent(
            known
              ? inputToAgentMeta(known)
              : (ctx.agentDrafts[token] ?? {
                  name: token,
                  type: "string",
                  required: true,
                }),
            known?.id,
            ctx,
          );
          rawBindings.push({
            id: bindingId,
            binding: { kind: "agentInput", agentInputId: id },
          });
        } else {
          // Undeclared brace text stays literal.
          return whole;
        }
        seen.set(token, bindingId);
        return `{{${bindingId}}}`;
      },
    );
    return {
      bodyType: "raw",
      ...(asJson
        ? { contentType: "application/json" }
        : input.existingRawContentType
          ? { contentType: input.existingRawContentType }
          : {}),
      bindings: rawBindings,
      template,
    };
  };

  let body: ClientBodyDefinition = { bodyType: "none" };
  if (input.bodyType === "form") {
    body = { bodyType: "form", fields: buildEntries(input.formRows) };
  } else if (input.bodyType === "json" && !input.jsonAdvanced) {
    body = {
      bodyType: "json",
      root: {
        kind: "object",
        fields: input.jsonRows
          .filter((row) => row.key.trim().length > 0)
          .map((row) =>
            rowToJsonField(
              row,
              ctx,
              input.reuseNodeIds !== false,
              input.resolveNodeId,
            ),
          ),
      },
    };
  } else if (input.bodyType === "json" && input.jsonAdvanced) {
    const parsedRoot = parseAdvancedJsonBody(
      input.advancedBody,
      ctx,
      input.existingJsonRoot,
      agentNames,
    );
    if (parsedRoot) {
      body = { bodyType: "json", root: parsedRoot };
    } else if (input.existingJsonRoot) {
      body = { bodyType: "json", root: input.existingJsonRoot };
    } else {
      body = buildRawBody(input.advancedBody, true);
    }
  } else if (input.bodyType === "raw") {
    body = buildRawBody(input.advancedBody, false);
  }

  return {
    version: REQUEST_DEFINITION_VERSION,
    pathSegments,
    query: buildEntries(input.query, true),
    headers: buildEntries(input.headers),
    body,
    agentInputs: [...ctx.agentInputs.values()],
    ...(input.annotations ? { annotations: input.annotations } : {}),
  };
}

// ---------------------------------------------------------------------------
// Common entries
// ---------------------------------------------------------------------------

export function commonRowsToEntries(
  rows: SourceRow[],
  serverValueIdByName: Record<string, string>,
): ClientNamedEntry[] {
  const ctx: BuildContext = {
    serverValueIdByName,
    agentInputId: (name) => name,
    agentInputs: new Map(),
    agentDrafts: {},
    existingAgentInputsById: new Map(),
  };
  return rows
    .filter((row) => row.key.trim().length > 0 && row.origin !== "agent")
    .map((row) => ({
      id: createDefinitionId("common"),
      name: row.key.trim(),
      value:
        row.origin === "fixed"
          ? ({ kind: "literal", value: row.value } as const)
          : sourceToBinding(rowToSource(row), ctx),
    }));
}
