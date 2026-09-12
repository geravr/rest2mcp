# Design: studio-template-engine

## Context

Layer 1 (`mcp-studio-foundation`, archived) shipped the studio loop: servers, tools, one credential per server, playground, gateway, logs. Real usage exposed the model as too closed and silently lossy:

- `paramMap` has seven buckets (`path`, `query`, `header`, `body`, `staticQuery`, `staticHeaders`, `staticBody`) yet cannot express Basic auth, two-secret APIs, secrets in body/query, form-encoded bodies with dynamic values, or nested JSON built from simple args.
- The gateway registers every tool with `inputSchema: z.looseObject({})` — agents see no parameters and must guess argument names.
- `createServer` stores `parsed.origin`, silently dropping path prefixes (`https://api.example.com/v2` → `https://api.example.com`).
- Auth-ish static headers are silently dropped at execution; secrets pasted into `staticQuery`/`staticBody` sit in plaintext and leak into call-log summaries (redaction only covers the single credential).
- Curl import discards the detected credential suggestion and hardcodes every value.

Constraints that stay untouched: SSRF guard (DNS resolution, blocked ranges, metadata hosts), per-server host allowlist, read-only-by-default with explicit `allowMutation`, separate agent tokens, 256 KiB response cap, 15 s upstream timeout.

## Goals / Non-Goals

**Goals:**

- One mental model for request definition: the request is a template; every `{{placeholder}}` resolves from agent arguments or server variables.
- Server variables with a secret flag; secret values encrypted at rest, never read back, redacted from all logs.
- Real MCP input schemas derived from declared tool params, with per-param descriptions.
- Server-level default headers and default query params (template-aware), so shared concerns (e.g. an API `Version` header, query-based key pairs) live once.
- Curl import that produces templates and captures detected credentials as secret variables instead of dropping them.
- `baseUrl` preserves path prefixes.

**Non-Goals:**

- Interactive authoring UX (value marking, tool edit/delete, server cards, schema-driven playground) — follow-up `studio-authoring-ux` change.
- Multipart/file tools, binary responses, response projection, OpenAPI import, OAuth2 token flows, HMAC signing, per-tool timeouts, recipe save/share.

## Decisions

### 1. Template syntax: `{{name}}` with context-aware escaping

One syntax everywhere: path template, query values, header values, and the body string. Resolution order: agent argument first, then server variable; an unresolved placeholder fails the call with `MCP_TEMPLATE_UNRESOLVED` (never sends a literal `{{...}}` upstream).

Escaping depends on where the placeholder sits:

| Context                       | Escaping                                    |
| ----------------------------- | ------------------------------------------- |
| Path segment                  | `encodeURIComponent`                        |
| Query value                   | `encodeURIComponent`                        |
| Header value                  | Raw, CRLF stripped                          |
| JSON body, quoted (`"{{x}}"`) | JSON string-escaped content                 |
| JSON body, bare (`{{x}}`)     | Raw JSON value (objects, numbers, booleans) |
| Form body value               | URL-encoded                                 |
| Raw body                      | None (explicit opt-in)                      |

Rationale: Postman/Bruno proved this model; users already know it. The alternative (keep `paramMap`, add more buckets) grows the form without closing the expressiveness gaps. Bare-vs-quoted in JSON bodies is the one rule to teach; it is what makes nested payloads from simple params possible.

### 2. Variables replace the credential box

New table `mcp_server_variable`: `serverId`, `name` (`[a-z][a-z0-9_]*`, unique per server), `isSecret`, `value` (plaintext when not secret), `ciphertext` (when secret, same `MCP_CREDENTIAL_SECRET` envelope as today). Reads return `name`, `isSecret`, `hasValue` — never secret values. Updates are write-only.

The `bearer`/`api_key`/`header` credential becomes a convention: a secret variable (e.g. `api_token`) referenced from a server default header (`Authorization: Bearer {{api_token}}`). This dissolves the one-credential limit, Basic auth (`Authorization: Basic {{basic_b64}}`), two-secret APIs, and secrets in body/query — all become templates over variables.

