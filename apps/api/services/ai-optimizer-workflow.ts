/**
 * @file The tool-free, memory-free optimizer Mastra workflow. Batches are
 * packed deterministically, generated through the request-scoped runtime with
 * the caller's abort signal and deadlines, parsed strictly, and converted into
 * server-owned review artifacts. Raw responses are never persisted.
 */
import { APP_ERROR_CODES, type AiProviderKind } from "@repo/core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { mcpServerVariable, type McpServer } from "@repo/db";
import { AppError, appError } from "../lib/app-error.js";
import {
  AI_TOOL_OPTIMIZATION_LIMITS,
  optimizerOperationClass,
  type OptimizerAdvisory,
  type OptimizerItemReview,
  type OptimizerOperation,
  type OptimizerRejectedDiagnostic,
  type OptimizerRequestDiffLine,
  type OptimizerReviewOperation,
  type OptimizerToolSnapshotV1,
} from "../lib/mcp-optimizer-contracts.js";
import {
  buildItemReview,
  parseModelItemOutput,
  validateOptimizerOperation,
  type OptimizerPolicyCompileContext,
} from "../lib/mcp-optimizer-policy.js";
import {
  composeBatchPrompt,
  optimizerBatchOutputSchema,
  packBatches,
  type OptimizerBatchItem,
  type OptimizerRepairContext,
} from "../lib/ai/optimizer-prompt.js";
import { redactCredentialText } from "../lib/openapi-redact.js";
import {
  generateStructured,
  resolveVerifiedSelection,
} from "../lib/ai/ai-runtime.js";
import type { AiProviderAdapter } from "../lib/ai/provider-adapter.js";
import {
  mcpAuthConfigurationSchema,
  mcpCommonEntriesSchema,
  type McpRequestDefinition,
} from "../lib/mcp-request-definition.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type AiOptimizerWorkflowDeps = {
  db: DB;
  /** Registry lookup; unknown provider kinds fail closed at first use. */
  getAdapter: (providerKind: AiProviderKind) => AiProviderAdapter | undefined;
  aiCredentialSecret: string;
};

function totalAdapter(
  deps: AiOptimizerWorkflowDeps,
): (providerKind: AiProviderKind) => AiProviderAdapter {
  return (providerKind) => {
    const adapter = deps.getAdapter(providerKind);
    if (!adapter) {
      throw appError({
        appCode: APP_ERROR_CODES.AI_PROVIDER_UNSUPPORTED,
        message: "The provider kind is not in the supported registry.",
        status: 400,
      });
    }
    return adapter;
  };
}

/** Stable per-item failure codes; never raw provider diagnostics. */
export const OPTIMIZER_ITEM_FAILURE_CODES = {
  MODEL_OUTPUT_INVALID: "model_output_invalid",
  NO_RESULT: "no_result",
  PROMPT_BOUNDS: "prompt_bounds_exceeded",
  PROVIDER_TRANSIENT: "provider_transient_failure",
  PROVIDER_REJECTED: "provider_request_rejected",
  CREDENTIAL_INVALID: "provider_credential_invalid",
  CANCELLED: "cancelled",
} as const;

export type OptimizerItemFailureCode =
  (typeof OPTIMIZER_ITEM_FAILURE_CODES)[keyof typeof OPTIMIZER_ITEM_FAILURE_CODES];

export type OptimizerBatchItemResult =
  | {
      ok: true;
      operations: OptimizerOperation[];
      advisories: OptimizerAdvisory[];
      rejected: OptimizerRejectedDiagnostic[];
    }
  | { ok: false; failureCode: OptimizerItemFailureCode };

export type OptimizerBatchAnalysis = {
  usage: {
    totalTokens: number | null;
    batchCount: number;
    usedRepair: boolean;
  };
  results: Map<string, OptimizerBatchItemResult>;
};

