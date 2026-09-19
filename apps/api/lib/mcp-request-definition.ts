/**
 * @file Versioned MCP request-definition schemas, bindings, auth config,
 * server values, and structured execution envelopes shared by Studio, gateway,
 * Platform MCP, and the compiler.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MCP_REQUEST_DEFINITION_VERSION } from "./mcp-policy.js";

export const mcpValueNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "Must match [a-z][a-z0-9_]*");

export const mcpBindingIdSchema = z.string().min(1).max(64);
export const mcpServerValueIdSchema = z.string().min(1).max(64);
export const mcpAgentInputIdSchema = z.string().min(1).max(64);

/** Payload limits for versioned request definitions, shared by tRPC and Platform MCP. */
export const MCP_DEFINITION_LIMITS = {
  pathSegments: 32,
  namedEntries: 60,
  agentInputs: 40,
  rawBindings: 40,
  jsonNodes: 400,
  jsonDepth: 32,
} as const;

export const mcpLiteralBindingSchema = z.strictObject({
  kind: z.literal("literal"),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

export const mcpServerValueBindingSchema = z.strictObject({
  kind: z.literal("serverValue"),
  serverValueId: mcpServerValueIdSchema,
  prefix: z.string().max(256).optional(),
  suffix: z.string().max(256).optional(),
});

export const mcpAgentInputBindingSchema = z.strictObject({
  kind: z.literal("agentInput"),
  agentInputId: mcpAgentInputIdSchema,
});

export const mcpValueBindingSchema = z.discriminatedUnion("kind", [
  mcpLiteralBindingSchema,
  mcpServerValueBindingSchema,
  mcpAgentInputBindingSchema,
]);

export type McpValueBinding = z.infer<typeof mcpValueBindingSchema>;

export const mcpNamedEntrySchema = z.strictObject({
  id: mcpBindingIdSchema,
  name: z.string().min(1).max(256),
  value: mcpValueBindingSchema,
  /** When true and the bound agent input is absent, omit this entry. */
  omitWhenAbsent: z.boolean().optional(),
});

export type McpNamedEntry = z.infer<typeof mcpNamedEntrySchema>;

export const mcpPathSegmentSchema = z.strictObject({
  id: mcpBindingIdSchema,
  value: mcpValueBindingSchema,
});

export type McpPathSegment = z.infer<typeof mcpPathSegmentSchema>;

export const mcpJsonNodeSchema: z.ZodType<McpJsonNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("literal"),
      jsonType: z.enum(["string", "number", "boolean", "null"]),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
    z.strictObject({
      kind: z.literal("binding"),
      binding: mcpValueBindingSchema,
      jsonType: z.enum(["string", "number", "boolean", "null", "any"]),
      omitWhenAbsent: z.boolean().optional(),
    }),
    z.strictObject({
      kind: z.literal("object"),
      fields: z.array(
        z.strictObject({
          id: mcpBindingIdSchema,
          key: z.string().min(1).max(256),
          value: mcpJsonNodeSchema,
          omitWhenAbsent: z.boolean().optional(),
        }),
      ),
    }),
    z.strictObject({
      kind: z.literal("array"),
      items: z.array(mcpJsonNodeSchema),
    }),
  ]),
);

export type McpJsonNode =
  | {
      kind: "literal";
      jsonType: "string" | "number" | "boolean" | "null";
      value: string | number | boolean | null;
    }
  | {
      kind: "binding";
      binding: McpValueBinding;
      jsonType: "string" | "number" | "boolean" | "null" | "any";
      omitWhenAbsent?: boolean;
    }
  | {
      kind: "object";
      fields: Array<{
        id: string;
        key: string;
        value: McpJsonNode;
        omitWhenAbsent?: boolean;
      }>;
    }
  | {
      kind: "array";
      items: McpJsonNode[];
    };

export const mcpAgentInputTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "integer",
  "json",
]);

export const mcpAgentInputSchema = z.strictObject({
  id: mcpAgentInputIdSchema,
  name: mcpValueNameSchema,
  description: z.string().max(2000).optional(),
  required: z.boolean(),
  sensitive: z.boolean().default(false),
  type: mcpAgentInputTypeSchema,
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  pattern: z.string().max(512).optional(),
  /** Supported string format preserved in the advertised schema and runtime. */
  format: z.enum(["date", "date-time", "email", "uri", "uuid"]).optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  examples: z.array(z.unknown()).max(8).optional(),
  allowEmpty: z.boolean().optional(),
});

