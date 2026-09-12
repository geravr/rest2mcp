## 1. Foundation

- [ ] 1.1 Add studio/gateway `APP_ERROR_CODES` in `packages/core` and map them in API i18n-ready handlers (`MCP_SERVER_NOT_FOUND`, `MCP_TOOL_NOT_FOUND`, `MCP_CREDENTIAL_REQUIRED`, `MCP_HOST_NOT_ALLOWED`, `MCP_MUTATION_NOT_ALLOWED`, `MCP_AGENT_TOKEN_INVALID`, `MCP_UPSTREAM_ERROR`, `MCP_CURL_INVALID`, `MCP_TOOL_NAME_CONFLICT`, `MCP_SERVER_SLUG_CONFLICT`)
- [ ] 1.2 Add required `MCP_CREDENTIAL_SECRET` (min 32) to `apps/api/lib/env.ts` and root `.env.example`
- [ ] 1.3 Add Drizzle schemas for `mcp_server`, `mcp_tool`, `mcp_credential`, `mcp_agent_token`, `mcp_call_log` with prefixed ids (`mcs`, `mct`, `mcr`, `mtk`, `mcl`), relations, and export from `db/schema`
- [ ] 1.4 Generate and apply a single Drizzle migration (`bun db:generate`, `bun db:migrate`)

## 2. Shared security and executor

- [ ] 2.1 Implement AES-256-GCM credential encrypt/decrypt using `MCP_CREDENTIAL_SECRET` with unit tests
- [ ] 2.2 Implement agent-token generate/hash/verify (SHA-256, prefix display, show raw once) with unit tests
- [ ] 2.3 Implement curl parser (method, URL, headers, body; never copy auth headers onto tools) with unit tests for valid curl, invalid curl, and secret stripping
- [ ] 2.4 Implement host allowlist + DNS SSRF checks (reject private, loopback, link-local, metadata; no cross-host redirects) with unit tests
- [ ] 2.5 Implement `executeMappedTool` (build URL, inject credential, mutation/enabled/paused rules, 15s timeout, 256 KiB response cap, redacted 64 KiB log summary) and persist `mcp_call_log`

## 3. Studio control plane (tRPC)

- [ ] 3.1 Add `mcp-studio-service` for owner-scoped server CRUD, slug uniqueness, derived `allowedHosts`, traffic-light helper, and pagination
- [ ] 3.2 Add tool create/update (manual + curl), 50-tool cap, mutation defaults, and credential set/replace (`hasSecret` only on read)
- [ ] 3.3 Add server agent-token create/list/revoke and connection snippet (`{API_ORIGIN}/mcp/{serverId}`)
- [ ] 3.4 Add thin `mcp` tRPC router (`protectedProcedure`), mount on `appRouter`, and service tests for ownership isolation

## 4. Product gateway

- [ ] 4.1 Spike Streamable HTTP on Hono/Bun; isolate adapter in `lib/mcp-http.ts` (stateless if possible)
- [ ] 4.2 Mount `/mcp/:serverId` that authenticates `kind=server` tokens, lists enabled tools, and executes via `executeMappedTool` with source `agent`
- [ ] 4.3 Add gateway tests: missing token, wrong-server token, mutation blocked, host not allowed, paused server, secret not echoed

## 5. Observability APIs

- [ ] 5.1 Add playground invoke tRPC mutation (same executor, source `playground`)
- [ ] 5.2 Add paginated call-log list (owner only; not-found for other users) and include traffic light on server get/list
- [ ] 5.3 Add tests for traffic-light states (draft, green unused, yellow, red, paused) and log redaction

## 6. Platform MCP

- [ ] 6.1 Add platform token create/revoke on the user (Settings-facing tRPC) with `kind=platform`
- [ ] 6.2 Mount `/api/platform-mcp` with the design tool list; reuse studio services; `test_tool` logs source `platform`
- [ ] 6.3 Add tests: server token rejected on platform route, ownership on `add_tool`, `list_servers` omits secrets, snippet has no ciphertext

## 7. SPA

- [ ] 7.1 Add `/(app)/servers/` list route with pagination, traffic light, empty state, and nav item; wire dashboard to this real list
- [ ] 7.2 Add `/(app)/servers/$serverId` tools tab: create manual tool, import curl, enable/`allowMutation`, 50-tool messaging
- [ ] 7.3 Add credential + connection snippet + token revoke UI (raw token shown once)
- [ ] 7.4 Add playground invoke and paginated logs tab using shared skeletons and control-level pending
- [ ] 7.5 Add Settings control to create/revoke the platform token and copy `/api/platform-mcp` snippet
- [ ] 7.6 Add en/es strings (layout, servers, playground, logs, settings, toasts) and map new `appCode` values in `resolveErrorMessage`

## 8. Verification

- [ ] 8.1 Run `bun typecheck`, `bun lint`, and tests for touched workspaces
- [ ] 8.2 Format with `bunx prettier --write` on edited files
- [ ] 8.3 Manual loop: create server, add GET tool, set credential, playground, copy snippet (do not treat GHL as in-scope)
