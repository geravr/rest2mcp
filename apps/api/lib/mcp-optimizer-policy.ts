/**
 * @file `AI_TOOL_OPTIMIZATION_POLICY_V1`: exhaustive operation registry,
 * strict model-output parsing, the in-memory patch engine, advisory
 * normalization, and canonical validation (parsing, ownership/security,
 * compilation, name collisions, redacted effective-request diffs). The policy
 * is fail-closed: anything outside the registry is rejected, never applied.
 */
import {
  AI_TOOL_OPTIMIZATION_LIMITS,
  OPTIMIZER_ADVISORY_CODES,
  OPTIMIZER_REJECTED_CODES,
  optimizerAdvisoryCodeSchema,
  optimizerAdvisorySchema,
  optimizerOperationSchema,
  optimizerRejectedCodeSchema,
  type OptimizerAdvisory,
  type OptimizerItemReview,
  type OptimizerOperation,
  type OptimizerRejectedDiagnostic,
  type OptimizerRequestDiffLine,
  type OptimizerReviewOperation,
  type OptimizerSnapshotInput,
  type OptimizerToolSnapshotV1,
} from "./mcp-optimizer-contracts.js";
import {
  mcpRequestDefinitionSchema,
  mcpValueNameSchema,
  type McpJsonNode,
  type McpNamedEntry,
  type McpRequestDefinition,
  type McpValueBinding,
} from "./mcp-request-definition.js";
import { compileToolDefinition, type CompileContext } from "./mcp-compiler.js";

export const AI_TOOL_OPTIMIZATION_POLICY_VERSION = 1 as const;

/** Kinds this policy version can execute, exactly. */
export const AI_TOOL_OPTIMIZATION_ALLOWED_KINDS: readonly OptimizerOperation["kind"][] =
  [
    "set_tool_name",
    "set_tool_title",
    "set_tool_description",
    "set_input_name",
    "set_input_description",
    "set_query_entry_key",
    "set_query_entry_serialization",
    "set_query_entry_omit_when_absent",
    "rebind_query_entry",
    "rebind_json_field",
    "set_json_field_key",
    "set_json_field_omit_when_absent",
  ];

/* ------------------------------------------------------------------------- *
 * Strict model-output parsing (fail-closed per operation)
 * ------------------------------------------------------------------------- */

export type ParsedModelItem = {
  operations: OptimizerOperation[];
  advisories: OptimizerAdvisory[];
  rejected: OptimizerRejectedDiagnostic[];
};

let rejectedCounter = 0;
function nextRejectedId(): string {
  rejectedCounter = (rejectedCounter + 1) % 1_000_000;
  return `rj${rejectedCounter.toString().padStart(6, "0")}`;
}

function reject(
  code: (typeof OPTIMIZER_REJECTED_CODES)[keyof typeof OPTIMIZER_REJECTED_CODES],
  detail: string,
): OptimizerRejectedDiagnostic {
  return {
    operationId: nextRejectedId(),
    code,
    detail: detail.slice(0, 300),
  };
}

/** Recursively drops any non-plain-data value before validation. */
function plainDataOnly(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((item) => plainDataOnly(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 64)) {
      out[key] = plainDataOnly(item, depth + 1);
    }
    return out;
  }
  return null;
}

