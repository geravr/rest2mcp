# MCP Templates

## Purpose

Server variables with secrecy, request templates with context-aware escaping, declared tool params, and server-level default headers/query — the model that lets one studio express any REST API without per-auth-scheme special cases.

## Requirements

### Requirement: Owner can manage server variables

The system SHALL let the owner manage server values scoped to an owned server. Each value SHALL have a stable id, unique display name matching `[a-z][a-z0-9_]*`, kind `config` or `secret`, optional description, and ownership `manual` or `auth`. Secret values SHALL be encrypted at rest and write-only; config values SHALL be readable. Runtime bindings SHALL reference stable ids rather than resolve by matching agent-input names.

#### Scenario: Create secret server value

- **WHEN** the owner creates secret `api_token`
- **THEN** its value is encrypted, reads expose only metadata, and tools reference its id

#### Scenario: Create visible configuration

- **WHEN** the owner creates config `location_id` with value `loc_9`
- **THEN** the owner can read the value and bind it to tools

#### Scenario: Agent input name collision is rejected

- **WHEN** an enabled tool would expose agent input `api_token` while a server value uses that name
- **THEN** compilation rejects the ambiguous public contract even though runtime references use ids

#### Scenario: Other user cannot read values

- **WHEN** user B lists values for user A's server
- **THEN** the system rejects with `MCP_SERVER_NOT_FOUND`

### Requirement: Requests are defined as templates

A tool SHALL store a versioned request definition as its canonical authoring source, composed of literal, server-value, and agent-input bindings for ordered path segments, query entries, headers, form fields, and body nodes. Tool create, update, duplicate, and preview commands SHALL accept this definition directly and SHALL reject a payload that mixes it with legacy template fields. Literal bindings SHALL never be rescanned for placeholders. JSON bodies SHALL use typed recursive nodes rather than string substitution. Raw advanced bodies SHALL replace only explicitly declared binding ids. GET and HEAD definitions SHALL reject bodies.

#### Scenario: Typed command is persisted without inference

- **WHEN** an author submits a literal containing `{{api_token}}`, a server-value binding by id, and an agent-input binding by id
- **THEN** the stored request definition preserves all three sources exactly without classifying them by text

#### Scenario: Mixed authoring contracts are rejected

- **WHEN** a create or update command includes both `requestDefinition` and legacy `pathTemplate` or `params`
- **THEN** validation rejects the command and writes nothing

#### Scenario: Ordered repeated query entries remain distinct

- **WHEN** a definition contains two query entries with the same wire name and distinct entry ids
- **THEN** persistence preserves their order and identities for compiler validation instead of collapsing them into a record

#### Scenario: Raw body replaces only declared ids

- **WHEN** a raw body declares binding id `bind_1` and also contains undeclared `{{api_token}}`
- **THEN** only `{{bind_1}}` is a binding token and `{{api_token}}` remains literal text

#### Scenario: GET body is rejected

- **WHEN** a GET tool definition contains any body variant other than `none`
- **THEN** compilation fails instead of storing a body that execution ignores

### Requirement: Placeholders resolve args-first with context-aware escaping

At execution, each compiled binding SHALL resolve only from its persisted source and stable reference. Agent-provided values SHALL never be rescanned as template syntax and SHALL never fall back to a server value. Server-value bindings SHALL never accept an agent override. Path values SHALL be encoded as individual segments and the final normalized path SHALL remain beneath the server base path. JSON values SHALL preserve their declared JSON types. Optional agent inputs SHALL omit only request structures whose binding defines omission semantics; optional path segments and unsupported mixed compositions SHALL be rejected at compile time.

#### Scenario: Agent cannot expand a secret

- **WHEN** an agent string argument equals `{{api_token}}`
- **THEN** it remains ordinary string data and does not cause the server secret to be read or injected

#### Scenario: Server secret survives display-name change

- **WHEN** a bound server secret is renamed after a tool was saved
- **THEN** the tool continues resolving the same server-value id without becoming an agent input

