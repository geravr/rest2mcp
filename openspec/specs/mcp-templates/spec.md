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

A tool SHALL store a versioned request definition composed of literal, server-value, and agent-input bindings for path segments, ordered query entries, headers, and body nodes. Literal bindings SHALL never be rescanned for placeholders. JSON bodies SHALL be constructed from typed JSON nodes rather than string substitution. GET and HEAD definitions SHALL reject bodies. Raw advanced bodies SHALL use explicit namespaced bindings and pass the same validation.

#### Scenario: Typed request definition is stored

- **WHEN** the owner builds `/contacts/{contactId}/notes` with a bound input and JSON content field
- **THEN** the stored definition records the literal segments and stable binding ids without ambiguous `{{name}}` provenance

#### Scenario: Literal template syntax is not executed

- **WHEN** a literal contains `{{api_token}}`
- **THEN** the upstream receives those literal characters and no secret is read

#### Scenario: GET body is rejected

- **WHEN** a GET tool definition contains a body
- **THEN** compilation fails instead of storing a body that execution ignores

### Requirement: Placeholders resolve args-first with context-aware escaping

At execution, each compiled binding SHALL resolve only from its declared source. Agent-provided values SHALL never be rescanned as template syntax and SHALL never fall back to a server value. Server-value bindings SHALL never accept an agent override. Path values SHALL be encoded as individual segments and the final normalized path SHALL remain beneath the server base path. JSON values SHALL be serialized according to their declared JSON type, including strings and null. Optional agent inputs SHALL omit only request structures whose binding defines omission semantics; optional path segments and mixed literal/input strings SHALL be rejected at compile time.

#### Scenario: Agent cannot expand a secret

- **WHEN** an agent string argument equals `{{api_token}}`
- **THEN** it remains ordinary string data and does not cause the server secret to be read or injected

#### Scenario: Server secret cannot be overridden

- **WHEN** auth binds to a server secret and the caller supplies an argument with the same display name
- **THEN** the auth binding still resolves only from the secret id

#### Scenario: Dot path segment stays confined

- **WHEN** a path input is `..`
- **THEN** the request does not escape the configured tool/base path and is rejected if confinement cannot be preserved

#### Scenario: JSON string and null remain valid

- **WHEN** a JSON-typed input is a string or null and the definition permits that type
- **THEN** the rendered body is valid JSON containing that exact JSON value

#### Scenario: Optional query entry is omitted

- **WHEN** an optional agent input is the complete binding for one query entry and is absent
- **THEN** that query entry is omitted

#### Scenario: Optional body field is omitted

- **WHEN** an optional agent input owns one JSON object field and is absent
- **THEN** that field is omitted while the remaining JSON stays valid

#### Scenario: Unsupported optional composition is rejected

- **WHEN** an optional input appears inside a path or a mixed literal string without defined omission behavior
- **THEN** compilation fails before the tool can be enabled

### Requirement: Tools declare agent params

Each tool SHALL define each agent input once with a stable id, unique public name, description, required flag, sensitive flag, and JSON-Schema-compatible type and constraints. All references to one input SHALL use the same definition. Compilation SHALL reject unused inputs, unresolved input references, duplicate public names, conflicting metadata, required strings that permit an empty value without explicit intent, and schemas incompatible with their request context.

#### Scenario: Input constraints are retained

- **WHEN** input `limit` is an optional integer with minimum 1, maximum 100, description, and example 20
- **THEN** the tool definition retains those constraints for MCP schema generation and runtime validation

#### Scenario: Conflicting repeated input is rejected

- **WHEN** two request locations reference the same public input name with different types or required flags
- **THEN** compilation fails instead of silently choosing one definition

#### Scenario: Unused input is rejected

- **WHEN** an input is declared but no request binding references it
- **THEN** the tool cannot be enabled

### Requirement: Server default headers and query

A server SHALL store ordered common header/query entries using explicit literal or server-value bindings. Tool entries MAY override non-protected common keys. Auth-owned keys SHALL be protected and injected after ordinary entries, so tools and agent inputs cannot override credentials. Duplicate effective keys SHALL be rejected or resolved explicitly during compilation rather than silently using the last row.

#### Scenario: Shared version header

- **WHEN** a server has common header `Version: 2021-07-28`
- **THEN** compiled tools include it without declaring it locally

#### Scenario: Allowed tool override

- **WHEN** common header `Accept` is JSON and a tool explicitly sets CSV
- **THEN** the compiled request sends CSV

#### Scenario: Protected auth override rejected

- **WHEN** auth owns `Authorization` and a tool defines that header
- **THEN** compilation rejects the conflict

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

The system SHALL analyze legacy string templates during migration. It SHALL convert only unambiguous bindings, preserve legacy source material for rollback, and mark ambiguous or unsafe tools invalid and disabled with actionable diagnostics. It SHALL NOT choose an agent input or server value based solely on whichever name currently exists.

#### Scenario: Ambiguous legacy name is disabled

- **WHEN** legacy placeholder `name` matches both stored param metadata and a server value
- **THEN** migration leaves the tool disabled and records a diagnostic requiring owner selection

#### Scenario: Unambiguous legacy tool is migrated

- **WHEN** every legacy placeholder has exactly one valid source and all safety checks pass
- **THEN** migration writes an equivalent versioned request definition
