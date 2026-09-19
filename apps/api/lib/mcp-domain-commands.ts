/**
 * @file Shared domain command schemas for Studio tRPC and Platform MCP.
 * Keep field/payload limits identical across both transports.
 *
 * Studio-only authoring fields (notably Studio group placement) must NOT be
 * added here: these schemas are the Platform MCP contract too. Derive a
 * Studio-specific schema in `mcp-studio-commands.ts` instead.
 */
import { z } from "zod";
import {
  MCP_DEFAULT_PLATFORM_SCOPES,
  MCP_OPENAPI_LIMITS,
  MCP_PLATFORM_RESOURCE_MODES,
  MCP_PLATFORM_SCOPES,
  MCP_TOOL_GROUP_LIMITS,
  paginationInputSchema,
} from "@repo/core";
import {
  MCP_FIELD_LIMITS,
  mcpAgentInputSchema,
  mcpAuthConfigurationSchema,
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

/**
 * Last observed server configuration revision. Required on every mutation of
 * an existing server so stale writes fail with `MCP_WRITE_CONFLICT` instead of
 * silently overwriting newer configuration.
 */
export const expectedRevisionSchema = z
  .number()
  .int()
  .min(1)
  .describe("Last observed server configuration revision.");

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

export const createToolCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  expectedRevision: expectedRevisionSchema,
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
    expectedRevision: expectedRevisionSchema,
  });

/** Create a copy of an existing tool with regenerated definition-local ids. */
export const duplicateToolCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  expectedRevision: expectedRevisionSchema,
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
  expectedRevision: expectedRevisionSchema,
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

export const setAuthConfigurationCommandSchema = z.object({
  serverId: z.string().min(1),
  expectedRevision: expectedRevisionSchema,
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
  expectedRevision: expectedRevisionSchema,
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

/** Grant fields shared by creation, rotation, and step-up approval. */
export const platformPatGrantInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FIELD_LIMITS.name)
    .describe("Required human-readable token name."),
  scopes: z
    .array(z.enum(MCP_PLATFORM_SCOPES))
    .min(1)
    .default([...MCP_DEFAULT_PLATFORM_SCOPES]),
  resourceMode: z.enum(MCP_PLATFORM_RESOURCE_MODES),
  serverIds: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe("Owned server ids for selected resource mode."),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const createPlatformPatCommandSchema = platformPatGrantInputSchema;

export const rotatePlatformPatCommandSchema =
  platformPatGrantInputSchema.extend({
    tokenId: z.string().min(1).describe("Active Platform token id to rotate."),
  });

export const revokePlatformPatCommandSchema = z.object({
  tokenId: z.string().min(1),
});

/** Verifies a step-up OTP and binds it to the exact requested grant. */
export const verifyPlatformStepUpCommandSchema = platformPatGrantInputSchema
  .omit({ name: true, expiresInDays: true })
  .extend({
    otp: z.string().regex(/^\d{6}$/),
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

/** Write-free publication preview for one observed draft revision. */
export const publishPreviewCommandSchema = z.object({
  serverId: z.string().min(1).describe("Owning server id."),
});

/**
 * One atomic publication command. The expected draft revision, active revision
 * id, candidate fingerprint, and warning acknowledgements are all bound to the
 * previewed candidate so a changed draft cannot reuse an older approval.
 */
export const publishServerCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  expectedDraftRevision: expectedRevisionSchema.describe(
    "Observed draft revision from the previewed candidate.",
  ),
  expectedPublishedRevisionId: z
    .string()
    .min(1)
    .nullable()
    .describe("Active published revision id at preview time, or null."),
  publishRequestId: z
    .string()
    .min(1)
    .max(128)
    .describe("Client-generated idempotency key for this publication."),
  candidateFingerprint: z
    .string()
    .min(1)
    .max(128)
    .describe("Candidate fingerprint returned by publication preview."),
  acknowledgedWarningCodes: z
    .array(z.string().min(1))
    .max(32)
    .optional()
    .describe("Warning codes acknowledged for the exact candidate."),
  note: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .describe("Optional bounded publication note."),
});

export const revisionHistoryCommandSchema = z.object({
  serverId: z.string().min(1).describe("Owning server id."),
  ...paginationInputSchema.shape,
});

export const revisionDetailCommandSchema = z.object({
  serverId: z.string().min(1).describe("Owning server id."),
  revisionId: z.string().min(1).describe("Revision id to read."),
});

export const restoreRevisionCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  revisionId: z.string().min(1).describe("Historical revision id to restore."),
  expectedRevision: expectedRevisionSchema,
  expectedDraftRevision: expectedRevisionSchema,
});

export type PublishPreviewCommand = z.infer<typeof publishPreviewCommandSchema>;
export type PublishServerCommand = z.infer<typeof publishServerCommandSchema>;
export type RevisionHistoryCommand = z.infer<
  typeof revisionHistoryCommandSchema
>;
export type RevisionDetailCommand = z.infer<typeof revisionDetailCommandSchema>;
export type RestoreRevisionCommand = z.infer<
  typeof restoreRevisionCommandSchema
>;

export type CreateServerCommand = z.infer<typeof createServerCommandSchema>;
export type CreateToolCommand = z.infer<typeof createToolCommandSchema>;
export type UpdateToolCommand = z.infer<typeof updateToolCommandSchema>;
export type DuplicateToolCommand = z.infer<typeof duplicateToolCommandSchema>;
export type PreviewToolCompileCommand = z.infer<
  typeof previewToolCompileCommandSchema
>;
export type CurlConfirmCommand = z.infer<typeof curlConfirmCommandSchema>;

/** Studio tool groups are presentation-only and never publishable structure. */
export const createToolGroupCommandSchema = z.strictObject({
  serverId: z.string().min(1),
  expectedRevision: expectedRevisionSchema,
  name: z.string().trim().min(1).max(MCP_TOOL_GROUP_LIMITS.name),
});
export const renameToolGroupCommandSchema = z.strictObject({
  serverId: z.string().min(1),
  expectedRevision: expectedRevisionSchema,
  groupId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(MCP_TOOL_GROUP_LIMITS.name),
});
export const deleteToolGroupCommandSchema = z.strictObject({
  serverId: z.string().min(1),
  expectedRevision: expectedRevisionSchema,
  groupId: z.string().min(1).max(64),
});
export const assignToolGroupCommandSchema = z.strictObject({
  serverId: z.string().min(1),
  expectedRevision: expectedRevisionSchema,
  toolIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MCP_OPENAPI_LIMITS.maxSelection),
  /** null ungroups; a group id assigns. */
  groupId: z.string().min(1).max(64).nullable(),
});

export type CreateToolGroupCommand = z.infer<
  typeof createToolGroupCommandSchema
>;
export type RenameToolGroupCommand = z.infer<
  typeof renameToolGroupCommandSchema
>;
export type DeleteToolGroupCommand = z.infer<
  typeof deleteToolGroupCommandSchema
>;
export type AssignToolGroupCommand = z.infer<
  typeof assignToolGroupCommandSchema
>;

export const MCP_TOOL_GROUP_FILTER_UNGROUPED = "ungrouped";
export const MCP_TOOL_GROUP_FILTER_ALL = "all";

/** `"all"` and an absent value both mean unfiltered; `"ungrouped"` means groupId IS NULL. */
export const toolGroupFilterSchema = z.string().min(1).max(64).optional();
