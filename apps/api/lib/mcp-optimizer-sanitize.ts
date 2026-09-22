/**
 * @file Pure sanitizer converting a persisted draft tool or a deterministic
 * OpenAPI candidate into `OptimizerToolSnapshotV1`. Excludes base URLs, source
 * URLs, allowed hosts, common headers/query, authentication configuration,
 * query/body literal values, server-value/secret ids, examples, raw templates, raw
 * documents, and provenance. Sensitive inputs keep only structure. Oversized
 * or unparseable tools are ineligible, never silently truncated.
 */
import {
  AI_TOOL_OPTIMIZATION_LIMITS,
  OPTIMIZER_INELIGIBLE_REASONS,
  optimizerIneligibleReasonSchema,
  optimizerToolSnapshotSchema,
  type OptimizerIneligibleReason,
  type OptimizerSnapshotInput,
  type OptimizerSnapshotJsonNode,
  type OptimizerQueryEntry,
  type OptimizerToolSnapshotV1,
} from "./mcp-optimizer-contracts.js";
import { redactCredentialText } from "./openapi-redact.js";
import {
  mcpRequestDefinitionSchema,
  type McpAgentInput,
  type McpCompileIssue,
  type McpJsonNode,
  type McpNamedEntry,
  type McpRequestDefinition,
  type McpValueBinding,
} from "./mcp-request-definition.js";
import { contractFingerprint } from "./mcp-contract.js";

export type OptimizerSanitizeFailure = {
  ok: false;
  reason: OptimizerIneligibleReason;
};

export type OptimizerSanitizeSuccess = {
  ok: true;
  snapshot: OptimizerToolSnapshotV1;
  fingerprint: string;
};

export type OptimizerSanitizeResult =
  OptimizerSanitizeSuccess | OptimizerSanitizeFailure;

export type OptimizerDraftToolSource = {
  kind: "draft";
  toolId: string;
  name: string;
  title: string | null;
  description: string | null;
  method: string;
  /** Raw stored canonical definition JSON; unparseable tools are ineligible. */
  requestDefinition: unknown;
  compileIssues: McpCompileIssue[] | null;
};

export type OptimizerCandidateSource = {
  kind: "openapi";
  operationKey: string;
  name: string;
  title?: string;
  description?: string;
  method: string;
  requestDefinition: McpRequestDefinition;
  compileIssues: McpCompileIssue[];
};

function fail(reason: OptimizerIneligibleReason): OptimizerSanitizeFailure {
  return { ok: false, reason };
}

/** Stable optimization fingerprint: canonical hash of the sanitized snapshot. */
export function computeOptimizerFingerprint(
  snapshot: OptimizerToolSnapshotV1,
): string {
  return contractFingerprint(snapshot);
}

function sanitizeBinding(
  binding: McpValueBinding,
  sensitiveRefs: Map<string, string>,
): "agentInput" | "literal" | "serverValue" | "sensitiveInput" | undefined {
  if (binding.kind === "agentInput") {
    return sensitiveRefs.has(binding.agentInputId)
      ? "sensitiveInput"
      : "agentInput";
  }
  if (binding.kind === "serverValue") return "serverValue";
  return "literal";
}

function sanitizeNamedEntry(
  entry: McpNamedEntry,
  sensitiveRefs: Map<string, string>,
): OptimizerQueryEntry {
  const sanitized: OptimizerQueryEntry = {
    id: entry.id,
    name: entry.name,
    binding: sanitizeBinding(entry.value, sensitiveRefs) ?? "literal",
  };
  if (
    entry.value.kind === "agentInput" &&
    !sensitiveRefs.has(entry.value.agentInputId)
  ) {
    sanitized.agentInputId = entry.value.agentInputId;
  }
  if (entry.omitWhenAbsent) sanitized.omitWhenAbsent = true;
  if (entry.serialization) sanitized.serialization = entry.serialization;
  return sanitized;
}

function sanitizeJsonNode(
  node: McpJsonNode,
  sensitiveRefs: Map<string, string>,
): OptimizerSnapshotJsonNode {
  if (node.kind === "literal") {
    // The literal value itself is excluded; only its JSON type remains.
    return { kind: "literal", jsonType: node.jsonType };
  }
  if (node.kind === "binding") {
    const binding = sanitizeBinding(node.binding, sensitiveRefs);
    const sanitized: OptimizerSnapshotJsonNode = {
      kind: "binding",
      binding: binding ?? "literal",
      jsonType: node.jsonType,
    };
    if (
      node.binding.kind === "agentInput" &&
      !sensitiveRefs.has(node.binding.agentInputId)
    ) {
      sanitized.agentInputId = node.binding.agentInputId;
    }
    if (node.omitWhenAbsent) sanitized.omitWhenAbsent = true;
    return sanitized;
  }
  if (node.kind === "object") {
    return {
      kind: "object",
      fields: node.fields.map((field) => ({
        id: field.id,
        key: field.key,
        value: sanitizeJsonNode(field.value, sensitiveRefs),
        ...(field.omitWhenAbsent ? { omitWhenAbsent: true } : {}),
      })),
    };
  }
  return {
    kind: "array",
    items: node.items.map((item) => sanitizeJsonNode(item, sensitiveRefs)),
  };
}

