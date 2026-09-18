/**
 * @file Versioned MCP request-definition schemas, bindings, auth config,
 * server values, and structured execution envelopes shared by Studio, gateway,
 * Platform MCP, and the compiler.
 */
import { z } from "zod";
import { MCP_REQUEST_DEFINITION_VERSION } from "./mcp-policy.js";

export const mcpValueNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "Must match [a-z][a-z0-9_]*");

export const mcpBindingIdSchema = z.string().min(1).max(64);
export const mcpServerValueIdSchema = z.string().min(1).max(64);
export const mcpAgentInputIdSchema = z.string().min(1).max(64);

export const mcpLiteralBindingSchema = z.object({
  kind: z.literal("literal"),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

export const mcpServerValueBindingSchema = z.object({
  kind: z.literal("serverValue"),
  serverValueId: mcpServerValueIdSchema,
  prefix: z.string().max(256).optional(),
  suffix: z.string().max(256).optional(),
});

export const mcpAgentInputBindingSchema = z.object({
  kind: z.literal("agentInput"),
  agentInputId: mcpAgentInputIdSchema,
});

export const mcpValueBindingSchema = z.discriminatedUnion("kind", [
  mcpLiteralBindingSchema,
  mcpServerValueBindingSchema,
  mcpAgentInputBindingSchema,
]);

export type McpValueBinding = z.infer<typeof mcpValueBindingSchema>;

export const mcpNamedEntrySchema = z.object({
  id: mcpBindingIdSchema,
  name: z.string().min(1).max(256),
  value: mcpValueBindingSchema,
  /** When true and the bound agent input is absent, omit this entry. */
  omitWhenAbsent: z.boolean().optional(),
});

export type McpNamedEntry = z.infer<typeof mcpNamedEntrySchema>;

export const mcpPathSegmentSchema = z.object({
  id: mcpBindingIdSchema,
  value: mcpValueBindingSchema,
});

export type McpPathSegment = z.infer<typeof mcpPathSegmentSchema>;

export const mcpJsonNodeSchema: z.ZodType<McpJsonNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("literal"),
      jsonType: z.enum(["string", "number", "boolean", "null"]),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
    z.object({
      kind: z.literal("binding"),
      binding: mcpValueBindingSchema,
      jsonType: z.enum(["string", "number", "boolean", "null", "any"]),
      omitWhenAbsent: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal("object"),
      fields: z.array(
        z.object({
          id: mcpBindingIdSchema,
          key: z.string().min(1).max(256),
          value: mcpJsonNodeSchema,
          omitWhenAbsent: z.boolean().optional(),
        }),
      ),
    }),
    z.object({
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

export const mcpAgentInputSchema = z.object({
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
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  examples: z.array(z.unknown()).max(8).optional(),
  allowEmpty: z.boolean().optional(),
});

export type McpAgentInput = z.infer<typeof mcpAgentInputSchema>;

export const mcpBehaviorAnnotationsSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

export type McpBehaviorAnnotations = z.infer<
  typeof mcpBehaviorAnnotationsSchema
>;

export const mcpBodyDefinitionSchema = z.discriminatedUnion("bodyType", [
  z.object({
    bodyType: z.literal("json"),
    root: mcpJsonNodeSchema,
  }),
  z.object({
    bodyType: z.literal("form"),
    fields: z.array(mcpNamedEntrySchema),
  }),
  z.object({
    bodyType: z.literal("raw"),
    contentType: z.string().max(256).optional(),
    bindings: z.array(
      z.object({
        id: mcpBindingIdSchema,
        binding: mcpValueBindingSchema,
      }),
    ),
    template: z.string().max(256_000),
  }),
  z.object({
    bodyType: z.literal("none"),
  }),
]);

export type McpBodyDefinition = z.infer<typeof mcpBodyDefinitionSchema>;

export const mcpRequestDefinitionSchema = z.object({
  version: z.literal(MCP_REQUEST_DEFINITION_VERSION),
  pathSegments: z.array(mcpPathSegmentSchema),
  query: z.array(mcpNamedEntrySchema).default([]),
  headers: z.array(mcpNamedEntrySchema).default([]),
  body: mcpBodyDefinitionSchema.default({ bodyType: "none" }),
  agentInputs: z.array(mcpAgentInputSchema).default([]),
  annotations: mcpBehaviorAnnotationsSchema.optional(),
});

export type McpRequestDefinition = z.infer<typeof mcpRequestDefinitionSchema>;

export const mcpCommonEntriesSchema = z.object({
  headers: z.array(mcpNamedEntrySchema).default([]),
  query: z.array(mcpNamedEntrySchema).default([]),
});

export type McpCommonEntries = z.infer<typeof mcpCommonEntriesSchema>;

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

export const mcpAuthBindingSchema = z.object({
  location: z.enum(["header", "query"]),
  key: z.string().min(1).max(256),
  serverValueId: mcpServerValueIdSchema,
  prefix: z.string().max(256).optional(),
  suffix: z.string().max(256).optional(),
});

export const mcpAuthConfigurationSchema = z.object({
  kind: mcpAuthRecipeKindSchema,
  bindings: z.array(mcpAuthBindingSchema).default([]),
  /** Required when any binding places a secret in the query string. */
  queryExposureAcknowledged: z.boolean().optional(),
  basicUsernameValueId: mcpServerValueIdSchema.optional(),
  basicPasswordValueId: mcpServerValueIdSchema.optional(),
});

export type McpAuthConfiguration = z.infer<typeof mcpAuthConfigurationSchema>;

export const mcpCompileIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
});

export type McpCompileIssue = z.infer<typeof mcpCompileIssueSchema>;

export const mcpExecutionEnvelopeSchema = z.object({
  ok: z.boolean(),
  status: z.number().int().nullable(),
  contentType: z.string().nullable(),
  data: z.unknown().optional(),
  body: z.string().optional(),
  headers: z.record(z.string(), z.string()).default({}),
  truncated: z.boolean(),
  binary: z.boolean().optional(),
  retryAfterSeconds: z.number().optional(),
  appCode: z.string().nullable().optional(),
  phase: z
    .enum([
      "compile",
      "validate",
      "connect",
      "redirect",
      "headers",
      "body",
      "complete",
    ])
    .optional(),
  indeterminate: z.boolean().optional(),
});

export type McpExecutionEnvelope = z.infer<typeof mcpExecutionEnvelopeSchema>;

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
} as const;
