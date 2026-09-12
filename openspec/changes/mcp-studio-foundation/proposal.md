## Why

Official and generated MCP catalogs still leave holes, especially around a user's own REST APIs. rest2mcp's product is a simple studio: map REST to tools, host the MCP, paste one URL into an agent. The starter has auth and an empty dashboard; this change ships that loop so a user (or their agent) can build and use a server the same day.

## What Changes

- Add a single-user **MCP studio**: create a server, add tools by form or by pasting a curl, store an encrypted upstream credential, copy a hosted MCP URL plus an agent token.
- Add a **hosted MCP gateway** (Hono Streamable HTTP, not tRPC) that authenticates the agent token and proxies approved tools to the upstream REST API.
- Add a **calm GUI**: server list, connection snippet, traffic light, playground invoke, call log. Building is also available through a **platform MCP** so the user's existing agent can create servers and tools in conversation.
- Shape server/tool/credential records so a later change can snapshot a **private recipe** (template without secrets). This change does not save, share, or publish recipes.

**Non-goals:** OpenAPI import; recipe save/share/marketplace; on-prem connector; GHL-specific or any vertical catalog; upstream OAuth; organizations; self-heal inbox; meta-tool facade; first-class multipart/file tools.

## Capabilities

### New Capabilities

- `mcp-studio`: Owner CRUD for MCP servers, REST tools (manual + curl), encrypted credentials, and a connection snippet. Records stay recipe-ready (auth scheme without secret values).
- `mcp-gateway`: Hosted Streamable HTTP MCP runtime: agent-token auth, host allowlist, read-only default, secret-safe proxy to upstream REST.
- `mcp-observability`: Playground invoke, traffic light, and paginated call log (no secrets).
- `platform-mcp`: Authenticated platform MCP so the owner's agent can create a server, add a tool from curl or fields, test it, and fetch the connection snippet.

### Modified Capabilities

- None. `openspec/specs/` has no existing product capabilities.

## Impact

- **db:** New Drizzle tables (`mcp_server`, `mcp_tool`, `mcp_credential`, `mcp_agent_token`, `mcp_call_log`) and one migration.
- **apps/api:** `mcp` tRPC router + services; Hono mounts for `/mcp/:serverId` (agent) and `/api/platform-mcp` (owner session); `@modelcontextprotocol/sdk`; encryption for credential secrets; new `APP_ERROR_CODES`.
- **apps/app:** Server list/detail routes, playground, logs, connection copy; en/es i18n; dashboard entry that is real, not decorative.
- **packages/core:** Error codes for studio/gateway failures.
- **scripts/mcp.ts:** Unchanged stub; not the product runtime.
