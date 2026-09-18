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

The system SHALL let the owner create a tool with a unique MCP-safe name, agent-facing description, HTTP method, versioned typed request definition, behavior annotations, mutation policy, and enabled state. The request definition SHALL be the canonical create payload and persistence source. Before writing, the backend SHALL compile the complete effective request and return location-aware issues for invalid references, duplicate ids or names, incompatible types, invalid headers or JSON, GET/HEAD bodies, unsupported optional placements, protected-auth overrides, unsafe paths, or invalid mutation metadata. Invalid tools SHALL NOT be enabled or advertised. A server SHALL NOT exceed 50 tools.

#### Scenario: Add valid typed GET tool

- **WHEN** the owner adds `get_contact` with literal and agent-input path segments referencing stable ids
- **THEN** the typed definition and compiled plan are stored atomically and the enabled tool is available to the gateway

#### Scenario: Fixed braces remain fixed

- **WHEN** the owner creates a tool with a fixed header value `Example {{name}}`
- **THEN** the persisted binding remains literal after save and reopen

#### Scenario: Invalid typed tool is not enabled

- **WHEN** a definition references a missing server-value or agent-input id
- **THEN** save returns a structured issue at that binding and does not enable the tool

#### Scenario: Optional path input is rejected

- **WHEN** the owner marks an agent input used in a path segment as optional
- **THEN** compilation returns a blocking issue explaining that path segments cannot be omitted

#### Scenario: Mutation stays off until allowed

- **WHEN** the owner adds a DELETE tool without explicit mutation permission
- **THEN** the tool remains disabled and is not described as read-only

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

The system SHALL let the owner update any typed tool field and delete a tool on a server they own. Editing SHALL preserve definition-local ids for unchanged nodes and SHALL compile and persist the request definition atomically with its effective plan. Duplicating SHALL generate new definition-local ids and rewrite internal references while preserving valid server-value ids. Legacy fields SHALL NOT override a typed definition. Deleting a tool SHALL keep historical call logs with null `toolId`, and tool names SHALL remain unique per server.

#### Scenario: Edit origin without text inference

- **WHEN** the owner changes one query value from Fixed to an existing Server configuration
- **THEN** the saved query entry references that server-value id and unrelated node ids remain unchanged

#### Scenario: Duplicate rewrites local ids

- **WHEN** the owner duplicates a typed tool
- **THEN** the new tool has distinct entry and agent-input ids with all internal references valid and the same external server-value references

#### Scenario: Legacy fields cannot downgrade typed data

- **WHEN** an outdated client submits legacy fields for a tool that already has a typed definition
- **THEN** the system rejects the downgrade and preserves the typed definition and compiled plan

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

The SPA SHALL represent every structured request value as exactly one typed origin: Fixed, Server configuration, Server secret, or Agent input. Fixed values SHALL retain their literal or JSON primitive value. Server origins SHALL retain a server-value id and optional prefix/suffix. Agent origins SHALL retain an agent-input id whose metadata is stored once in the definition. The SPA SHALL submit these bindings directly and SHALL load them directly on reopen without compiling or inferring `{{placeholder}}` strings.

#### Scenario: Server secret is persisted by id

- **WHEN** the owner selects secret `api_token` with prefix `Bearer ` for a header
- **THEN** the request payload and stored definition reference the secret id and never serialize its display name as a placeholder

#### Scenario: Typed JSON literal stays typed

- **WHEN** the owner sets a JSON field to fixed boolean `false`
- **THEN** the definition stores boolean false rather than string `"false"`

#### Scenario: Reorder preserves identity

- **WHEN** the owner reorders query entries
- **THEN** their ids and bindings remain unchanged while their array order is updated

### Requirement: Studio tool dialog is a request builder

The create/edit/duplicate tool dialog SHALL mirror the versioned request-definition model for path, ordered query/header/form entries, structured JSON, raw bodies, and the shared agent-input registry. It SHALL NOT build legacy template maps as its save payload. Structured fields SHALL reference agent inputs rather than duplicate their metadata. Advanced raw bodies SHALL insert explicit binding-id tokens and SHALL treat undeclared brace text literally. Compile issues SHALL attach to stable node ids when available.

