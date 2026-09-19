## ADDED Requirements

### Requirement: Canonical MCP authoring state is structurally complete

The system SHALL persist MCP authoring state using only versioned request definitions, canonical compiled artifacts, ordered common entries, explicit authentication configuration, and server values with non-null `kind` and `owner`. The persistence model SHALL NOT contain alternate request-template projections, default string maps, boolean secrecy aliases, or a legacy compile status. Config server values SHALL use readable value storage, secret server values SHALL use encrypted storage, and the unused storage form SHALL be empty.

#### Scenario: New records contain canonical state only

- **WHEN** a server and typed tool are created successfully
- **THEN** their rows contain the canonical typed fields and no alternate compatibility representation is written

#### Scenario: Server value storage matches its kind

- **WHEN** a config value and a secret value are persisted
- **THEN** the config uses readable storage only and the secret uses encrypted storage only

#### Scenario: Structurally incomplete tool cannot become runnable

- **WHEN** a tool lacks a valid request definition or canonical compiled artifact
- **THEN** it cannot be enabled, advertised, or invoked

## MODIFIED Requirements

### Requirement: Requests are defined as templates

A tool SHALL store a versioned request definition as its only authoring source, composed of literal, server-value, and agent-input bindings for ordered path segments, query entries, headers, form fields, and body nodes. Tool create, update, duplicate, and preview commands SHALL accept this definition directly and SHALL reject unknown authoring fields. Literal bindings SHALL never be scanned for binding syntax. JSON bodies SHALL use typed recursive nodes rather than string substitution. Raw advanced bodies SHALL replace only explicitly declared binding ids. GET and HEAD definitions SHALL reject bodies.

#### Scenario: Typed command is persisted without inference

- **WHEN** an author submits literal text containing braces, a server-value binding by id, and an agent-input binding by id
- **THEN** the stored request definition preserves all three sources exactly without classifying them by text

#### Scenario: Unknown authoring field is rejected

- **WHEN** a create or update command includes a field outside the typed command schema
- **THEN** validation rejects the command before compilation and writes nothing

#### Scenario: Ordered repeated query entries remain distinct

- **WHEN** a definition contains two query entries with the same wire name and distinct entry ids
- **THEN** persistence preserves their order and identities for compiler validation instead of collapsing them into a record

#### Scenario: Raw body replaces only declared ids

- **WHEN** a raw body declares binding id `bind_1` and also contains undeclared `{{api_token}}`
- **THEN** only `{{bind_1}}` is a binding token and `{{api_token}}` remains literal text

#### Scenario: GET body is rejected

- **WHEN** a GET tool definition contains any body variant other than `none`
- **THEN** compilation fails instead of storing a body that execution ignores

### Requirement: Server default headers and query

A server SHALL persist ordered common header/query entries as its only server-wide request definition, using explicit literal or server-value bindings with stable entry ids. Studio and Platform writes SHALL submit this typed shape directly. Agent-input bindings are forbidden. An update SHALL compile every affected enabled tool against the candidate entries before commit; if any tool becomes invalid, the update SHALL fail atomically with per-tool diagnostics. Auth-owned keys remain protected and are injected after ordinary entries.

#### Scenario: Common entry keeps its source

- **WHEN** the owner saves common header `Version` bound to configuration id `value_1` and later renames that configuration
- **THEN** reopening Settings and executing tools retain the `value_1` binding

#### Scenario: Invalidating update is atomic

- **WHEN** a common-header update would conflict with an auth-protected key for an enabled tool
- **THEN** the common entries and all compiled tool plans remain unchanged and the response identifies the affected tool

#### Scenario: Agent input is rejected from common values

- **WHEN** a common entry contains an agent-input binding
- **THEN** validation rejects the update because server-wide values cannot require invocation input

#### Scenario: Allowed tool override

- **WHEN** a common non-protected `Accept` header is JSON and a tool explicitly defines CSV
- **THEN** the effective compiled request uses the tool's CSV value

#### Scenario: Protected auth override is rejected

- **WHEN** authentication owns `Authorization` and common or tool entries define that header
- **THEN** compilation rejects the conflicting entry

### Requirement: Variable update can rotate value and secrecy

The system SHALL update an existing server value by stable id while treating `kind` (`config` or `secret`) as the only secrecy classification and preserving its `owner`. Secret values SHALL remain write-only in responses. Turning a secret into a config SHALL require a new value in the same request. Turning a config into a secret MAY encrypt either a newly submitted value or its currently readable value. Generic value editing SHALL NOT change auth ownership.

#### Scenario: Rotate secret keeps write-only response

- **WHEN** the owner updates secret `api_token` with a new value
- **THEN** the stored ciphertext changes and the response does not include the new value

#### Scenario: Change secret to config requires replacement

- **WHEN** the owner changes secret `api_token` to kind `config` without submitting a new value
- **THEN** the system rejects the request and the value remains secret

#### Scenario: Change config to secret clears readable storage

- **WHEN** the owner changes a config value to kind `secret`
- **THEN** the resulting value is encrypted and its prior readable storage is removed

#### Scenario: Generic edit cannot adopt auth ownership

- **WHEN** a manual server value is edited through the ordinary value command
- **THEN** it remains manual and cannot become auth-owned through that command

## REMOVED Requirements

### Requirement: Legacy template compilation is explicit

**Reason**: Runtime analysis, compatibility projection, and conversion drafts preserve an unreleased authoring model and create multiple sources of truth.

**Migration**: Reset or reseed disposable development MCP data and recreate required tools through the canonical typed authoring APIs. No application-level converter or backfill is provided.
