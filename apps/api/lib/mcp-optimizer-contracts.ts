/**
 * @file Versioned contracts for AI tool optimization: shared limits, run/item
 * states, sanitized `OptimizerToolSnapshotV1`, typed recommendation operations,
 * advisories, review artifacts, progress projections, and tRPC schemas. This
 * module never imports Mastra, Drizzle, or database types so the SPA can safely
 * consume every exported type through tRPC inference.
 */
import { z } from "zod";
import { MCP_FIELD_LIMITS } from "./mcp-request-definition.js";
import { mcpQuerySerializationSchema } from "./mcp-request-definition.js";
import type { McpCompileIssue } from "./mcp-request-definition.js";
import type { McpOpenApiMethod } from "./openapi-import-contracts.js";

/**
 * Version of the recommendation policy registry. Bumping it is a breaking
 * change: readers reject unknown versions instead of guessing at semantics.
 */
export const AI_TOOL_OPTIMIZATION_POLICY_VERSION = 1 as const;

/** Version of the optimizer system prompt paired with the output schema. */
export const AI_TOOL_OPTIMIZATION_PROMPT_VERSION = 2 as const;

/** Version of the sanitized snapshot schema sent to the model. */
export const OPTIMIZER_SNAPSHOT_VERSION = 1 as const;

/** Capability profile the optimizer requires. */
export const OPTIMIZER_CAPABILITY_PROFILE = "structured-text-v1" as const;

/** Bounded operational limits for the optimizer. */
export const AI_TOOL_OPTIMIZATION_LIMITS = {
  /** An unauthorized plan is discarded after this long. */
  planTtlMs: 15 * 60_000,
  /** Hard cap on items in one run regardless of server capacity. */
  maxItemsPerRun: 500,
  /** Cap on an explicitly selected tool set. */
  maxSelectedTools: 50,
  /** Cap on selected OpenAPI operation keys per run. */
  maxSelectedOperations: 50,
  /** Maximum sanitized items packed into one model call. */
  maxBatchItems: 8,
  /** Fraction of the verified context window used for one batch input. */
  batchContextFraction: 0.5,
  /** Minimum usable batch context budget; smaller models stay ineligible. */
  minBatchContextTokens: 8_192,
  /** Cap on executable operations per item output. */
  maxOperationsPerItem: 12,
  /** Cap on advisory findings per item output. */
  maxAdvisoriesPerItem: 8,
  /** Cap on rejected diagnostics retained per item. */
  maxRejectedPerItem: 24,
  /** Serialized snapshot byte cap; larger tools are ineligible. */
  snapshotMaxBytes: 24_000,
  /** Cap on any single text field inside a snapshot before serialization. */
  snapshotTextMaxChars: 2_000,
  /** Model generation token cap per batch. */
  maxGenerationOutputTokens: 8_000,
  /** Per-batch model deadline. */
  batchDeadlineMs: 120_000,
  /** One bounded schema-repair attempt per batch. */
  maxSchemaRepairs: 1,
  /** One bounded policy-repair attempt per batch, fed the rejection reasons. */
  maxPolicyRepairs: 1,
  /** Transient retries per batch with the same model/scope/prompt. */
  maxBatchRetries: 2,
  /** Lease window without a heartbeat before another worker may claim. */
  leaseTtlMs: 120_000,
  /** Heartbeat cadence for a running worker. */
  heartbeatIntervalMs: 30_000,
  /** Bounded attempts before a run is marked failed. */
  maxRunAttempts: 3,
  /** Worker claim polling interval. */
  workerPollIntervalMs: 5_000,
  /** Batches processed concurrently by one worker. */
  workerConcurrency: 2,
  /** Recommendation history retention. */
  retentionDays: 30,
  /** Bounded rationale length for operations and advisories. */
  rationaleMaxChars: 600,
} as const;

/* ------------------------------------------------------------------------- *
 * States and scope
 * ------------------------------------------------------------------------- */

export const OPTIMIZER_RUN_STATES = {
  PLANNED: "planned",
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  COMPLETED_WITH_ERRORS: "completed_with_errors",
  FAILED: "failed",
  CANCEL_REQUESTED: "cancel_requested",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
} as const;

export const optimizerRunStateSchema = z.enum([
  OPTIMIZER_RUN_STATES.PLANNED,
  OPTIMIZER_RUN_STATES.QUEUED,
  OPTIMIZER_RUN_STATES.RUNNING,
  OPTIMIZER_RUN_STATES.COMPLETED,
  OPTIMIZER_RUN_STATES.COMPLETED_WITH_ERRORS,
  OPTIMIZER_RUN_STATES.FAILED,
  OPTIMIZER_RUN_STATES.CANCEL_REQUESTED,
  OPTIMIZER_RUN_STATES.CANCELLED,
  OPTIMIZER_RUN_STATES.EXPIRED,
]);

export type OptimizerRunState = z.infer<typeof optimizerRunStateSchema>;

/** States a run cannot leave once reached. */
export const OPTIMIZER_TERMINAL_RUN_STATES: readonly OptimizerRunState[] = [
  OPTIMIZER_RUN_STATES.COMPLETED,
  OPTIMIZER_RUN_STATES.COMPLETED_WITH_ERRORS,
  OPTIMIZER_RUN_STATES.FAILED,
  OPTIMIZER_RUN_STATES.CANCELLED,
  OPTIMIZER_RUN_STATES.EXPIRED,
];

