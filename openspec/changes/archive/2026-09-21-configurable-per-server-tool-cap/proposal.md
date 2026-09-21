## Why

The per-server MCP tool cap is a hardcoded `50` duplicated in two places: `MCP_MAX_TOOLS_PER_SERVER` in the API (`apps/api/lib/mcp-redact.ts`) and `MCP_MAX_TOOLS` in the SPA (`apps/app/lib/mcp-limits.ts`), plus the same number spelled out in the Studio alert copy (`en`/`es` `servers.toolCap`). Two literals for one deployment fact can drift, and a self-hosted deployment cannot raise or lower the cap without editing source.

## What Changes

- **Add** an optional `MCP_MAX_TOOLS_PER_SERVER` environment variable (default `50`, accepted range `1-500`) that sets the effective per-server tool cap.
- **Move** the default and the accepted range to `@repo/core` (`MCP_MAX_TOOLS_PER_SERVER_DEFAULT`, `MCP_MAX_TOOLS_PER_SERVER_BOUNDS`) as the single source, validated by the API environment schema.
- **Split** the environment schema into a Bun-free `apps/api/lib/env-schema.ts` (with `apps/api/lib/env.ts` still parsing `Bun.env`) so configuration modules can be imported by the Node-based test runner.
- **Resolve** the effective cap through one API accessor (`apps/api/lib/mcp-limits.ts`) used by tool creation, tool duplication, curl import, settings recompilation, and OpenAPI import capacity and confirmation.
- **Expose** the effective cap in the Studio server detail (`limits.maxToolsPerServer`) and drive the SPA tools tab from it, removing `MCP_MAX_TOOLS` and the literal in the alert copy.
- **Remove** `MCP_MAX_TOOLS_PER_SERVER` from `apps/api/lib/mcp-redact.ts` (secret redaction is not its concern).

## Capabilities

### Modified Capabilities

- `mcp-studio`: the per-server tool limit becomes deployment configuration instead of a fixed constant, and the Studio reports the configured value.

## Non-goals

- Per-user or per-server cap overrides stored in the database.
- Changing the tool-group cap (`MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer`), the OpenAPI selection cap, or any other bounded limit.
- Reworking how the cap is enforced (locking, revision conflicts, and error codes are unchanged).

## Impact

- **Configuration:** new optional `MCP_MAX_TOOLS_PER_SERVER`, documented in `.env.example`; unset keeps the current behavior (`50`).
- **API:** `apps/api/lib/env-schema.ts` (new, Bun-free schema), `apps/api/lib/env.ts` (accessor only), new `apps/api/lib/mcp-limits.ts`, `mcp-studio-service.ts`, `mcp-openapi-import-service.ts`, `mcp-redact.ts`; `getServer` returns `limits.maxToolsPerServer`.
- **SPA:** `tools-tab.tsx` takes `toolLimit` from the route instead of a local constant; `apps/app/lib/mcp-limits.ts` drops `MCP_MAX_TOOLS`; `servers.toolCap` copy takes a `{limit}` placeholder in both locales.
- **Behavior:** lowering the cap below a server's current tool count blocks new tools and publication until the surplus is disabled; no data migration or backfill.
