# MCP Studio

## Purpose

Owner-scoped control plane for mapping REST APIs to hosted MCP tools: servers, tools, variables, and connection snippets.

## Requirements

### Requirement: Studio loads persisted typed origins

The Studio SHALL load request origins, stable ids, types, order, and metadata directly from the persisted versioned request definition. It SHALL NOT infer an origin from literal text, server-value display names, or another derived representation. Human-readable request summaries SHALL be derived for display only and SHALL NOT become writable authoring state.

#### Scenario: Typed definition survives catalog changes

- **WHEN** a server value is added with the same name as an existing fixed or agent binding
- **THEN** reopening the tool preserves its persisted sources and stable ids

#### Scenario: Literal binding-like text remains literal

- **WHEN** a saved literal contains text such as `{{api_token}}`
- **THEN** Studio displays and resaves it as literal text without offering an inferred conversion

#### Scenario: Path summary is derived

- **WHEN** Studio displays a tool path in a list or dialog header
- **THEN** it derives a sanitized summary from typed path segments without reading or writing a separate path template

### Requirement: Canonical authoring preserves dynamic arrays and request serialization

The canonical typed request definition SHALL represent array-valued agent inputs separately from fixed JSON array templates. It SHALL preserve supported primitive item constraints, bounded array constraints, optionality, and supported query serialization through save, reopen, compile preview, publication, and playground execution. Unsupported serialization SHALL fail compilation with a location-aware issue rather than falling back to object stringification.

#### Scenario: Array input survives save and reopen

- **WHEN** the owner saves an array-valued input with string item constraints and bounds
- **THEN** Studio reloads the same array type, item constraints, bounds, stable id, and request bindings

#### Scenario: Repeated query serialization is previewed

- **WHEN** a query entry binds an array input with form serialization and explode enabled
- **THEN** compile preview shows one encoded query entry per supplied array item

#### Scenario: Delimited query serialization is previewed

- **WHEN** a query entry binds an array input with form serialization and explode disabled
- **THEN** compile preview shows one comma-delimited encoded query value

#### Scenario: Optional structured body field is omitted

- **WHEN** an optional object or array body field is bound to an absent structured input
- **THEN** compile preview omits the complete field instead of emitting an empty placeholder or one-element template

#### Scenario: Serialization requires an array input

- **WHEN** form-array serialization is attached to a scalar or structured object input
- **THEN** compilation returns a blocking issue at that query entry

#### Scenario: Unsupported query style is rejected

- **WHEN** a query entry requests a serialization style not represented by the canonical model
- **THEN** the strict typed command or compiler rejects it and preserves the previous stored definition

### Requirement: Studio binding errors identify canonical locations

When Studio preview, save, or playground execution reports a binding or compilation failure, the SPA SHALL render localized copy in English and Spanish using structured issue codes, stable node or entry ids, and safe public names when available. It SHALL NOT parse an English server message or require a placeholder string to identify the problem.

#### Scenario: Missing agent input names its location

- **WHEN** a query entry references an absent agent-input id
- **THEN** Studio identifies the affected query entry and stable input reference in the active locale

#### Scenario: Secret-safe binding error

- **WHEN** a secret server-value reference cannot be resolved
- **THEN** the error identifies the safe reference location without including plaintext or ciphertext

### Requirement: Owner can create and list MCP servers

The system SHALL let an authenticated user create MCP servers they own, each with a name, optional description, an optional server icon asset (`iconAssetId`, with its resolved `iconUrl`), required HTTPS or HTTP `baseUrl`, and a slug unique among that user's servers. The stored `baseUrl` SHALL preserve any path prefix (e.g. `https://api.example.com/v2` keeps `/v2`) and SHALL strip query and fragment. Collection list endpoints SHALL return the `@repo/core` pagination envelope (`items`, `page`, `pageSize`, `total`). Each list item SHALL carry the traffic light, enabled tool count, the timestamp of the most recent call log (or null), and its resolved `iconUrl`. A user SHALL NOT read or mutate another user's server.

#### Scenario: Create server

- **WHEN** the owner creates a server with name "CRM" and base URL `https://api.example.com`
- **THEN** the system stores a server owned by that user, derives `allowedHosts` to include `api.example.com`, leaves `iconAssetId` null, and returns the server id and slug

#### Scenario: Path prefix preserved

- **WHEN** the owner creates a server with base URL `https://api.example.com/v2`
- **THEN** the stored `baseUrl` is `https://api.example.com/v2` and tool paths resolve under that prefix

