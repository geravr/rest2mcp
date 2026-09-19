/**
 * @file Shared domain command schemas for Studio tRPC and Platform MCP.
 * Keep field/payload limits identical across both transports.
 */
import { z } from "zod";
import { MCP_DEFAULT_PLATFORM_SCOPES, MCP_PLATFORM_SCOPES } from "@repo/core";
import {
  MCP_FIELD_LIMITS,
  mcpAgentInputSchema,
  mcpAuthConfigurationSchema,
  mcpCommonEntriesSchema,
  mcpRequestDefinitionSchema,
  mcpServerValueKindSchema,
  mcpValueNameSchema,
} from "./mcp-request-definition.js";

export const mcpHttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
]);

export const createServerCommandSchema = z.object({
  name: z.string().trim().min(1).max(MCP_FIELD_LIMITS.name),
  slug: z.string().trim().min(1).max(MCP_FIELD_LIMITS.name).optional(),
  description: z
    .string()
    .max(MCP_FIELD_LIMITS.description)
    .optional()
    .nullable(),
  baseUrl: z.string().trim().url().max(2048),
  allowedHosts: z.array(z.string().min(1).max(253)).max(20).optional(),
});

export const updateServerCommandSchema = z
  .strictObject({
    serverId: z.string().min(1),
    name: z.string().trim().min(1).max(MCP_FIELD_LIMITS.name).optional(),
    description: z
      .string()
      .max(MCP_FIELD_LIMITS.description)
      .optional()
      .nullable(),
    baseUrl: z.string().trim().url().max(2048).optional(),
    allowedHosts: z.array(z.string().min(1).max(253)).max(20).optional(),
    status: z.enum(["draft", "live", "paused"]).optional(),
    iconImage: z.string().max(2048).optional().nullable(),
    common: mcpCommonEntriesSchema.optional(),
    /** Legacy compatibility maps during dual-write window. */
    defaultHeaders: z.record(z.string(), z.string()).optional().nullable(),
    defaultQuery: z.record(z.string(), z.string()).optional().nullable(),
  })
  .refine(
    (value) =>
      value.common === undefined ||
      (value.defaultHeaders === undefined && value.defaultQuery === undefined),
    {
      message:
        "Typed common entries and legacy default maps cannot be combined in one update.",
    },
  );

/** Legacy `{{name}}` template shape, shared by tRPC and Platform MCP until authoring migrates to `requestDefinition`. */
export const legacyToolParamSchema = z.object({
  name: mcpValueNameSchema,
  description: z.string().max(MCP_FIELD_LIMITS.description).optional(),
  required: z.boolean(),
  type: z.enum(["string", "number", "boolean", "json"]),
  /** Never logged/previewed; masked as a password field in the playground. */
  sensitive: z.boolean().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  pattern: z.string().max(512).optional(),
  format: z.enum(["date", "date-time", "email", "uri", "uuid"]).optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  examples: z.array(z.unknown()).max(8).optional(),
  allowEmpty: z.boolean().optional(),
});

export const legacyRequestTemplateSchema = z.object({
  query: z
    .record(z.string(), z.string().max(MCP_FIELD_LIMITS.queryValue))
    .optional(),
  headers: z
    .record(z.string(), z.string().max(MCP_FIELD_LIMITS.headerValue))
    .optional(),
  body: z.string().max(MCP_FIELD_LIMITS.body).nullable().optional(),
  bodyType: z.enum(["json", "form", "raw"]).optional(),
});

export const createLegacyToolCommandSchema = z.strictObject({
  serverId: z.string().min(1),
  name: z.string().trim().min(1).max(MCP_FIELD_LIMITS.name),
  description: z
    .string()
    .max(MCP_FIELD_LIMITS.description)
    .optional()
    .nullable(),
  method: mcpHttpMethodSchema,
  pathTemplate: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.legacyPathTemplate),
  requestTemplate: legacyRequestTemplateSchema.optional(),
  params: z
    .array(legacyToolParamSchema)
    .max(MCP_FIELD_LIMITS.agentInputCount)
    .optional(),
  allowMutation: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const updateLegacyToolCommandSchema = createLegacyToolCommandSchema
  .omit({ serverId: true })
  .partial()
  .extend({
    toolId: z.string().min(1),
    serverId: z.string().min(1),
  });

export const createToolCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.name)
    .describe("Stable MCP tool name."),
  title: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.toolTitle)
    .optional()
    .nullable()
    .describe("Human-facing agent title."),
  description: z
    .string()
    .max(MCP_FIELD_LIMITS.description)
    .optional()
    .nullable()
    .describe("Outcome-oriented agent description."),
  method: mcpHttpMethodSchema.describe("Upstream HTTP method."),
  requestDefinition: mcpRequestDefinitionSchema.describe(
    "Versioned typed request definition.",
  ),
  allowMutation: z
    .boolean()
    .optional()
    .describe("Whether this tool may contact upstream with a mutating method."),
  enabled: z
    .boolean()
    .optional()
    .describe("Whether the tool is enabled; requires a contract-ready tool."),
});

export const updateToolCommandSchema = createToolCommandSchema
  .omit({ serverId: true })
  .partial()
  .extend({
    toolId: z.string().min(1),
    serverId: z.string().min(1),
  });

