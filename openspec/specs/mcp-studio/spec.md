# MCP Studio

## Purpose

Owner-scoped control plane for mapping REST APIs to hosted MCP tools: servers, tools, variables, and connection snippets.

## Requirements

### Requirement: Owner can create and list MCP servers

The system SHALL let an authenticated user create MCP servers they own, each with a name, optional description, optional `iconImage` (a storage access URL or null), required HTTPS or HTTP `baseUrl`, and a slug unique among that user's servers. The stored `baseUrl` SHALL preserve any path prefix (e.g. `https://api.example.com/v2` keeps `/v2`) and SHALL strip query and fragment. Collection list endpoints SHALL return the `@repo/core` pagination envelope (`items`, `page`, `pageSize`, `total`). Each list item SHALL carry the traffic light, enabled tool count, the timestamp of the most recent call log (or null), and `iconImage`. A user SHALL NOT read or mutate another user's server.

#### Scenario: Create server

- **WHEN** the owner creates a server with name "CRM" and base URL `https://api.example.com`
- **THEN** the system stores a server owned by that user, derives `allowedHosts` to include `api.example.com`, sets `iconImage` to null, and returns the server id and slug

#### Scenario: Path prefix preserved

- **WHEN** the owner creates a server with base URL `https://api.example.com/v2`
- **THEN** the stored `baseUrl` is `https://api.example.com/v2` and tool paths resolve under that prefix

#### Scenario: Paginated list is owner-scoped

- **WHEN** user A has two servers and user B has one
- **THEN** user A's list with page=1 returns only A's servers and a `total` of 2

#### Scenario: List items carry activity metadata

- **WHEN** the owner lists servers and one server has three enabled tools and a call logged yesterday
- **THEN** that item reports an enabled tool count of 3, a `lastCallAt` matching that log, and its current `iconImage`

#### Scenario: Slug conflict

- **WHEN** the owner creates a second server with a slug already used on their account
- **THEN** the system rejects the request with `MCP_SERVER_SLUG_CONFLICT`

### Requirement: Owner can set a custom server icon

The system SHALL let the owner set or clear `iconImage` on a server they own via `updateServer`. The value SHALL be null or a URL pointing at an object the owner uploaded through the existing authenticated storage upload flow under their user scope. The system SHALL NOT accept arbitrary external URLs on update. Clearing `iconImage` SHALL revert the server to automatic icon resolution in the SPA.

#### Scenario: Upload and persist icon

- **WHEN** the owner uploads a PNG to storage and updates the server with the returned access URL
- **THEN** subsequent `getServer` and list responses include that `iconImage` value

#### Scenario: Remove custom icon

- **WHEN** the owner updates the server with `iconImage: null`
- **THEN** the stored value is null and the SPA shows the automatic fallback icon

#### Scenario: Reject foreign storage URL

- **WHEN** the owner updates `iconImage` to a storage URL scoped to another user
- **THEN** the system rejects the request with a validation error and does not change the server

### Requirement: Server icon display uses custom image or DiceBear rings

The SPA SHALL render each owned server's icon using, in order: (1) `iconImage` when set, otherwise (2) a locally generated DiceBear **rings** SVG data URI seeded by the server id. The SPA SHALL NOT use Google's s2 favicon service or text initials as the automatic fallback.

#### Scenario: Custom icon wins

- **WHEN** a server has `iconImage` set
- **THEN** list and detail views show that image for the server icon

#### Scenario: Rings fallback is deterministic

- **WHEN** a server has no `iconImage`
- **THEN** list and detail views show the same rings icon for that server id on every render until an icon is uploaded

#### Scenario: Rings fallback replaces initials

- **WHEN** a server has no `iconImage` and an unparseable `baseUrl`
- **THEN** the SPA still shows the rings icon seeded by server id (not text initials)

### Requirement: Owner can add REST tools manually

The system SHALL let the owner create a tool with a unique MCP-safe name, an agent-facing description, HTTP method, explicit request bindings, agent input schema, behavior annotations, mutation policy, and enabled state. Before enabling the tool, the backend SHALL compile the complete effective request and reject unresolved references, duplicate keys or inputs, conflicting input metadata, invalid headers or JSON, GET/HEAD bodies, unsupported optional placements, protected-auth overrides, unsafe path traversal, and any definition that cannot execute deterministically. GET and HEAD tools SHALL use read-only mutation metadata. POST, PUT, PATCH, and DELETE tools SHALL require explicit mutation permission before they can be enabled. A server SHALL NOT exceed 50 tools.