export type McpAgentInput = z.infer<typeof mcpAgentInputSchema>;

export const mcpBehaviorAnnotationsSchema = z.strictObject({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

export type McpBehaviorAnnotations = z.infer<
  typeof mcpBehaviorAnnotationsSchema
>;

export const mcpRawBindingSchema = z.strictObject({
  id: mcpBindingIdSchema,
  binding: mcpValueBindingSchema,
});

export const mcpBodyDefinitionSchema = z.discriminatedUnion("bodyType", [
  z.strictObject({
    bodyType: z.literal("json"),
    root: mcpJsonNodeSchema,
  }),
  z.strictObject({
    bodyType: z.literal("form"),
    fields: z
      .array(mcpNamedEntrySchema)
      .max(MCP_DEFINITION_LIMITS.namedEntries),
  }),
  z.strictObject({
    bodyType: z.literal("raw"),
    contentType: z.string().max(256).optional(),
    bindings: z
      .array(mcpRawBindingSchema)
      .max(MCP_DEFINITION_LIMITS.rawBindings),
    template: z.string().max(256_000),
  }),
  z.strictObject({
    bodyType: z.literal("none"),
  }),
]);

export type McpBodyDefinition = z.infer<typeof mcpBodyDefinitionSchema>;

export type McpDefinitionIdScan = {
  /** Every definition-local id in declaration order. */
  ids: string[];
  /** Stable id and path for every agent-input reference. */
  agentInputRefs: Array<{ id: string; path: string }>;
  /** Stable id and path for every server-value reference. */
  serverValueRefs: Array<{ id: string; path: string }>;
  /** Declared raw-body binding ids. */
  rawBindingIds: string[];
  /** Recursive JSON node count. */
  jsonNodeCount: number;
  /** Maximum observed JSON nesting depth. */
  jsonDepth: number;
};

/**
 * Walks a definition and collects every definition-local id plus reference
 * targets. Used for schema-level uniqueness, cross-reference validation, and
 * by services that need stable ids without re-parsing issue messages.
 */
export function scanDefinitionIds(
  definition: McpRequestDefinition,
): McpDefinitionIdScan {
  const scan: McpDefinitionIdScan = {
    ids: [],
    agentInputRefs: [],
    serverValueRefs: [],
    rawBindingIds: [],
    jsonNodeCount: 0,
    jsonDepth: 0,
  };

  const recordBinding = (binding: McpValueBinding, path: string) => {
    if (binding.kind === "agentInput") {
      scan.agentInputRefs.push({ id: binding.agentInputId, path });
    } else if (binding.kind === "serverValue") {
      scan.serverValueRefs.push({ id: binding.serverValueId, path });
    }
  };

  const walkJson = (node: McpJsonNode, path: string, depth: number) => {
    scan.jsonNodeCount += 1;
    scan.jsonDepth = Math.max(scan.jsonDepth, depth);
    if (node.kind === "binding") {
      recordBinding(node.binding, path);
      return;
    }
    if (node.kind === "object") {
      for (const field of node.fields) {
        scan.ids.push(field.id);
        walkJson(field.value, `${path}.${field.key}`, depth + 1);
      }
      return;
    }
    if (node.kind === "array") {
      node.items.forEach((item, index) =>
        walkJson(item, `${path}[${index}]`, depth + 1),
      );
    }
  };

  definition.pathSegments.forEach((segment, index) => {
    scan.ids.push(segment.id);
    recordBinding(segment.value, `pathSegments[${index}]`);
  });

  for (const [key, entries] of [
    ["query", definition.query],
    ["headers", definition.headers],
  ] as const) {
    entries.forEach((entry, index) => {
      scan.ids.push(entry.id);
      recordBinding(entry.value, `${key}[${index}]`);
    });
  }

  if (definition.body.bodyType === "json") {
    walkJson(definition.body.root, "body.root", 1);
  } else if (definition.body.bodyType === "form") {
    definition.body.fields.forEach((field, index) => {
      scan.ids.push(field.id);
      recordBinding(field.value, `body.fields[${index}]`);
    });
  } else if (definition.body.bodyType === "raw") {
    definition.body.bindings.forEach((entry, index) => {
      scan.ids.push(entry.id);
      scan.rawBindingIds.push(entry.id);
      recordBinding(entry.binding, `body.bindings[${index}]`);
    });
  }

  for (const input of definition.agentInputs) {
    scan.ids.push(input.id);
  }

  return scan;
}

/**
 * Removes `examples` from any agent input flagged `sensitive` without needing a
 * full schema parse. Used by read-only/preview surfaces so sensitive sample
 * values are never echoed back, matching the advertised write-only schema.
 */
export function redactSensitiveExamples(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  const inputs = record.agentInputs;
  if (!Array.isArray(inputs)) return raw;
  return {
    ...record,
    agentInputs: inputs.map((input) => {
      if (
        input &&
        typeof input === "object" &&
        (input as { sensitive?: unknown }).sensitive === true &&
        "examples" in input
      ) {
        const rest = { ...(input as Record<string, unknown>) };
        delete rest.examples;
        return rest;
      }
      return input;
    }),
  };
}

/**
 * Validates cross-node invariants that per-field Zod objects cannot express:
 * unique definition-local ids, resolvable agent-input references, and payload
 * limits. Server-value references are validated by services against the
 * owner's catalog because that list is not part of the definition.
 */
function refineRequestDefinition(
  definition: McpRequestDefinition,
  ctx: z.RefinementCtx,
): void {
  const scan = scanDefinitionIds(definition);

  const seenIds = new Set<string>();
  for (const id of scan.ids) {
    if (seenIds.has(id)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodeIds"],
        message: `Definition-local id "${id}" is used more than once.`,
      });
    }
    seenIds.add(id);
  }

  const agentInputIds = new Set(
    definition.agentInputs.map((input) => input.id),
  );
  for (const ref of scan.agentInputRefs) {
    if (!agentInputIds.has(ref.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["agentInputs"],
        message: `Binding at ${ref.path} references undeclared agent input "${ref.id}".`,
      });
    }
  }

  if (definition.pathSegments.length > MCP_DEFINITION_LIMITS.pathSegments) {
    ctx.addIssue({
      code: "custom",
      path: ["pathSegments"],
      message: `A definition supports at most ${MCP_DEFINITION_LIMITS.pathSegments} path segments.`,
    });
  }
  if (definition.query.length > MCP_DEFINITION_LIMITS.namedEntries) {
    ctx.addIssue({
      code: "custom",
      path: ["query"],
      message: `A definition supports at most ${MCP_DEFINITION_LIMITS.namedEntries} query entries.`,
    });
  }
  if (definition.headers.length > MCP_DEFINITION_LIMITS.namedEntries) {
    ctx.addIssue({
      code: "custom",
      path: ["headers"],
      message: `A definition supports at most ${MCP_DEFINITION_LIMITS.namedEntries} header entries.`,
    });
  }
  if (scan.jsonNodeCount > MCP_DEFINITION_LIMITS.jsonNodes) {
    ctx.addIssue({
      code: "custom",
      path: ["body"],
      message: `A JSON body supports at most ${MCP_DEFINITION_LIMITS.jsonNodes} nodes.`,
    });
  }
  if (scan.jsonDepth > MCP_DEFINITION_LIMITS.jsonDepth) {
    ctx.addIssue({
      code: "custom",
      path: ["body"],
      message: `A JSON body supports at most ${MCP_DEFINITION_LIMITS.jsonDepth} levels of nesting.`,
    });
  }
}

