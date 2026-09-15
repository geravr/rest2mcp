## 1. Auth recipe mapping

- [ ] 1.1 Add a shared auth-recipe helper (types, paste normalization, variable names, default header/query templates, Basic Base64, infer None/Bearer/Header/Query/Basic/Custom)
- [ ] 1.2 Unit tests: Bearer prefix strip, Shopify-style header name, Basic encode, Custom when two credential defaults exist, None when empty

## 2. Apply recipe in the studio service

- [ ] 2.1 Implement `applyAuthRecipe` / `setServerAuth` in one transaction (upsert secret variable, set mapped default, replace previous recipe keys, delete unreferenced prior variable)
- [ ] 2.2 Extend `createServer` to accept optional `auth` and apply it before returning
- [ ] 2.3 Add tRPC `mcp.setServerAuth` plus `createServer` input; reject empty credentials for non-none types
- [ ] 2.4 Service tests: bearer create, none create, switch bearer→header without dropping unrelated `Version`, none clears unreferenced `api_token`, empty token rejected

## 3. Curl import and plaintext guard

- [ ] 3.1 Skip credential upsert and default overwrite when the server already has an auth-ish default header or credential query; report “existing auth kept”
- [ ] 3.2 Stop writing agent-param credentials into server default headers
- [ ] 3.3 Broaden `isAuthHeaderName` to names containing `token` or `secret`; test `X-Shopify-Access-Token` literal → `MCP_PLAINTEXT_SECRET`
- [ ] 3.4 Curl tests: keep existing Bearer; capture when none; param marking does not set server Authorization

## 4. Executor, playground contract, gateway

- [ ] 4.1 Return completed HTTP responses from `executeMappedTool` (`ok`, `httpStatus`, body, `callLogId`); log success on 2xx and error otherwise; throw only when upstream is not reached
- [ ] 4.2 Executor tests: 401 returns body + error log; 200 unchanged; mutation/disabled/unresolved still throw
- [ ] 4.3 Gateway/platform `test_tool` keep returning tool results with `httpStatus`; update tests so 401 is not `MCP_UPSTREAM_ERROR`

## 5. Platform MCP

- [ ] 5.1 Extend `create_server` with optional `auth`; register `set_server_auth`
- [ ] 5.2 Tests: bearer create omits secret; set header auth; curl import keeps existing auth

## 6. Create dialog and connection test

- [ ] 6.1 Auth type control on create with conditional fields (`password` inputs); compile recipe into `createServer`; hide variable names and `isSecret`
- [ ] 6.2 Remove auto `testConnection` on create success; add an explicit Test connection button on that step
- [ ] 6.3 en/es copy for types, fields, test button, existing-auth-kept (curl)
- [ ] 6.4 Create-dialog tests: Bearer submit payload, None omits auth, no probe until button click

## 7. Settings Auth card

- [ ] 7.1 Auth card that infers scheme, edits typed recipes via `setServerAuth`, and shows Custom without clobbering extra defaults
- [ ] 7.2 Test connection button on the Auth card using current saved defaults
- [ ] 7.3 Settings tests: infer Bearer, save None, Custom leaves partner header

## 8. Playground UX

- [ ] 8.1 Render HTTP status + body for every invoke result (including 4xx/5xx); link to log; clear panel on new submit; no success/error toast for HTTP results
- [ ] 8.2 Disable invoke with a reason for disabled tools, mutation-blocked tools, and paused servers
- [ ] 8.3 Playground tests: 401 panel, disabled copy, previous result cleared

## 9. Verification

- [ ] 9.1 `bun typecheck`, `bun lint`, focused api + app tests, then `bunx prettier --write .`
- [ ] 9.2 `openspec validate simplify-server-auth --strict`
