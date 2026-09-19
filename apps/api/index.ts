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
  TemplateWarning,
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
export type {
  InferredServerAuth,
  ServerAuthRecipe,
} from "./lib/mcp-auth-recipe.js";
export type {
  CurlImportCredentialDiagnostic,
  CurlImportMarking,
  CurlImportPreview,
} from "./lib/mcp-curl-import.js";
// Re-export context type to fix TypeScript portability issues
export type * from "./lib/context.js";

// Default export is the core app
export { default } from "./lib/app.js";