#### Scenario: Paginated list is owner-scoped

- **WHEN** user A has two servers and user B has one
- **THEN** user A's list with page=1 returns only A's servers and a `total` of 2

#### Scenario: List items carry activity metadata

- **WHEN** the owner lists servers and one server has three enabled tools and a call logged yesterday
- **THEN** that item reports an enabled tool count of 3, a `lastCallAt` matching that log, and its current `iconUrl`

#### Scenario: Slug conflict

- **WHEN** the owner creates a second server with a slug already used on their account
- **THEN** the system rejects the request with `MCP_SERVER_SLUG_CONFLICT`

### Requirement: Owner can set a custom server icon

The system SHALL let the owner attach or clear a server icon via `updateServer` using an opaque, owner-scoped storage asset id. The asset SHALL be attached only when it belongs to the caller, has the icon purpose, is `ready`, and has not expired; attaching it SHALL mark it `attached` and the resolved `iconUrl` SHALL be returned by `getServer` and list responses. The system SHALL NOT accept or read a legacy icon URL field. Clearing the icon SHALL detach the asset for durable cleanup and revert the SPA to automatic icon resolution.

#### Scenario: Attach an uploaded asset

- **WHEN** the owner uploads a PNG through the authenticated storage flow and updates the server with the returned `assetId`
- **THEN** subsequent `getServer` and list responses include the resolved `iconUrl` for that asset

#### Scenario: Remove custom icon

- **WHEN** the owner updates the server with `iconAssetId: null`
- **THEN** the server icon is detached for cleanup and the SPA shows the automatic fallback icon

#### Scenario: Reject foreign or unready asset

- **WHEN** the owner submits an asset id owned by another user, a staging asset, an expired asset, or a legacy icon URL field
- **THEN** the system rejects the request with a validation error and does not change the server

### Requirement: Server icon display uses custom image or DiceBear rings

The SPA SHALL render each owned server's icon using, in order: (1) the resolved `iconUrl` of the attached asset when set, otherwise (2) a locally generated DiceBear **rings** SVG data URI seeded by the server id. The SPA SHALL NOT use Google's s2 favicon service or text initials as the automatic fallback.

#### Scenario: Custom icon wins

- **WHEN** a server has an attached icon asset
- **THEN** list and detail views show its resolved `iconUrl` for the server icon

#### Scenario: Rings fallback is deterministic

- **WHEN** a server has no attached icon asset
- **THEN** list and detail views show the same rings icon for that server id on every render until an icon is attached

#### Scenario: Rings fallback replaces initials

- **WHEN** a server has no attached icon asset and an unparseable `baseUrl`
- **THEN** the SPA still shows the rings icon seeded by server id (not text initials)

### Requirement: Owner can add REST tools manually

The system SHALL let the owner create a tool with a unique MCP-safe name, agent-facing description, HTTP method, versioned typed request definition, behavior annotations, mutation policy, and enabled state. The request definition SHALL be the canonical create payload and persistence source. Before writing, the backend SHALL compile the complete effective request and return location-aware issues for invalid references, duplicate ids or names, incompatible types, invalid headers or JSON, GET/HEAD bodies, unsupported optional placements, protected-auth overrides, unsafe paths, or invalid mutation metadata. Invalid tools SHALL NOT be enabled or advertised. The backend SHALL reject creating, duplicating, or importing tools beyond the deployment's configured tool cap, and SHALL reject publishing a candidate whose enabled tools exceed it. The cap defaults to 50 and is validated against a bounded range by the same schema that parses the environment; an unset or blank setting means the default. Lowering the cap below a server's existing tool count leaves the surplus in place until the owner removes it, and blocks further tools and publication until then.

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

#### Scenario: Cap follows configuration

- **WHEN** the deployment configures a tool cap and the owner creates tools beyond it
- **THEN** the backend rejects creation with the configured limit, a settings save compiling more enabled tools than the cap is rejected, and a publish whose candidate enables more tools than the cap is rejected with the configured limit and the observed count

#### Scenario: Studio reports the configured cap

- **WHEN** the owner opens a server whose tool count reaches the configured cap
- **THEN** the Studio disables the creation actions and states the server's tool count and the configured limit

### Requirement: Owner can add a tool from curl

