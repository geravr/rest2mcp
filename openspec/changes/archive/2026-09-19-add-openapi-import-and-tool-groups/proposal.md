## Why

Creating REST tools one endpoint at a time does not scale when an API already has a usable OpenAPI description, and the current flat Studio list becomes difficult to maintain as a server approaches its tool limit. Owners need a safe, reviewable bulk-import path and presentation-only organization without changing published MCP behavior.

## What Changes

- Add a two-phase OpenAPI 3.0/3.1 JSON import flow from a local file, pasted JSON, or a public document URL: validate and preview first, then atomically create selected typed draft tools.
- Map supported operations, parameters, request bodies, descriptions, annotations, and tags into canonical request definitions; return per-operation warnings or blocking diagnostics for unsupported or ambiguous constructs.
- Keep imported tools disabled, never import credential values, never modify server authentication/common values, and require normal review and publication before agent-visible behavior changes.
- Add owner-managed, single-membership tool groups for Studio filtering and maintenance, with optional assignment during manual, curl, and OpenAPI creation. OpenAPI tags may suggest or create groups.
- Keep groups outside MCP discovery, execution, contracts, publication fingerprints, and immutable revisions; group changes are presentation-only and deleting a group leaves its tools ungrouped.
- Record secret-safe OpenAPI provenance so later reconciliation can identify imported operations without implementing automatic synchronization in this change.
- Non-goals: YAML, Swagger/OpenAPI 2.0, OpenAPI 3.2, external references, automatic re-import/synchronization, runtime group scoping, group-aware tokens/endpoints, Platform MCP group management or OpenAPI import, and silent approximation of unsupported OpenAPI semantics.

## Capabilities

### New Capabilities

- `openapi-import`: Secure OpenAPI JSON ingestion, preview, mapping, selection, provenance, and atomic disabled-draft creation.
- `tool-groups`: Studio-only group lifecycle, assignment, filtering, counts, and preservation across publication operations.

### Modified Capabilities

- `mcp-studio`: Extend manual and curl authoring with optional group assignment and integrate OpenAPI import into the Tools surface.

## Impact

This affects the MCP Drizzle schema and migration, typed domain commands, Studio services and tRPC router, SSRF-safe document retrieval, OpenAPI parsing/mapping utilities, the React Tools UI and import dialogs, en/es localization, telemetry/error codes, and tests. Implementation targets the canonical typed model from `remove-preproduction-mcp-legacy-paths` and preserves the active draft-versus-published boundary.