/** Parses one item's raw model payload; invalid entries become diagnostics. */
export function parseModelItemOutput(raw: unknown): ParsedModelItem {
  const operations: OptimizerOperation[] = [];
  const advisories: OptimizerAdvisory[] = [];
  const rejected: OptimizerRejectedDiagnostic[] = [];
  const seenOperationIds = new Set<string>();

  const source = plainDataOnly(raw);
  const record = (source ?? {}) as Record<string, unknown>;
  const rawOperations = Array.isArray(record.operations)
    ? record.operations.slice(
        0,
        AI_TOOL_OPTIMIZATION_LIMITS.maxOperationsPerItem * 2,
      )
    : [];
  const rawAdvisories = Array.isArray(record.advisories)
    ? record.advisories.slice(
        0,
        AI_TOOL_OPTIMIZATION_LIMITS.maxAdvisoriesPerItem * 2,
      )
    : [];

  for (const entry of rawOperations) {
    const parsed = optimizerOperationSchema.safeParse(entry);
    if (!parsed.success) {
      rejected.push(
        reject(
          OPTIMIZER_REJECTED_CODES.SCHEMA_INVALID,
          "The recommendation did not match the strict operation schema.",
        ),
      );
      continue;
    }
    const op = parsed.data;
    if (!AI_TOOL_OPTIMIZATION_ALLOWED_KINDS.includes(op.kind)) {
      rejected.push(
        reject(
          OPTIMIZER_REJECTED_CODES.POLICY_REJECTED,
          `Operation kind "${op.kind}" is not allowed by the policy.`,
        ),
      );
      continue;
    }
    if (seenOperationIds.has(op.operationId)) {
      rejected.push(
        reject(
          OPTIMIZER_REJECTED_CODES.DUPLICATE_OPERATION,
          "Duplicate operation id in one item.",
        ),
      );
      continue;
    }
    seenOperationIds.add(op.operationId);
    if (operations.length >= AI_TOOL_OPTIMIZATION_LIMITS.maxOperationsPerItem) {
      rejected.push(
        reject(OPTIMIZER_REJECTED_CODES.OUT_OF_BOUNDS, "Too many operations."),
      );
      continue;
    }
    operations.push(op);
  }

  for (const entry of rawAdvisories) {
    const candidate = plainDataOnly(entry) as Record<string, unknown> | null;
    if (!candidate) continue;
    const code = optimizerAdvisoryCodeSchema.safeParse(candidate.code);
    const rationale =
      typeof candidate.rationale === "string" ? candidate.rationale : "";
    const advisory = optimizerAdvisorySchema.safeParse({
      advisoryId:
        typeof candidate.advisoryId === "string" && candidate.advisoryId
          ? candidate.advisoryId.slice(0, 64)
          : nextRejectedId(),
      code: code.success
        ? code.data
        : OPTIMIZER_ADVISORY_CODES.UNSUPPORTED_RESTRUCTURING,
      rationale,
    });
    if (advisory.success) {
      // Advisories never retain machine-applicable values; only the bounded
      // rationale and normalized code survive.
      advisories.push(advisory.data);
    }
    if (advisories.length >= AI_TOOL_OPTIMIZATION_LIMITS.maxAdvisoriesPerItem) {
      break;
    }
  }

  return { operations, advisories, rejected };
}

/* ------------------------------------------------------------------------- *
 * Snapshot target resolution
 * ------------------------------------------------------------------------- */

type QueryTarget = {
  entryId: string;
  boundInputId: string | null;
  boundSensitive: boolean;
};

function resolveSnapshotTargets(snapshot: OptimizerToolSnapshotV1) {
  const inputsById = new Map<string, OptimizerSnapshotInput>();
  for (const input of snapshot.inputs) {
    if (input.sensitivity === "normal") inputsById.set(input.id, input);
  }
  const normalInputIds = new Set(inputsById.keys());

  const queryById = new Map<string, QueryTarget>();
  for (const entry of snapshot.query) {
    queryById.set(entry.id, {
      entryId: entry.id,
      boundInputId: entry.agentInputId ?? null,
      boundSensitive: entry.binding === "sensitiveInput",
    });
  }

  const jsonFields = new Map<
    string,
    {
      boundInputId: string | null;
      boundSensitive: boolean;
      bindingKind: string | undefined;
      path: string;
    }
  >();
  if (snapshot.body.bodyType === "json") {
    const visit = (node: unknown, path: string): void => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.kind === "object" && Array.isArray(record.fields)) {
        for (const field of record.fields as Array<Record<string, unknown>>) {
          if (typeof field.id !== "string") continue;
          const value = field.value as Record<string, unknown> | undefined;
          const binding =
            value && value.kind === "binding"
              ? (value.binding as string)
              : undefined;
          jsonFields.set(field.id, {
            boundInputId:
              binding === "agentInput" &&
              typeof value!.agentInputId === "string"
                ? value!.agentInputId
                : null,
            boundSensitive: binding === "sensitiveInput",
            bindingKind: binding,
            path: `${path}.${String(field.key)}`,
          });
          visit(value, `${path}.${String(field.key)}`);
        }
      }
    };
    visit(snapshot.body.root, "body");
  }

  return { inputsById, normalInputIds, queryById, jsonFields };
}