The system SHALL import curl as a sanitized definition for one endpoint. The confirmed import SHALL create exactly one disabled draft tool in one transaction and MAY assign it to one optional existing group owned by the same server. It SHALL NOT create, update, rotate, delete, or overwrite server authentication, server values, secrets, default headers/query, or groups. Credential headers, cookies, proxy credentials, and unsafe transport headers SHALL be excluded. Detected authentication SHALL be reported only by kind and header/query name, without its value, as a separate configuration requirement. Value markings SHALL identify a concrete location and occurrence rather than matching globally by literal value.

#### Scenario: Curl credential is excluded

- **WHEN** the owner imports `curl -H 'Authorization: Bearer secret' https://api.example.com/v1/items`
- **THEN** the draft tool contains no Authorization value, no secret or auth row changes, and the result reports that Bearer authentication must be configured separately

#### Scenario: Existing authentication is untouched

- **WHEN** the server already has authentication and the imported curl contains a different credential
- **THEN** the existing authentication and all secret values remain byte-for-byte unchanged

#### Scenario: Mark one repeated literal

- **WHEN** the same literal appears in path and body and the owner marks only the body occurrence as an agent input
- **THEN** only the selected body location receives that binding

#### Scenario: Import into an existing group

- **WHEN** the owner confirms a curl import with an existing group belonging to the selected server
- **THEN** the one disabled draft tool is created in that group without changing the group itself

#### Scenario: Foreign group is rejected atomically

- **WHEN** the curl confirmation references a group from another server or owner
- **THEN** import fails with not-found semantics and creates no tool or other persistent row

#### Scenario: Import is atomic

- **WHEN** draft tool creation fails after preview
- **THEN** no tool, group, server value, auth configuration, default, or other persistent row is changed

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

The system SHALL let the owner update any typed tool field and delete a tool on a server they own. Editing SHALL preserve definition-local ids for unchanged nodes and SHALL compile and persist the request definition atomically with its effective plan. Duplicating SHALL generate new definition-local ids and rewrite internal references while preserving valid server-value ids. Commands SHALL use strict typed schemas and reject unknown fields before compilation. Deleting a tool SHALL keep historical call logs with null `toolId`, and tool names SHALL remain unique per server.

#### Scenario: Edit origin without text inference

- **WHEN** the owner changes one query value from Fixed to an existing Server configuration
- **THEN** the saved query entry references that server-value id and unrelated node ids remain unchanged

#### Scenario: Duplicate rewrites local ids

- **WHEN** the owner duplicates a typed tool
- **THEN** the new tool has distinct entry and agent-input ids with all internal references valid and the same external server-value references

#### Scenario: Unknown field is rejected without writes

- **WHEN** a tool edit includes a field outside the typed update schema
- **THEN** the system rejects the command and preserves the request definition and compiled plan

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

The system SHALL provide a connectivity probe that issues a GET to the server's `baseUrl` through the same SSRF guard and host allowlist as execution, rendering canonical common entries and explicit authentication configuration with secret values resolved only at execution, with a 5 second timeout. The probe SHALL return `{ ok, httpStatus, durationMs, appCode? }`, SHALL NOT create a call-log row, and SHALL treat any completed HTTP response, including 401, as reachable.

#### Scenario: Reachable with auth failure

- **WHEN** the owner tests a server whose upstream answers 401
- **THEN** the probe returns `ok: true` with `httpStatus: 401`

#### Scenario: Blocked host

- **WHEN** the server `baseUrl` resolves to a private address
- **THEN** the probe returns `ok: false` with `MCP_HOST_NOT_ALLOWED` and no upstream connection is made

#### Scenario: Explicit auth is rendered

- **WHEN** the server has Bearer auth referencing an auth-owned secret id
- **THEN** the probe resolves that id for the protected Authorization header without inspecting common-entry text

### Requirement: Owner can copy a connection snippet

The system SHALL let the owner create a server-scoped agent token, display the raw token only once at creation, persist only a hash, and return a connection snippet containing the gateway URL `{API_ORIGIN}/mcp/{serverId}` and instructions to send that token as Bearer.

#### Scenario: Token shown once

- **WHEN** the owner creates an agent token
- **THEN** the response includes the raw token and prefix, and later list views show only the prefix and metadata

#### Scenario: Revoke token

- **WHEN** the owner revokes an agent token
- **THEN** that token MUST fail gateway authentication

### Requirement: Records are recipe-ready without secrets

