# Proposal: add-server-icon-upload

## Why

MCP server cards and detail headers rely on Google's favicon service, which returns a generic globe for domains without a real favicon. The image loads successfully, so the initials fallback never appears. Owners also need a way to override the automatic icon when branding matters or the domain has no useful favicon.

## What Changes

- Add optional `iconImage` on owned MCP servers, stored as a user-scoped storage access URL (same pattern as profile avatars).
- Extend `updateServer` and server read/list payloads to include `iconImage`.
- Replace `ServerFavicon` with a resolver that prioritizes custom icon, then DiceBear **rings** (seeded by server id), dropping the Google s2 favicon dependency and text-initials fallback.
- Add icon upload and remove controls on the server **Settings** tab (JPG/PNG/WebP, 5 MB client limit).
- Add en/es copy for icon management and S3-not-configured messaging.

**Non-goals:** icon upload during server creation; server-side favicon probing; detecting Google's generic globe heuristically; changing platform MCP tools; public/unauthenticated icon URLs.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `mcp-studio`: server model and update API gain optional `iconImage`; server list/detail responses expose it; UI resolves server icons with custom upload, DiceBear rings fallback, and Settings-tab management.

## Impact

- **db:** new nullable `iconImage` column on `mcp_server` plus generated migration.
- **apps/api:** `updateServer` input/output, `listServers`, `getServer`; reuse existing `/api/storage/upload` (no new routes).
- **apps/app:** `ServerIcon` resolver/helper, component updates on list/detail/edit, Settings tab upload UX, i18n en/es, Vitest for resolver.
- **packages/core:** no new error codes expected (reuse storage and validation errors).
