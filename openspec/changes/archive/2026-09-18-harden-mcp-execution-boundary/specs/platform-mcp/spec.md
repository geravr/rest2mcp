## MODIFIED Requirements

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

Platform tools SHALL use the same shared command schemas, size limits, compiler, ownership checks, and transactions as tRPC Studio. Curl import SHALL create only a sanitized disabled draft tool and SHALL never change authentication, server values, secrets, or defaults. Destructive operations SHALL require destructive scope plus a confirmation field matching the current resource name.

#### Scenario: Validation matches tRPC

- **WHEN** an agent submits a tool name, path, body, parameter list, or curl larger than the tRPC limit
- **THEN** Platform MCP rejects it with the same validation code and writes nothing

#### Scenario: Curl with credential is rejected or sanitized

- **WHEN** `add_tool_from_curl` receives curl containing Authorization, cookies, or API keys
- **THEN** no credential value is stored, no server-wide state changes, and the result reports separate auth configuration is required

#### Scenario: Destructive confirmation mismatch

- **WHEN** `delete_server` receives the right id but a confirmation name that does not match
- **THEN** deletion fails and all resources remain

#### Scenario: Cannot mutate another user's server

- **WHEN** an agent supplies another user's server id
- **THEN** the operation fails with `MCP_SERVER_NOT_FOUND` and writes nothing

### Requirement: Platform tools can test and connect

`test_tool` SHALL require invoke scope and use the same compiled executor and structured result contract as the product gateway. `get_connection_snippet` SHALL require read scope, return no token, and SHALL NOT mint credentials. Completed upstream 4xx/5xx responses SHALL be Platform MCP tool errors with structured details.

#### Scenario: Scoped test tool

- **WHEN** a token with invoke scope tests an enabled tool
- **THEN** the shared executor runs and returns the standard result or tool-error envelope

#### Scenario: Read token cannot invoke

- **WHEN** a read-only platform token calls `test_tool`
- **THEN** the operation is denied before upstream contact

### Requirement: Platform calls stay secret-safe

Platform MCP SHALL never accept new plaintext secret values, raw auth credentials, or secret-bearing curl as normal agent-authored fields. It MAY reference an existing secret id when the token has secret-reference scope. Results, logs, schemas, and validation errors SHALL omit secret values, ciphertext, raw tokens, and sensitive inputs.

#### Scenario: Agent cannot create plaintext secret

- **WHEN** `set_variable` requests `kind: secret` with a plaintext value
- **THEN** Platform MCP rejects the request and directs the owner to the secure Studio secret flow

#### Scenario: Existing secret reference is allowed by scope

- **WHEN** an authoring tool references an existing secret id and the token has secret-reference scope
- **THEN** the definition may be compiled without revealing the secret value

#### Scenario: Secret-reference scope is required

- **WHEN** a token without secret-reference scope attempts to bind a secret id
- **THEN** the operation is denied without revealing whether the secret exists

## REMOVED Requirements

### Requirement: Platform create_server accepts an auth recipe

**Reason**: Secret-bearing auth recipes place upstream credentials in model-visible Platform MCP arguments and client logs.

**Migration**: Platform `create_server` creates the server without plaintext auth. The owner configures credentials in Studio, or a scoped platform authoring operation references an already configured secret without receiving its value.

### Requirement: Platform can set server authentication

**Reason**: The existing tool accepts plaintext credentials from an AI agent and infers server-wide secret ownership.

**Migration**: Configure or rotate credential values in the human Studio Auth card. Platform MCP may select an existing auth/secret reference only with secret-reference scope and never accepts the plaintext value.

## ADDED Requirements

### Requirement: Platform token replacement is atomic

Creating a replacement platform token SHALL revoke previous active tokens and insert the new scoped token in one transaction. If creation fails, the previous token SHALL remain active.

#### Scenario: Replacement insert fails

- **WHEN** database insertion of a new token fails
- **THEN** the existing active token is not revoked