Server, tool, and server-value metadata SHALL be sufficient to reconstruct a canonical typed recipe later: server identity and network policy, ordered common entries, explicit authentication shape with secret references removed or declared as required inputs, versioned request definitions, tool behavior metadata, and server-value names with `kind` and `owner`. Secret values, ciphertext, agent tokens, compiled runtime artifacts, and call logs SHALL NOT be part of that recipe shape.

#### Scenario: Recipe shape excludes secret material

- **WHEN** a server has typed tools, common entries, authentication, and server values
- **THEN** its recipe contains canonical authoring metadata and required-secret declarations but no plaintext, ciphertext, token, or runtime log

#### Scenario: Recipe round-trip keeps origins

- **WHEN** a secret-free recipe is recreated with required secrets supplied separately
- **THEN** its request bindings and common entries preserve their explicit origin types and stable internal relationships

### Requirement: Studio tool fields choose a value origin

The SPA SHALL represent every structured request value as exactly one typed origin: Fixed, Server configuration, Server secret, or Agent input. Fixed values SHALL retain their literal or JSON primitive value. Server origins SHALL retain a server-value id and optional prefix/suffix. Agent origins SHALL retain an agent-input id whose metadata is stored once in the definition. The SPA SHALL submit and reload these bindings directly without text classification.

#### Scenario: Server secret is persisted by id

- **WHEN** the owner selects secret `api_token` with prefix `Bearer ` for a header
- **THEN** the request payload and stored definition reference the secret id and never serialize its display name as a binding token

#### Scenario: Typed JSON literal stays typed

- **WHEN** the owner sets a JSON field to fixed boolean `false`
- **THEN** the definition stores boolean false rather than string `"false"`

#### Scenario: Reorder preserves identity

- **WHEN** the owner reorders query entries
- **THEN** their ids and bindings remain unchanged while their array order is updated

### Requirement: Studio tool dialog is a request builder

The create/edit/duplicate tool dialog SHALL mirror the versioned request-definition model for path, ordered query/header/form entries, structured JSON, raw bodies, and the shared agent-input registry. Its save payload SHALL contain only the strict typed command. Structured fields SHALL reference agent inputs rather than duplicate their metadata. Advanced raw bodies SHALL insert explicit binding-id tokens and SHALL treat undeclared brace text literally. Compile issues SHALL attach to stable node ids when available.

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

### Requirement: Studio can edit a server variable

The Settings server-values list SHALL offer an edit action that opens a dialog. The name and ownership SHALL be read-only. The owner SHALL be able to replace the value and change its kind between `config` and `secret`. Secret values SHALL NOT be shown. Rotating a secret or turning a secret into a config SHALL require a newly entered value. Turning a config into a secret MAY reuse the visible current value.

#### Scenario: Rotate secret

- **WHEN** the owner edits secret `api_token`, enters a new value, and saves
- **THEN** the list still shows the secret badge and no plaintext value

#### Scenario: Secret value stays hidden

- **WHEN** the owner opens the edit dialog for a secret server value
- **THEN** the value field is empty and the previous secret is not displayed

#### Scenario: Ownership remains unchanged

- **WHEN** the owner edits a manual config or secret
- **THEN** the value remains manual and the dialog does not offer auth ownership

### Requirement: Studio confirms variable deletion

The Settings server-values list SHALL require destructive confirmation before deletion. A referenced server value SHALL NOT be deleted until the owner removes or replaces every tool, default, or auth reference. The dialog SHALL list all known references, including references outside the currently loaded tools page.

#### Scenario: Cancel leaves the value

- **WHEN** the owner starts deletion and cancels
- **THEN** the server value remains and no delete request is sent

#### Scenario: Referenced value is blocked

- **WHEN** a secret is referenced by auth or any tool binding
- **THEN** deletion is rejected with structured reference details and no request definition is left dangling

### Requirement: Server common entries use Fixed or Server Value origins

The Settings editor SHALL read and write typed ordered common entries. Each entry SHALL have a stable id and a Fixed, Server configuration, or Server secret origin; Agent input is forbidden. Saving SHALL preserve stable server-value ids and SHALL atomically recompile affected enabled tools. Auth-owned keys SHALL be displayed as protected and editable only through the Auth card.

#### Scenario: Common binding survives rename

- **WHEN** a common header references configuration id `value_1` and its display name changes
- **THEN** Settings and compiled tools retain the same binding without reclassification

#### Scenario: Common update reports affected tools