Rationale: two parallel secret systems (credential + variables) would be the complexity trap the user explicitly wants to avoid. One system, encryption and redaction apply uniformly.

### 3. Server default headers and default query

`mcp_server` gains `defaultHeaders` and `defaultQuery` jsonb maps; values are templates. Tool-level headers/query merge over them (tool wins on key conflict). This covers shared `Version`/`Accept` headers and query-credential APIs (e.g. `consumer_key={{ck}}&consumer_secret={{cs}}` on every call) without repeating per tool.

### 4. Tool shape: `requestTemplate` + `params`

`mcp_tool` gains:

- `requestTemplate` jsonb: `{ query?, headers?, body?, bodyType: "json" | "form" | "raw" }` — all values are templates. `pathTemplate` column stays, now with `{{}}` support.
- `params` jsonb array: `{ name, description?, required, type: "string" | "number" | "boolean" | "json" }`.

Placeholders not matching a server variable are agent params. Save-time validation warns on placeholders with no param entry and params matching nothing; runtime is strict. `type: "json"` exists so an agent can pass an object for bare injection into JSON bodies.

### 5. Gateway derives the input schema

For each enabled tool the gateway builds a zod object from `params` (type mapping, `.describe(description)`, optional when not required) instead of `z.looseObject({})`. The tool description stays the primary curation surface; param descriptions are the second layer. This is the fix for agents guessing argument names.

### 6. Plaintext-secret guard moves to "literal auth values"

Today `isSafeToolHeaderName` silently drops auth-ish static headers. New rule: auth-ish header names (`Authorization`, `*-api-key`, etc.) reject **literal** values with `MCP_PLAINTEXT_SECRET` and a hint to use a secret variable; templated values are allowed. No more silent drops — a rejected save is loud, a rendered header always sends.

### 7. Curl import captures instead of discarding

`createToolFromCurl` emits templates (query/header literals stay literal, body typed by content-type) and, when it detects an auth header, creates or updates the secret variable plus the matching default header, returning what it captured (`capturedVariable`, `capturedHeader`). The user pasted the secret already; encrypting it immediately is strictly safer than dropping it and failing later with a 401.

### 8. Redaction covers every secret variable

The executor collects all decrypted secret values used in the render and passes them to `redactText` (existing raw/URL/form variants). Request and response log summaries can no longer leak a secret that traveled via query or body.

## Risks / Trade-offs

- [Agent-controlled raw JSON injection via bare `{{x}}` in bodies] → JSON body type escapes quoted placeholders by default; `raw` body type is an explicit opt-in; mutation tools still require `allowMutation`.
- [Template/escaping bugs send malformed requests] → renderer gets a dedicated unit-test matrix across all six contexts; playground surfaces the fully rendered (redacted) request in logs.
- [Param/variable name collisions confuse resolution] → args-first order is documented; save-time validation warns when a param shadows a variable name.
- [Migration loses an exotic `paramMap`] → pre-production product with no external users; the single migration drops `paramMap` and `mcp_credential` directly and dev data is recreated by hand.
- [Secret value appears in a URL path and leaks via upstream access logs] → unavoidable at the upstream; our own logs redact it; docs recommend header placement.

## Migration Plan

Pre-production decision: a single migration, no backfill. The dev database holds only disposable test data, so the old columns/tables are dropped in place instead of migrated.

1. Generate one migration: create `mcp_server_variable`; add `mcp_server.defaultHeaders` / `defaultQuery`; add `mcp_tool.requestTemplate` / `params`; drop `paramMap` and `mcp_credential`.
2. Deploy code that reads the new shape (executor, gateway, studio service, platform MCP).
3. Recreate dev servers/tools by hand (curl import covers the common case).
4. Rollback: restore from a `db:export` dump taken before applying; no forward-fix of generated migrations.

## Open Questions

- None blocking. Deferrals already listed as non-goals (multipart, binary responses, response projection, OAuth2, per-tool timeout).
