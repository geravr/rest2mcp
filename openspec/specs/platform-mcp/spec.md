# Platform MCP

## Purpose

Streamable HTTP MCP for the owner to manage MCP studio resources from an external agent using a platform-scoped token.

## Requirements

### Requirement: Owner can connect a platform MCP

The system SHALL expose `/api/platform-mcp` authenticated by an expiring platform token with explicit scopes for read, author, invoke, secret-reference, and destructive operations. The raw token SHALL be shown once and stored only as a hash. Requests SHALL enforce trusted Origin when present, payload limits, per-token rate limits, and concurrency limits. Existing unscoped platform tokens SHALL be revoked during migration.

#### Scenario: Scoped read token

- **WHEN** a platform token has only read scope
- **THEN** list tools are available while create, execute, secret-reference, and delete tools are absent or denied

#### Scenario: Server token rejected

- **WHEN** a server token is sent to Platform MCP
- **THEN** the system rejects with `MCP_AGENT_TOKEN_INVALID`

#### Scenario: Expired token rejected

- **WHEN** a platform token is past its expiration
- **THEN** the request is rejected before any studio data is read

### Requirement: Platform tools mutate only the owner's studio

Platform authoring tools SHALL use the same versioned request-definition command schemas, field limits, compiler, ownership checks, and transactions as tRPC Studio. Create, update, duplicate, and preview operations SHALL accept typed bindings and SHALL reject mixed typed/legacy payloads. Destructive operations SHALL continue to require destructive scope plus matching confirmation. Curl import SHALL remain a sanitized disabled-draft operation and SHALL never change auth, server values, secrets, or defaults.

#### Scenario: Validation matches tRPC

- **WHEN** an agent submits the same invalid typed definition through Platform MCP and tRPC
- **THEN** both return the same issue codes and locations and neither writes data

#### Scenario: Mixed legacy and typed payload is rejected

- **WHEN** Platform `create_tool` receives `requestDefinition` together with `pathTemplate`
- **THEN** the operation fails before compiling or persisting the tool

#### Scenario: Cannot mutate another user's server

- **WHEN** an agent supplies another user's server id or server-value id
- **THEN** the operation fails with not-found semantics and writes nothing

#### Scenario: Curl import keeps server state isolated

- **WHEN** `add_tool_from_curl` receives a curl containing credentials
- **THEN** no auth, secret, server value, or common entry changes and the existing sanitized-import policy applies

#### Scenario: Destructive confirmation mismatch

- **WHEN** a destructive operation receives the right id but a non-matching confirmation name
- **THEN** it fails and all resources remain unchanged

### Requirement: Platform tools can test and connect

`test_tool` SHALL require invoke scope and use the same compiled executor and structured result contract as the product gateway. `get_connection_snippet` SHALL require read scope, return no token, and SHALL NOT mint credentials. Completed upstream 4xx/5xx responses SHALL be Platform MCP tool errors with structured details.

#### Scenario: Scoped test tool

- **WHEN** a token with invoke scope tests an enabled tool
- **THEN** the shared executor runs and returns the standard result or tool-error envelope

#### Scenario: Read token cannot invoke

- **WHEN** a read-only platform token calls `test_tool`
- **THEN** the operation is denied before upstream contact

### Requirement: Platform calls stay secret-safe

Platform MCP SHALL never accept new plaintext secret values or raw auth credentials in authoring commands. A typed definition MAY reference an existing server secret id only when the token has `secret-reference` scope. Scope and ownership SHALL be checked before revealing whether the id exists. Returned definitions, compiler issues, logs, and schemas SHALL contain ids and metadata only, never resolved secret values, ciphertext, or raw tokens.

#### Scenario: Existing secret reference is allowed by scope

- **WHEN** an authoring command binds a server secret id and the token has author and secret-reference scopes
- **THEN** the definition may compile and persist without returning the secret value

#### Scenario: Secret-reference scope is required

- **WHEN** a token without secret-reference scope submits a secret id
- **THEN** the operation is denied without revealing whether that id exists

#### Scenario: Config reference needs no secret scope

- **WHEN** an author-scoped token binds an owned non-secret configuration id
- **THEN** the definition may compile without secret-reference scope

#### Scenario: Agent cannot create plaintext secret

- **WHEN** a Platform authoring command includes a new plaintext credential instead of an existing secret id
- **THEN** the operation is rejected and directs the owner to the secure Studio secret flow

### Requirement: Platform token replacement is atomic

Creating a replacement platform token SHALL revoke previous active tokens and insert the new scoped token in one transaction. If creation fails, the previous token SHALL remain active.

#### Scenario: Replacement insert fails

- **WHEN** database insertion of a new token fails
- **THEN** the existing active token is not revoked

### Requirement: Platform tool authoring exposes typed bindings

Platform MCP SHALL describe tool authoring with discriminated literal, server-value, and agent-input bindings, stable definition-local ids, an agent-input registry, and typed body variants. Responses SHALL return the canonical stored request definition and location-aware compile issues so an AI agent can repair a draft without parsing legacy placeholder strings or English error messages.

#### Scenario: Agent repairs a binding by issue path

- **WHEN** preview reports an unresolved agent-input id at a query entry id
- **THEN** the response identifies both ids and the agent can resubmit a corrected definition

#### Scenario: Typed response omits compatibility projection

- **WHEN** Platform MCP creates a valid typed tool
- **THEN** its result presents the canonical request definition and does not ask the agent to reason about generated legacy templates
