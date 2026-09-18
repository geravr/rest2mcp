## MODIFIED Requirements

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

### Requirement: Studio infers origins when opening a saved tool

For versioned request definitions, the SPA SHALL load the persisted origins exactly and SHALL NOT infer them from current server-value names. For legacy templates only, the backend SHALL run compatibility analysis; unambiguous origins MAY be proposed, while ambiguous placeholders SHALL be shown as blocking migration issues and the tool SHALL remain disabled until the owner resolves them.

#### Scenario: New definition survives value changes

- **WHEN** a fixed or agent-input binding shares text with a subsequently created server value
- **THEN** reopening the tool preserves its original binding source

#### Scenario: Ambiguous legacy placeholder is not guessed

- **WHEN** a legacy `{{name}}` could refer to both a declared input and a server value
- **THEN** the Studio shows a migration issue and does not enable the tool automatically

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

## ADDED Requirements

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
