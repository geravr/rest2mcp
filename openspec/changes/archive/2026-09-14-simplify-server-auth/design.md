## Context

Auth is already a convention, not a table: a secret row in `mcp_server_variable` plus a template on `mcp_server.defaultHeaders` or `defaultQuery` (for example `Authorization: Bearer {{api_token}}`). Curl import already writes that pair. The create dialog does not: it stores name + `baseUrl`, then auto-runs `testConnection` with no credentials. Settings then asks the owner to invent a variable name, mark it secret, and wire a Variable origin with a `Bearer ` prefix.

The playground shares `executeMappedTool` with the gateway. Any non-2xx upstream response throws `MCP_UPSTREAM_ERROR`, so a missing or wrong token looks like a product failure and the body never reaches the SPA.

This change is a facade plus invoke honesty. Storage stays variables + defaults. No `authType` column, no `mcp_credential`.

## Goals / Non-Goals

**Goals:**

- Owners pick an auth type (or none) and fill only the fields that type needs.
- Secrets are encrypted without an `isSecret` question.
- Create and Settings write the same mapping in one transaction.
- Connection tests run only when the owner clicks a button.
- Curl import does not silently rotate an existing server credential.
- Playground and gateway return upstream HTTP bodies (including 401) so owners and agents can see what the API said.

**Non-Goals:**

- OAuth2, HMAC, AWS SigV4, session cookies.
- Restoring `mcp_credential` or persisting `authType`.
- Two-key recipes (WooCommerce `consumer_key` + `consumer_secret`) as a dedicated type — Custom / Settings defaults cover them.
- Renaming variables or rewriting `{{old}}` in templates.
- Auto-detecting auth from `baseUrl`.
- Marketing-site copy.

## Decisions

### 1. Facade recipe, inferred later — never stored as `authType`

API shape (conceptual):

```
none    { type: "none" }
bearer  { type: "bearer"; token: string }
header  { type: "header"; headerName: string; value: string }
query   { type: "query"; paramName: string; value: string }
basic   { type: "basic"; username: string; password: string }
```

`createServer` accepts optional `auth` (omit or `none` → no mapping). Settings calls `setServerAuth` with the same object. Mapping:

| Type   | Variable                       | Default                                                                                      |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------------- |
| bearer | `api_token`                    | `Authorization: Bearer {{api_token}}`                                                        |
| header | slug of header, else `api_key` | `{headerName}: {{name}}`                                                                     |
| query  | slug of param, else `api_key`  | `defaultQuery[paramName] = {{name}}`                                                         |
| basic  | `basic_auth`                   | `Authorization: Basic {{basic_auth}}` where the stored secret is Base64(`username:password`) |

Reads infer the type from defaults + variable names using the same rules as tool origin inference. Unrecognized combinations are **Custom**: the Auth card does not pretend to edit them; the existing default-header/query editors remain the source of truth.

**Alternatives considered:** persist `authType` — rejected; curl and manual default edits would desync it. Restore `mcp_credential` — rejected; two secret systems. Encode Basic at render time with template functions — rejected; the renderer has no functions.

### 2. Normalize pasted secrets, hide internal names

On save, trim. For bearer, strip a leading `Bearer ` / `Token ` (case-insensitive). For header/query, if the value looks like `HeaderName: token`, keep the token. Empty credential with a non-none type is rejected. Create/Settings recipe fields use `type=password` and never echo the value.

The create dialog does not show `api_token` / `isSecret`. Settings Auth card still talks in types and fields, not placeholders. The generic Variables list stays for power users.

**Alternatives considered:** show variable names “for transparency” — rejected; that is the complexity this change removes.

### 3. Switching schemes replaces the mapping; unused secrets go away

`setServerAuth` in one transaction:

1. Write the new variable (encrypted) and the new default header or query key.
2. Remove the previous recipe’s default key (`Authorization`, prior custom header, or prior query param) when it still matches the old mapping.
3. Delete the previous recipe variable only if no tool template and no remaining default references `{{oldName}}`.
4. `type: "none"` is the same cleanup with no new mapping.

If inference is Custom, `setServerAuth` for a typed recipe is allowed (owner is choosing a simple scheme) but MUST NOT wipe unrelated extra defaults (for example a `Version` header). Only the recognized auth keys from the previous inference, if any, are replaced.