#### Scenario: Add valid GET tool

- **WHEN** the owner adds `get_contact` with a literal `/contacts/` path segment, required string input `contactId`, and a path binding to that input
- **THEN** the tool is stored enabled, compiled successfully, and has read-only behavior metadata

#### Scenario: Invalid tool is not enabled

- **WHEN** a tool contains an unresolved binding or conflicting definitions for the same agent input
- **THEN** save returns structured validation issues and the tool is not enabled or advertised

#### Scenario: Optional path input is rejected

- **WHEN** the owner marks an agent input used in a path segment as optional
- **THEN** compilation fails with a validation issue explaining that path segments cannot be omitted

#### Scenario: Mutation stays off until allowed

- **WHEN** the owner adds a DELETE tool without explicit mutation permission
- **THEN** the tool remains disabled and no UI copy describes it as a read-only DELETE

#### Scenario: Tool name conflict

- **WHEN** the owner adds a second tool with the same normalized name on one server
- **THEN** the system rejects the request with `MCP_TOOL_NAME_CONFLICT`

### Requirement: Owner can add a tool from curl

The system SHALL import curl as a sanitized definition for one endpoint. The confirmed import SHALL create exactly one disabled draft tool in one transaction and SHALL NOT create, update, rotate, delete, or overwrite server authentication, server values, secrets, or default headers/query. Credential headers, cookies, proxy credentials, and unsafe transport headers SHALL be excluded. Detected authentication SHALL be reported only by kind and header/query name, without its value, as a separate configuration requirement. Value markings SHALL identify a concrete location and occurrence rather than matching globally by literal value.

#### Scenario: Curl credential is excluded

- **WHEN** the owner imports `curl -H 'Authorization: Bearer secret' https://api.example.com/v1/items`
- **THEN** the draft tool contains no Authorization value, no secret or auth row changes, and the result reports that Bearer authentication must be configured separately

#### Scenario: Existing authentication is untouched

- **WHEN** the server already has authentication and the imported curl contains a different credential
- **THEN** the existing authentication and all secret values remain byte-for-byte unchanged

#### Scenario: Mark one repeated literal

- **WHEN** the same literal appears in path and body and the owner marks only the body occurrence as an agent input
- **THEN** only the selected body location receives that binding

#### Scenario: Import is atomic

- **WHEN** draft tool creation fails after preview
- **THEN** no tool, server value, auth configuration, default, or other persistent row is changed

#### Scenario: Foreign origin is rejected

- **WHEN** the curl target origin differs from the selected server origin
- **THEN** import fails with a validation issue instead of silently applying the path to the selected server

#### Scenario: Unsupported curl flag is rejected

- **WHEN** a curl command uses an unsupported flag whose semantics affect the request
- **THEN** preview fails with `MCP_CURL_INVALID` naming the unsupported flag

### Requirement: Owner can preview a curl import without writing

The system SHALL provide a dry-run curl parse that validates origin and base-path boundaries, preserves repeated query entries, classifies request components, and returns a sanitized normalized draft plus excluded-item diagnostics. Preview SHALL NOT return detected credential values and SHALL NOT create or modify any server, tool, server value, secret, auth mapping, or default.

#### Scenario: Preview returns sanitized shape

- **WHEN** the owner previews a valid curl containing endpoint fields and a Bearer token
- **THEN** the response includes method, relative path, non-credential request fields, location-aware markable values, and a credential-excluded diagnostic without the token

#### Scenario: Base path boundary is respected

- **WHEN** the server base path is `/v1` and the curl path begins `/v10`
- **THEN** preview rejects the mismatch instead of stripping `/v1` as a text prefix

#### Scenario: Preview rejects invalid curl without writes

- **WHEN** the owner submits an unparseable or ambiguous curl
- **THEN** the system rejects with `MCP_CURL_INVALID` and writes nothing

### Requirement: Owner can edit and delete tools

The system SHALL let the owner update any tool field (name, description, method, path template, request template, params, `allowMutation`, `enabled`) on a server they own, and delete a tool. Deleting a tool SHALL keep its historical call logs (their `toolId` becomes null). Name uniqueness per server SHALL be enforced on update.

#### Scenario: Edit path template

