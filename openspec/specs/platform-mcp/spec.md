# Platform MCP

## Purpose

Streamable HTTP MCP for the owner to manage MCP studio resources from an external agent using a platform-scoped token.

## Requirements

### Requirement: Owner can connect a platform MCP

The system SHALL expose a Streamable HTTP MCP at `/api/platform-mcp` authenticated by a platform agent token (not a server token). The owner SHALL be able to create and revoke that token from the authenticated SPA. The raw token SHALL be shown only once; only a hash is stored.

#### Scenario: Valid platform token

- **WHEN** the owner's agent connects to `/api/platform-mcp` with a valid platform token
- **THEN** the agent receives studio tools (`list_servers`, `create_server`, `add_tool`, `add_tool_from_curl`, `set_variable`, `list_variables`, `delete_variable`, `list_tools`, `test_tool`, `get_connection_snippet`, `list_recent_calls`)

#### Scenario: Server token rejected

- **WHEN** a server-scoped agent token is sent to `/api/platform-mcp`
- **THEN** the system rejects the request with `MCP_AGENT_TOKEN_INVALID`

#### Scenario: Unauthenticated

- **WHEN** a client calls `/api/platform-mcp` without a token
- **THEN** the system rejects the request and does not list servers

### Requirement: Platform tools mutate only the owner's studio

Platform MCP tools SHALL enforce the same ownership, validation, mutation, and secret rules as the tRPC studio. They SHALL NOT expose ciphertext or other users' servers.

#### Scenario: Create server via agent

- **WHEN** the owner's agent calls `create_server` with a valid name and base URL
- **THEN** a server owned by that user is created and returned without any secret variable value

#### Scenario: Add tool from curl via agent

- **WHEN** the owner's agent calls `add_tool_from_curl` with a valid curl and server id they own
- **THEN** a tool is created using the same parsing rules as the SPA import

#### Scenario: Cannot edit another user's server

- **WHEN** the agent passes another user's server id to `add_tool`
- **THEN** the tool fails with `MCP_SERVER_NOT_FOUND` and no row is inserted

### Requirement: Platform tools can test and connect

`test_tool` SHALL run the shared executor and record a call log with source `platform`. `get_connection_snippet` SHALL return the product gateway URL for that server and SHALL NOT mint a new server token unless the owner explicitly requests token creation through the documented token-create path.

#### Scenario: Test tool

- **WHEN** the agent calls `test_tool` for an enabled GET tool on a server they own
- **THEN** the executor runs and a call log row with source `platform` is stored

#### Scenario: Connection snippet

- **WHEN** the agent calls `get_connection_snippet` for a server they own
- **THEN** the result includes `/mcp/{serverId}` and does not include secret variable values

### Requirement: Platform calls stay secret-safe

Platform MCP responses and logs SHALL NOT include secret variable values, raw platform tokens after issuance, or raw server agent tokens except the one-time token-create response. `list_variables` SHALL return names, `isSecret` flags, and `hasValue` metadata only.

#### Scenario: list_variables omits secrets

- **WHEN** the agent calls `list_variables` for a server with a secret variable
- **THEN** the item includes the variable name, `isSecret` true, and `hasValue` true, and MUST NOT include the value

#### Scenario: list_servers omits secrets

- **WHEN** the agent calls `list_servers`
- **THEN** each item may include secret-presence metadata and MUST NOT include any secret variable value
