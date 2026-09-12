# Tasks: studio-template-engine

## 1. Schema and migration

- [ ] 1.1 Add `mcp_server_variable` table (serverId, name, isSecret, value, ciphertext, timestamps; unique `(serverId, name)`) and `mcp_server.defaultHeaders` / `defaultQuery` jsonb columns in `db/schema/`
- [ ] 1.2 Add `mcp_tool.requestTemplate` (`{ query?, headers?, body?, bodyType }`) and `mcp_tool.params` jsonb columns; keep `paramMap` readable for backfill
- [ ] 1.3 Generate migration A with `bun db:generate` and apply with `bun db:migrate`

## 2. Template renderer

- [ ] 2.1 Create `apps/api/lib/mcp-template.ts`: placeholder extraction (`{{name}}`), args-first-then-variables resolution, and `MCP_TEMPLATE_UNRESOLVED` failure
- [ ] 2.2 Implement context-aware escaping (path/query URL-encode, header CRLF strip, JSON quoted vs bare, form URL-encode, raw passthrough)
- [ ] 2.3 Unit-test the renderer across all contexts, including unresolved, collision (arg shadows variable), and bare JSON object injection cases

## 3. Variables and server model in studio service

- [ ] 3.1 Add variable CRUD to `mcp-studio-service.ts` (create/list/update/delete, name validation, secret encryption via `mcp-crypto`, write-only reads returning `hasValue`)
- [ ] 3.2 Preserve `baseUrl` path prefix in `createServer`/`updateServer` (strip query/fragment only) and keep `allowedHosts` derivation by host
- [ ] 3.3 Add defaultHeaders/defaultQuery update path with template-aware values
- [ ] 3.4 Replace literal-auth-header silent drops with save-time `MCP_PLAINTEXT_SECRET` rejection; allow templated auth headers
- [ ] 3.5 Add new `APP_ERROR_CODES` (`MCP_TEMPLATE_UNRESOLVED`, `MCP_VARIABLE_NAME_CONFLICT`, `MCP_PLAINTEXT_SECRET`) to `packages/core` with en/es client copy

## 4. Executor rewrite

- [ ] 4.1 Rebuild request construction in `mcp-executor-service.ts` on the renderer: baseUrl prefix + path template, merged default/tool query and headers, typed body (json/form/raw), no body for GET/HEAD
- [ ] 4.2 Collect every decrypted secret variable used in a render and pass all values to log redaction
- [ ] 4.3 Update executor tests: variables in each position, defaults merge and tool override, unresolved placeholder, redaction across query and body

## 5. Gateway input schemas

- [ ] 5.1 Derive per-tool zod input schemas from `params` (type mapping, descriptions, required list) in `mcp-gateway.ts`, replacing `z.looseObject({})`
- [ ] 5.2 Gateway tests: advertised schema matches params; paramless tool advertises empty object schema

## 6. Curl import capture

- [ ] 6.1 Rework `createToolFromCurl` to emit request templates and typed bodies from the parsed curl
- [ ] 6.2 Auto-capture detected auth headers as secret variable + default header, returning `capturedVariable`/`capturedHeader` in the response
- [ ] 6.3 Update curl import tests (capture path, literal-free tools, invalid curl)

## 7. Platform MCP and tRPC surface

- [ ] 7.1 Replace `set_credential` with `set_variable`, `list_variables`, `delete_variable` in `mcp-platform.ts`; extend `add_tool` with template and params fields
- [ ] 7.2 Update `routers/mcp.ts`: variable procedures, template-aware tool inputs, remove `setCredential`
- [ ] 7.3 Update platform and router tests for the new tool list and payloads

## 8. SPA minimal rework

- [ ] 8.1 Replace the credential form in `connection-tab.tsx` with a variables manager (list with secret badges, add with secret flag, delete; write-only secret inputs)
- [ ] 8.2 Add server default headers/query editing to the server detail flow
- [ ] 8.3 Add/refresh en/es locale strings for variables, defaults, and new error codes

## 9. Backfill and cleanup

- [ ] 9.1 Write `db/scripts/` backfill: `paramMap` buckets → `requestTemplate`/`params`; `mcp_credential` rows → secret variable + default header (or per-tool query entries for `query` location)
- [ ] 9.2 Run `bun db:export`, execute backfill, verify a sampled server renders identically to its pre-migration mapping
- [ ] 9.3 Generate migration B dropping `paramMap` and `mcp_credential`; apply
- [ ] 9.4 Update recipe-template shape in `getServer` (variable names/flags, no values) and its tests

## 10. Verification

- [ ] 10.1 `bun typecheck`, `bun lint`, `bun test` green across db, api, app, core
- [ ] 10.2 `bunx prettier --write .`
- [ ] 10.3 `openspec validate studio-template-engine --strict`
