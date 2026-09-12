# Proposal: studio-template-engine

## Why

The layer-1 studio cannot express most real-world APIs: the tool form creates static requests, the credential box allows a single secret in three fixed schemes, and the gateway advertises every tool with an empty input schema, so agents must guess arguments. The model is simultaneously too closed (no Basic auth, no two-secret APIs, no secrets in body/query, no server-level headers) and already complex in the wrong place (seven `paramMap` buckets). Replacing the request model with templates plus server variables makes the studio strictly more expressive while removing concepts, and gives agents real input schemas.

## What Changes

- Add **server variables**: named values scoped to a server, each marked secret or not. Secret values are encrypted at rest, never returned by reads, and redacted from all call logs. Non-secret values are stored in plaintext.
- Replace the seven-bucket `paramMap` with a **request template**: path, query, headers, and body are strings with `{{placeholder}}` interpolation. Placeholders resolve from agent arguments first, then server variables. Escaping is context-aware (URL-encode in path/query, JSON-aware in JSON bodies, form-encode in form bodies).
- Add **tool params** as first-class metadata (name, description, required, type) so the gateway advertises a real MCP `inputSchema` per tool instead of `z.looseObject({})`.
- Add **server default headers** (template-aware) applied to every tool call, e.g. a shared `Version` header.
- Unify credentials into variables: the `bearer`/`api_key`/`header` credential box becomes a secret variable plus a default header template. **BREAKING**: `mcp_credential` is migrated to variables and dropped; `setCredential` APIs are replaced by variable management.
- Preserve `baseUrl` path prefixes (e.g. `https://api.example.com/v2`) instead of silently truncating to the origin.
- Extend log redaction to every secret variable value, closing the plaintext leak through `staticQuery`/`staticBody`.
- Rework curl import output to emit templates (literal values stay literal; auth headers become a suggested secret variable).

**Non-goals:** interactive authoring UX (value picker, tool edit/delete, server cards, schema-driven playground) — that is the follow-up `studio-authoring-ux` change; multipart/file tools and binary responses; OAuth2 flows and HMAC signing; response projection; OpenAPI import; recipe save/share.

## Capabilities

### New Capabilities

- `mcp-templates`: Server variables (secret/plain), request template syntax and context-aware escaping, tool param declaration, server default headers, and derivation of gateway input schemas from params.

### Modified Capabilities

- `mcp-studio`: credential requirement replaced by variable management; tools are defined as templates; `baseUrl` keeps its path prefix; recipe-ready shape carries variable definitions (names/flags, never secret values) instead of a credential scheme.
- `mcp-gateway`: request building renders templates with args + variables; advertised tools expose derived input schemas with per-param descriptions.
- `mcp-observability`: log redaction covers all secret variable values, not only the single credential.
- `platform-mcp`: `set_credential` is replaced by variable management tools; `add_tool` accepts template fields.

## Impact

- **db:** new `mcp_server_variable` table; `mcp_server.defaultHeaders` jsonb; `mcp_tool.requestTemplate` and `mcp_tool.params` jsonb replacing `paramMap`; `mcp_credential` dropped after migration; one migration plus a backfill script.
- **apps/api:** new template renderer (`lib/mcp-template.ts`); executor rewritten around rendering; gateway derives input schemas; studio service gains variable CRUD; platform MCP tools updated; curl import emits templates; redaction takes all secret values.
- **apps/app:** connection tab replaces the credential form with a variables manager (secret flag, add/remove); en/es i18n parity. Tool authoring UI rebuild stays in `studio-authoring-ux`.
- **packages/core:** new `APP_ERROR_CODES` for template/variable failures.