export const OPTIMIZER_ITEM_STATES = {
  QUEUED: "queued",
  RUNNING: "running",
  RECOMMENDED: "recommended",
  NO_CHANGE: "no_change",
  FAILED: "failed",
  CANCELLED: "cancelled",
  APPLIED: "applied",
  REJECTED: "rejected",
} as const;

export const optimizerItemStateSchema = z.enum([
  OPTIMIZER_ITEM_STATES.QUEUED,
  OPTIMIZER_ITEM_STATES.RUNNING,
  OPTIMIZER_ITEM_STATES.RECOMMENDED,
  OPTIMIZER_ITEM_STATES.NO_CHANGE,
  OPTIMIZER_ITEM_STATES.FAILED,
  OPTIMIZER_ITEM_STATES.CANCELLED,
  OPTIMIZER_ITEM_STATES.APPLIED,
  OPTIMIZER_ITEM_STATES.REJECTED,
]);

export type OptimizerItemState = z.infer<typeof optimizerItemStateSchema>;

export const OPTIMIZER_SOURCE_KINDS = {
  DRAFT: "draft",
  OPENAPI: "openapi",
} as const;

export const optimizerSourceKindSchema = z.enum([
  OPTIMIZER_SOURCE_KINDS.DRAFT,
  OPTIMIZER_SOURCE_KINDS.OPENAPI,
]);

export type OptimizerSourceKind = z.infer<typeof optimizerSourceKindSchema>;

/** Draft scope kinds; OpenAPI runs always carry an explicit operation key set. */
export const OPTIMIZER_SCOPE_KINDS = {
  SINGLE: "single",
  SELECTED: "selected",
  ALL_ELIGIBLE: "all_eligible",
  OPENAPI: "openapi",
} as const;

export const optimizerScopeKindSchema = z.enum([
  OPTIMIZER_SCOPE_KINDS.SINGLE,
  OPTIMIZER_SCOPE_KINDS.SELECTED,
  OPTIMIZER_SCOPE_KINDS.ALL_ELIGIBLE,
  OPTIMIZER_SCOPE_KINDS.OPENAPI,
]);

export type OptimizerScopeKind = z.infer<typeof optimizerScopeKindSchema>;

/** One item identity inside a run. */
export const optimizerItemRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("draft_tool"), toolId: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("openapi_candidate"),
    operationKey: z.string().min(1).max(512),
  }),
]);

export type OptimizerItemRef = z.infer<typeof optimizerItemRefSchema>;

export const optimizerScopeSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal(OPTIMIZER_SCOPE_KINDS.SINGLE),
      toolIds: z.tuple([z.string().min(1)]),
    }),
    z.strictObject({
      kind: z.literal(OPTIMIZER_SCOPE_KINDS.SELECTED),
      toolIds: z
        .array(z.string().min(1))
        .min(1)
        .max(AI_TOOL_OPTIMIZATION_LIMITS.maxSelectedTools),
    }),
    z.strictObject({ kind: z.literal(OPTIMIZER_SCOPE_KINDS.ALL_ELIGIBLE) }),
    z.strictObject({
      kind: z.literal(OPTIMIZER_SCOPE_KINDS.OPENAPI),
      operationKeys: z
        .array(z.string().min(1).max(512))
        .min(1)
        .max(AI_TOOL_OPTIMIZATION_LIMITS.maxSelectedOperations),
    }),
  ])
  .superRefine((scope, ctx) => {
    // Duplicate members would collapse to one item in the worker's ref maps.
    const values =
      scope.kind === "single" || scope.kind === "selected"
        ? scope.toolIds
        : scope.kind === "openapi"
          ? scope.operationKeys
          : [];
    if (new Set(values).size !== values.length) {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: "Scope members must be unique.",
      });
    }
  });

export type OptimizerScope = z.infer<typeof optimizerScopeSchema>;

/* ------------------------------------------------------------------------- *
 * Sanitized snapshot (OptimizerToolSnapshotV1)
 * ------------------------------------------------------------------------- */

/**
 * Why a tool or candidate cannot be safely snapshotted. Content is never
 * silently truncated: oversized or unparseable tools are ineligible.
 */
export const OPTIMIZER_INELIGIBLE_REASONS = {
  DEFINITION_UNPARSEABLE: "definition_unparseable",
  DEFINITION_UNSUPPORTED_BODY: "definition_unsupported_body",
  SNAPSHOT_TOO_LARGE: "snapshot_too_large",
  COMPILE_BLOCKED: "compile_blocked",
  OPENAPI_BLOCKED: "openapi_blocked",
} as const;

export const optimizerIneligibleReasonSchema = z.enum([
  OPTIMIZER_INELIGIBLE_REASONS.DEFINITION_UNPARSEABLE,
  OPTIMIZER_INELIGIBLE_REASONS.DEFINITION_UNSUPPORTED_BODY,
  OPTIMIZER_INELIGIBLE_REASONS.SNAPSHOT_TOO_LARGE,
  OPTIMIZER_INELIGIBLE_REASONS.COMPILE_BLOCKED,
  OPTIMIZER_INELIGIBLE_REASONS.OPENAPI_BLOCKED,
]);

export type OptimizerIneligibleReason =
  (typeof OPTIMIZER_INELIGIBLE_REASONS)[keyof typeof OPTIMIZER_INELIGIBLE_REASONS];