function policyReject(
  code:
    | "unknown_target"
    | "sensitive_target"
    | "forbidden_target"
    | "policy_rejected"
    | "out_of_bounds"
    | "name_conflict"
    | "compile_failed",
  detail: string,
): OptimizerRejectedDiagnostic {
  return {
    operationId: nextRejectedId(),
    code: optimizerRejectedCodeSchema.parse(code),
    detail: detail.slice(0, 300),
  };
}

/* ------------------------------------------------------------------------- *
 * In-memory patch engine (canonical ids and immutable fields preserved)
 * ------------------------------------------------------------------------- */

function mapBindingForRebind(
  binding: McpValueBinding,
  agentInputId: string,
): McpValueBinding {
  return binding.kind === "agentInput" ||
    binding.kind === "serverValue" ||
    binding.kind === "literal"
    ? { kind: "agentInput", agentInputId }
    : binding;
}

function cloneJson(node: McpJsonNode): McpJsonNode {
  if (node.kind === "object") {
    return {
      kind: "object",
      fields: node.fields.map((field) => ({
        ...field,
        value: cloneJson(field.value),
      })),
    };
  }
  if (node.kind === "array") {
    return { kind: "array", items: node.items.map(cloneJson) };
  }
  return { ...node };
}

function cloneDefinition(
  definition: McpRequestDefinition,
): McpRequestDefinition {
  return {
    ...definition,
    pathSegments: definition.pathSegments.map((s) => ({ ...s })),
    query: definition.query.map((e) => ({ ...e })),
    headers: definition.headers.map((e) => ({ ...e })),
    body:
      definition.body.bodyType === "json"
        ? { bodyType: "json", root: cloneJson(definition.body.root) }
        : definition.body.bodyType === "form"
          ? {
              bodyType: "form",
              fields: definition.body.fields.map((f) => ({ ...f })),
            }
          : definition.body,
    agentInputs: definition.agentInputs.map((i) => ({ ...i })),
  };
}

export type OptimizerPatchState = {
  definition: McpRequestDefinition;
  toolName: string;
  toolTitle: string | undefined;
  toolDescription: string | undefined;
};

/**
 * Applies one executable operation to a fresh copy of the definition and
 * metadata. Returns null when the target does not exist in the definition.
 */
export function applyOptimizerOperation(
  input: OptimizerPatchState,
  operation: OptimizerOperation,
): OptimizerPatchState | null {
  const next = {
    definition: cloneDefinition(input.definition),
    toolName: input.toolName,
    toolTitle: input.toolTitle,
    toolDescription: input.toolDescription,
  };
  const def = next.definition;

  switch (operation.kind) {
    case "set_tool_name":
      next.toolName = operation.value;
      break;
    case "set_tool_title":
      next.toolTitle = operation.value;
      break;
    case "set_tool_description":
      next.toolDescription = operation.value;
      break;
    case "set_input_name": {
      const target = def.agentInputs.find((i) => i.id === operation.inputId);
      if (!target) return null;
      target.name = operation.value;
      break;
    }
    case "set_input_description": {
      const target = def.agentInputs.find((i) => i.id === operation.inputId);
      if (!target) return null;
      target.description = operation.value;
      break;
    }
    case "set_query_entry_key": {
      const target = def.query.find((e) => e.id === operation.entryId);
      if (!target) return null;
      target.name = operation.value;
      break;
    }
    case "set_query_entry_serialization": {
      const target = def.query.find((e) => e.id === operation.entryId);
      if (!target) return null;
      target.serialization = { style: "form", explode: operation.explode };
      break;
    }
    case "set_query_entry_omit_when_absent": {
      const target = def.query.find((e) => e.id === operation.entryId);
      if (!target) return null;
      target.omitWhenAbsent = operation.value || undefined;
      break;
    }
    case "rebind_query_entry": {
      const target = def.query.find((e) => e.id === operation.entryId);
      if (!target) return null;
      target.value = mapBindingForRebind(target.value, operation.agentInputId);
      break;
    }
    case "set_json_field_key": {
      const applied = applyToJsonField(def, operation.fieldId, (field) => {
        field.key = operation.value;
        return true;
      });
      if (!applied) return null;
      break;
    }
    case "set_json_field_omit_when_absent": {
      const applied = applyToJsonField(def, operation.fieldId, (field) => {
        field.omitWhenAbsent = operation.value || undefined;
        return true;
      });
      if (!applied) return null;
      break;
    }
    case "rebind_json_field": {
      const applied = applyToJsonBinding(def, operation.fieldId, (binding) =>
        mapBindingForRebind(binding, operation.agentInputId),
      );
      if (!applied) return null;
      break;
    }
    default:
      return null;
  }
  return next;
}

