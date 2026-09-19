## 1. Canonical-only persistence schema

- [x] 1.1 Remove legacy `defaultHeaders`/`defaultQuery` columns from `db/schema/mcp-server.ts`
- [x] 1.2 Remove legacy `pathTemplate`/`requestTemplate`/`params` columns and `McpRequestTemplate`/`McpToolParam`/`McpBodyType` types from `db/schema/mcp-tool.ts`, and drop the `"legacy"` compile status literal
- [x] 1.3 Remove `isSecret` from `db/schema/mcp-server-variable.ts`, make `kind` and `owner` `NOT NULL`, and document config/secret storage exclusivity
- [x] 1.4 Remove `pathTemplate` from `mcp_server_revision_tool` and `isSecret` from `mcp_server_revision_config` in `db/schema/mcp-server-revision.ts`
- [x] 1.5 Update `db/schema/mcp-relations.ts` and any schema exports affected by removed columns/types
- [x] 1.6 Rewrite `db/seeds/mcp.ts` to persist only canonical `commonEntries`, `requestDefinition`, and `kind`/`owner` values
- [x] 1.7 Generate one destructive Drizzle migration with `bun db:generate` and verify its SQL drops the legacy columns and tightens nullability without hand-editing migrations

## 2. Canonical-only domain commands and errors

- [x] 2.1 Remove legacy command schemas from `apps/api/lib/mcp-domain-commands.ts` (`createLegacyToolCommandSchema`, `updateLegacyToolCommandSchema`, `previewLegacyToolCompileCommandSchema`, `legacyToolParamSchema`, `legacyRequestTemplateSchema`, `updateServerCommandSchema`, `invokeToolCommandSchema`)
- [x] 2.2 Make server-value commands canonical: `kind` + `owner`-preserving create/update/delete by stable id in `mcp-domain-commands.ts`
- [x] 2.3 Remove `MCP_FIELD_LIMITS.legacyPathTemplate` from `apps/api/lib/mcp-request-definition.ts`
- [x] 2.4 Remove legacy-only error codes `MCP_LEGACY_PROJECTION_UNAVAILABLE` and `MCP_LEGACY_DOWNGRADE_REJECTED` from `packages/core/src/error-codes.ts` and their mappings in `apps/api/lib/mcp-result.ts`
- [x] 2.5 Remove legacy telemetry events (`legacyCompatWrite`, `legacyConversion`, `definitionNotProjectable`) from `apps/api/lib/mcp-telemetry.ts`

## 3. Canonical-only execution and publishing

- [x] 3.1 Remove `loadVariables`, the runtime legacy-template fallback in `compilePlanForTool`, and legacy fields from `ToolCompileInputs` in `apps/api/services/mcp-executor-service.ts`, making execution fail closed
- [x] 3.2 Remove the legacy common-entries fallback, `pathTemplate`, and `isSecret` handling from `apps/api/services/mcp-publishing-service.ts`
- [x] 3.3 Remove `pathTemplate`/`isSecret` from publication candidate/fingerprint/diff models in `apps/api/lib/mcp-publishing.ts`
- [x] 3.4 Delete `apps/api/lib/mcp-template.ts`, `apps/api/lib/mcp-legacy-migrate.ts`, `apps/api/services/mcp-backfill-service.ts`, and `apps/api/scripts/backfill-mcp-execution-boundary.ts` once no callers remain

## 4. Canonical-only Studio service

