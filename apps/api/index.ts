/**
 * @file Public API surface for the backend package.
 *
 * Re-exports the Hono app, tRPC router, and core utilities.
 */

// Core utilities and services
export { createAuth } from "./lib/auth.js";
export { createDb } from "./lib/db.js";

// Application and router exports
export { default as app, appRouter } from "./lib/app.js";

// Type exports
export type { AppRouter } from "./lib/app.js";
export type { AppContext } from "./lib/context.js";
export type { ExecuteMappedToolResult } from "./services/mcp-executor-service.js";
export type {
  ConfirmCurlImportInput,
  ConfirmCurlImportOptions,
  CreateServerInput,
  CreateTypedToolInput,
  McpHttpMethod,
  McpServerStatus,
  McpServerWithMeta,
  McpToolSource,
  ServerValueReference,
  SetVariableInput,
  TestConnectionResult,
  TrafficLight,
  UpdateServerInput,
  UpdateTypedToolInput,
} from "./services/mcp-studio-service.js";
export type {
  CreatePlatformPatInput,
  CreatedPlatformPat,
  PlatformPatSummary,
  RotatePlatformPatInput,
} from "./services/mcp-platform-token-service.js";
export type { PlatformPrincipal } from "./lib/mcp-platform-principal.js";
export type { ServerAuthRecipe } from "./lib/mcp-auth-recipe.js";
export type {
  CurlImportCredentialDiagnostic,
  CurlImportMarking,
  CurlImportPreview,
} from "./lib/mcp-curl-import.js";
// OpenAPI import contracts, re-exported so consumers can name these shapes
// instead of re-declaring them.
export type {
  McpOpenApiCapacityProjection,
  McpOpenApiConfirmInput,
  McpOpenApiConfirmResult,
  McpOpenApiDocumentMetadata,
  McpOpenApiDocumentSummary,
  McpOpenApiGroupStrategy,
  McpOpenApiGroupStrategyKind,
  McpOpenApiInventory,
  McpOpenApiInventoryMediaType,
  McpOpenApiInventoryOperation,
  McpOpenApiInventoryParameter,
  McpOpenApiInventoryRequestBody,
  McpOpenApiInventoryServer,
  McpOpenApiMethod,
  McpOpenApiOperationCandidate,
  McpOpenApiOperationIssue,
  McpOpenApiPointer,
  McpOpenApiPreviewResult,
  McpOpenApiSecurityRequirement,
  McpOpenApiSelectionEntry,
  McpOpenApiSource,
  McpOpenApiSourceKind,
  McpOpenApiSourceProvenance,
  McpOpenApiSuggestedGroup,
  McpOpenApiTelemetrySummary,
} from "./lib/openapi-import-contracts.js";
export type { McpToolGroupSummary } from "./services/mcp-tool-group-service.js";
// Canonical request-definition types referenced by the OpenAPI import
// contracts above; re-exported for the same naming reason.
export type {
  McpAgentInput,
  McpBehaviorAnnotations,
  McpBodyDefinition,
  McpCompiledPlan,
  McpCompileIssue,
  McpCommonEntries,
  McpJsonNode,
  McpNamedEntry,
  McpPathSegment,
  McpRequestDefinition,
  McpValueBinding,
} from "./lib/mcp-request-definition.js";
// Re-export context type to fix TypeScript portability issues
export type * from "./lib/context.js";

// Default export is the core app
export { default } from "./lib/app.js";