function applyToJsonField(
  def: McpRequestDefinition,
  fieldId: string,
  mutate: (field: {
    id: string;
    key: string;
    value: McpJsonNode;
    omitWhenAbsent?: boolean;
  }) => boolean,
): boolean {
  if (def.body.bodyType !== "json") return false;
  const visit = (node: McpJsonNode): boolean => {
    if (node.kind !== "object") return false;
    for (const field of node.fields) {
      if (field.id === fieldId) return mutate(field);
    }
    for (const field of node.fields) {
      if (visit(field.value)) return true;
    }
    return false;
  };
  return visit(def.body.root);
}

function applyToJsonBinding(
  def: McpRequestDefinition,
  fieldId: string,
  mapBinding: (binding: McpValueBinding) => McpValueBinding,
): boolean {
  if (def.body.bodyType !== "json") return false;
  const visit = (node: McpJsonNode): boolean => {
    if (node.kind !== "object") return false;
    for (const field of node.fields) {
      if (field.id === fieldId) {
        if (field.value.kind !== "binding") return false;
        field.value = {
          ...field.value,
          binding: mapBinding(field.value.binding),
        };
        return true;
      }
    }
    for (const field of node.fields) {
      if (visit(field.value)) return true;
    }
    return false;
  };
  return visit(def.body.root);
}

/* ------------------------------------------------------------------------- *
 * Redacted effective-request rendering
 * ------------------------------------------------------------------------- */

function renderBinding(binding: McpValueBinding): string {
  switch (binding.kind) {
    case "agentInput":
      return `{input}`;
    case "serverValue":
      return `{serverValue}`;
    case "literal":
      return `{literal}`;
  }
}

function renderEntry(entry: McpNamedEntry): string {
  const serialization = entry.serialization
    ? ` (form${entry.serialization.explode ? ", explode" : ""})`
    : "";
  const omit = entry.omitWhenAbsent ? " [omit when absent]" : "";
  return `${entry.name}=${renderBinding(entry.value)}${serialization}${omit}`;
}

function findQueryEntry(
  def: McpRequestDefinition,
  entryId: string,
): McpNamedEntry | null {
  return def.query.find((e) => e.id === entryId) ?? null;
}

function findJsonField(
  def: McpRequestDefinition,
  fieldId: string,
): { key: string; value: McpJsonNode; omitWhenAbsent?: boolean } | null {
  if (def.body.bodyType !== "json") return null;
  const visit = (
    node: McpJsonNode,
  ): { key: string; value: McpJsonNode; omitWhenAbsent?: boolean } | null => {
    if (node.kind !== "object") return null;
    for (const field of node.fields) {
      if (field.id === fieldId) return field;
    }
    for (const field of node.fields) {
      const found = visit(field.value);
      if (found) return found;
    }
    return null;
  };
  return visit(def.body.root);
}