/** Runtime selection fingerprint must match the authorized one, fail closed. */
export async function assertRunModelCurrent(
  deps: AiOptimizerWorkflowDeps,
  input: {
    userId: string;
    expectedReadinessFingerprint: string;
    expectedModelId: string;
  },
) {
  const selection = await resolveVerifiedSelection({
    db: deps.db,
    getAdapter: totalAdapter(deps),
    userId: input.userId,
    capabilityProfile: "structured-text-v1",
  });
  if (
    selection.storedFingerprint !== input.expectedReadinessFingerprint ||
    selection.modelId !== input.expectedModelId
  ) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_OPTIMIZATION_MODEL_DRIFT,
      message: "The verified model changed after authorization.",
      status: 409,
    });
  }
  return selection;
}

class TransientBatchError extends Error {
  constructor(
    readonly failureCode: OptimizerItemFailureCode,
    cause?: unknown,
  ) {
    super("transient batch failure");
    this.cause = cause;
  }
}

/**
 * Analyzes one deterministic batch with the owner's verified model. Applies
 * one bounded schema-repair attempt with the same model, scope, prompt policy,
 * and authority; fails stable when output remains invalid.
 */
export async function analyzeBatch(
  deps: AiOptimizerWorkflowDeps,
  input: {
    userId: string;
    providerKind: AiProviderKind;
    batch: OptimizerBatchItem[];
    expectedReadinessFingerprint: string;
    expectedModelId: string;
    signal?: AbortSignal;
  },
): Promise<OptimizerBatchAnalysis> {
  await assertRunModelCurrent(deps, input);

  const maxPromptChars = 400_000;
  const batch: OptimizerBatchAnalysis = {
    usage: { totalTokens: null, batchCount: 0, usedRepair: false },
    results: new Map(),
  };
  let totalTokens: number | null = null;

  const run = async (
    prompt: string,
    repair: boolean,
  ): Promise<{ object: unknown; tokenUsage: number | null }> => {
    const result = await generateStructured({
      deps: { ...deps, getAdapter: totalAdapter(deps) },
      userId: input.userId,
      capabilityProfile: "structured-text-v1",
      schema: optimizerBatchOutputSchema,
      prompt,
      maxOutputTokens: AI_TOOL_OPTIMIZATION_LIMITS.maxGenerationOutputTokens,
      deadlineMs: AI_TOOL_OPTIMIZATION_LIMITS.batchDeadlineMs,
      signal: input.signal,
      maxPromptLength: maxPromptChars,
    });
    batch.usage.batchCount += 1;
    batch.usage.usedRepair = batch.usage.usedRepair || repair;
    if (result.tokenUsage !== null) {
      totalTokens = (totalTokens ?? 0) + result.tokenUsage;
    }
    return { object: result.object as unknown, tokenUsage: result.tokenUsage };
  };

  const prompt = composeBatchPrompt(input.batch);
  if (prompt.length > maxPromptChars) {
    for (const item of input.batch) {
      batch.results.set(item.itemRef, {
        ok: false,
        failureCode: OPTIMIZER_ITEM_FAILURE_CODES.PROMPT_BOUNDS,
      });
    }
    batch.usage.totalTokens = totalTokens;
    return batch;
  }

  let output: BatchEnvelope | null = null;
  let schemaIssue: string | null = null;
  try {
    const first = await run(prompt, false);
    const parsedFirst = optimizerBatchOutputSchema.safeParse(first.object);
    if (parsedFirst.success) {
      output = parsedFirst.data;
    } else if (input.signal?.aborted) {
      throw new TransientBatchError(OPTIMIZER_ITEM_FAILURE_CODES.CANCELLED);
    } else {
      schemaIssue = zodIssueSummary(parsedFirst.error.issues);
    }
  } catch (error) {
    if (input.signal?.aborted) {
      for (const item of input.batch) {
        batch.results.set(item.itemRef, {
          ok: false,
          failureCode: OPTIMIZER_ITEM_FAILURE_CODES.CANCELLED,
        });
      }
      batch.usage.totalTokens = totalTokens;
      return batch;
    }
    // The runtime validates the same schema and throws before this function
    // can read the object. That throw is the production schema-failure path.
    if (isSchemaConformanceFailure(error)) {
      schemaIssue = error.message.slice(0, 800);
    } else {
      const failureCode =
        error instanceof TransientBatchError
          ? error.failureCode
          : mapProviderFailure(error);
      for (const item of input.batch) {
        batch.results.set(item.itemRef, { ok: false, failureCode });
      }
      batch.usage.totalTokens = totalTokens;
      return batch;
    }
  }

  if (
    !output &&
    schemaIssue &&
    AI_TOOL_OPTIMIZATION_LIMITS.maxSchemaRepairs > 0
  ) {
    try {
      const repair = await run(
        composeBatchPrompt(input.batch, { kind: "schema", issue: schemaIssue }),
        true,
      );
      const parsedRepair = optimizerBatchOutputSchema.safeParse(repair.object);
      if (parsedRepair.success) output = parsedRepair.data;
    } catch (error) {
      if (input.signal?.aborted || !isSchemaConformanceFailure(error)) {
        const failureCode = input.signal?.aborted
          ? OPTIMIZER_ITEM_FAILURE_CODES.CANCELLED
          : error instanceof TransientBatchError
            ? error.failureCode
            : mapProviderFailure(error);
        for (const item of input.batch) {
          batch.results.set(item.itemRef, { ok: false, failureCode });
        }
        batch.usage.totalTokens = totalTokens;
        return batch;
      }
    }
  }

  if (!output) {
    for (const item of input.batch) {
      batch.results.set(item.itemRef, {
        ok: false,
        failureCode: OPTIMIZER_ITEM_FAILURE_CODES.MODEL_OUTPUT_INVALID,
      });
    }
    batch.usage.totalTokens = totalTokens;
    return batch;
  }

  const assessments = assessEnvelope(input.batch, output);
  const repairable = [...assessments.entries()].filter(
    ([, assessment]) => assessment.problems.length > 0,
  );
  if (
    repairable.length > 0 &&
    AI_TOOL_OPTIMIZATION_LIMITS.maxPolicyRepairs > 0 &&
    !input.signal?.aborted
  ) {
    const feedback: OptimizerRepairContext = {
      kind: "policy",
      items: repairable.map(([itemRef, assessment]) => ({
        itemRef,
        problems: assessment.problems,
      })),
    };
    try {
      const repair = await run(composeBatchPrompt(input.batch, feedback), true);
      const parsedRepair = optimizerBatchOutputSchema.safeParse(repair.object);
      if (parsedRepair.success) {
        const repaired = assessEnvelope(input.batch, parsedRepair.data);
        for (const [itemRef, previous] of repairable) {
          const next = repaired.get(itemRef);
          if (next && next.problems.length < previous.problems.length) {
            assessments.set(itemRef, next);
          }
        }
      }
    } catch {
      if (input.signal?.aborted) {
        const failureCode = OPTIMIZER_ITEM_FAILURE_CODES.CANCELLED;
        for (const item of input.batch) {
          batch.results.set(item.itemRef, { ok: false, failureCode });
        }
        batch.usage.totalTokens = totalTokens;
        return batch;
      }
      // A failed policy repair keeps the first valid operations.
    }
  }

  for (const item of input.batch) {
    const assessment = assessments.get(item.itemRef);
    if (!assessment) {
      batch.results.set(item.itemRef, {
        ok: false,
        failureCode: OPTIMIZER_ITEM_FAILURE_CODES.NO_RESULT,
      });
      continue;
    }
    batch.results.set(item.itemRef, {
      ok: true,
      operations: assessment.operations,
      advisories: assessment.advisories,
      rejected: assessment.rejected,
    });
  }
  batch.usage.totalTokens = totalTokens;
  return batch;
}