- **WHEN** the owner updates a tool's path template from `/contacts/{{id}}` to `/contacts/{{contactId}}` and declares param `contactId`
- **THEN** subsequent executions resolve the new template

#### Scenario: Delete tool keeps history

- **WHEN** the owner deletes a tool that has call logs
- **THEN** the tool row is gone and its log rows remain with null `toolId`

#### Scenario: Rename to existing name conflicts

- **WHEN** the owner renames a tool to a name already used on that server
- **THEN** the system rejects with `MCP_TOOL_NAME_CONFLICT`

### Requirement: Owner can delete a server

The system SHALL let the owner delete a server they own in one transaction: that server's call logs, tools, variables, and agent tokens are removed with the server. Other users' servers SHALL NOT be deletable (not-found semantics).

#### Scenario: Delete cascades

- **WHEN** the owner deletes a server with tools, variables, tokens, and logs
- **THEN** no rows for that server remain in any of those tables

#### Scenario: Other user cannot delete

- **WHEN** user B deletes user A's server id
- **THEN** the system rejects with `MCP_SERVER_NOT_FOUND` and nothing is removed

### Requirement: Owner can test server connectivity

The system SHALL provide a connectivity probe that issues a GET to the server's `baseUrl` through the same SSRF guard and host allowlist as execution, rendering server default headers and query (secret variables included), with a 5 second timeout. The probe SHALL return `{ ok, httpStatus, durationMs, appCode? }`, SHALL NOT create a call-log row, and SHALL treat any HTTP response (including 401) as reachable.

#### Scenario: Reachable with auth failure

- **WHEN** the owner tests a server whose upstream answers 401
- **THEN** the probe returns `ok: true` with `httpStatus: 401`

#### Scenario: Blocked host

- **WHEN** the server `baseUrl` resolves to a private address
- **THEN** the probe returns `ok: false` with `MCP_HOST_NOT_ALLOWED` and no upstream connection is made

### Requirement: Owner can copy a connection snippet

The system SHALL let the owner create a server-scoped agent token, display the raw token only once at creation, persist only a hash, and return a connection snippet containing the gateway URL `{API_ORIGIN}/mcp/{serverId}` and instructions to send that token as Bearer.

#### Scenario: Token shown once

- **WHEN** the owner creates an agent token
- **THEN** the response includes the raw token and prefix, and later list views show only the prefix and metadata

#### Scenario: Revoke token

- **WHEN** the owner revokes an agent token
- **THEN** that token MUST fail gateway authentication

### Requirement: Records are recipe-ready without secrets

Server, tool, and variable-definition fields SHALL be sufficient to reconstruct a template later: name, description, baseUrl, allowedHosts, defaultHeaders, defaultQuery, tool templates, params, and variable names with their `isSecret` flags. Secret values, ciphertext, agent tokens, and call logs SHALL NOT be part of that template shape.

#### Scenario: Template shape excludes secrets

- **WHEN** a server has tools, variables, and defaults
- **THEN** the exportable template includes variable names and flags but no secret values, ciphertext, or tokens

### Requirement: Studio tool fields choose a value origin

The SPA SHALL let the owner assign every structured request value exactly one persisted origin: Fixed, Server configuration, Server secret, or Agent input. Fixed values SHALL be literal and SHALL never be scanned for template syntax. Server origins SHALL reference a stable server-value id and visibly identify whether it is configuration or secret. Agent inputs SHALL reference one input definition with description, JSON Schema type/constraints, required state, examples, and sensitive flag. Saving and reopening SHALL preserve the selected origin without reclassification from text.

#### Scenario: Fixed braces stay literal

- **WHEN** the owner saves fixed value `Example {{name}}`
- **THEN** execution sends those characters literally and does not resolve `name`

#### Scenario: Server secret is explicit

- **WHEN** the owner chooses secret `api_token` with prefix `Bearer ` for a header
- **THEN** the persisted binding references that secret id and does not declare an agent input

#### Scenario: Agent input is explicit

- **WHEN** the owner binds query key `locationId` to agent input `location_id`
- **THEN** the persisted request references that input id and the generated MCP schema exposes `location_id`

### Requirement: Studio tool dialog is a request builder