function renderJsonField(field: {
  key: string;
  value: McpJsonNode;
  omitWhenAbsent?: boolean;
}): string {
  const value =
    field.value.kind === "binding"
      ? renderBinding(field.value.binding)
      : field.value.kind === "literal"
        ? `{${field.value.jsonType}}`
        : `{${field.value.kind}}`;
  return `${field.key}=${value}${field.omitWhenAbsent ? " [omit when absent]" : ""}`;
}

/* ------------------------------------------------------------------------- *
 * Validation and review generation
 * ------------------------------------------------------------------------- */

export type OptimizerPolicyCompileContext = Omit<
  CompileContext,
  "definition" | "method"
>;

export type BuildItemReviewInput = {
  snapshot: OptimizerToolSnapshotV1;
  definition: McpRequestDefinition;
  operations: OptimizerOperation[];
  /** Diagnostics produced by strict parsing before this step. */
  preRejected: OptimizerRejectedDiagnostic[];
  advisories: OptimizerAdvisory[];
  compile: OptimizerPolicyCompileContext;
  existingToolNames: string[];
};

/**
 * Validates every parsed operation against the current policy, applies it in
 * memory, and produces server-owned review artifacts. One invalid operation is
 * recorded as rejected and can never contaminate the others.
 */
export function buildItemReview(
  input: BuildItemReviewInput,
): OptimizerItemReview {
  const rejected: OptimizerRejectedDiagnostic[] = [...input.preRejected];
  const operations: OptimizerReviewOperation[] = [];
  const targets = resolveSnapshotTargets(input.snapshot);
  const otherToolNames = new Set(
    input.existingToolNames.filter((name) => name !== input.snapshot.name),
  );

  // Parse the canonical definition once; a definition that cannot re-parse
  // fails closed for guarded operations only.
  const baseParsed = mcpRequestDefinitionSchema.safeParse(input.definition);

  let current = {
    definition: input.definition,
    toolName: input.snapshot.name,
    toolTitle: input.snapshot.title,
    toolDescription: input.snapshot.description,
  };

  for (const op of input.operations) {
    const diagnostic = validateOperation(op, targets, {
      normalInputIds: targets.normalInputIds,
      otherToolNames,
      currentName: current.toolName,
      baseParsedOk: baseParsed.success,
    });
    if (diagnostic) {
      rejected.push(diagnostic);
      continue;
    }

    const applied = applyOptimizerOperation(current, op);
    if (!applied) {
      rejected.push(
        policyReject(
          "unknown_target",
          "The operation target does not exist in this tool.",
        ),
      );
      continue;
    }

    const reparsed = mcpRequestDefinitionSchema.safeParse(applied.definition);
    if (!reparsed.success) {
      rejected.push(
        policyReject(
          "policy_rejected",
          "The patched definition is not a valid canonical definition.",
        ),
      );
      continue;
    }

    if (
      op.kind !== "set_tool_name" &&
      op.kind !== "set_tool_title" &&
      op.kind !== "set_tool_description"
    ) {
      const result = compileToolDefinition({
        ...input.compile,
        method: input.snapshot.method,
        definition: reparsed.data,
      });
      if (!result.ok) {
        rejected.push(
          policyReject(
            "compile_failed",
            `Compilation failed: ${result.issues[0]?.message ?? "unknown issue"}`,
          ),
        );
        continue;
      }
    }

    const requestDiff = buildRequestDiff(input.definition, reparsed.data, op);
    operations.push({
      operationId: op.operationId,
      kind: op.kind,
      class:
        op.kind.startsWith("set_tool") || op.kind.startsWith("set_input")
          ? "safe"
          : "guarded",
      targetLabel: resolveTargetLabel(op, input),
      before: resolveBefore(op, current, input.definition),
      after: resolveAfter(op, applied),
      rationale: op.rationale,
      ...(requestDiff.length > 0 ? { requestDiff } : {}),
    });

    current = applied;
  }

  return {
    operations,
    advisories: input.advisories,
    rejected,
    // Persist only operations that passed validation for this item; a
    // rejected operation must never become selectable at apply time.
    sourceOperations: input.operations.filter((op) =>
      operations.some((artifact) => artifact.operationId === op.operationId),
    ),
  };
}