**Alternatives considered:** leave orphan `api_token` rows forever — simpler code, messier list. Confirm every switch — extra friction for “I picked the wrong type.”

### 4. Curl import keeps existing server auth

If the server already has a default header whose name is auth-ish **or** a default query param that is a sole `{{variable}}` used as a credential, curl MUST NOT upsert the captured secret and MUST NOT overwrite that default. The tool is still created; auth headers stay peeled off the tool template; the response tells the owner that existing server auth was kept.

If the server has no mapped auth, current capture behavior stays (secret variable + default).

Marking a curl credential as an agent param MUST NOT write that param into **server** defaults. Server defaults stay server-scoped secrets. (Today that path can store `Bearer {{some_param}}` on the server.)

**Alternatives considered:** confirm dialog to overwrite — extra step. Always overwrite — silent rotation, the footgun.

### 5. Connection test is owner-initiated

Remove the `testConnection.mutate` that runs in `onSuccess` of create. The post-create dialog and the Settings Auth card expose a Test connection button that calls the existing probe (defaults + secrets rendered, 401 = reachable). Creating a server MUST NOT probe by itself.

**Alternatives considered:** keep auto-test after auth is saved — still surprising, and a 404 on `/` is not “bad credentials.”

### 6. Upstream HTTP is a result, not `MCP_UPSTREAM_ERROR`

`executeMappedTool` (playground, gateway, platform `test_tool`):

- Any completed HTTP response (2xx–5xx) returns `{ ok, httpStatus, body, truncated, durationMs, callLogId }`. Log `status` is `success` for 2xx and `error` otherwise so the traffic light still turns yellow/red on 401 storms.
- Throw only when upstream is not contacted or the socket fails: paused, disabled, mutation guard, unresolved placeholder, SSRF, timeout, network.
- Gateway `jsonToolResult` includes `httpStatus` and body. Secrets stay redacted in logs; the upstream body is not a place we inject our bearer token.

Playground UI: always show status + body when a result returns; link to the log when `callLogId` is set; clear the previous panel on a new submit; no success toast (the panel is the feedback); toasts only for thrown errors. Disabled, paused, and mutation-blocked tools stay in the selector with invoke disabled and a one-line reason (enable in Tools / resume the server).

**Alternatives considered:** special-case 401 only — agents still need 403/429 bodies. Keep throwing and teach the SPA to read error payloads — loses `callLogId` and the body today.

### 7. Broaden plaintext-secret names; recipe values are always secret

`isAuthHeaderName` also matches header names containing `token` or `secret` (so `X-Shopify-Access-Token` cannot be saved as a Fixed literal). Recipe writes always set `isSecret: true`. The Auth card does not offer “make this plaintext.” Generic variable edit can still flip secrecy for non-recipe rows.

### 8. Platform MCP uses the same service

`create_server` accepts optional `auth` with the same discriminated object. `set_server_auth` is registered so agents do not have to compose `set_variable` + default headers. Curl import uses the keep-existing rule automatically.

## Risks / Trade-offs

- **[Inference misses a hand-edited default] → Custom.** Owners still have the existing editors; we never guess wrong and overwrite `Version` or a second key.
- **[Base64 Basic cannot rotate user vs password independently] → Accept.** Re-enter both fields; simpler than template functions.
- **[401 logs as error] → Traffic light goes yellow while the owner debugs.** Correct: the integration is not healthy. The playground still shows the body.
- **[Gateway agents now receive 401 JSON as a tool result] → They can retry; they no longer see a generic MCP error.** Log redaction still applies. Document in gateway spec.
- **[Curl no longer plants auth when the server already has it] → Importing a “full” curl with a different token will not rotate credentials.** Rotate from Settings. Safer default.

## Migration Plan

No schema migration. Existing servers infer None / a typed scheme / Custom on first Settings visit. Rollback is a code revert; stored variables and defaults remain valid.

## Open Questions

None. Remaining product calls from explore were resolved toward owner simplicity: include Basic and query; hide variable names; delete unused prior secrets on switch; skip curl overwrite without a confirm; test only on button; show all HTTP statuses in the playground; expose `set_server_auth` on platform MCP.