- **WHEN** a candidate common entry invalidates two enabled tools
- **THEN** save writes nothing and returns diagnostics identifying both tools and request locations

### Requirement: Owner chooses authentication when creating a server

The create-server dialog SHALL ask which authentication to use: None, Bearer token, API key header, API key query, or Basic. Only the fields required by the selected type SHALL be visible. Bearer SHALL collect a token. Header SHALL collect a header name with default `X-API-Key` and a value. Query SHALL collect a query parameter name with default `api_key`, a value, and required exposure acknowledgement. Basic SHALL collect a username and a password. The owner SHALL NOT choose storage fields, name backing values, or type binding syntax. Empty credentials for a non-None type SHALL be rejected. The create request SHALL persist the server, auth-owned secret values, and explicit authentication configuration in one transaction.

#### Scenario: Bearer on create

- **WHEN** the owner creates a server with type Bearer and token `sk_live_123`
- **THEN** the server has an explicit Bearer configuration referencing an auth-owned secret and later reads do not include `sk_live_123`

#### Scenario: None on create

- **WHEN** the owner creates a server with type None
- **THEN** the server has no auth-owned secret value or authentication configuration from this flow

#### Scenario: Header fields appear only for that type

- **WHEN** the owner selects API key header
- **THEN** the dialog shows header name and value inputs and does not show Basic username/password

#### Scenario: Query auth requires acknowledgement

- **WHEN** the owner selects API key query without acknowledging URL exposure
- **THEN** creation is rejected before any server or secret is written

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

The SPA SHALL NOT probe connectivity as a side effect of creating a server. Create success and the Settings Auth card SHALL offer an explicit Test connection control that calls the existing probe using the committed common entries and explicit authentication configuration.

#### Scenario: Create does not auto-test

- **WHEN** the owner successfully creates a server
- **THEN** no connectivity probe runs until they click Test connection

#### Scenario: Settings test uses current auth

- **WHEN** the owner has saved Bearer auth and clicks Test connection
- **THEN** the probe sends the protected Authorization header resolved from the committed auth-owned secret

### Requirement: Studio playground shows upstream HTTP results

When playground invoke returns an executor result (including non-2xx `httpStatus`), the SPA SHALL render the HTTP status and capped body and SHALL link to the call log when `callLogId` is present. It SHALL NOT treat that result as a generic product error toast. A new submit SHALL clear the previous result panel. Tools that cannot run (disabled, mutation not allowed, server paused) SHALL stay selectable with invoke disabled and an explanation.

#### Scenario: 401 is visible in the panel

- **WHEN** invoke returns `httpStatus` 401 and a JSON body
- **THEN** the playground shows status 401 and that body, and a toast does not claim a generic upstream product failure

#### Scenario: Disabled tool explains itself

- **WHEN** the owner selects a tool with `enabled` false
- **THEN** invoke is disabled and the copy states the tool is disabled

### Requirement: Studio shows an effective request preview

Before enabling a tool, the SPA SHALL submit the unsaved typed request definition to the same backend compiler used by persistence. The preview SHALL show the compiled method, URL shape, query, headers, and body with secret values redacted, inherited common entries, protected auth injection, omitted optional entries, and location-aware issues. Preview SHALL perform no writes and SHALL compile the submitted definition directly.

#### Scenario: Preview matches subsequent save

- **WHEN** the owner previews and then saves an unchanged typed definition against unchanged server configuration
- **THEN** both operations return the same compile outcome and effective plan shape

#### Scenario: Preview does not persist draft ids

- **WHEN** preview rejects a definition
- **THEN** no tool, common entry, compiled plan, or server value is written

### Requirement: Enabled and mutation controls are independent and truthful

The Studio SHALL represent draft availability and mutation permission without silently toggling an unrelated control or implying that a saved draft is already live. A mutating draft tool without permission cannot be enabled; removing permission from an enabled mutating draft tool SHALL explain and confirm the required draft disable. Read tools SHALL never be disabled merely because mutation permission is false. Changes to either control SHALL affect agents only after a successful server publication.

#### Scenario: Read tool remains enabled in the draft

- **WHEN** mutation permission is false for an enabled GET draft tool
- **THEN** the draft tool remains enabled

#### Scenario: Revoking mutation permission is explicit

- **WHEN** the owner revokes mutation permission from an enabled POST draft tool
- **THEN** the UI explains that the draft tool must also be disabled and applies both draft changes only after confirmation