type BatchEnvelope = {
  results: Array<{
    itemRef: string;
    operations: unknown[];
    advisories: unknown[];
  }>;
};

type ItemAssessment = {
  operations: OptimizerOperation[];
  advisories: OptimizerAdvisory[];
  rejected: OptimizerRejectedDiagnostic[];
  problems: string[];
};

function assessEnvelope(
  items: OptimizerBatchItem[],
  output: BatchEnvelope,
): Map<string, ItemAssessment> {
  const byRef = new Map(
    output.results.map((result) => [result.itemRef, result]),
  );
  const assessments = new Map<string, ItemAssessment>();
  for (const item of items) {
    const result = byRef.get(item.itemRef);
    if (!result) continue;
    assessments.set(
      item.itemRef,
      assessItemOutput(item.snapshot, result.operations, result.advisories),
    );
  }
  return assessments;
}

function assessItemOutput(
  snapshot: OptimizerToolSnapshotV1,
  operations: unknown[],
  advisories: unknown[],
): ItemAssessment {
  const parsed = parseModelItemOutput({ operations, advisories });
  const accepted: OptimizerOperation[] = [];
  const rejected = [...parsed.rejected];
  const problems = parsed.rejected.map((diagnostic) => diagnostic.detail);
  for (const operation of parsed.operations) {
    const diagnostic = validateOptimizerOperation(operation, snapshot);
    if (diagnostic) {
      rejected.push(diagnostic);
      problems.push(describeRejectedOperation(operation, diagnostic.detail));
      continue;
    }
    accepted.push(operation);
  }
  return {
    operations: accepted,
    advisories: parsed.advisories,
    rejected,
    problems,
  };
}

