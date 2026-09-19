## Why

The MCP builder still preserves unreleased request-template, default-map, variable, and tool-authoring contracts alongside the typed model. Those compatibility paths create multiple sources of truth, allow malformed development records to reach execution, and make Studio and platform behavior harder to reason about even though the product is still pre-production and its data is disposable.

## What Changes

- **BREAKING**: Remove legacy MCP persistence fields and make typed request definitions, compiled plans, common entries, authentication configuration, and typed server values the only stored model.
- **BREAKING**: Remove legacy tool create/update/preview procedures, compatibility projections, conversion drafts, dual writes, fallback reads, and runtime template compilation.
- **BREAKING**: Require development databases to be reset or contain only canonical typed records before applying the destructive schema migration; no runtime backfill or compatibility window is provided.
- Make Studio load and edit explicit persisted origins and stable value identifiers instead of inferring intent from placeholder strings or legacy maps.
- Make platform authoring APIs accept only strict typed inputs and make the gateway reject tools that do not have a valid canonical execution contract.
- Remove legacy-only telemetry, errors, localization copy, tests, scripts, and documentation after their callers disappear.
- Preserve external MCP protocol behavior, curl import isolation, secret redaction, authorization, and transactional guarantees.

Non-goals:

- Reworking icon persistence, token-scope persistence, agent-facing tool descriptions, or published revision architecture; those belong to active changes already responsible for them.
- Preserving unreleased development records, accepting obsolete request payloads, or providing downgrade support.
- Squashing or rewriting existing shared Drizzle migration history.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-templates`: Retire legacy template compilation and make canonical typed persistence and server-value metadata mandatory.
- `mcp-studio`: Remove conversion/inference workflows and expose only explicit typed authoring state.
- `platform-mcp`: Remove legacy authoring payloads and compatibility projections from platform tools.
- `mcp-gateway`: Eliminate runtime fallback compilation and require a valid canonical execution contract.

## Impact

This affects the MCP Drizzle schema and generated migration, Studio and platform tRPC inputs, MCP domain commands and services, executor and auth composition, React authoring forms, shared error codes and telemetry, localization, tests, and obsolete migration/backfill scripts. The change is intentionally destructive to development-only MCP records and must be coordinated with the four active MCP changes listed above.
