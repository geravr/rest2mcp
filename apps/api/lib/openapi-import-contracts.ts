import { z } from "zod";
import {
  MCP_OPENAPI_LIMITS,
  MCP_OPENAPI_VERSIONS,
  MCP_TOOL_GROUP_LIMITS,
} from "@repo/core";
import {
  mcpCompileIssueSchema,
  type McpCompileIssue,
  type McpRequestDefinition,
} from "./mcp-request-definition.js";

/**
 * Version of the persisted OpenAPI provenance payload. Bumping it is a
 * breaking change for every stored import; readers must reject unknown values
 * rather than guessing at extra fields.
 */
export const MCP_OPENAPI_PROVENANCE_VERSION = 1 as const;

/** HTTP methods the importer can map onto the canonical request model. */
export const mcpOpenApiMethodSchema = z.enum([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export type McpOpenApiMethod = z.infer<typeof mcpOpenApiMethodSchema>;

/** Origin of a submitted OpenAPI document, for provenance and telemetry. */
export const mcpOpenApiSourceKindSchema = z.enum(["content", "url"]);
export type McpOpenApiSourceKind = z.infer<typeof mcpOpenApiSourceKindSchema>;

/**
 * One OpenAPI source submission.
 *
 * `content` carries pasted text or locally read file text: the SPA never
 * uploads the file itself. `label` only distinguishes the two content origins
 * for display; the document body is never persisted either way.
 */
export const mcpOpenApiSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("content"),
    content: z.string().min(1).max(MCP_OPENAPI_LIMITS.maxDocumentBytes),
    label: z.enum(["file", "paste"]).default("paste"),
  }),
  z.strictObject({
    kind: z.literal("url"),
    url: z.string().min(1).max(2048),
  }),
]);

export type McpOpenApiSource = z.infer<typeof mcpOpenApiSourceSchema>;

/**
 * Single group strategy for one confirmation. The union is mutually exclusive
 * by construction so the API never has to reconcile competing instructions.
 */
export const mcpOpenApiGroupStrategySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ungrouped") }),
  z.strictObject({
    kind: z.literal("existing"),
    groupId: z.string().min(1).max(64),
  }),
  z.strictObject({
    kind: z.literal("new"),
    name: z.string().trim().min(1).max(MCP_TOOL_GROUP_LIMITS.name),
  }),
  /** Reuse or create one group per selected operation's first OpenAPI tag. */
  z.strictObject({ kind: z.literal("firstTag") }),
]);

export type McpOpenApiGroupStrategy = z.infer<
  typeof mcpOpenApiGroupStrategySchema
>;

export type McpOpenApiGroupStrategyKind = McpOpenApiGroupStrategy["kind"];

/**
 * Secret-safe effective security requirement. Only the declared scheme's name,
 * type, and placement ever cross this boundary: never a value, token, or
 * example.
 */
export const mcpOpenApiSecurityRequirementSchema = z.strictObject({
  name: z.string().min(1).max(256),
  type: z.enum([
    "http",
    "apiKey",
    "oauth2",
    "openIdConnect",
    "mutualTLS",
    "unknown",
  ]),
  /** Placement for `apiKey` and `http` schemes, when declared. */
  in: z.enum(["header", "query", "cookie"]).optional(),
  /** HTTP authentication scheme (`bearer`, `basic`, …), when declared. */
  scheme: z.string().max(64).optional(),
});

export type McpOpenApiSecurityRequirement = z.infer<
  typeof mcpOpenApiSecurityRequirementSchema
>;

/** One per-operation diagnostic, always stable by code and location. */
export type McpOpenApiOperationIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
  /** Location inside the document (e.g. `paths./items.get.parameters[0]`). */
  path?: string;
};

/**
 * One representable-or-blocked operation from a previewed document.
 *
 * `selectable` is false whenever the importer recorded a blocking issue, so
 * clients can render a candidate without re-deriving severity rules.
 */
export type McpOpenApiOperationCandidate = {
  /** `operationId` when present, otherwise `METHOD /path`. Stable across previews. */
  operationKey: string;
  method: McpOpenApiMethod;
  path: string;
  operationId?: string;
  title?: string;
  description?: string;
  /** Original OpenAPI tags in document order; the first one suggests a group. */
  tags: string[];
  deprecated: boolean;
  /** Deterministic MCP-safe name before owner edits. */
  suggestedName: string;
  selectable: boolean;
  issues: McpOpenApiOperationIssue[];
  security: McpOpenApiSecurityRequirement[];
  /** Canonical definition when the operation is representable. */
  requestDefinition?: McpRequestDefinition;
  /** Compiler diagnostics for the canonical definition, when it was previewed. */
  compileIssues: McpCompileIssue[];
};