function describeRejectedOperation(
  operation: OptimizerOperation,
  detail: string,
): string {
  const value =
    "value" in operation && typeof operation.value === "string"
      ? redactCredentialText(operation.value).text.slice(0, 120)
      : "";
  const target = "inputId" in operation ? ` input ${operation.inputId}` : "";
  const shown = value ? ` value "${value}"` : "";
  return `${operation.kind}${target}${shown}: ${detail}`.slice(0, 300);
}

function zodIssueSummary(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): string {
  return issues
    .slice(0, 8)
    .map((entry) => `${entry.path.join(".") || "root"}: ${entry.message}`)
    .join("; ")
    .slice(0, 800);
}

/** True when the runtime rejected model output for schema conformance. */
function isSchemaConformanceFailure(error: unknown): error is AppError {
  return (
    error instanceof AppError &&
    error.appCode === APP_ERROR_CODES.AI_MODEL_VERIFICATION_FAILED
  );
}

/** Maps runtime provider failures to stable item failure codes. */
function mapProviderFailure(error: unknown): OptimizerItemFailureCode {
  const status =
    error && typeof error === "object"
      ? ((error as { status?: unknown }).status ?? null)
      : null;
  if (status === 401 || status === 403) {
    return OPTIMIZER_ITEM_FAILURE_CODES.CREDENTIAL_INVALID;
  }
  if (status === 422 || status === 400) {
    return OPTIMIZER_ITEM_FAILURE_CODES.PROVIDER_REJECTED;
  }
  return OPTIMIZER_ITEM_FAILURE_CODES.PROVIDER_TRANSIENT;
}

/** Re-packs items for retry with the same model/scope/prompt policy. */
export function packAnalysisBatches(input: {
  items: OptimizerBatchItem[];
  contextWindowTokens: number | null;
  maxPromptChars?: number;
}): OptimizerBatchItem[][] {
  return packBatches({
    items: input.items,
    contextWindowTokens: input.contextWindowTokens,
    maxPromptChars: input.maxPromptChars ?? 400_000,
  });
}

/* ------------------------------------------------------------------------- *
 * Review artifact construction
 * ------------------------------------------------------------------------- */

