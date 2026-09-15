## Why

Creating a server asks for a name and URL, then immediately probes the API with no credentials. Owners must invent a secret variable and a default header template before the playground works — and a 401 there still looks like a generic product error. Auth is already a convention (secret variable + default header/query); the studio never offers that convention as a choice.

## What Changes

- **Auth recipe on create.** The create dialog asks which authentication to use: None, Bearer, API key header (custom name), API key query, or Basic. Only the fields for that type appear. Tokens and passwords are always stored as secret variables; owners never choose `isSecret` or type `{{placeholders}}`. The API maps the recipe to a variable plus `defaultHeaders` / `defaultQuery` in one transaction.
- **Same recipe in Settings.** An Auth card infers the current scheme from defaults + variables and can change or clear it. Unrecognized setups fall back to Custom (existing default-header/query editors). Switching schemes replaces the mapped default; an old variable is deleted only when nothing else references it.
- **Connection test is a button.** Creating a server MUST NOT auto-probe. The owner runs Test connection after create (and again from Settings) when they choose.
- **Curl import keeps existing server auth.** If the server already has a mapped auth default, import does not overwrite the secret or the default header/query. It uses the server credential and tells the owner.
- **Playground and gateway show upstream HTTP.** 4xx/5xx from the API return as invoke/tool results (status + body, log row, `callLogId`). They are no longer `MCP_UPSTREAM_ERROR`. Network/SSRF/template/guard failures still throw. The playground renders the result panel (no success toast that hides a 401); disabled, paused, and mutation-blocked tools explain why invoke is unavailable.

**Non-goals:** OAuth2, HMAC, AWS SigV4, cookies; restoring `mcp_credential`; persisting `authType` on the server row; renaming variables or rewriting `{{old}}` placeholders; two-secret recipes (WooCommerce) as a fifth radio; OpenAPI import; marketing-site rewrite.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `mcp-studio`: create/settings auth recipe facade; test connection only on explicit action; curl import does not silently rotate existing auth.
- `mcp-templates`: create/update apply an auth recipe atomically onto secret variables and server defaults; plaintext-secret guard covers token/secret header names.
- `mcp-observability`: playground returns and displays upstream HTTP errors as results; blocked tools are explained in-place.
- `mcp-gateway`: upstream HTTP error responses are tool results with `httpStatus` and body, not `MCP_UPSTREAM_ERROR`.
- `platform-mcp`: `create_server` accepts the same optional auth recipe; curl import follows the keep-existing-auth rule.

## Impact

- **apps/app:** create dialog, Settings Auth card, playground result/error UX, en/es copy; remove auto `testConnection` on create.
- **apps/api:** extend `createServer` / add `setServerAuth` (or equivalent) as one transaction; curl capture skip; executor returns HTTP errors instead of throwing; platform `create_server` schema.
- **db / packages/core:** no new tables or `authType` column. Optional error-code copy only if invoke payload shape is documented via existing codes.
- **apps/web:** unchanged.