#### Scenario: Optional query entry is omitted

- **WHEN** an optional agent input is the complete binding for one query entry and is absent
- **THEN** that query entry is omitted

#### Scenario: Optional path input is rejected

- **WHEN** an optional agent input is referenced by a path segment
- **THEN** compilation fails before the definition can be enabled

#### Scenario: Dot path segment stays confined

- **WHEN** a path input is `..`
- **THEN** the request does not escape the configured base path and is rejected if confinement cannot be preserved

#### Scenario: JSON string and null remain valid

- **WHEN** a JSON binding resolves to a string or null permitted by its node type
- **THEN** the rendered body contains that exact JSON value rather than interpolated template text

### Requirement: Tools declare agent params

Each tool SHALL persist each agent input once with an opaque definition-local id, unique public name, description, required flag, sensitive flag, and JSON-Schema-compatible type and constraints. Every request location using that input SHALL reference its id. Renaming an input SHALL preserve its id and all references. Compilation SHALL reject duplicate ids or public names, unused inputs, unresolved references, conflicting constraints, invalid empty-value rules, and schemas incompatible with their request context.

#### Scenario: One input is reused by id

- **WHEN** path and header bindings reference the same agent-input id
- **THEN** one input definition is persisted and both locations expose the same validated agent argument

#### Scenario: Rename preserves references

- **WHEN** the owner renames an input while editing a typed tool
- **THEN** its id and all request references remain unchanged while the MCP public name changes

#### Scenario: Missing input id is rejected

- **WHEN** a request binding references an agent-input id absent from the registry
- **THEN** the compiler returns a location-aware issue and the tool cannot be enabled

#### Scenario: Input constraints are retained

- **WHEN** input `limit` is an optional integer with minimum 1, maximum 100, description, and example 20
- **THEN** those constraints survive save and reopen for MCP schema generation and runtime validation

#### Scenario: Unused input is rejected

- **WHEN** an input is declared but no request binding references its id
- **THEN** the tool cannot be enabled

### Requirement: Server default headers and query

A server SHALL persist ordered common header/query entries as the canonical `commonEntries` definition using explicit literal or server-value bindings with stable entry ids. Studio and Platform writes SHALL submit this typed shape directly and SHALL NOT reconstruct it from legacy string maps. Agent-input bindings are forbidden. An update SHALL compile every affected enabled tool against the candidate entries before commit; if any tool becomes invalid, the update SHALL fail atomically with per-tool diagnostics. Auth-owned keys remain protected and are injected after ordinary entries.

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

### Requirement: Plaintext secrets are rejected in auth positions

The system SHALL prevent plaintext credentials from being stored in tool definitions, common values, query, path, body, cookies, or recognized credential headers. Secret bindings in path or query SHALL require an explicit supported auth configuration and exposure acknowledgement; arbitrary secret bindings in URLs SHALL be rejected. Credential classification SHALL include configured auth ownership and not depend only on header-name heuristics.

#### Scenario: Literal bearer rejected

- **WHEN** the owner saves literal `Authorization: Bearer sk_live_123`
- **THEN** validation rejects it with `MCP_PLAINTEXT_SECRET`

#### Scenario: Nonstandard credential header is protected

- **WHEN** auth owns `X-Partner-Key`
- **THEN** a literal value or tool override for that header is rejected even though its name is nonstandard

#### Scenario: Literal query credential rejected

- **WHEN** the owner saves a fixed query credential such as `api_key=secret`
- **THEN** validation directs the owner to configure a secret-backed auth binding

### Requirement: Auth recipe maps to a secret variable and server defaults

The system SHALL persist authentication as an explicit auth configuration referencing one or more auth-owned secret server values and protected request keys. Applying or clearing a recipe SHALL be transactional, SHALL never overwrite or delete manual values because of a name match, and SHALL never infer ownership from template shape. Bearer, header, query, Basic, and Custom configurations SHALL remain write-only. Query auth SHALL require an exposure acknowledgement.

#### Scenario: Apply bearer without name collision