#### Scenario: Saved enablement is not represented as published

- **WHEN** an owner enables, disables, or changes mutation permission on a live server's draft
- **THEN** Studio marks the server as having unpublished changes
- **AND** the active gateway behavior remains on the published revision until publication

### Requirement: Studio validates agent-facing contract readiness

The Studio SHALL compile deterministic contract-readiness diagnostics from the same backend contract compiler used by the gateway. A tool SHALL NOT be enabled unless it has a valid human-facing title, nonblank outcome-oriented description, descriptions for every exposed agent input, supported schema constraints, and non-contradictory annotations. Incomplete tools MAY be saved only as disabled drafts. The system SHALL NOT generate placeholder title/description copy to preserve an incomplete enabled tool.

#### Scenario: Missing input description blocks enable

- **WHEN** a new tool exposes required input `contact_id` without a description
- **THEN** the owner may save it disabled but cannot enable it until the description is supplied

#### Scenario: Contradictory annotation blocks enable

- **WHEN** a POST tool is marked read-only
- **THEN** readiness reports the contradiction and the tool is not enabled

#### Scenario: Incomplete development tool is not preserved as enabled

- **WHEN** a development tool lacks required contract copy during the clean migration
- **THEN** the tool is disabled or removed by an explicit development-data reset and no generated placeholder copy is persisted

#### Scenario: Disabled draft supports iterative authoring

- **WHEN** a contract has readiness errors and the owner saves without enabling
- **THEN** the typed request definition and diagnostics persist as a disabled Studio draft and the gateway does not advertise it

### Requirement: Studio previews the exact agent-visible MCP contract

Before enabling a tool, Studio SHALL provide a backend-generated preview of the exact normalized `tools/list` item, including name, title, description, input schema, output schema, annotations, contract version, fingerprint, and readiness diagnostics. The preview SHALL use the unsaved typed definition, perform no writes, and redact secret values, sensitive examples, internal database ids, and resolved credential-bearing URLs.

#### Scenario: Preview matches listed contract

- **WHEN** the owner previews, saves, and enables an unchanged valid definition against unchanged server configuration
- **THEN** the gateway advertises the same normalized contract and fingerprint shown in preview

#### Scenario: Preview explains mutation behavior

- **WHEN** a mutating tool is destructive and non-idempotent
- **THEN** preview displays those exact annotations and safe retry implications before enable

#### Scenario: Preview never resolves secret binding

- **WHEN** a request header references a server secret
- **THEN** preview may describe the binding's effect but contains neither the secret value nor secret-derived text

#### Scenario: Preview is write-free

- **WHEN** contract compilation fails
- **THEN** preview returns location-aware diagnostics without modifying the tool, compiled plan, server values, or enabled state

### Requirement: Studio configuration commands are atomic

The system SHALL execute each server-scoped Studio mutation as one transaction that includes ownership validation, invariant checks, all related database writes, and the server revision increment.

#### Scenario: Tool creation promotes a draft server atomically

- **WHEN** an owner creates the first enabled valid tool on a draft server
- **THEN** the tool insertion, compiled plan, draft-to-live promotion, and revision increment commit together
- **AND** a failure in any step leaves the tool absent and the server unchanged

#### Scenario: Concurrent tool creation respects the capacity limit

- **WHEN** concurrent create or duplicate commands would exceed the maximum tool count
- **THEN** the system serializes the capacity check for that server
- **AND** only commands that fit within the limit commit

#### Scenario: Server deletion excludes concurrent child writes

- **WHEN** a server deletion races with a tool, variable, authentication, token, or settings mutation
- **THEN** the commands serialize on the same server aggregate
- **AND** the final state is either the complete non-deleted mutation followed by deletion or no server aggregate at all

### Requirement: Studio rejects stale configuration writes

The system SHALL require the last observed server configuration revision for mutations of an existing server and SHALL reject a stale revision without changing persistent state.

#### Scenario: Current revision commits once

- **WHEN** a mutation supplies the current configuration revision and passes validation
- **THEN** the system commits the command and increments the server revision exactly once
- **AND** the response includes the new revision

#### Scenario: Stale form cannot overwrite a newer change

- **WHEN** a Studio form submits an expected revision older than the current server revision
- **THEN** the system returns the stable `MCP_WRITE_CONFLICT` application code and the current revision
- **AND** no portion of the stale mutation is persisted

#### Scenario: Studio recovers visibly from a conflict

