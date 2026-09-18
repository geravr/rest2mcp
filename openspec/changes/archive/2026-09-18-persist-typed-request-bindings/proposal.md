## Why

The request builder presents Fixed, Server value, and Agent input as distinct origins, but normal Studio and Platform authoring still serializes them into legacy `{{placeholder}}` strings and asks the backend to infer the source again. This loses stable ids and type intent, makes literal placeholder-shaped text ambiguous, and allows a tool's meaning to change when server values are renamed or added.

## What Changes

- Make the versioned typed `requestDefinition` the canonical create, edit, duplicate, preview, and Platform authoring payload for tools.
- Persist literal, server-configuration, server-secret, and agent-input bindings by stable id across path, ordered query entries, headers, form fields, and structured JSON nodes.
- Persist agent-input metadata once and reference it by id from every request location.
- Make server common headers/query use the same typed literal or server-value bindings.
- Compile and validate the submitted typed definition before saving; invalid definitions cannot be enabled and return location-aware issues.
- Load versioned definitions directly into Studio without reclassifying values from text or current server-value names.
- Keep legacy template analysis only for unmigrated records, then save the owner's resolved result as a typed definition.
- Continue generating legacy compatibility fields when the typed definition has a lossless projection, but never treat them as authoritative for a typed record.
- Update Platform MCP authoring to accept the shared typed command shape and require `secret-reference` scope before resolving secret ids.

**Non-goals:** changing gateway transport behavior, curl credential policy, authentication recipes, rate limits, observability, or removing legacy database columns in this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-templates`: Typed request bindings and common entries become the canonical persisted authoring contract rather than a derived representation of legacy templates.
- `mcp-studio`: Studio creates, edits, duplicates, previews, and reopens tools using persisted typed origins and stable ids.
- `platform-mcp`: Agent-driven tool authoring uses the same typed definition and scope-aware server-value references as Studio.

## Impact

This affects the Studio tool/default editors, frontend request types and adapters, tRPC authoring schemas, Platform MCP tool schemas, MCP Studio services, compiler integration, legacy compatibility conversion, and related tests. Existing typed database columns remain in use; a migration may be needed only for backfill/version metadata discovered during implementation. No new runtime dependency or public gateway URL is introduced.
