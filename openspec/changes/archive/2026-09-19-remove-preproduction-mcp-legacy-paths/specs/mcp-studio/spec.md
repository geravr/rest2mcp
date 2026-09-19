## ADDED Requirements

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

### Requirement: Studio binding errors identify canonical locations

When Studio preview, save, or playground execution reports a binding or compilation failure, the SPA SHALL render localized copy in English and Spanish using structured issue codes, stable node or entry ids, and safe public names when available. It SHALL NOT parse an English server message or require a placeholder string to identify the problem.

#### Scenario: Missing agent input names its location

- **WHEN** a query entry references an absent agent-input id
- **THEN** Studio identifies the affected query entry and stable input reference in the active locale

#### Scenario: Secret-safe binding error

- **WHEN** a secret server-value reference cannot be resolved
- **THEN** the error identifies the safe reference location without including plaintext or ciphertext

## MODIFIED Requirements

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

### Requirement: Connection test runs only when the owner asks

The SPA SHALL NOT probe connectivity as a side effect of creating a server. Create success and the Settings Auth card SHALL offer an explicit Test connection control that calls the existing probe using the committed common entries and explicit authentication configuration.

#### Scenario: Create does not auto-test

- **WHEN** the owner successfully creates a server
- **THEN** no connectivity probe runs until they click Test connection

#### Scenario: Settings test uses current auth

- **WHEN** the owner has saved Bearer auth and clicks Test connection
- **THEN** the probe sends the protected Authorization header resolved from the committed auth-owned secret

### Requirement: Studio shows an effective request preview

Before enabling a tool, the SPA SHALL submit the unsaved typed request definition to the same backend compiler used by persistence. The preview SHALL show the compiled method, URL shape, query, headers, and body with secret values redacted, inherited common entries, protected auth injection, omitted optional entries, and location-aware issues. Preview SHALL perform no writes and SHALL compile the submitted definition directly.

#### Scenario: Preview matches subsequent save

- **WHEN** the owner previews and then saves an unchanged typed definition against unchanged server configuration
- **THEN** both operations return the same compile outcome and effective plan shape

#### Scenario: Preview does not persist draft ids

- **WHEN** preview rejects a definition
- **THEN** no tool, common entry, compiled plan, or server value is written

## REMOVED Requirements

### Requirement: Studio infers origins when opening a saved tool

**Reason**: Origin inference and conversion drafts support disposable pre-production records while obscuring the canonical typed state.

**Migration**: Reset or reseed development data and recreate any needed tool with explicit typed origins. Studio opens only canonical typed definitions.

### Requirement: Unresolved template errors name the placeholder

**Reason**: Canonical compilation identifies bindings by structured issue code and stable location rather than unresolved placeholder text.

**Migration**: Map owner-facing errors to the new structured binding diagnostics and remove placeholder-specific locale entries.

## RENAMED Requirements

- FROM: `### Requirement: Server defaults use Fixed or Variable origins`
- TO: `### Requirement: Server common entries use Fixed or Server Value origins`