/** Sanitized agent input: sensitive inputs keep only structure, never names. */
const optimizerSnapshotInputSchema = z.discriminatedUnion("sensitivity", [
  z.strictObject({
    sensitivity: z.literal("normal"),
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(256),
    description: z.string().max(2_000).optional(),
    type: z.string().min(1).max(32),
    required: z.boolean(),
    isItemsElement: z.boolean().optional(),
  }),
  z.strictObject({
    sensitivity: z.literal("sensitive"),
    /** Synthetic stable reference so bindings can cite the input without naming it. */
    ref: z.string().min(1).max(64),
    type: z.string().min(1).max(32),
    required: z.boolean(),
  }),
]);

export type OptimizerSnapshotInput = z.infer<
  typeof optimizerSnapshotInputSchema
>;

/**
 * Path segment shape. Literal segments keep bounded route text so the model
 * can infer the endpoint. Credential-shaped spans are redacted before this
 * field is set; query/body literal values stay out of the snapshot.
 */
export const optimizerPathSegmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("literal"),
    text: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("parameter"),
    agentInputId: z.string().min(1).max(64),
  }),
  /** A path segment bound to a sensitive input; the input id is never sent. */
  z.strictObject({ kind: z.literal("sensitiveParameter") }),
]);

export type OptimizerPathSegment = z.infer<typeof optimizerPathSegmentSchema>;

/**
 * Query entry structure; bindings keep only their kind and input reference.
 * Bindings owned by a sensitive input expose no id at all.
 */
export const optimizerQueryEntrySchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  binding: z.enum(["agentInput", "literal", "serverValue", "sensitiveInput"]),
  agentInputId: z.string().min(1).max(64).optional(),
  omitWhenAbsent: z.boolean().optional(),
  serialization: mcpQuerySerializationSchema.optional(),
});

export type OptimizerQueryEntry = z.infer<typeof optimizerQueryEntrySchema>;

/** JSON object field structure, recursively for nested objects. */
export type OptimizerSnapshotJsonNode =
  | { kind: "literal"; jsonType: "string" | "number" | "boolean" | "null" }
  | {
      kind: "binding";
      binding: "agentInput" | "literal" | "serverValue" | "sensitiveInput";
      agentInputId?: string;
      jsonType: "string" | "number" | "boolean" | "null" | "any";
      omitWhenAbsent?: boolean;
    }
  | {
      kind: "object";
      fields: Array<{
        id: string;
        key: string;
        value: OptimizerSnapshotJsonNode;
        omitWhenAbsent?: boolean;
      }>;
    }
  | { kind: "array"; items: OptimizerSnapshotJsonNode[] };

/** Header presence indicator: immutable, names only, never construction. */
export const optimizerHeaderPresenceSchema = z.strictObject({
  names: z.array(z.string().min(1).max(256)).max(60),
});

export type OptimizerHeaderPresence = z.infer<
  typeof optimizerHeaderPresenceSchema
>;

/** Sanitized body shape. Raw templates are never included. */
export const optimizerBodySchema = z.discriminatedUnion("bodyType", [
  z.strictObject({
    bodyType: z.literal("json"),
    root: z.custom<OptimizerSnapshotJsonNode>(
      (value) => typeof value === "object" && value !== null,
    ),
  }),
  z.strictObject({
    bodyType: z.literal("form"),
    fields: z.array(optimizerQueryEntrySchema).max(60),
  }),
  z.strictObject({ bodyType: z.literal("raw") }),
  z.strictObject({ bodyType: z.literal("none") }),
]);

export type OptimizerBody = z.infer<typeof optimizerBodySchema>;

/** Existing structural issues exposed as stable codes, never as instructions. */
export const optimizerSnapshotIssueSchema = z.strictObject({
  code: z.string().min(1).max(128),
  path: z.string().max(256).optional(),
  severity: z.enum(["error", "warning"]),
});

export type OptimizerSnapshotIssue = z.infer<
  typeof optimizerSnapshotIssueSchema
>;

/**
 * Versioned sanitized tool snapshot. Exactly one of `toolId` (draft) or
 * `operationKey` (OpenAPI candidate) is present. Excludes base URLs, source
 * URLs, allowed hosts, common headers/query, authentication, literal values,
 * server-value/secret IDs, examples, raw templates, documents, provenance.
 */
export type OptimizerToolSnapshotV1 = {
  snapshotVersion: typeof OPTIMIZER_SNAPSHOT_VERSION;
  source: OptimizerSourceKind;
  toolId?: string;
  operationKey?: string;
  name: string;
  title?: string;
  description?: string;
  method: McpOpenApiMethod | string;
  pathShape: OptimizerPathSegment[];
  inputs: OptimizerSnapshotInput[];
  query: OptimizerQueryEntry[];
  headerPresence: OptimizerHeaderPresence;
  body: OptimizerBody;
  issues: OptimizerSnapshotIssue[];
};