/**
 * Validates one parsed operation against a snapshot without applying it.
 * Used by review builders that must fail closed before showing selections.
 */
export function validateOptimizerOperation(
  op: OptimizerOperation,
  snapshot: OptimizerToolSnapshotV1,
  options?: { otherToolNames?: string[] },
): OptimizerRejectedDiagnostic | null {
  const targets = resolveSnapshotTargets(snapshot);
  return validateOperation(op, targets, {
    normalInputIds: targets.normalInputIds,
    otherToolNames: new Set(
      (options?.otherToolNames ?? []).filter((name) => name !== snapshot.name),
    ),
    currentName: snapshot.name,
    baseParsedOk: true,
  });
}

/* ------------------------------------------------------------------------- *
 * Apply-time revalidation (fail closed)
 * ------------------------------------------------------------------------- */

export type ApplySelectedResult =
  | { ok: true; state: OptimizerPatchState }
  | { ok: false; rejected: OptimizerRejectedDiagnostic[] };

/**
 * Revalidates selected operations against the current policy and applies them
 * in memory. Used by draft application and import confirmation: any invalid
 * operation fails the whole batch closed.
 */
export function applySelectedOperations(input: {
  snapshot: OptimizerToolSnapshotV1;
  definition: McpRequestDefinition;
  startName: string;
  startTitle?: string;
  startDescription?: string;
  operations: OptimizerOperation[];
  compile: OptimizerPolicyCompileContext;
  existingToolNames: string[];
}): ApplySelectedResult {
  const rejected: OptimizerRejectedDiagnostic[] = [];
  const targets = resolveSnapshotTargets(input.snapshot);
  const otherToolNames = new Set(
    input.existingToolNames.filter((name) => name !== input.startName),
  );
  let current: OptimizerPatchState = {
    definition: input.definition,
    toolName: input.startName,
    toolTitle: input.startTitle,
    toolDescription: input.startDescription,
  };

  for (const op of input.operations) {
    const diagnostic = validateOperation(op, targets, {
      normalInputIds: targets.normalInputIds,
      otherToolNames,
      currentName: current.toolName,
      baseParsedOk: true,
    });
    if (diagnostic) {
      rejected.push(diagnostic);
      continue;
    }
    const applied = applyOptimizerOperation(current, op);
    if (!applied) {
      rejected.push(
        policyReject(
          "unknown_target",
          "The operation target no longer exists.",
        ),
      );
      continue;
    }
    const reparsed = mcpRequestDefinitionSchema.safeParse(applied.definition);
    if (!reparsed.success) {
      rejected.push(
        policyReject(
          "policy_rejected",
          "The patched definition is not a valid canonical definition.",
        ),
      );
      continue;
    }
    if (
      op.kind !== "set_tool_name" &&
      op.kind !== "set_tool_title" &&
      op.kind !== "set_tool_description"
    ) {
      const result = compileToolDefinition({
        ...input.compile,
        method: input.snapshot.method,
        definition: reparsed.data,
      });
      if (!result.ok) {
        rejected.push(
          policyReject(
            "compile_failed",
            `Compilation failed: ${result.issues[0]?.message ?? "unknown issue"}`,
          ),
        );
        continue;
      }
    }
    current = { ...applied, definition: reparsed.data };
  }

  if (rejected.length > 0) return { ok: false, rejected };
  return { ok: true, state: current };
}

