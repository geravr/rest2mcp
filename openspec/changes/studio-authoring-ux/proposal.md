# Proposal: studio-authoring-ux

## Why

The template engine made the studio expressive, but the authoring experience still belongs to layer 1: the tool form cannot declare params, a POST tool is born disabled with no explanation, tools and servers cannot be edited or deleted, the curl import is a fire-and-forget textarea that hides what it captured, the playground asks for raw JSON, and the server list is a bare table. The studio's core promise — "from a curl to a tool your agent understands in 30 seconds" — is not yet true in the GUI.

## What Changes

- **Server list becomes cards**: auto logo from the base-URL domain favicon (initials fallback), traffic light, status, tool count, last activity, and quick actions (copy MCP URL, pause/resume). Pagination contract preserved.
- **Server creation guides**: description field, optional inline connectivity test against `baseUrl`, and a post-create next step pointing at the first tool.
- **Server detail gains management**: edit name/description/baseUrl, and delete server with type-to-confirm (cascades tools, variables, tokens, and that server's call logs).
- **Tool authoring form (create and edit)**: method select, path with live `{{placeholder}}` detection, params editor (description, required, type), key-value editors for query/headers with variable autocomplete, body editor with `bodyType` (json/form/raw), visible `allowMutation`/`enabled` toggles with explanation, save-time warnings (placeholder without param), delete and duplicate actions.
- **Interactive curl import**: two-phase flow — dry-run parse preview, mark each detected value as agent param / variable (secret flag) / literal, then create. Captured variables are reported, never silent.
- **Playground asks for params, not JSON**: one field per declared param by type, and the result view links to the persisted call log.
- **Backend support endpoints**: `deleteServer`, `deleteTool`, dry-run `parseCurl` (no writes), `testConnection` (SSRF-guarded probe that renders default headers including secret variables), and server list enrichment (tool count, last call at). Platform MCP gains `delete_server` / `delete_tool` for parity.
- Replace default headers/query JSON textareas with the same key-value editor; replace native `<select>` elements with the shared Select component; en/es parity for all new copy.

**Non-goals:** template engine semantics (shipped); response projection; multipart/binary tools; OpenAPI import; recipe save/share/marketplace; on-prem connector; server icon upload (favicon is automatic); changes to traffic-light derivation.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `mcp-studio`: adds delete server (cascade) and delete tool; curl import becomes two-phase (dry-run parse, then create with value markings); connectivity test against `baseUrl`; server list items carry tool count and last-activity metadata.
- `platform-mcp`: tool list gains `delete_server` and `delete_tool` with the same ownership rules.

## Impact

- **apps/api:** new service functions (`deleteServer`, `deleteTool`, `parseCurlPreview`, `testConnection`) and tRPC procedures; `listServers` meta enrichment; two new platform MCP tools; tests.
- **apps/app:** rebuilt `servers/index.tsx` (cards), create/edit server dialogs, rebuilt `tools-tab.tsx` (form + edit + delete + interactive import), rebuilt `playground-tab.tsx` (param form), shared key-value editor and params editor components, favicon component, i18n en/es.
- **db:** no schema changes (call-log FKs already `set null`; server delete removes its logs explicitly).
- **packages/core:** no new error codes expected (reuses `MCP_SERVER_NOT_FOUND`, `MCP_TOOL_NOT_FOUND`, `MCP_UPSTREAM_ERROR`, `MCP_HOST_NOT_ALLOWED`, `MCP_CURL_INVALID`).