export async function loadCompileContext(
  db: DB,
  server: McpServer,
): Promise<OptimizerPolicyCompileContext> {
  const rows = await db
    .select({
      id: mcpServerVariable.id,
      name: mcpServerVariable.name,
      kind: mcpServerVariable.kind,
      owner: mcpServerVariable.owner,
    })
    .from(mcpServerVariable)
    .where(eq(mcpServerVariable.serverId, server.id));
  const commonParsed = mcpCommonEntriesSchema.safeParse(server.commonEntries);
  const authParsed = server.authConfiguration
    ? mcpAuthConfigurationSchema.safeParse(server.authConfiguration)
    : null;
  let basePath = "/";
  try {
    basePath = new URL(server.baseUrl).pathname || "/";
  } catch {
    basePath = "/";
  }
  return {
    common: commonParsed.success
      ? commonParsed.data
      : { headers: [], query: [] },
    auth: authParsed && authParsed.success ? authParsed.data : null,
    serverValues: rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind as "config" | "secret",
      owner: row.owner as "manual" | "auth",
    })),
    basePath,
    allowMutation: false,
  };
}

export type ReviewBuildInput = {
  snapshot: OptimizerToolSnapshotV1;
  /** Canonical definition for draft items; null for OpenAPI candidates. */
  definition: McpRequestDefinition | null;
  operations: OptimizerOperation[];
  advisories: OptimizerAdvisory[];
  preRejected: OptimizerRejectedDiagnostic[];
  compile: OptimizerPolicyCompileContext;
  existingToolNames: string[];
};

/**
 * Builds server-owned review artifacts. Draft items get full canonical
 * validation (parse, compile, collisions, redacted diffs); OpenAPI candidate
 * items get snapshot-level before/after rendering and are fully revalidated
 * during import confirmation.
 */
export function buildReviewForItem(
  input: ReviewBuildInput,
): OptimizerItemReview {
  if (input.definition) {
    return buildItemReview({
      snapshot: input.snapshot,
      definition: input.definition,
      operations: input.operations,
      preRejected: input.preRejected,
      advisories: input.advisories,
      compile: input.compile,
      existingToolNames: input.existingToolNames,
    });
  }
  return buildSnapshotLevelReview(input);
}

type SnapshotState = {
  snapshot: OptimizerToolSnapshotV1;
  toolName: string;
  toolTitle?: string;
  toolDescription?: string;
};

function cloneSnapshot(
  snapshot: OptimizerToolSnapshotV1,
): OptimizerToolSnapshotV1 {
  return JSON.parse(JSON.stringify(snapshot)) as OptimizerToolSnapshotV1;
}

function renderSnapshotQueryEntry(
  entry: OptimizerToolSnapshotV1["query"][number],
): string {
  const serialization = entry.serialization
    ? ` (form${entry.serialization.explode ? ", explode" : ""})`
    : "";
  const omit = entry.omitWhenAbsent ? " [omit when absent]" : "";
  return `${entry.name}={${entry.binding}}${serialization}${omit}`;
}

function renderSnapshotJsonField(field: {
  key: string;
  value: { kind: string; binding?: string };
  omitWhenAbsent?: boolean;
}): string {
  const value =
    field.value.kind === "binding"
      ? `{${field.value.binding}}`
      : `{${field.value.kind}}`;
  return `${field.key}=${value}${field.omitWhenAbsent ? " [omit when absent]" : ""}`;
}

function findSnapshotJsonField(
  snapshot: OptimizerToolSnapshotV1,
  fieldId: string,
): {
  key: string;
  value: { kind: string; binding?: string; agentInputId?: string };
  omitWhenAbsent?: boolean;
} | null {
  if (snapshot.body.bodyType !== "json") return null;
  const visit = (
    node: unknown,
  ): {
    key: string;
    value: { kind: string; binding?: string; agentInputId?: string };
    omitWhenAbsent?: boolean;
  } | null => {
    if (!node || typeof node !== "object") return null;
    const record = node as Record<string, unknown>;
    if (record.kind === "object" && Array.isArray(record.fields)) {
      for (const field of record.fields as Array<Record<string, unknown>>) {
        if (field.id === fieldId) return field as never;
      }
      for (const field of record.fields as Array<Record<string, unknown>>) {
        const found = visit(field.value);
        if (found) return found;
      }
    }
    return null;
  };
  return visit(snapshot.body.root);
}