export const optimizerToolSnapshotSchema: z.ZodType<OptimizerToolSnapshotV1> =
  z.strictObject({
    snapshotVersion: z.literal(OPTIMIZER_SNAPSHOT_VERSION),
    source: optimizerSourceKindSchema,
    toolId: z.string().min(1).optional(),
    operationKey: z.string().min(1).max(512).optional(),
    name: z.string().min(1).max(MCP_FIELD_LIMITS.name),
    title: z.string().max(MCP_FIELD_LIMITS.toolTitle).optional(),
    description: z.string().max(MCP_FIELD_LIMITS.description).optional(),
    method: z.string().min(1).max(16),
    pathShape: z.array(optimizerPathSegmentSchema).max(32),
    inputs: z.array(optimizerSnapshotInputSchema).max(40),
    query: z.array(optimizerQueryEntrySchema).max(60),
    headerPresence: optimizerHeaderPresenceSchema,
    body: optimizerBodySchema,
    issues: z.array(optimizerSnapshotIssueSchema).max(60),
  });

/* ------------------------------------------------------------------------- *
 * Recommendation operations (policy-typed)
 * ------------------------------------------------------------------------- */

export const OPTIMIZER_OPERATION_KINDS = {
  SET_TOOL_NAME: "set_tool_name",
  SET_TOOL_TITLE: "set_tool_title",
  SET_TOOL_DESCRIPTION: "set_tool_description",
  SET_INPUT_NAME: "set_input_name",
  SET_INPUT_DESCRIPTION: "set_input_description",
  SET_QUERY_ENTRY_KEY: "set_query_entry_key",
  SET_QUERY_ENTRY_SERIALIZATION: "set_query_entry_serialization",
  SET_QUERY_ENTRY_OMIT_WHEN_ABSENT: "set_query_entry_omit_when_absent",
  REBIND_QUERY_ENTRY: "rebind_query_entry",
  REBIND_JSON_FIELD: "rebind_json_field",
  SET_JSON_FIELD_KEY: "set_json_field_key",
  SET_JSON_FIELD_OMIT_WHEN_ABSENT: "set_json_field_omit_when_absent",
} as const;

export type OptimizerOperationKind =
  (typeof OPTIMIZER_OPERATION_KINDS)[keyof typeof OPTIMIZER_OPERATION_KINDS];

/** Kinds any owner may apply without extra review friction. */
export const OPTIMIZER_SAFE_OPERATION_KINDS: readonly OptimizerOperationKind[] =
  [
    OPTIMIZER_OPERATION_KINDS.SET_TOOL_NAME,
    OPTIMIZER_OPERATION_KINDS.SET_TOOL_TITLE,
    OPTIMIZER_OPERATION_KINDS.SET_TOOL_DESCRIPTION,
    OPTIMIZER_OPERATION_KINDS.SET_INPUT_NAME,
    OPTIMIZER_OPERATION_KINDS.SET_INPUT_DESCRIPTION,
  ];

/** Request-shaping kinds that require guarded review and compile validation. */
export const OPTIMIZER_GUARDED_OPERATION_KINDS: readonly OptimizerOperationKind[] =
  [
    OPTIMIZER_OPERATION_KINDS.SET_QUERY_ENTRY_KEY,
    OPTIMIZER_OPERATION_KINDS.SET_QUERY_ENTRY_SERIALIZATION,
    OPTIMIZER_OPERATION_KINDS.SET_QUERY_ENTRY_OMIT_WHEN_ABSENT,
    OPTIMIZER_OPERATION_KINDS.REBIND_QUERY_ENTRY,
    OPTIMIZER_OPERATION_KINDS.REBIND_JSON_FIELD,
    OPTIMIZER_OPERATION_KINDS.SET_JSON_FIELD_KEY,
    OPTIMIZER_OPERATION_KINDS.SET_JSON_FIELD_OMIT_WHEN_ABSENT,
  ];

export type OptimizerOperationClass = "safe" | "guarded";

export function optimizerOperationClass(
  kind: OptimizerOperationKind,
): OptimizerOperationClass | null {
  if (OPTIMIZER_SAFE_OPERATION_KINDS.includes(kind)) return "safe";
  if (OPTIMIZER_GUARDED_OPERATION_KINDS.includes(kind)) return "guarded";
  return null;
}

export const optimizerOperationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_TOOL_NAME),
    operationId: z.string().min(1).max(64),
    value: z.string().min(1).max(MCP_FIELD_LIMITS.name),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_TOOL_TITLE),
    operationId: z.string().min(1).max(64),
    value: z.string().min(1).max(MCP_FIELD_LIMITS.toolTitle),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_TOOL_DESCRIPTION),
    operationId: z.string().min(1).max(64),
    value: z.string().min(1).max(MCP_FIELD_LIMITS.description),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_INPUT_NAME),
    operationId: z.string().min(1).max(64),
    inputId: z.string().min(1).max(64),
    value: z.string().min(1).max(256),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_INPUT_DESCRIPTION),
    operationId: z.string().min(1).max(64),
    inputId: z.string().min(1).max(64),
    value: z.string().min(1).max(MCP_FIELD_LIMITS.description),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_QUERY_ENTRY_KEY),
    operationId: z.string().min(1).max(64),
    entryId: z.string().min(1).max(64),
    value: z.string().min(1).max(256),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_QUERY_ENTRY_SERIALIZATION),
    operationId: z.string().min(1).max(64),
    entryId: z.string().min(1).max(64),
    explode: z.boolean(),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_QUERY_ENTRY_OMIT_WHEN_ABSENT),
    operationId: z.string().min(1).max(64),
    entryId: z.string().min(1).max(64),
    value: z.boolean(),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.REBIND_QUERY_ENTRY),
    operationId: z.string().min(1).max(64),
    entryId: z.string().min(1).max(64),
    agentInputId: z.string().min(1).max(64),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.REBIND_JSON_FIELD),
    operationId: z.string().min(1).max(64),
    fieldId: z.string().min(1).max(64),
    agentInputId: z.string().min(1).max(64),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_JSON_FIELD_KEY),
    operationId: z.string().min(1).max(64),
    fieldId: z.string().min(1).max(64),
    value: z.string().min(1).max(256),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
  z.strictObject({
    kind: z.literal(OPTIMIZER_OPERATION_KINDS.SET_JSON_FIELD_OMIT_WHEN_ABSENT),
    operationId: z.string().min(1).max(64),
    fieldId: z.string().min(1).max(64),
    value: z.boolean(),
    rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  }),
]);