The create/edit/duplicate tool dialog SHALL show identity (name, description), method and path together, then inner tabs for Query, Headers, and Body. It SHALL NOT show a standalone Params list for values already represented as Agent origins on those parts. Body type `form` SHALL use the same origin rows as query. Body type `json` SHALL use origin rows when the stored body is a flat JSON object, and an Advanced textarea otherwise. Body type `raw` SHALL use Advanced. Advanced SHALL offer variable insert/autocomplete and SHALL list Agent leftovers only for placeholders in that textarea that are not server variables.

#### Scenario: Structured fields do not repeat in a Params list

- **WHEN** the owner sets one Agent query row and no Advanced body placeholders
- **THEN** the dialog does not render a separate Params section listing that query param

#### Scenario: Nested JSON stays Advanced

- **WHEN** the owner edits a tool whose JSON body is a nested object
- **THEN** the Body tab shows the Advanced textarea, not origin rows

### Requirement: Studio infers origins when opening a saved tool

For versioned request definitions, the SPA SHALL load the persisted origins exactly and SHALL NOT infer them from current server-value names. For legacy templates only, the backend SHALL run compatibility analysis; unambiguous origins MAY be proposed, while ambiguous placeholders SHALL be shown as blocking migration issues and the tool SHALL remain disabled until the owner resolves them.

#### Scenario: New definition survives value changes

- **WHEN** a fixed or agent-input binding shares text with a subsequently created server value
- **THEN** reopening the tool preserves its original binding source

#### Scenario: Ambiguous legacy placeholder is not guessed

- **WHEN** a legacy `{{name}}` could refer to both a declared input and a server value
- **THEN** the Studio shows a migration issue and does not enable the tool automatically

### Requirement: Studio can edit a server variable

The Settings variables list SHALL offer an edit action that opens a dialog. The name SHALL be read-only. The owner SHALL be able to replace the value and change `isSecret`. Secret values SHALL NOT be shown. Rotating a secret or turning a secret into a non-secret SHALL require a newly entered value. Turning a non-secret into a secret MAY reuse the visible current value.

#### Scenario: Rotate secret

- **WHEN** the owner edits secret `api_token`, enters a new value, and saves
- **THEN** the list still shows the secret badge and no plaintext value

#### Scenario: Secret value stays hidden

- **WHEN** the owner opens the edit dialog for a secret variable
- **THEN** the value field is empty and the previous secret is not displayed

### Requirement: Studio confirms variable deletion

The Settings server-values list SHALL require destructive confirmation before deletion. A referenced server value SHALL NOT be deleted until the owner removes or replaces every tool, default, or auth reference. The dialog SHALL list all known references, including references outside the currently loaded tools page.

#### Scenario: Cancel leaves the value

- **WHEN** the owner starts deletion and cancels
- **THEN** the server value remains and no delete request is sent

#### Scenario: Referenced value is blocked

- **WHEN** a secret is referenced by auth or any tool binding
- **THEN** deletion is rejected with structured reference details and no request definition is left dangling

### Requirement: Server defaults use Fixed or Variable origins

The Settings editor SHALL label server-wide entries as common request values and SHALL allow Fixed, Server configuration, or Server secret bindings, never Agent input. Fixed values SHALL remain literal. Auth-owned keys SHALL be displayed as protected and SHALL be editable only through the Auth card.

#### Scenario: Common header from configuration

- **WHEN** the owner binds common header `Version` to server configuration `api_version`
- **THEN** every compiled tool inherits that value unless it defines an allowed non-auth override

#### Scenario: Auth key is protected

- **WHEN** authentication owns the `Authorization` header
- **THEN** the common-values editor and tool editor cannot override that key

### Requirement: Owner chooses authentication when creating a server

The create-server dialog SHALL ask which authentication to use: None, Bearer token, API key header, API key query, or Basic. Only the fields required by the selected type SHALL be visible. Bearer SHALL collect a token. Header SHALL collect a header name (default `X-API-Key`) and a value. Query SHALL collect a query parameter name (default `api_key`) and a value. Basic SHALL collect a username and a password. The owner SHALL NOT choose `isSecret`, SHALL NOT name the backing variable, and SHALL NOT type `{{placeholders}}`. Empty credentials for a non-None type SHALL be rejected. The create request SHALL persist the server and the mapped secret in one transaction.

#### Scenario: Bearer on create

- **WHEN** the owner creates a server with type Bearer and token `sk_live_123`
- **THEN** the server exists with a secret variable used from a default `Authorization` header, and later reads do not include `sk_live_123`

#### Scenario: None on create