const mcpRequestDefinitionSchemaBase = z
  .strictObject({
    version: z.literal(MCP_REQUEST_DEFINITION_VERSION),
    pathSegments: z
      .array(mcpPathSegmentSchema)
      .max(MCP_DEFINITION_LIMITS.pathSegments),
    query: z
      .array(mcpNamedEntrySchema)
      .max(MCP_DEFINITION_LIMITS.namedEntries)
      .default([]),
    headers: z
      .array(mcpNamedEntrySchema)
      .max(MCP_DEFINITION_LIMITS.namedEntries)
      .default([]),
    body: mcpBodyDefinitionSchema.default({ bodyType: "none" }),
    agentInputs: z
      .array(mcpAgentInputSchema)
      .max(MCP_DEFINITION_LIMITS.agentInputs)
      .default([]),
    annotations: mcpBehaviorAnnotationsSchema.optional(),
  })
  .superRefine(refineRequestDefinition);

export type McpRequestDefinition = z.infer<
  typeof mcpRequestDefinitionSchemaBase
>;

/**
 * Pinned to the inferred domain type so transports (tRPC/Platform) serialize a
 * compact type rather than expanding the recursive Zod schema.
 */
export const mcpRequestDefinitionSchema: z.ZodType<McpRequestDefinition> =
  mcpRequestDefinitionSchemaBase;