- **WHEN** the SPA receives `MCP_WRITE_CONFLICT`
- **THEN** it reloads the current server aggregate and presents localized conflict guidance
- **AND** it does not report the stale mutation as successful

### Requirement: Runtime readers observe one committed server revision

The system SHALL materialize gateway tool listings and invocation configuration from a single committed database snapshot before performing external work.

#### Scenario: Invocation overlaps a configuration commit

- **WHEN** an invocation loads configuration while a Studio command is committing
- **THEN** the invocation uses either the complete previous revision or the complete new revision
- **AND** it never combines server settings, compiled plans, authentication, or values from different revisions

#### Scenario: Upstream HTTP does not hold the snapshot transaction

- **WHEN** invocation preparation has materialized a valid immutable snapshot
- **THEN** the read transaction ends before the upstream HTTP request begins

### Requirement: Server icon changes are commit-aware

The system SHALL represent server icons only as user-owned staged assets referenced by opaque asset id and SHALL make attachment and replacement visible only through a committed server mutation. Server mutation contracts SHALL NOT accept or read a legacy icon URL field.

#### Scenario: Legacy icon URL is not accepted

- **WHEN** a caller submits the superseded icon URL field instead of a ready owned asset id
- **THEN** validation rejects the request and no compatibility write or fallback read is performed

#### Scenario: Uploaded asset is not attached after a failed mutation

- **WHEN** an icon upload succeeds but the server mutation fails or conflicts
- **THEN** the current server icon remains unchanged
- **AND** the unattached asset remains eligible for durable garbage collection

#### Scenario: Replacing an icon preserves the committed icon until commit

- **WHEN** an owner replaces a server icon
- **THEN** attaching the new asset and marking the prior asset for deletion commit with the server revision increment
- **AND** object deletion starts only after the database commit

#### Scenario: Object deletion failure is recoverable

- **WHEN** deletion of a replaced or abandoned object fails
- **THEN** the committed server configuration remains valid
- **AND** durable cleanup state retains enough information for an idempotent retry without exposing another user's object

### Requirement: Studio distinguishes draft, published, and operational state

The Studio SHALL display the active published revision, whether the draft differs, draft readiness, and paused/runtime state as separate concepts. Save actions SHALL use draft language, publication SHALL be a distinct action, and pause/resume SHALL remain immediately operational.

#### Scenario: Live server has unpublished changes

- **WHEN** a live server's draft fingerprint differs from its active revision
- **THEN** the server remains labeled live on its published revision and separately shows an unpublished-changes indicator

#### Scenario: Never-published server is draft

- **WHEN** a server has no published revision
- **THEN** Studio identifies it as unpublished draft and does not claim that connected agents can call it

#### Scenario: Pause does not discard draft or revision

- **WHEN** an owner pauses a server with unpublished changes
- **THEN** gateway availability stops immediately while both the active revision and dirty draft remain available for resume or editing

### Requirement: Studio reviews publication before commit

The Studio SHALL provide a publish review surface containing readiness, blocking issues, warnings, safe structured diff, current/candidate contract identity, and an optional bounded note. It SHALL require explicit acknowledgement of candidate-bound warnings and SHALL never show secret/config values in the diff.

#### Scenario: Blocking issue disables publish

- **WHEN** preview reports a blocking compiler, binding, or policy issue
- **THEN** the publish action remains unavailable and Studio links the issue to the affected draft location

#### Scenario: Successful publish refreshes all surfaces

- **WHEN** publication succeeds
- **THEN** Studio shows the new active revision, clears the dirty indicator for the matching draft, refreshes published contract/playground data, and retains revision history

#### Scenario: Publish conflict preserves form work

- **WHEN** publication conflicts with a newer draft or active revision
- **THEN** Studio reloads revision metadata, reports the conflict in the active locale, and does not report publication success or discard unsaved form state

### Requirement: Studio exposes revision history without secret material

The Studio SHALL list paginated revision summaries, display secret-safe change categories and actor/source metadata, and allow an owner to restore a selected revision to the current draft after confirmation.

#### Scenario: History distinguishes Studio and Platform publication

- **WHEN** revisions were published through the SPA and Platform MCP
- **THEN** history identifies each safe source and timestamp without exposing session ids, raw tokens, or secret references

#### Scenario: Restore is visibly draft-only

- **WHEN** an owner restores a prior revision
- **THEN** Studio explains that runtime remains unchanged and requires preview plus a new publication before agents see the restored structure