export type OptimizerOperation = z.infer<typeof optimizerOperationSchema>;

/* ------------------------------------------------------------------------- *
 * Advisories and rejected diagnostics
 * ------------------------------------------------------------------------- */

export const OPTIMIZER_ADVISORY_CODES = {
  SUSPECTED_PATH: "suspected_path",
  SUSPECTED_METHOD: "suspected_method",
  SUSPECTED_AUTH: "suspected_auth",
  SUSPECTED_HOST: "suspected_host",
  SUSPECTED_HEADER: "suspected_header",
  SUSPECTED_SECRET: "suspected_secret",
  SUSPECTED_MUTATION_CLASSIFICATION: "suspected_mutation_classification",
  SUSPECTED_ENABLEMENT: "suspected_enablement",
  SUSPECTED_PUBLICATION: "suspected_publication",
  MISSING_PARAMETER: "missing_parameter",
  TYPE_MISMATCH: "type_mismatch",
  UNSUPPORTED_RESTRUCTURING: "unsupported_restructuring",
} as const;

export const optimizerAdvisoryCodeSchema = z.enum(
  Object.values(OPTIMIZER_ADVISORY_CODES) as [
    (typeof OPTIMIZER_ADVISORY_CODES)[keyof typeof OPTIMIZER_ADVISORY_CODES],
    ...(typeof OPTIMIZER_ADVISORY_CODES)[keyof typeof OPTIMIZER_ADVISORY_CODES][],
  ],
);

export type OptimizerAdvisoryCode = z.infer<typeof optimizerAdvisoryCodeSchema>;

/** Manual-review guidance; never machine-applicable. */
export const optimizerAdvisorySchema = z.strictObject({
  advisoryId: z.string().min(1).max(64),
  code: optimizerAdvisoryCodeSchema,
  rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
});

export type OptimizerAdvisory = z.infer<typeof optimizerAdvisorySchema>;

/** Stable codes for recommendations that failed schema/policy/validation. */
export const OPTIMIZER_REJECTED_CODES = {
  UNKNOWN_TARGET: "unknown_target",
  DUPLICATE_OPERATION: "duplicate_operation",
  OUT_OF_BOUNDS: "out_of_bounds",
  FORBIDDEN_TARGET: "forbidden_target",
  SENSITIVE_TARGET: "sensitive_target",
  MISSING_VALUE: "missing_value",
  POLICY_REJECTED: "policy_rejected",
  COMPILE_FAILED: "compile_failed",
  SECURITY_REJECTED: "security_rejected",
  NAME_CONFLICT: "name_conflict",
  SCHEMA_INVALID: "schema_invalid",
  CROSS_ITEM_REFERENCE: "cross_item_reference",
} as const;

export const optimizerRejectedCodeSchema = z.enum(
  Object.values(OPTIMIZER_REJECTED_CODES) as [
    (typeof OPTIMIZER_REJECTED_CODES)[keyof typeof OPTIMIZER_REJECTED_CODES],
    ...(typeof OPTIMIZER_REJECTED_CODES)[keyof typeof OPTIMIZER_REJECTED_CODES][],
  ],
);

export type OptimizerRejectedCode = z.infer<typeof optimizerRejectedCodeSchema>;

export const optimizerRejectedDiagnosticSchema = z.strictObject({
  /** Server-assigned id; model ids are not trusted for rejected entries. */
  operationId: z.string().min(1).max(64),
  code: optimizerRejectedCodeSchema,
  detail: z.string().max(300),
});

export type OptimizerRejectedDiagnostic = z.infer<
  typeof optimizerRejectedDiagnosticSchema
>;

/* ------------------------------------------------------------------------- *
 * Review artifacts
 * ------------------------------------------------------------------------- */

/** One redacted effective-request line delta for a guarded operation. */
export const optimizerRequestDiffLineSchema = z.strictObject({
  label: z.string().min(1).max(64),
  before: z.string().max(512),
  after: z.string().max(512),
});

export type OptimizerRequestDiffLine = z.infer<
  typeof optimizerRequestDiffLineSchema
>;

/** Server-owned review artifact for one valid executable operation. */
export const optimizerReviewOperationSchema = z.strictObject({
  operationId: z.string().min(1).max(64),
  kind: z.string().min(1).max(64),
  class: z.enum(["safe", "guarded"]),
  targetLabel: z.string().min(1).max(256),
  before: z.string().max(MCP_FIELD_LIMITS.description).nullable(),
  after: z.string().max(MCP_FIELD_LIMITS.description),
  rationale: z.string().max(AI_TOOL_OPTIMIZATION_LIMITS.rationaleMaxChars),
  requestDiff: z.array(optimizerRequestDiffLineSchema).max(20).optional(),
});

