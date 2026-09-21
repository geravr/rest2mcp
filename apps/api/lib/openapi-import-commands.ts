/**
 * @file tRPC input schemas for the OpenAPI import preview and confirmation
 * commands. The service layer revalidates every semantic rule (selection
 * shape, fingerprint, names, capacity) so these schemas only bound payloads.
 */
import { z } from "zod";
import { MCP_OPENAPI_LIMITS } from "@repo/core";
import { expectedRevisionSchema } from "./mcp-domain-commands.js";
import {
  mcpOpenApiGroupStrategySchema,
  mcpOpenApiSelectionEntrySchema,
  mcpOpenApiSourceSchema,
} from "./openapi-import-contracts.js";

/** Write-free preview of one OpenAPI source for one owned server. */
export const openApiImportPreviewCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  source: mcpOpenApiSourceSchema.describe(
    "OpenAPI 3.0/3.1 JSON content or a public HTTPS document URL.",
  ),
});

/**
 * Fingerprint-bound confirmation. The source is resubmitted (content) or
 * refetched (URL) and must reproduce `fingerprint` before anything is written.
 */
export const openApiImportConfirmCommandSchema = z.strictObject({
  serverId: z.string().min(1).describe("Owning server id."),
  expectedRevision: expectedRevisionSchema,
  source: mcpOpenApiSourceSchema,
  fingerprint: z
    .string()
    .min(1)
    .max(128)
    .describe("Document fingerprint returned by the import preview."),
  selection: z
    .array(mcpOpenApiSelectionEntrySchema)
    .min(1)
    .max(MCP_OPENAPI_LIMITS.maxOperations)
    .describe("Selected operations with optional name overrides."),
  groupStrategy: mcpOpenApiGroupStrategySchema.describe(
    "Single group strategy applied to every selected operation.",
  ),
});

export type OpenApiImportPreviewCommand = z.infer<
  typeof openApiImportPreviewCommandSchema
>;
export type OpenApiImportConfirmCommand = z.infer<
  typeof openApiImportConfirmCommandSchema
>;