- **WHEN** the owner creates a server with type None
- **THEN** the server has no auth secret variable and no auth default header or query from this flow

#### Scenario: Header fields appear only for that type

- **WHEN** the owner selects API key header
- **THEN** the dialog shows header name and value inputs and does not show Basic username/password

### Requirement: Studio Settings expose the same authentication recipe

The Settings Auth card SHALL edit an explicit auth configuration with owned secret references and protected request keys. Saving a recipe SHALL rotate or replace only auth-owned secrets and SHALL preserve all manual server values. Switching from Custom to a typed recipe SHALL present the exact custom keys to be removed and apply the replacement atomically. Credential paste normalization SHALL preserve colons unless the pasted prefix matches the selected header or query name.

#### Scenario: Manual value is not overwritten

- **WHEN** a manual server value is named `api_token` and the owner configures Bearer authentication
- **THEN** auth creates or uses a distinct auth-owned secret and leaves the manual value unchanged

#### Scenario: Custom replacement is explicit

- **WHEN** the current auth owns multiple custom headers and the owner selects Bearer
- **THEN** the UI lists the keys to replace and confirmation atomically removes those auth-owned keys before adding Bearer

#### Scenario: Credential containing colon is preserved

- **WHEN** the owner enters header credential `abc:def:ghi` without a matching `Header-Name:` prefix
- **THEN** the full credential is encrypted unchanged

### Requirement: Connection test runs only when the owner asks

The SPA SHALL NOT probe connectivity as a side effect of creating a server. Create success and the Settings Auth card SHALL offer an explicit Test connection control that calls the existing probe.

#### Scenario: Create does not auto-test

- **WHEN** the owner successfully creates a server
- **THEN** no connectivity probe runs until they click Test connection

#### Scenario: Settings test uses current auth

- **WHEN** the owner has saved Bearer auth and clicks Test connection
- **THEN** the probe sends the rendered default Authorization header

### Requirement: Studio playground shows upstream HTTP results

When playground invoke returns an executor result (including non-2xx `httpStatus`), the SPA SHALL render the HTTP status and capped body and SHALL link to the call log when `callLogId` is present. It SHALL NOT treat that result as a generic product error toast. A new submit SHALL clear the previous result panel. Tools that cannot run (disabled, mutation not allowed, server paused) SHALL stay selectable with invoke disabled and an explanation.

#### Scenario: 401 is visible in the panel

- **WHEN** invoke returns `httpStatus` 401 and a JSON body
- **THEN** the playground shows status 401 and that body, and a toast does not claim a generic upstream product failure

#### Scenario: Disabled tool explains itself

- **WHEN** the owner selects a tool with `enabled` false
- **THEN** invoke is disabled and the copy states the tool is disabled

### Requirement: Unresolved template errors name the placeholder

When a playground or studio request fails with `MCP_TEMPLATE_UNRESOLVED`, the SPA SHALL show localized copy (en and es) that includes the unresolved placeholder name. The name SHALL come from structured error details, not from parsing the English server `message`.

#### Scenario: Playground toast names the missing placeholder

- **WHEN** invoke fails because query placeholder `limit` cannot be resolved
- **THEN** the owner sees an error that includes `limit` in the active locale

### Requirement: Studio shows an effective request preview

Before enabling a tool, the SPA SHALL show the compiled method, URL shape, query, headers, and body using example agent inputs, with all secret values redacted. The preview SHALL show inherited common values, protected auth injection, omitted optional entries, and validation issues.

#### Scenario: Preview redacts secret and shows inheritance

- **WHEN** a tool inherits Bearer auth and a common version header
- **THEN** preview shows `Authorization: Bearer [REDACTED]`, the version header, and the tool-local request fields

### Requirement: Enabled and mutation controls are independent and truthful

The Studio SHALL represent availability and mutation permission without silently toggling an unrelated control. A mutating tool without permission cannot be enabled; removing permission from an enabled mutating tool SHALL explain and confirm the required disable. Read tools SHALL never be disabled merely because mutation permission is false.

#### Scenario: Read tool remains enabled

- **WHEN** mutation permission is false for an enabled GET tool
- **THEN** the tool remains enabled

#### Scenario: Revoking mutation permission is explicit

- **WHEN** the owner revokes mutation permission from an enabled POST tool
- **THEN** the UI explains that the tool must be disabled and applies both changes only after confirmation