export type OptimizerReviewOperation = z.infer<
  typeof optimizerReviewOperationSchema
>;

/** Full review payload for one analyzed item. */
export type OptimizerItemReview = {
  operations: OptimizerReviewOperation[];
  advisories: OptimizerAdvisory[];
  rejected: OptimizerRejectedDiagnostic[];
  sourceOperations?: OptimizerOperation[];
};

/** Fail-safe review payload persisted on the item row. */
export const optimizerItemReviewSchema: z.ZodType<OptimizerItemReview> =
  z.strictObject({
    operations: z
      .array(optimizerReviewOperationSchema)
      .max(AI_TOOL_OPTIMIZATION_LIMITS.maxOperationsPerItem),
    advisories: z
      .array(optimizerAdvisorySchema)
      .max(AI_TOOL_OPTIMIZATION_LIMITS.maxAdvisoriesPerItem),
    rejected: z
      .array(optimizerRejectedDiagnosticSchema)
      .max(AI_TOOL_OPTIMIZATION_LIMITS.maxRejectedPerItem),
    /**
     * Persisted-only: the validated typed operations backing the review, in
     * policy order. Server strips this field from client projections and uses
     * it for fail-closed revalidation at apply/confirmation time.
     */
    sourceOperations: z
      .array(optimizerOperationSchema)
      .max(AI_TOOL_OPTIMIZATION_LIMITS.maxOperationsPerItem)
      .optional(),
  });

/* ------------------------------------------------------------------------- *
 * Cost estimation
 * ------------------------------------------------------------------------- */

/** Pricing is either honestly estimated or explicitly unknown; never zero. */
export const optimizerPricingSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("estimated"),
    inputCostUsd: z.number().min(0),
    outputCostUsd: z.number().min(0),
    totalCostUsd: z.number().min(0),
  }),
  z.strictObject({ state: z.literal("unknown") }),
]);

export type OptimizerPricing = z.infer<typeof optimizerPricingSchema>;

export const optimizerTokenEstimateSchema = z.strictObject({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});

export type OptimizerTokenEstimate = z.infer<
  typeof optimizerTokenEstimateSchema
>;

export const optimizerEstimateSchema = z.strictObject({
  tokens: optimizerTokenEstimateSchema,
  pricing: optimizerPricingSchema,
});

export type OptimizerEstimate = z.infer<typeof optimizerEstimateSchema>;

/* ------------------------------------------------------------------------- *
 * Preflight plan projections
 * ------------------------------------------------------------------------- */

/** Static data categories the model will receive. */
export const OPTIMIZER_DISCLOSED_DATA = [
  "tool_names",
  "tool_descriptions",
  "path_shape",
  "query_structure",
  "body_structure",
  "input_metadata",
  "serialization",
  "compile_issue_codes",
  "header_presence",
] as const;

export type OptimizerDisclosedData = (typeof OPTIMIZER_DISCLOSED_DATA)[number];

/** Fields the model may propose changes to. */
export const OPTIMIZER_MUTABLE_FIELDS = [
  "tool_name",
  "tool_title",
  "tool_description",
  "input_name",
  "input_description",
  "query_key",
  "query_serialization",
  "query_omit_when_absent",
  "query_binding",
  "json_field_key",
  "json_field_omit_when_absent",
  "json_field_binding",
] as const;

export type OptimizerMutableField = (typeof OPTIMIZER_MUTABLE_FIELDS)[number];

/** Fields the model can never change, disclosed before authorization. */
export const OPTIMIZER_IMMUTABLE_FIELDS = [
  "method",
  "path",
  "base_url",
  "allowed_hosts",
  "headers",
  "authentication",
  "secrets",
  "literal_values",
  "input_types",
  "input_constraints",
  "input_requiredness",
  "mutation_permission",
  "enablement",
  "groups",
  "publication",
] as const;

export type OptimizerImmutableField =
  (typeof OPTIMIZER_IMMUTABLE_FIELDS)[number];

/** One scope member that cannot be analyzed, with its stable reason. */
export const optimizerIneligibleItemSchema = z.strictObject({
  ref: optimizerItemRefSchema,
  /** Agent-facing label so the UI can list each ineligible member. */
  name: z.string().min(1).max(MCP_FIELD_LIMITS.name),
  reason: optimizerIneligibleReasonSchema,
});

export type OptimizerIneligibleItem = z.infer<
  typeof optimizerIneligibleItemSchema
>;

/** Eligible scope member with its sanitized snapshot fingerprint. */
export const optimizerEligibleItemSchema = z.strictObject({
  ref: optimizerItemRefSchema,
  fingerprint: z.string().min(1).max(128),
  name: z.string().min(1).max(MCP_FIELD_LIMITS.name),
});

export type OptimizerEligibleItem = z.infer<typeof optimizerEligibleItemSchema>;

/** Model/provider identity shown before authorization. */
export const optimizerModelSelectionSchema = z.strictObject({
  providerKind: z.string().min(1).max(64),
  modelId: z.string().min(1).max(256),
  readinessFingerprint: z.string().min(1).max(128),
});