/** Bounded counters describing the document that was previewed. */
export type McpOpenApiDocumentSummary = {
  version: "3.0" | "3.1";
  title?: string;
  /** Canonical fingerprint of the parsed document, recomputed on confirmation. */
  fingerprint: string;
  operationCount: number;
  selectableCount: number;
};

/** Capacity projection shown before confirmation. */
export type McpOpenApiCapacityProjection = {
  toolLimit: number;
  currentTools: number;
  groupLimit: number;
  currentGroups: number;
};

/** A group that first-tag mapping would reuse or create. */
export type McpOpenApiSuggestedGroup = {
  tag: string;
  normalizedName: string;
  /** Existing owner group to reuse, when normalization already matches one. */
  existingGroupId?: string;
  /** Whether confirmation would create this group. */
  willCreate: boolean;
};

/** Write-free preview of one OpenAPI source for one owned server. */
export type McpOpenApiPreviewResult = {
  document: McpOpenApiDocumentSummary;
  operations: McpOpenApiOperationCandidate[];
  /** Blocking diagnostics that cannot be attributed to one operation. */
  documentIssues: McpOpenApiOperationIssue[];
  suggestedGroups: McpOpenApiSuggestedGroup[];
  capacity: McpOpenApiCapacityProjection;
  /** Sanitized label of the submitted source; never a raw credential URL. */
  sourceLabel: string;
  /** Observed server configuration revision the preview was computed against. */
  configRevision: number;
};

/** One selected operation with an optional owner-supplied name override. */
export const mcpOpenApiSelectionEntrySchema = z.strictObject({
  operationKey: z.string().min(1).max(512),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("Owner-supplied MCP-safe tool name override."),
});

export type McpOpenApiSelectionEntry = z.infer<
  typeof mcpOpenApiSelectionEntrySchema
>;

/**
 * Fingerprint-bound confirmation. The source is resubmitted (content) or
 * refetched (URL) and must reproduce `fingerprint` before anything is written.
 */
/**
 * Optional AI optimization bundle for one confirmation: a completed run plus
 * the selected recommendation operation ids per candidate. The run stays
 * fingerprint-bound: confirmation recomputes the document and candidate
 * fingerprints and rejects stale state before any write.
 */
export type McpOpenApiConfirmOptimization = {
  runId: string;
  /** Selected recommendation operation ids per candidate operation key. */
  operations: Array<{
    operationKey: string;
    operationIds: string[];
  }>;
};

export type McpOpenApiConfirmInput = {
  expectedRevision: number;
  source: McpOpenApiSource;
  fingerprint: string;
  selection: McpOpenApiSelectionEntry[];
  groupStrategy: McpOpenApiGroupStrategy;
  optimization?: McpOpenApiConfirmOptimization;
};

/** Result of one committed import batch. */
export type McpOpenApiConfirmResult = {
  revision: number;
  draftRevision: number;
  /** Generated batch id shared by every tool created in this confirmation. */
  batchId: string;
  tools: Array<{
    id: string;
    name: string;
    method: McpOpenApiMethod;
    path: string;
  }>;
  groups: Array<{ id: string; name: string; created: boolean }>;
};

/**
 * Versioned, secret-safe provenance for one imported operation.
 *
 * Deliberately excludes the raw document, examples, credentials, and any URL
 * component that could carry a secret. Stored on the draft tool and snapshotted
 * into revisions for faithful restore; never part of agent contracts.
 */
export type McpOpenApiSourceProvenance = {
  version: typeof MCP_OPENAPI_PROVENANCE_VERSION;
  /** Import batch id shared by every tool created in one confirmation. */
  batchId: string;
  openApiVersion: "3.0" | "3.1";
  /** Stable operation key (`operationId` or `METHOD /path`). */
  operationKey: string;
  /** Canonical fingerprint of the whole source document. */
  documentFingerprint: string;
  /** Deterministic hash of the generated canonical definition. */
  definitionHash: string;
  /** Original OpenAPI tags in document order. */
  tags: string[];
  /** Sanitized source label: no query, fragment, userinfo, or credentials. */
  sourceLabel: string;
};

export const mcpOpenApiSourceProvenanceSchema: z.ZodType<McpOpenApiSourceProvenance> =
  z.strictObject({
    version: z.literal(MCP_OPENAPI_PROVENANCE_VERSION),
    batchId: z.string().min(1).max(64),
    openApiVersion: z.enum(MCP_OPENAPI_VERSIONS),
    operationKey: z.string().min(1).max(512),
    documentFingerprint: z.string().min(1).max(128),
    definitionHash: z.string().min(1).max(128),
    tags: z.array(z.string().max(256)).max(64),
    sourceLabel: z.string().min(1).max(512),
  });

