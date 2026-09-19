/**
 * Studio-only command schemas derived from the shared domain commands.
 *
 * Group placement is Studio organization, not product configuration, so it is
 * added here rather than to `mcp-domain-commands.ts` — those schemas are also
 * the Platform MCP contract, and Platform must never accept or expose group
 * metadata.
 */
import { z } from "zod";
import {
  createToolCommandSchema,
  curlConfirmCommandSchema,
  updateToolCommandSchema,
} from "./mcp-domain-commands.js";
import { mcpToolGroupPlacementSchema } from "./openapi-import-contracts.js";

/**
 * Studio manual tool creation. Adds optional group placement to the shared
 * command without widening it for other transports.
 */
export const studioCreateToolCommandSchema = createToolCommandSchema.extend({
  /** Absent is ungrouped on create. */
  groupId: mcpToolGroupPlacementSchema.optional().nullable(),
});

/**
 * Studio manual tool editing. Distinct from the create shape because
 * `groupId` is tri-state here: absent leaves the stored assignment untouched,
 * `null` ungroups, and a string moves the tool.
 */
export const studioUpdateToolCommandSchema = studioCreateToolCommandSchema
  .omit({ serverId: true })
  .partial()
  .extend({
    toolId: z.string().min(1),
    serverId: z.string().min(1),
    expectedRevision: updateToolCommandSchema.shape.expectedRevision,
  });

/** Studio curl confirmation. Adds optional group placement. */
export const studioCurlConfirmCommandSchema = curlConfirmCommandSchema.extend({
  /** Optional existing Studio group for the imported draft. */
  groupId: mcpToolGroupPlacementSchema.optional().nullable(),
});

export type StudioCreateToolCommand = z.infer<
  typeof studioCreateToolCommandSchema
>;
export type StudioUpdateToolCommand = z.infer<
  typeof studioUpdateToolCommandSchema
>;
export type StudioCurlConfirmCommand = z.infer<
  typeof studioCurlConfirmCommandSchema
>;