function validateOperation(
  op: OptimizerOperation,
  targets: ReturnType<typeof resolveSnapshotTargets>,
  context: {
    normalInputIds: Set<string>;
    otherToolNames: Set<string>;
    currentName: string;
    baseParsedOk: boolean;
  },
): OptimizerRejectedDiagnostic | null {
  switch (op.kind) {
    case "set_tool_name": {
      if (op.value === context.currentName) return null;
      if (!mcpValueNameSchema.safeParse(op.value).success) {
        return policyReject(
          "policy_rejected",
          "Tool names must match ^[a-z][a-z0-9_]*$.",
        );
      }
      if (context.otherToolNames.has(op.value)) {
        return policyReject(
          "name_conflict",
          `Tool name "${op.value}" is already used.`,
        );
      }
      return null;
    }
    case "set_tool_title":
    case "set_tool_description":
      return null;
    case "set_input_name":
    case "set_input_description": {
      const input = targets.inputsById.get(op.inputId);
      if (!input) {
        return policyReject(
          "unknown_target",
          "The referenced agent input does not exist or is sensitive.",
        );
      }
      if (
        op.kind === "set_input_name" &&
        !mcpValueNameSchema.safeParse(op.value).success
      ) {
        return policyReject(
          "policy_rejected",
          "Input names must match ^[a-z][a-z0-9_]*$.",
        );
      }
      return null;
    }
    case "set_query_entry_key":
    case "set_query_entry_serialization":
    case "rebind_query_entry": {
      const entry = targets.queryById.get(op.entryId);
      if (!entry) return policyReject("unknown_target", "Unknown query entry.");
      if (op.kind === "rebind_query_entry") {
        if (!context.normalInputIds.has(op.agentInputId)) {
          return policyReject(
            "sensitive_target",
            "Rebind targets must reference existing non-sensitive inputs.",
          );
        }
      }
      return null;
    }
    case "set_query_entry_omit_when_absent": {
      const entry = targets.queryById.get(op.entryId);
      if (!entry) return policyReject("unknown_target", "Unknown query entry.");
      if (entry.boundSensitive || !entry.boundInputId) {
        return policyReject(
          "forbidden_target",
          "Omission flags require a bound non-sensitive agent input.",
        );
      }
      const bound = targets.inputsById.get(entry.boundInputId);
      if (!bound || bound.required) {
        return policyReject(
          "forbidden_target",
          "Omission flags require an optional bound input.",
        );
      }
      return null;
    }
    case "rebind_json_field": {
      const field = targets.jsonFields.get(op.fieldId);
      if (!field) return policyReject("unknown_target", "Unknown JSON field.");
      if (!context.normalInputIds.has(op.agentInputId)) {
        return policyReject(
          "sensitive_target",
          "Rebind targets must reference existing non-sensitive inputs.",
        );
      }
      return null;
    }
    case "set_json_field_key":
    case "set_json_field_omit_when_absent": {
      const field = targets.jsonFields.get(op.fieldId);
      if (!field) return policyReject("unknown_target", "Unknown JSON field.");
      if (op.kind === "set_json_field_omit_when_absent") {
        if (field.boundSensitive || field.bindingKind !== "agentInput") {
          return policyReject(
            "forbidden_target",
            "Omission flags require a bound non-sensitive agent input.",
          );
        }
        const bound = field.boundInputId
          ? targets.inputsById.get(field.boundInputId)
          : undefined;
        if (!bound || bound.required) {
          return policyReject(
            "forbidden_target",
            "Omission flags require an optional bound input.",
          );
        }
      }
      return null;
    }
    default: {
      // Exhaustiveness: unknown kinds can never reach here.
      return policyReject("policy_rejected", "Unsupported operation kind.");
    }
  }
}

function resolveTargetLabel(
  op: OptimizerOperation,
  input: BuildItemReviewInput,
): string {
  switch (op.kind) {
    case "set_tool_name":
    case "set_tool_title":
    case "set_tool_description":
      return "tool";
    case "set_input_name":
    case "set_input_description": {
      const found = input.definition.agentInputs.find(
        (i) => i.id === op.inputId,
      );
      return `input.${found?.name ?? op.inputId}`;
    }
    case "set_query_entry_key":
    case "set_query_entry_serialization":
    case "set_query_entry_omit_when_absent":
    case "rebind_query_entry": {
      const found = input.definition.query.find((e) => e.id === op.entryId);
      return `query.${found?.name ?? op.entryId}`;
    }
    case "rebind_json_field":
    case "set_json_field_key":
    case "set_json_field_omit_when_absent": {
      const found = findJsonField(input.definition, op.fieldId);
      return `body.${found?.key ?? op.fieldId}`;
    }
    default:
      return "tool";
  }
}