export type OptimizerModelSelection = z.infer<
  typeof optimizerModelSelectionSchema
>;

/** Write-free preflight plan; authorization is a separate mutation. */
export type OptimizerPreflightResult = {
  runId: string;
  state: OptimizerRunState;
  serverId: string;
  source: OptimizerSourceKind;
  scope: OptimizerScope;
  scopeKind: OptimizerScopeKind;
  model: OptimizerModelSelection;
  policyVersion: number;
  promptVersion: number;
  eligible: OptimizerEligibleItem[];
  ineligible: OptimizerIneligibleItem[];
  disclosedData: readonly OptimizerDisclosedData[];
  mutableFields: readonly OptimizerMutableField[];
  immutableFields: readonly OptimizerImmutableField[];
  estimate: OptimizerEstimate;
  expiresAt: Date;
};

export const optimizerPreflightResultSchema: z.ZodType<OptimizerPreflightResult> =
  z.strictObject({
    runId: z.string().min(1),
    state: optimizerRunStateSchema,
    serverId: z.string().min(1),
    source: optimizerSourceKindSchema,
    scope: optimizerScopeSchema,
    scopeKind: optimizerScopeKindSchema,
    model: optimizerModelSelectionSchema,
    policyVersion: z.number().int().min(1),
    promptVersion: z.number().int().min(1),
    eligible: z.array(optimizerEligibleItemSchema),
    ineligible: z.array(optimizerIneligibleItemSchema),
    disclosedData: z.array(z.enum(OPTIMIZER_DISCLOSED_DATA)),
    mutableFields: z.array(z.enum(OPTIMIZER_MUTABLE_FIELDS)),
    immutableFields: z.array(z.enum(OPTIMIZER_IMMUTABLE_FIELDS)),
    estimate: optimizerEstimateSchema,
    expiresAt: z.date(),
  });

/* ------------------------------------------------------------------------- *
 * Run progress and result projections
 * ------------------------------------------------------------------------- */

export const optimizerProgressSchema = z.strictObject({
  total: z.number().int().min(0),
  queued: z.number().int().min(0),
  running: z.number().int().min(0),
  recommended: z.number().int().min(0),
  noChange: z.number().int().min(0),
  failed: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  applied: z.number().int().min(0),
  rejected: z.number().int().min(0),
});

export type OptimizerProgress = z.infer<typeof optimizerProgressSchema>;

/** Paginated item row without review payloads. */
export const optimizerItemSummarySchema = z.strictObject({
  id: z.string().min(1),
  ref: optimizerItemRefSchema,
  name: z.string().min(1).max(MCP_FIELD_LIMITS.name),
  state: optimizerItemStateSchema,
  fingerprint: z.string().min(1).max(128),
  operationCount: z.number().int().min(0),
  advisoryCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  failureCode: z.string().max(128).nullable(),
  appliedDraftRevision: z.number().int().min(1).nullable(),
  updatedAt: z.date(),
});

export type OptimizerItemSummary = z.infer<typeof optimizerItemSummarySchema>;

/** One item with its full review artifacts. */
export type OptimizerItemDetail = OptimizerItemSummary & {
  review: OptimizerItemReview;
};

export const optimizerItemDetailSchema: z.ZodType<OptimizerItemDetail> =
  z.strictObject({
    id: z.string().min(1),
    ref: optimizerItemRefSchema,
    name: z.string().min(1).max(MCP_FIELD_LIMITS.name),
    state: optimizerItemStateSchema,
    fingerprint: z.string().min(1).max(128),
    operationCount: z.number().int().min(0),
    advisoryCount: z.number().int().min(0),
    rejectedCount: z.number().int().min(0),
    failureCode: z.string().max(128).nullable(),
    appliedDraftRevision: z.number().int().min(1).nullable(),
    updatedAt: z.date(),
    review: optimizerItemReviewSchema,
  });

/** Run row projection without secrets or snapshots. */
export const optimizerRunSummarySchema = z.strictObject({
  id: z.string().min(1),
  serverId: z.string().min(1),
  source: optimizerSourceKindSchema,
  scopeKind: optimizerScopeKindSchema,
  /** Exact scope so clients can resume a matching active run. */
  scope: optimizerScopeSchema,
  state: optimizerRunStateSchema,
  policyVersion: z.number().int().min(1),
  promptVersion: z.number().int().min(1),
  providerKind: z.string().min(1).max(64).nullable(),
  modelId: z.string().min(1).max(256).nullable(),
  progress: optimizerProgressSchema,
  authorizedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  cancelRequested: z.boolean(),
  errorCode: z.string().max(128).nullable(),
  createdAt: z.date(),
  expiresAt: z.date().nullable(),
});

export type OptimizerRunSummary = z.infer<typeof optimizerRunSummarySchema>;

/* ------------------------------------------------------------------------- *
 * tRPC input schemas
 * ------------------------------------------------------------------------- */

export const optimizerPreflightDraftInputSchema = z.strictObject({
  serverId: z.string().min(1).max(64),
  scope: optimizerScopeSchema,
  expectedConfigRevision: z.number().int().min(1),
});

export type OptimizerPreflightDraftInput = z.infer<
  typeof optimizerPreflightDraftInputSchema
>;