/** Create a copy of an existing tool with regenerated definition-local ids. */
export const duplicateToolCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  toolId: z.string().min(1).describe("Source tool id to copy."),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.name)
    .optional()
    .describe("Name for the copy."),
  title: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.toolTitle)
    .optional()
    .nullable()
    .describe("Human-facing agent title for the copy."),
  description: z
    .string()
    .max(MCP_FIELD_LIMITS.description)
    .optional()
    .nullable()
    .describe("Outcome-oriented agent description for the copy."),
  enabled: z.boolean().optional().describe("Whether the copy is enabled."),
});

export const setServerValueCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  name: mcpValueNameSchema.describe("Server value name."),
  kind: mcpServerValueKindSchema.describe(
    "Whether the value is config or secret.",
  ),
  value: z
    .string()
    .max(MCP_FIELD_LIMITS.body)
    .describe("Value to store; secrets must use the Studio secret flow."),
  description: z
    .string()
    .max(MCP_FIELD_LIMITS.description)
    .optional()
    .describe("Optional human-facing description."),
});

export const updateServerValueCommandSchema = z.object({
  serverId: z.string().min(1),
  valueId: z.string().min(1),
  name: mcpValueNameSchema.optional(),
  value: z.string().max(MCP_FIELD_LIMITS.body).optional(),
  description: z
    .string()
    .max(MCP_FIELD_LIMITS.description)
    .optional()
    .nullable(),
});

export const setAuthConfigurationCommandSchema = z.object({
  serverId: z.string().min(1),
  configuration: mcpAuthConfigurationSchema,
  /** Plaintext secret payloads for auth-owned values keyed by binding role. */
  secrets: z
    .record(z.string(), z.string().max(MCP_FIELD_LIMITS.body))
    .optional(),
});

export const curlPreviewCommandSchema = z.object({
  serverId: z.string().min(1),
  curl: z.string().min(1).max(MCP_FIELD_LIMITS.body),
});

export const curlConfirmCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  curl: z
    .string()
    .min(1)
    .max(MCP_FIELD_LIMITS.body)
    .describe("One curl command to import."),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.name)
    .optional()
    .describe("Optional tool name for the imported draft."),
  description: z
    .string()
    .max(MCP_FIELD_LIMITS.description)
    .optional()
    .nullable()
    .describe("Optional agent description for the imported draft."),
  markings: z
    .array(
      z.object({
        location: z.enum(["path", "query", "header", "form", "json", "raw"]),
        key: z.string().optional(),
        jsonPath: z.string().optional(),
        occurrenceId: z.string().min(1),
        as: z.enum(["literal", "serverValue", "agentInput"]),
        name: mcpValueNameSchema.optional(),
        agentInput: mcpAgentInputSchema.optional(),
      }),
    )
    .max(100)
    .default([]),
});

export const createPlatformTokenCommandSchema = z.object({
  name: z.string().trim().min(1).max(MCP_FIELD_LIMITS.name).optional(),
  scopes: z
    .array(z.enum(MCP_PLATFORM_SCOPES))
    .min(1)
    .default([...MCP_DEFAULT_PLATFORM_SCOPES]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** Dry-run compile preview: same typed definition the Studio tool form builds, no persistence. */
export const previewToolCompileCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.name)
    .optional()
    .describe("Candidate tool name."),
  title: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.toolTitle)
    .optional()
    .nullable()
    .describe("Candidate human-facing agent title."),
  description: z
    .string()
    .max(MCP_FIELD_LIMITS.description)
    .optional()
    .nullable()
    .describe("Candidate outcome-oriented agent description."),
  method: mcpHttpMethodSchema.describe("Upstream HTTP method."),
  requestDefinition: mcpRequestDefinitionSchema.describe(
    "Candidate versioned typed request definition.",
  ),
  allowMutation: z
    .boolean()
    .optional()
    .describe("Whether the candidate tool may mutate upstream state."),
});

/** Explicit legacy compatibility preview retained during the migration window. */
export const previewLegacyToolCompileCommandSchema = z.strictObject({
  serverId: z.string().min(1),
  method: mcpHttpMethodSchema,
  pathTemplate: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.legacyPathTemplate),
  requestTemplate: legacyRequestTemplateSchema.optional(),
  params: z
    .array(legacyToolParamSchema)
    .max(MCP_FIELD_LIMITS.agentInputCount)
    .optional(),
  allowMutation: z.boolean().optional(),
});

export const invokeToolCommandSchema = z.object({
  serverId: z.string().min(1),
  toolId: z.string().min(1).optional(),
  toolName: z.string().min(1).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
});

export type CreateServerCommand = z.infer<typeof createServerCommandSchema>;
export type UpdateServerCommand = z.infer<typeof updateServerCommandSchema>;
export type CreateToolCommand = z.infer<typeof createToolCommandSchema>;
export type UpdateToolCommand = z.infer<typeof updateToolCommandSchema>;
export type DuplicateToolCommand = z.infer<typeof duplicateToolCommandSchema>;
export type PreviewToolCompileCommand = z.infer<
  typeof previewToolCompileCommandSchema
>;
export type CurlConfirmCommand = z.infer<typeof curlConfirmCommandSchema>;