### Requirement: Owner can search the Studio tool list by name

The Studio tools list SHALL accept an optional name query `q` that is trimmed client-side and bounded in length; an absent or blank `q` SHALL mean unfiltered. The list and count queries SHALL apply the same case-insensitive, LIKE-escaped name predicate combined with the active group filter, so page rows and total can never diverge. Changing `q` or the group filter SHALL reset the page to the first page, and the query SHALL persist in the route URL. Search SHALL match draft tool names only and SHALL NOT affect publication, gateway discovery, execution, or Platform MCP outputs.

#### Scenario: Search narrows rows and total with one predicate

- **WHEN** the owner searches for `ad_account` on a server with matching and non-matching tools
- **THEN** the page rows and the reported total contain only tools whose name matches case-insensitively

#### Scenario: Search combines with the group filter

- **WHEN** the owner filters by group `Ad Manager` and searches for `pause`
- **THEN** the response contains only matching tools assigned to `Ad Manager` and the total reflects both predicates

#### Scenario: Metacharacters match literally

- **WHEN** the owner searches for `100%_off`
- **THEN** only a tool literally named with that substring matches, with no wildcard interpretation of `%` or `_`

#### Scenario: Blank query is unfiltered

- **WHEN** the owner clears the search input
- **THEN** the unfiltered paginated list returns with the page reset to the first page

### Requirement: Studio can request bounded AI optimization for draft tools

Studio SHALL let the owner request optimization for one tool, selected tools, or every eligible tool in the current server draft, subject to AI readiness, scope limits, eligibility, and explicit authorization.

#### Scenario: Optimize one tool

- **WHEN** the owner invokes optimization from an eligible tool row or editor
- **THEN** preflight contains only that tool and opens the authorization review before any model call

#### Scenario: Optimize selected tools

- **WHEN** the owner selects multiple eligible tool rows and invokes optimization
- **THEN** preflight preserves exactly those tool identities and reports any ineligible selection separately

#### Scenario: Optimize all eligible tools

- **WHEN** the owner invokes optimization for all tools in the server
- **THEN** preflight includes every currently eligible draft tool regardless of current pagination or search results and reports the full scope and estimate

#### Scenario: AI model is not ready

- **WHEN** `structured-text-v1` readiness is unavailable
- **THEN** optimization controls are disabled and provide a link to AI Settings

#### Scenario: Tool cannot be safely snapshotted

- **WHEN** a draft tool lacks a parseable supported canonical definition or exceeds sanitizer bounds
- **THEN** Studio marks it ineligible with a localized reason and does not send it to the model

#### Scenario: Authorization is declined

- **WHEN** the owner cancels the preflight authorization dialog
- **THEN** no model call occurs and the mutable draft remains unchanged

### Requirement: Studio presents progress and recommendations before applying

Studio SHALL expose durable run progress, cancellation, partial failures, per-tool comparison, advisory findings, and individual executable-operation selection before any draft mutation.

#### Scenario: Running scan is revisited

- **WHEN** the owner leaves and later returns while a run is queued or running
- **THEN** Studio reloads persisted progress and offers cancellation without relying on the original browser session

#### Scenario: Completed item has guarded changes

- **WHEN** a tool recommendation includes request-shaping operations
- **THEN** Studio labels them guarded and shows both field-level changes and the redacted effective-request difference

#### Scenario: Item has immutable-field concern

- **WHEN** analysis suspects a path, method, authentication, host, secret, enablement, mutation, or publication issue
- **THEN** Studio shows an advisory-only finding without an apply checkbox

#### Scenario: Partial run completes

- **WHEN** some tools fail analysis and others produce recommendations
- **THEN** Studio shows both groups and allows valid recommendations to be reviewed without hiding failures

#### Scenario: Owner applies selected operations

- **WHEN** the owner confirms a set of valid recommendation operation IDs against the observed draft revision
- **THEN** Studio applies them through one atomic draft command and refreshes tool, server, compile, and publication-readiness state

#### Scenario: Draft changed during review

- **WHEN** the server or any selected tool changed after authorization
- **THEN** Studio preserves the visible recommendations, reports a stale conflict, and requires a new optimization run rather than silently rebasing

#### Scenario: Successful application remains unpublished

- **WHEN** selected AI recommendations commit
- **THEN** Studio identifies them as saved draft changes and requires the normal publication review before agent-visible behavior changes