/**
 * Common server values forbid agent inputs, so only the shared entry shape and
 * definition-local id uniqueness apply.
 */
export const mcpCommonEntriesSchema = z
  .strictObject({
    headers: z
      .array(mcpNamedEntrySchema)
      .max(MCP_DEFINITION_LIMITS.namedEntries)
      .default([]),
    query: z
      .array(mcpNamedEntrySchema)
      .max(MCP_DEFINITION_LIMITS.namedEntries)
      .default([]),
  })
  .superRefine((common, ctx) => {
    const seen = new Set<string>();
    for (const entry of [...common.headers, ...common.query]) {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["entries"],
          message: `Common entry id "${entry.id}" is used more than once.`,
        });
      }
      seen.add(entry.id);
      if (entry.value.kind === "agentInput") {
        ctx.addIssue({
          code: "custom",
          path: ["entries"],
          message:
            "Agent input bindings are not allowed in server common entries.",
        });
      }
    }
  });

export type McpCommonEntries = z.infer<typeof mcpCommonEntriesSchema>;

/**
 * Produces a deep copy of a definition with fresh definition-local ids for
 * every path segment, named entry, JSON field, raw binding, and agent input.
 * Internal references (agent-input bindings and raw `{{id}}` tokens) are
 * rewritten to the new ids; external server-value ids are preserved.
 */