/**
 * Re-parses persisted provenance. Returns null for absent or incompatible
 * payloads so callers treat ledger-less tools as non-imported rather than
 * guessing at an unknown shape.
 */
export function parseOpenApiSourceProvenance(
  raw: unknown,
): McpOpenApiSourceProvenance | null {
  if (raw === null || raw === undefined) return null;
  const parsed = mcpOpenApiSourceProvenanceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Telemetry-safe summary of one preview or confirmation attempt. */
export type McpOpenApiTelemetrySummary = {
  sourceKind: McpOpenApiSourceKind;
  openApiVersion?: "3.0" | "3.1";
  operationCount?: number;
  selectedCount?: number;
  blockedCount?: number;
  warningCount?: number;
  groupCount?: number;
  durationMs: number;
};

/** Optional Studio-only group placement on a manual or curl tool command. */
export const mcpToolGroupPlacementSchema = z
  .string()
  .min(1)
  .max(64)
  .describe("Target Studio group id; null ungroups, absent leaves unchanged.");

/* ------------------------------------------------------------------------- *
 * Document inventory (frozen interface between the parser and the mapper)
 * ------------------------------------------------------------------------- */

/** A JSON Pointer location inside the submitted document. */
export type McpOpenApiPointer = string;

/** One server entry resolved from document, path, or operation precedence. */
export type McpOpenApiInventoryServer = {
  url: string;
  variables: Array<{ name: string; default?: string; values?: string[] }>;
  pointer: McpOpenApiPointer;
};

/** One parameter after path-level and operation-level merging. */
export type McpOpenApiInventoryParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  deprecated: boolean;
  /** Resolved JSON Schema fragment, when the document declares one. */
  schema?: Record<string, unknown>;
  /** Declared serialization; drives representability checks. */
  style?: string;
  explode?: boolean;
  /** Example/default values, already stripped of credential-like material. */
  examples?: unknown[];
  pointer: McpOpenApiPointer;
};

/** One declared request body media type. */
export type McpOpenApiInventoryMediaType = {
  mediaType: string;
  schema?: Record<string, unknown>;
  pointer: McpOpenApiPointer;
};

export type McpOpenApiInventoryRequestBody = {
  required: boolean;
  mediaTypes: McpOpenApiInventoryMediaType[];
  pointer: McpOpenApiPointer;
};

/** One operation read from the document, before canonical mapping. */
export type McpOpenApiInventoryOperation = {
  /** `operationId` when present, otherwise `METHOD /path`. Stable per document. */
  operationKey: string;
  /** Raw uppercase method; may be unsupported by the canonical model. */
  method: string;
  /** Raw templated path exactly as declared. */
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  /** Effective parameters: path-level merged with operation-level. */
  parameters: McpOpenApiInventoryParameter[];
  requestBody?: McpOpenApiInventoryRequestBody;
  /** Effective secret-safe security requirements after document-level merge. */
  security: McpOpenApiSecurityRequirement[];
  /** Effective server precedence for this operation, nearest first. */
  servers: McpOpenApiInventoryServer[];
  /** Impediments found while reading the document (refs, limits, shape). */
  issues: McpOpenApiOperationIssue[];
  pointer: McpOpenApiPointer;
};

/** Document-level metadata extracted alongside the operation inventory. */
export type McpOpenApiDocumentMetadata = {
  version: "3.0" | "3.1";
  title?: string;
  description?: string;
  /** Canonical fingerprint of the parsed document. */
  fingerprint: string;
  /** Document-level servers in declaration order. */
  servers: McpOpenApiInventoryServer[];
  /** Secret-safe security schemes declared by `components.securitySchemes`. */
  securitySchemes: Record<string, McpOpenApiSecurityRequirement>;
  /** Document-level security requirement, when declared. */
  security: McpOpenApiSecurityRequirement[];
};

export type McpOpenApiInventory = {
  document: McpOpenApiDocumentMetadata;
  operations: McpOpenApiInventoryOperation[];
  /**
   * Blocking diagnostics that cannot be attributed to one operation because
   * the affected node could not be read far enough to know its operations, for
   * example a Path Item whose `$ref` cannot be resolved. Located by the JSON
   * Pointer of the offending node.
   */
  documentIssues: McpOpenApiOperationIssue[];
};

export { mcpCompileIssueSchema, type McpCompileIssue };