- **WHEN** a manual config named `api_token` exists and the owner applies Bearer auth
- **THEN** the system creates a distinct auth-owned secret reference and preserves the manual config

#### Scenario: Clear auth deletes only owned secret

- **WHEN** the owner clears Bearer auth
- **THEN** its auth mapping is removed and only an unreferenced auth-owned secret may be deleted

#### Scenario: Replace Custom atomically

- **WHEN** the owner confirms replacing multi-key Custom auth with Basic
- **THEN** all old auth-owned keys and the new Basic mapping change in one transaction while unrelated defaults remain

### Requirement: Variable update can rotate value and secrecy

The system SHALL accept an owner update of an existing variable by `name` that replaces the stored value and MAY set `isSecret`. Secret values SHALL remain write-only in the response (`name`, `isSecret`, `hasValue` only). Turning a secret variable into a non-secret SHALL require a new value in the same request. Turning a non-secret variable into a secret MAY encrypt the submitted value (including the previously readable value). A secret variable SHALL NOT accept an update that omits `value` while requesting `isSecret: false`.

#### Scenario: Rotate secret keeps write-only response

- **WHEN** the owner updates secret `api_token` with a new value
- **THEN** the stored ciphertext changes and the response does not include the new value

#### Scenario: Clear secrecy without a value is rejected

- **WHEN** the owner updates secret `api_token` with `isSecret: false` and no value
- **THEN** the system rejects the request and the variable remains secret

### Requirement: Deleting a variable does not rewrite templates

Deleting a server value SHALL be rejected while any tool, common request value, or auth configuration references its stable id. The system SHALL return structured references so the owner can replace or remove them first. Deletion SHALL never convert the reference into an agent input or leave an unresolved runtime binding.

#### Scenario: Referenced secret cannot be deleted

- **WHEN** auth or a tool references a secret
- **THEN** deletion fails and all definitions remain unchanged

#### Scenario: Unreferenced config can be deleted

- **WHEN** no definition references a config value
- **THEN** the owner can delete it without rewriting any tool

### Requirement: Legacy template compilation is explicit

The system SHALL run legacy template analysis only for a record or explicit compatibility command that lacks a typed request definition. It SHALL convert only unambiguous bindings, preserve legacy source material, and mark ambiguous or unsafe tools invalid and disabled with actionable diagnostics. After a typed definition is saved, reads, previews, edits, and execution SHALL NOT re-run origin inference even when server-value names change. A typed definition SHALL produce legacy compatibility fields only when the projection is semantically lossless.

#### Scenario: Typed record bypasses legacy inference

- **WHEN** a typed record contains fixed text matching a newly created server-value name
- **THEN** loading or resaving the record keeps the fixed binding and does not invoke name-based analysis

#### Scenario: Ambiguous legacy name is disabled

- **WHEN** legacy placeholder `name` matches both stored param metadata and a server value
- **THEN** compatibility analysis leaves the tool disabled and records a diagnostic requiring owner selection

#### Scenario: Lossy projection is not approximated

- **WHEN** a typed definition contains semantics that legacy template fields cannot represent safely
- **THEN** the typed definition remains canonical and the system marks it non-projectable instead of writing an approximate legacy request

#### Scenario: Unambiguous legacy tool is migrated

- **WHEN** every legacy placeholder has exactly one valid source and all compiler checks pass
- **THEN** the compatibility flow produces an equivalent typed definition for owner acceptance or backfill

### Requirement: Dependent compiled plans change atomically

The system SHALL compile and persist the complete affected closure of enabled tools in the same transaction as any source configuration change that can alter their effective requests.

#### Scenario: Server-wide request setting recompiles enabled tools

- **WHEN** an owner changes the base URL, allowed hosts, authentication, or common header or query bindings
- **THEN** the system validates and recompiles every affected enabled tool against the candidate configuration
- **AND** the source change and all new compiled plans commit together

#### Scenario: One invalid dependent tool rejects the source change