#### Scenario: Shared agent input is edited once

- **WHEN** two request locations reference one agent input
- **THEN** editing its description or constraints updates the single registry entry used by both locations

#### Scenario: Advanced literal braces survive

- **WHEN** a raw body contains undeclared `{{example}}`
- **THEN** the editor saves and reloads it as literal text

#### Scenario: Issue remains attached after reorder

- **WHEN** a query row with a compile issue is reordered
- **THEN** the issue remains associated with its stable row id

#### Scenario: Structured fields do not repeat in a Params list

- **WHEN** the owner binds one query entry to an agent input and has no other use of that input
- **THEN** the dialog references the shared registry entry without rendering a duplicate standalone parameter

#### Scenario: Nested JSON remains lossless

- **WHEN** the owner opens and saves a typed nested JSON body
- **THEN** its recursive nodes, primitive types, binding ids, and field order remain unchanged

### Requirement: Studio infers origins when opening a saved tool

For a versioned request definition, the SPA SHALL load persisted origins, ids, types, order, and metadata exactly and SHALL NOT run template inference. For a legacy-only tool, the backend SHALL return either an unambiguous typed conversion draft or blocking location-aware diagnostics. Saving an accepted draft SHALL convert the record permanently; ambiguous tools SHALL remain disabled until the owner resolves each source.

#### Scenario: Typed definition survives catalog changes

- **WHEN** a server value is added with the same name as an existing fixed or agent binding
- **THEN** reopening the typed tool preserves its persisted sources

#### Scenario: Unambiguous legacy tool is converted once

- **WHEN** the owner opens an unambiguous legacy tool and saves the proposed typed draft
- **THEN** later opens use the persisted definition without invoking legacy analysis

#### Scenario: Ambiguous legacy placeholder is not guessed

- **WHEN** a legacy placeholder could refer to both an agent input and server value
- **THEN** the Studio shows a blocking source-selection issue and does not enable the tool automatically

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

The Settings editor SHALL read and write typed ordered common entries. Each entry SHALL have a stable id and a Fixed, Server configuration, or Server secret origin; Agent input is forbidden. Saving SHALL preserve stable server-value ids and SHALL atomically recompile affected enabled tools. Auth-owned keys SHALL be displayed as protected and editable only through the Auth card.

#### Scenario: Common binding survives rename

- **WHEN** a common header references configuration id `value_1` and its display name changes
- **THEN** Settings and compiled tools retain the same binding without reclassification

#### Scenario: Common update reports affected tools

- **WHEN** a candidate common entry invalidates two enabled tools
- **THEN** save writes nothing and returns diagnostics identifying both tools and request locations

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

Before enabling a tool, the SPA SHALL submit the unsaved typed request definition to the same backend compiler used by persistence. The preview SHALL show the compiled method, URL shape, query, headers, and body with secret values redacted, inherited common entries, protected auth injection, omitted optional entries, and location-aware issues. Preview SHALL perform no writes and SHALL NOT translate the definition through legacy templates.

#### Scenario: Preview matches subsequent save

- **WHEN** the owner previews and then saves an unchanged typed definition against unchanged server configuration
- **THEN** both operations return the same compile outcome and effective plan shape

#### Scenario: Preview does not persist draft ids

- **WHEN** preview rejects a definition
- **THEN** no tool, common entry, compiled plan, or server value is written

### Requirement: Enabled and mutation controls are independent and truthful

The Studio SHALL represent availability and mutation permission without silently toggling an unrelated control. A mutating tool without permission cannot be enabled; removing permission from an enabled mutating tool SHALL explain and confirm the required disable. Read tools SHALL never be disabled merely because mutation permission is false.

#### Scenario: Read tool remains enabled

- **WHEN** mutation permission is false for an enabled GET tool
- **THEN** the tool remains enabled

#### Scenario: Revoking mutation permission is explicit

- **WHEN** the owner revokes mutation permission from an enabled POST tool
- **THEN** the UI explains that the tool must be disabled and applies both changes only after confirmation
