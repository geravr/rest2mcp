## MODIFIED Requirements

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

### Requirement: Server defaults use Fixed or Variable origins

The Settings editor SHALL read and write typed ordered common entries. Each entry SHALL have a stable id and a Fixed, Server configuration, or Server secret origin; Agent input is forbidden. Saving SHALL preserve stable server-value ids and SHALL atomically recompile affected enabled tools. Auth-owned keys SHALL be displayed as protected and editable only through the Auth card.

#### Scenario: Common binding survives rename

- **WHEN** a common header references configuration id `value_1` and its display name changes
- **THEN** Settings and compiled tools retain the same binding without reclassification

#### Scenario: Common update reports affected tools

- **WHEN** a candidate common entry invalidates two enabled tools
- **THEN** save writes nothing and returns diagnostics identifying both tools and request locations

### Requirement: Studio shows an effective request preview

Before enabling a tool, the SPA SHALL submit the unsaved typed request definition to the same backend compiler used by persistence. The preview SHALL show the compiled method, URL shape, query, headers, and body with secret values redacted, inherited common entries, protected auth injection, omitted optional entries, and location-aware issues. Preview SHALL perform no writes and SHALL NOT translate the definition through legacy templates.

#### Scenario: Preview matches subsequent save

- **WHEN** the owner previews and then saves an unchanged typed definition against unchanged server configuration
- **THEN** both operations return the same compile outcome and effective plan shape

#### Scenario: Preview does not persist draft ids

- **WHEN** preview rejects a definition
- **THEN** no tool, common entry, compiled plan, or server value is written