- [x] 4.1 Remove legacy tool authoring (`createLegacyTool`, `updateLegacyTool`, `previewLegacyToolCompile`, `compileLegacyToolForPersistence`, `collectTemplateWarnings`, `validateToolTemplates`, `CreateLegacyToolInput`, `UpdateLegacyToolInput`, `TemplateWarning`) from `apps/api/services/mcp-studio-service.ts`
- [x] 4.2 Remove compatibility projections, conversion drafts, and dual writes (`projectDefinitionToLegacy`, `projectCommonEntriesToLegacy`, `renderDefinitionToLegacy`, `compatibilityProjectable`, `legacyProjectable`, `conversionDraft`, `conversionIssues`) from `mcp-studio-service.ts`
- [x] 4.3 Make `createTool`/`updateTool`/`duplicateTool`/`confirmCurlImport` persist only canonical `requestDefinition` + compiled plan
- [x] 4.4 Make common-entry reads/writes and auth composition (`getServer`, `updateServer`, `getServerCommon`, `updateServerCommon`, `setServerAuth`, `findServerValueReferences`, `deleteVariable`) operate on `commonEntries`, `authConfiguration`, and server-value `kind`/`owner` only
- [x] 4.5 Rewrite connectivity probe `testConnection` to render canonical common entries and explicit auth configuration without the legacy template engine
- [x] 4.6 Make server-value `createVariable`/`updateVariable`/`listVariables` use `kind`/`owner` with secret write-only responses and config/secret storage exclusivity
- [x] 4.7 Remove `InferredServerAuth` and legacy auth inference from `apps/api/lib/mcp-auth-recipe.ts` and `apps/api/index.ts`, keeping explicit recipe mapping and credential helpers

## 5. Canonical-only routers and Platform MCP

- [x] 5.1 Remove `createLegacyTool`, `updateLegacyTool`, and `previewLegacyToolCompile` procedures from `apps/api/routers/mcp.ts`
- [x] 5.2 Remove `defaultHeaders`/`defaultQuery` from `updateServer` and replace `isSecret` with `kind` on `createVariable`/`updateVariable`
- [x] 5.3 Make `getToolEditorState` and `getServerCommon` return canonical state only in `mcp-studio-service.ts` and update the router read shapes
- [x] 5.4 Remove `conversionDraft`/`conversionIssues`/`compatibilityProjectable` from `apps/api/lib/mcp-platform.ts` and require canonical definitions in Platform responses

## 6. Canonical-only Studio SPA

- [x] 6.1 Remove legacy inference/compilation helpers from `apps/app/lib/value-origin.ts` while keeping canonical typed origin types
- [x] 6.2 Remove conversion-draft flow and legacy path/template/params fallbacks from `apps/app/components/servers/tool-form-dialog.tsx`
- [x] 6.3 Remove the `defaultHeaders`/`defaultQuery` fallback and switch variables to `kind`/`owner` in `apps/app/components/servers/settings-tab.tsx`
- [x] 6.4 Rewrite `edit-variable-dialog.tsx` around `kind` and keep ownership read-only
- [x] 6.5 Rewrite `delete-variable-dialog.tsx` reference detection from typed `requestDefinition` bindings and `commonEntries`
- [x] 6.6 Derive a display-only path summary in `tools-tab.tsx` and remove the legacy `pathTemplate` column
- [x] 6.7 Delete dead legacy editors `params-editor.tsx` and `key-value-editor.tsx` if unreferenced
- [x] 6.8 Remove legacy read fields (`conversionDraft`, `isSecret`, `defaultHeaders`, `defaultQuery`) from `apps/app/hooks/use-mcp.ts` and `apps/app/routes/(app)/servers/$serverId.tsx`
- [x] 6.9 Remove placeholder-name special handling from `apps/app/lib/errors.ts`
- [x] 6.10 Remove legacy-only i18n keys and add canonical copy with en/es parity in `apps/app/i18n/locales/en/servers.ts`, `es/servers.ts`, `en/errors.ts`, `es/errors.ts`

## 7. Tests, documentation, and residue

- [x] 7.1 Delete legacy-only test files for removed modules and rewrite mixed tests to canonical fixtures
- [x] 7.2 Update `apps/api/docs/mcp-typed-authoring.md` and `apps/api/docs/mcp-execution-boundary.md` to canonical-only guidance
- [x] 7.3 Remove the legacy exception note from root `AGENTS.md` and any other stale documentation
- [x] 7.4 Run a repository-wide residue search for legacy symbols and remove any remaining callers or fixtures
- [x] 7.5 Run `bun typecheck`, `bun lint`, focused tests, and `bunx prettier --write .`
- [x] 7.6 Validate the change with `openspec validate remove-preproduction-mcp-legacy-paths --strict`