function sanitizeInputs(inputs: McpAgentInput[]): {
  list: OptimizerSnapshotInput[];
  refs: Map<string, string>;
} {
  // Sensitive inputs get stable synthetic refs so structure stays renderable
  // without exposing names, descriptions, examples, or binding targets.
  const refs = new Map<string, string>();
  inputs.forEach((input, index) => {
    if (input.sensitive) refs.set(input.id, `s${index + 1}`);
  });
  const list: OptimizerSnapshotInput[] = inputs.map((input) => {
    const ref = refs.get(input.id);
    if (ref) {
      return {
        sensitivity: "sensitive",
        ref,
        type: input.type,
        required: input.required,
      };
    }
    return {
      sensitivity: "normal",
      id: input.id,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      type: input.type,
      required: input.required,
    };
  });
  return { list, refs };
}

function sanitizePathShape(
  definition: McpRequestDefinition,
  refs: Map<string, string>,
): OptimizerToolSnapshotV1["pathShape"] {
  return definition.pathSegments.map((segment) => {
    if (segment.value.kind === "agentInput") {
      if (refs.has(segment.value.agentInputId)) {
        return { kind: "sensitiveParameter" } as const;
      }
      return {
        kind: "parameter",
        agentInputId: segment.value.agentInputId,
      } as const;
    }
    if (segment.value.kind !== "literal") {
      return { kind: "literal", text: "redacted" } as const;
    }
    // Route text is documentation the model needs. Credential-shaped spans
    // are replaced; query and body literal values stay excluded elsewhere.
    const redacted = redactCredentialText(String(segment.value.value))
      .text.replace(/\s+/g, " ")
      .trim()
      .slice(0, 128);
    return {
      kind: "literal",
      text: redacted.length > 0 ? redacted : "redacted",
    } as const;
  });
}

function sanitizeBody(
  definition: McpRequestDefinition,
  refs: Map<string, string>,
): OptimizerToolSnapshotV1["body"] {
  const body = definition.body;
  if (body.bodyType === "json") {
    return { bodyType: "json", root: sanitizeJsonNode(body.root, refs) };
  }
  if (body.bodyType === "form") {
    return {
      bodyType: "form",
      fields: body.fields.map((field) => sanitizeNamedEntry(field, refs)),
    };
  }
  if (body.bodyType === "raw") {
    // Raw templates are excluded entirely; only the shape survives.
    return { bodyType: "raw" };
  }
  return { bodyType: "none" };
}

function withinBounds(snapshot: OptimizerToolSnapshotV1): boolean {
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  } catch {
    return false;
  }
  return bytes <= AI_TOOL_OPTIMIZATION_LIMITS.snapshotMaxBytes;
}

function validate(snapshot: OptimizerToolSnapshotV1): OptimizerSanitizeResult {
  const parsed = optimizerToolSnapshotSchema.safeParse(snapshot);
  if (!parsed.success)
    return fail(OPTIMIZER_INELIGIBLE_REASONS.SNAPSHOT_TOO_LARGE);
  if (!withinBounds(parsed.data)) {
    return fail(OPTIMIZER_INELIGIBLE_REASONS.SNAPSHOT_TOO_LARGE);
  }
  return {
    ok: true,
    snapshot: parsed.data,
    fingerprint: computeOptimizerFingerprint(parsed.data),
  };
}

export function sanitizeDraftTool(
  source: OptimizerDraftToolSource,
): OptimizerSanitizeResult {
  const parsedDefinition = mcpRequestDefinitionSchema.safeParse(
    source.requestDefinition,
  );
  if (!parsedDefinition.success) {
    return fail(OPTIMIZER_INELIGIBLE_REASONS.DEFINITION_UNPARSEABLE);
  }
  const definition = parsedDefinition.data;
  const { list: inputs, refs } = sanitizeInputs(definition.agentInputs);
  const snapshot: OptimizerToolSnapshotV1 = {
    snapshotVersion: 1,
    source: "draft",
    toolId: source.toolId,
    name: source.name,
    ...(source.title ? { title: source.title } : {}),
    ...(source.description ? { description: source.description } : {}),
    method: source.method,
    pathShape: sanitizePathShape(definition, refs),
    inputs,
    query: definition.query.map((entry) => sanitizeNamedEntry(entry, refs)),
    headerPresence: {
      names: definition.headers.map((entry) => entry.name),
    },
    body: sanitizeBody(definition, refs),
    issues: (source.compileIssues ?? [])
      .filter((issue) => issue.code && issue.severity)
      .map((issue) => ({
        code: issue.code,
        ...(issue.path ? { path: issue.path.slice(0, 256) } : {}),
        severity: issue.severity,
      })),
  };
  return validate(snapshot);
}

export function sanitizeOpenApiCandidate(
  source: OptimizerCandidateSource,
): OptimizerSanitizeResult {
  const { list: inputs, refs } = sanitizeInputs(
    source.requestDefinition.agentInputs,
  );
  const snapshot: OptimizerToolSnapshotV1 = {
    snapshotVersion: 1,
    source: "openapi",
    operationKey: source.operationKey,
    name: source.name,
    ...(source.title ? { title: source.title } : {}),
    ...(source.description ? { description: source.description } : {}),
    method: source.method,
    pathShape: sanitizePathShape(source.requestDefinition, refs),
    inputs,
    query: source.requestDefinition.query.map((entry) =>
      sanitizeNamedEntry(entry, refs),
    ),
    headerPresence: {
      names: source.requestDefinition.headers.map((entry) => entry.name),
    },
    body: sanitizeBody(source.requestDefinition, refs),
    issues: source.compileIssues
      .filter((issue) => issue.code && issue.severity)
      .map((issue) => ({
        code: issue.code,
        ...(issue.path ? { path: issue.path.slice(0, 256) } : {}),
        severity: issue.severity,
      })),
  };
  return validate(snapshot);
}

export { optimizerIneligibleReasonSchema };