export function regenerateDefinitionIds(
  definition: McpRequestDefinition,
  makeId: (prefix: string) => string = (prefix) =>
    `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
): McpRequestDefinition {
  const idMap = new Map<string, string>();
  const mapId = (oldId: string, prefix: string): string => {
    const existing = idMap.get(oldId);
    if (existing) return existing;
    const next = makeId(prefix);
    idMap.set(oldId, next);
    return next;
  };

  const mapBinding = (binding: McpValueBinding): McpValueBinding =>
    binding.kind === "agentInput"
      ? { kind: "agentInput", agentInputId: mapId(binding.agentInputId, "ain") }
      : binding;

  const mapJson = (node: McpJsonNode): McpJsonNode => {
    if (node.kind === "binding") {
      return { ...node, binding: mapBinding(node.binding) };
    }
    if (node.kind === "array") {
      return { kind: "array", items: node.items.map(mapJson) };
    }
    if (node.kind === "object") {
      return {
        kind: "object",
        fields: node.fields.map((field) => ({
          ...field,
          id: mapId(field.id, "field"),
          value: mapJson(field.value),
        })),
      };
    }
    return node;
  };

  let body: McpRequestDefinition["body"];
  if (definition.body.bodyType === "json") {
    body = { bodyType: "json", root: mapJson(definition.body.root) };
  } else if (definition.body.bodyType === "form") {
    body = {
      bodyType: "form",
      fields: definition.body.fields.map((field) => ({
        ...field,
        id: mapId(field.id, "field"),
        value: mapBinding(field.value),
      })),
    };
  } else if (definition.body.bodyType === "raw") {
    const bindings = definition.body.bindings.map((entry) => ({
      id: mapId(entry.id, "raw"),
      binding: mapBinding(entry.binding),
    }));
    const tokenPattern = /\{\{([^}]+)\}\}/g;
    const template = definition.body.template.replace(
      tokenPattern,
      (whole, id: string) => {
        const next = idMap.get(id);
        return next ? `{{${next}}}` : whole;
      },
    );
    body = {
      bodyType: "raw",
      ...(definition.body.contentType !== undefined
        ? { contentType: definition.body.contentType }
        : {}),
      bindings,
      template,
    };
  } else {
    body = { bodyType: "none" };
  }

  return {
    version: definition.version,
    pathSegments: definition.pathSegments.map((segment) => ({
      id: mapId(segment.id, "path"),
      value: mapBinding(segment.value),
    })),
    query: definition.query.map((entry) => ({
      ...entry,
      id: mapId(entry.id, "query"),
      value: mapBinding(entry.value),
    })),
    headers: definition.headers.map((entry) => ({
      ...entry,
      id: mapId(entry.id, "header"),
      value: mapBinding(entry.value),
    })),
    body,
    agentInputs: definition.agentInputs.map((input) => ({
      ...input,
      id: mapId(input.id, "ain"),
    })),
    ...(definition.annotations !== undefined
      ? { annotations: definition.annotations }
      : {}),
  };
}

export const mcpServerValueKindSchema = z.enum(["config", "secret"]);
export const mcpServerValueOwnerSchema = z.enum(["manual", "auth"]);

export const mcpAuthRecipeKindSchema = z.enum([
  "none",
  "bearer",
  "header",
  "query",
  "basic",
  "custom",
]);

export const mcpAuthBindingSchema = z.strictObject({
  location: z.enum(["header", "query"]),
  key: z.string().min(1).max(256),
  serverValueId: mcpServerValueIdSchema,
  prefix: z.string().max(256).optional(),
  suffix: z.string().max(256).optional(),
});

export const mcpAuthConfigurationSchema = z.strictObject({
  kind: mcpAuthRecipeKindSchema,
  bindings: z.array(mcpAuthBindingSchema).default([]),
  /** Required when any binding places a secret in the query string. */
  queryExposureAcknowledged: z.boolean().optional(),
  basicUsernameValueId: mcpServerValueIdSchema.optional(),
  basicPasswordValueId: mcpServerValueIdSchema.optional(),
});

export type McpAuthConfiguration = z.infer<typeof mcpAuthConfigurationSchema>;

/**
 * A compile issue always carries a human-readable `path` plus, when the
 * affected node has one, its stable definition-local `id` so clients can
 * attach diagnostics without parsing English messages.
 */
export const mcpCompileIssueSchema = z.strictObject({
  path: z.string(),
  /** Stable definition-local id of the affected node, when known. */
  id: z.string().optional(),
  code: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
});

export type McpCompileIssue = z.infer<typeof mcpCompileIssueSchema>;

export const mcpCompiledPlanSchema = z.object({
  version: z.literal(MCP_REQUEST_DEFINITION_VERSION),
  method: z.string(),
  pathSegments: z.array(
    z.object({
      source: mcpValueBindingSchema,
      encode: z.literal(true),
    }),
  ),
  query: z.array(
    z.object({
      name: z.string(),
      source: mcpValueBindingSchema,
      omitWhenAbsent: z.boolean().optional(),
    }),
  ),
  headers: z.array(
    z.object({
      name: z.string(),
      source: mcpValueBindingSchema,
      omitWhenAbsent: z.boolean().optional(),
      protected: z.boolean().optional(),
    }),
  ),
  body: z.discriminatedUnion("bodyType", [
    z.object({ bodyType: z.literal("none") }),
    z.object({
      bodyType: z.literal("json"),
      root: mcpJsonNodeSchema,
    }),
    z.object({
      bodyType: z.literal("form"),
      fields: z.array(
        z.object({
          name: z.string(),
          source: mcpValueBindingSchema,
          omitWhenAbsent: z.boolean().optional(),
        }),
      ),
    }),
    z.object({
      bodyType: z.literal("raw"),
      contentType: z.string().optional(),
      parts: z.array(
        z.union([
          z.object({ kind: z.literal("text"), value: z.string() }),
          z.object({
            kind: z.literal("binding"),
            binding: mcpValueBindingSchema,
          }),
        ]),
      ),
    }),
  ]),
  agentInputs: z.array(mcpAgentInputSchema),
  annotations: mcpBehaviorAnnotationsSchema,
  protectedKeys: z.object({
    headers: z.array(z.string()),
    query: z.array(z.string()),
  }),
  compiledAt: z.string(),
  definitionHash: z.string(),
});

export type McpCompiledPlan = z.infer<typeof mcpCompiledPlanSchema>;

/** Shared field/payload limits for tRPC and Platform MCP authoring. */
export const MCP_FIELD_LIMITS = {
  name: 80,
  toolTitle: 120,
  description: 2000,
  pathSegment: 512,
  /** Legacy whole-path template shared by tRPC and Platform MCP tool authoring. */
  legacyPathTemplate: 2048,
  headerName: 256,
  headerValue: 8_192,
  queryName: 256,
  queryValue: 8_192,
  body: 256_000,
  toolCount: 50,
  agentInputCount: 40,
  serverValueCount: 100,
  pathSegments: MCP_DEFINITION_LIMITS.pathSegments,
  namedEntries: MCP_DEFINITION_LIMITS.namedEntries,
  rawBindings: MCP_DEFINITION_LIMITS.rawBindings,
  jsonNodes: MCP_DEFINITION_LIMITS.jsonNodes,
} as const;