/**
 * Snapshot-level review for OpenAPI candidates: applies operations to the
 * sanitized snapshot and renders bounded before/after strings. Executable
 * guarded changes are revalidated against the full canonical pipeline at
 * import confirmation.
 */
function buildSnapshotLevelReview(
  input: ReviewBuildInput,
): OptimizerItemReview {
  const rejected: OptimizerRejectedDiagnostic[] = [...input.preRejected];
  const operations: OptimizerReviewOperation[] = [];
  let current: SnapshotState = {
    snapshot: input.snapshot,
    toolName: input.snapshot.name,
    toolTitle: input.snapshot.title,
    toolDescription: input.snapshot.description,
  };

  for (const op of input.operations) {
    // Same fail-closed target validation as the draft path: a policy-invalid
    // operation must never become selectable in review.
    const diagnostic = validateOptimizerOperation(op, input.snapshot, {
      otherToolNames: input.existingToolNames,
    });
    if (diagnostic) {
      rejected.push(diagnostic);
      continue;
    }
    const next: SnapshotState = {
      snapshot: cloneSnapshot(current.snapshot),
      toolName: current.toolName,
      toolTitle: current.toolTitle,
      toolDescription: current.toolDescription,
    };
    let before: string | null = null;
    let after: string = "";
    let targetLabel = "tool";
    let requestDiff: OptimizerRequestDiffLine[] | undefined;

    const inputTarget = (id: string) =>
      current.snapshot.inputs.find(
        (
          i,
        ): i is Extract<
          OptimizerToolSnapshotV1["inputs"][number],
          { sensitivity: "normal" }
        > => i.sensitivity === "normal" && i.id === id,
      );

    switch (op.kind) {
      case "set_tool_name":
        before = current.toolName;
        next.toolName = op.value;
        after = op.value;
        break;
      case "set_tool_title":
        before = current.toolTitle ?? null;
        next.toolTitle = op.value;
        after = op.value;
        break;
      case "set_tool_description":
        before = current.toolDescription ?? null;
        next.toolDescription = op.value;
        after = op.value;
        break;
      case "set_input_name": {
        const target = inputTarget(op.inputId);
        if (!target) {
          rejected.push(
            rejectedDiagnostic("unknown_target", "Unknown agent input."),
          );
          continue;
        }
        targetLabel = `input.${target.name}`;
        before = target.name;
        const nextInput = next.snapshot.inputs.find(
          (
            i,
          ): i is Extract<
            OptimizerToolSnapshotV1["inputs"][number],
            { sensitivity: "normal" }
          > => i.sensitivity === "normal" && i.id === op.inputId,
        )!;
        nextInput.name = op.value;
        after = op.value;
        break;
      }
      case "set_input_description": {
        const target = inputTarget(op.inputId);
        if (!target) {
          rejected.push(
            rejectedDiagnostic("unknown_target", "Unknown agent input."),
          );
          continue;
        }
        targetLabel = `input.${target.name}`;
        before = target.description ?? null;
        const nextInput = next.snapshot.inputs.find(
          (
            i,
          ): i is Extract<
            OptimizerToolSnapshotV1["inputs"][number],
            { sensitivity: "normal" }
          > => i.sensitivity === "normal" && i.id === op.inputId,
        )!;
        nextInput.description = op.value;
        after = op.value;
        break;
      }
      case "set_query_entry_key":
      case "set_query_entry_serialization":
      case "set_query_entry_omit_when_absent":
      case "rebind_query_entry": {
        const entryIndex = current.snapshot.query.findIndex(
          (e) => e.id === op.entryId,
        );
        if (entryIndex === -1) {
          rejected.push(
            rejectedDiagnostic("unknown_target", "Unknown query entry."),
          );
          continue;
        }
        const beforeEntry = current.snapshot.query[entryIndex]!;
        const afterEntry = next.snapshot.query[entryIndex]!;
        targetLabel = `query.${beforeEntry.name}`;
        before = renderSnapshotQueryEntry(beforeEntry);
        if (op.kind === "set_query_entry_key") afterEntry.name = op.value;
        if (op.kind === "set_query_entry_serialization") {
          afterEntry.serialization = { style: "form", explode: op.explode };
        }
        if (op.kind === "set_query_entry_omit_when_absent") {
          afterEntry.omitWhenAbsent = op.value || undefined;
        }
        if (op.kind === "rebind_query_entry") {
          afterEntry.binding = "agentInput";
          afterEntry.agentInputId = op.agentInputId;
        }
        after = renderSnapshotQueryEntry(afterEntry);
        requestDiff =
          before !== after
            ? [{ label: `query.${afterEntry.name}`, before: before!, after }]
            : undefined;
        break;
      }
      case "set_json_field_key":
      case "set_json_field_omit_when_absent":
      case "rebind_json_field": {
        const beforeField = findSnapshotJsonField(current.snapshot, op.fieldId);
        const afterField = findSnapshotJsonField(next.snapshot, op.fieldId);
        if (!beforeField || !afterField) {
          rejected.push(
            rejectedDiagnostic("unknown_target", "Unknown JSON field."),
          );
          continue;
        }
        targetLabel = `body.${beforeField.key}`;
        before = renderSnapshotJsonField(beforeField as never);
        if (op.kind === "set_json_field_key") afterField.key = op.value;
        if (op.kind === "set_json_field_omit_when_absent") {
          afterField.omitWhenAbsent = op.value || undefined;
        }
        if (op.kind === "rebind_json_field") {
          (
            afterField.value as {
              kind: string;
              binding?: string;
              agentInputId?: string;
            }
          ).kind = "binding";
          (
            afterField.value as {
              kind: string;
              binding?: string;
              agentInputId?: string;
            }
          ).binding = "agentInput";
          (
            afterField.value as {
              kind: string;
              binding?: string;
              agentInputId?: string;
            }
          ).agentInputId = op.agentInputId;
        }
        after = renderSnapshotJsonField(afterField as never);
        requestDiff =
          before !== after
            ? [{ label: `body.${afterField.key}`, before: before!, after }]
            : undefined;
        break;
      }
      default:
        rejected.push(
          rejectedDiagnostic("policy_rejected", "Unsupported operation kind."),
        );
        continue;
    }

    const opClass = optimizerOperationClass(op.kind);
    operations.push({
      operationId: op.operationId,
      kind: op.kind,
      class: opClass ?? "guarded",
      targetLabel,
      before,
      after,
      rationale: op.rationale,
      ...(requestDiff ? { requestDiff } : {}),
    });
    current = next;
  }

  return {
    operations,
    advisories: input.advisories,
    rejected,
    sourceOperations: input.operations.filter((op) =>
      operations.some((artifact) => artifact.operationId === op.operationId),
    ),
  };
}

let snapshotRejectedCounter = 0;
function rejectedDiagnostic(
  code:
    | "unknown_target"
    | "policy_rejected"
    | "forbidden_target"
    | "sensitive_target"
    | "name_conflict"
    | "compile_failed"
    | "out_of_bounds",
  detail: string,
): OptimizerRejectedDiagnostic {
  snapshotRejectedCounter = (snapshotRejectedCounter + 1) % 1_000_000;
  return {
    operationId: `rj${snapshotRejectedCounter.toString().padStart(6, "0")}`,
    code,
    detail: detail.slice(0, 300),
  };
}