export const optimizerPreflightOpenapiInputSchema = z
  .strictObject({
    serverId: z.string().min(1).max(64),
    source: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("content"),
        content: z.string().min(1).max(2_000_000),
        label: z.enum(["file", "paste"]).default("paste"),
      }),
      z.strictObject({
        kind: z.literal("url"),
        url: z.string().min(1).max(2048),
      }),
    ]),
    fingerprint: z.string().min(1).max(128),
    operationKeys: z
      .array(z.string().min(1).max(512))
      .min(1)
      .max(AI_TOOL_OPTIMIZATION_LIMITS.maxSelectedOperations),
    expectedConfigRevision: z.number().int().min(1),
  })
  .superRefine((input, ctx) => {
    if (new Set(input.operationKeys).size !== input.operationKeys.length) {
      ctx.addIssue({
        code: "custom",
        path: ["operationKeys"],
        message: "operationKeys must be unique.",
      });
    }
  });

export type OptimizerPreflightOpenapiInput = z.infer<
  typeof optimizerPreflightOpenapiInputSchema
>;

export const optimizerAuthorizeInputSchema = z.strictObject({
  runId: z.string().min(1),
  expectedConfigRevision: z.number().int().min(1),
  expectedDraftRevision: z.number().int().min(1).optional(),
  /**
   * Required for OpenAPI runs: the source is reparsed/refetched so the
   * document fingerprint can be rechecked without any stored raw document.
   */
  source: z
    .discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("content"),
        content: z.string().min(1).max(2_000_000),
        label: z.enum(["file", "paste"]).default("paste"),
      }),
      z.strictObject({
        kind: z.literal("url"),
        url: z.string().min(1).max(2048),
      }),
    ])
    .optional(),
});

export type OptimizerAuthorizeInput = z.infer<
  typeof optimizerAuthorizeInputSchema
>;

export const optimizerAuthorizeResultSchema = z.strictObject({
  runId: z.string().min(1),
  state: optimizerRunStateSchema,
});

export type OptimizerAuthorizeResult = z.infer<
  typeof optimizerAuthorizeResultSchema
>;

export const optimizerStatusInputSchema = z.strictObject({
  runId: z.string().min(1),
});

export const optimizerListItemsInputSchema = z.strictObject({
  runId: z.string().min(1),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  state: optimizerItemStateSchema.optional(),
});

export type OptimizerListItemsInput = z.infer<
  typeof optimizerListItemsInputSchema
>;

export const optimizerPaginatedItemsSchema = z.strictObject({
  items: z.array(optimizerItemSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type OptimizerPaginatedItems = z.infer<
  typeof optimizerPaginatedItemsSchema
>;

export const optimizerListRunsInputSchema = z.strictObject({
  serverId: z.string().min(1).max(64),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});

export type OptimizerListRunsInput = z.infer<
  typeof optimizerListRunsInputSchema
>;

export const optimizerPaginatedRunsSchema = z.strictObject({
  items: z.array(optimizerRunSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type OptimizerPaginatedRuns = z.infer<
  typeof optimizerPaginatedRunsSchema
>;

export const optimizerCancelInputSchema = z.strictObject({
  runId: z.string().min(1),
});

export const optimizerCancelResultSchema = z.strictObject({
  runId: z.string().min(1),
  state: optimizerRunStateSchema,
});

export type OptimizerCancelResult = z.infer<typeof optimizerCancelResultSchema>;

export const optimizerRejectInputSchema = z.strictObject({
  runId: z.string().min(1),
  itemId: z.string().min(1),
});

export const optimizerRejectResultSchema = z.strictObject({
  runId: z.string().min(1),
  itemId: z.string().min(1),
  state: optimizerItemStateSchema,
});

export type OptimizerRejectResult = z.infer<typeof optimizerRejectResultSchema>;

/** One selected executable operation set on one item. */
export const optimizerApplySelectionSchema = z.strictObject({
  itemId: z.string().min(1),
  operationIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(AI_TOOL_OPTIMIZATION_LIMITS.maxOperationsPerItem),
});

export type OptimizerApplySelection = z.infer<
  typeof optimizerApplySelectionSchema
>;

export const optimizerApplyDraftInputSchema = z
  .strictObject({
    runId: z.string().min(1),
    selections: z
      .array(optimizerApplySelectionSchema)
      .min(1)
      .max(AI_TOOL_OPTIMIZATION_LIMITS.maxSelectedTools),
    expectedConfigRevision: z.number().int().min(1),
    expectedDraftRevision: z.number().int().min(1),
    /** Client-generated idempotency key for the whole application batch. */
    applyKey: z.string().min(8).max(128),
  })
  .superRefine((input, ctx) => {
    const ids = input.selections.map((entry) => entry.itemId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        path: ["selections"],
        message: "selections must reference distinct items.",
      });
    }
  });

export type OptimizerApplyDraftInput = z.infer<
  typeof optimizerApplyDraftInputSchema
>;

export const optimizerApplyDraftResultSchema = z.strictObject({
  runId: z.string().min(1),
  configRevision: z.number().int().min(1),
  draftRevision: z.number().int().min(1),
  applied: z.array(
    z.strictObject({
      itemId: z.string().min(1),
      toolId: z.string().min(1),
      toolName: z.string().min(1).max(MCP_FIELD_LIMITS.name),
    }),
  ),
});

export type OptimizerApplyDraftResult = z.infer<
  typeof optimizerApplyDraftResultSchema
>;

export type { McpCompileIssue };