- **WHEN** a candidate server-wide or variable-metadata change makes any affected enabled tool invalid
- **THEN** the system rejects the whole command with actionable compile issues
- **AND** neither the source configuration nor any compiled plan changes

#### Scenario: Value rotation preserves structural plans

- **WHEN** an owner rotates a config or secret value without changing its kind, owner, or identity
- **THEN** the value update commits atomically without requiring structurally unchanged plans to be rewritten
- **AND** subsequent execution snapshots resolve only the committed value

### Requirement: Variable reference checks are race-safe

The system SHALL serialize variable create, update, and delete commands with tool, common-entry, and authentication mutations for the same server so persisted bindings cannot reference a missing server value.

#### Scenario: Delete races with a new reference

- **WHEN** one command deletes a server value while another command adds a binding to it
- **THEN** the commands serialize on the server aggregate
- **AND** the final committed state either retains both the value and reference or contains neither reference nor value

#### Scenario: Concurrent same-name creation remains singular

- **WHEN** concurrent commands create or set a value with the same normalized name
- **THEN** at most one value row with that server and name commits
- **AND** the losing command returns a stable conflict or duplicate-name error without changing another row

#### Scenario: Kind transition validates every protected placement

- **WHEN** a value changes between config and secret kinds
- **THEN** the system validates authentication and other secret-required placements before committing
- **AND** an invalid transition leaves the original encrypted or plaintext representation unchanged

### Requirement: Authentication transitions are atomic and secret-safe

The system SHALL treat authentication configuration, auth-owned secret values, replaced-value cleanup, dependent compilation, and the revision increment as one server command.

#### Scenario: Authentication replacement commits as a unit

- **WHEN** an owner replaces one authentication recipe with another valid recipe
- **THEN** the new auth-owned values, authentication bindings, dependent plans, and cleanup of no-longer-used auth values commit together

#### Scenario: Authentication compilation failure rolls back secret rotation

- **WHEN** the candidate authentication makes an enabled tool invalid or a database statement fails
- **THEN** the prior authentication and auth-owned values remain active
- **AND** no plaintext or ciphertext is included in the error, telemetry, or conflict details

### Requirement: Published config values are revision snapshots

The system SHALL copy non-secret configuration values required by a published candidate into the immutable revision and SHALL resolve published requests from that snapshot rather than current draft value rows. Editing, renaming, changing kind, or deleting draft config SHALL require publication before changing agent behavior.

#### Scenario: Draft config edit does not affect live calls

- **WHEN** an owner changes a non-secret config value used by an enabled published tool
- **THEN** draft preview/testing uses the new value while gateway calls continue using the active revision's snapshot

#### Scenario: Publishing config switches dependents together

- **WHEN** a ready draft with changed non-secret config is published
- **THEN** the new config snapshot and every dependent compiled plan become active in the same revision switch

#### Scenario: Revision diff hides config content

- **WHEN** a config value changes between revisions
- **THEN** publication history reports that configuration changed without returning the old or new value

### Requirement: Published secrets remain operational slots

Published revisions SHALL reference secrets by stable owned slot id and expected kind/owner metadata without copying secret material. Secret value rotation SHALL take effect immediately for the active revision, while structural secret/auth changes SHALL remain draft-only until publication. Deleting a slot referenced by the active revision SHALL be rejected with safe reference guidance.

#### Scenario: Active secret can rotate without publish

- **WHEN** an owner securely rotates ciphertext for a secret slot referenced by the active revision
- **THEN** subsequent published execution resolves the new material without changing the revision contract

#### Scenario: Active secret deletion is blocked

- **WHEN** an owner attempts to delete a secret slot referenced by the active revision
- **THEN** deletion fails and identifies safe affected categories or tools without exposing the secret value

#### Scenario: Unreferenced historical secret can be deleted

- **WHEN** no active revision or current draft references a secret slot but an old retained revision does
- **THEN** the owner may delete the slot material
- **AND** restoring that historical revision later produces a missing-secret readiness issue rather than resurrecting it
