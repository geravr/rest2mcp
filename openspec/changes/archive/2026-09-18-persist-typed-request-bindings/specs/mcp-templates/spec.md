## MODIFIED Requirements

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