function resolveBefore(
  op: OptimizerOperation,
  current: { toolName: string; toolTitle?: string; toolDescription?: string },
  definition: McpRequestDefinition,
): string | null {
  switch (op.kind) {
    case "set_tool_name":
      return current.toolName;
    case "set_tool_title":
      return current.toolTitle ?? null;
    case "set_tool_description":
      return current.toolDescription ?? null;
    case "set_input_name":
    case "set_input_description": {
      const found = definition.agentInputs.find((i) => i.id === op.inputId);
      if (!found) return null;
      return op.kind === "set_input_name"
        ? found.name
        : (found.description ?? null);
    }
    case "set_query_entry_key":
    case "set_query_entry_serialization":
    case "set_query_entry_omit_when_absent":
    case "rebind_query_entry": {
      const found = findQueryEntry(definition, op.entryId);
      return found ? renderEntry(found) : null;
    }
    case "rebind_json_field":
    case "set_json_field_key":
    case "set_json_field_omit_when_absent": {
      const found = findJsonField(definition, op.fieldId);
      return found ? renderJsonField(found) : null;
    }
    default:
      return null;
  }
}

function resolveAfter(
  op: OptimizerOperation,
  applied: {
    definition: McpRequestDefinition;
    toolName: string;
    toolTitle?: string;
    toolDescription?: string;
  },
): string {
  switch (op.kind) {
    case "set_tool_name":
      return applied.toolName;
    case "set_tool_title":
      return applied.toolTitle ?? "";
    case "set_tool_description":
      return applied.toolDescription ?? "";
    case "set_input_name":
    case "set_input_description": {
      const found = applied.definition.agentInputs.find(
        (i) => i.id === (op as { inputId: string }).inputId,
      );
      return op.kind === "set_input_name"
        ? (found?.name ?? "")
        : (found?.description ?? "");
    }
    case "set_query_entry_key":
    case "set_query_entry_serialization":
    case "set_query_entry_omit_when_absent":
    case "rebind_query_entry": {
      const found = findQueryEntry(
        applied.definition,
        (op as { entryId: string }).entryId,
      );
      return found ? renderEntry(found) : "";
    }
    case "rebind_json_field":
    case "set_json_field_key":
    case "set_json_field_omit_when_absent": {
      const found = findJsonField(
        applied.definition,
        (op as { fieldId: string }).fieldId,
      );
      return found ? renderJsonField(found) : "";
    }
    default:
      return "";
  }
}

/** Builds redacted before/after lines for the affected request location. */
function buildRequestDiff(
  before: McpRequestDefinition,
  after: McpRequestDefinition,
  op: OptimizerOperation,
): OptimizerRequestDiffLine[] {
  if (
    op.kind === "set_tool_name" ||
    op.kind === "set_tool_title" ||
    op.kind === "set_tool_description" ||
    op.kind === "set_input_name" ||
    op.kind === "set_input_description"
  ) {
    return [];
  }
  if (
    op.kind === "set_query_entry_key" ||
    op.kind === "set_query_entry_serialization" ||
    op.kind === "set_query_entry_omit_when_absent" ||
    op.kind === "rebind_query_entry"
  ) {
    const beforeEntry = findQueryEntry(before, op.entryId);
    const afterEntry = findQueryEntry(after, op.entryId);
    if (!beforeEntry || !afterEntry) return [];
    const label = `query.${afterEntry.name}`;
    const beforeText = renderEntry(beforeEntry);
    const afterText = renderEntry(afterEntry);
    if (beforeText === afterText) return [];
    return [{ label, before: beforeText, after: afterText }];
  }
  const beforeField = findJsonField(before, op.fieldId);
  const afterField = findJsonField(after, op.fieldId);
  if (!beforeField || !afterField) return [];
  const label = `body.${afterField.key}`;
  const beforeText = renderJsonField(beforeField);
  const afterText = renderJsonField(afterField);
  if (beforeText === afterText) return [];
  return [{ label, before: beforeText, after: afterText }];
}
