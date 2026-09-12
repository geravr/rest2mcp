# Platform MCP (delta)

## MODIFIED Requirements

### Requirement: Owner can connect a platform MCP

The system SHALL expose a Streamable HTTP MCP at `/api/platform-mcp` authenticated by a platform agent token (not a server token). The owner SHALL be able to create and revoke that token from the authenticated SPA. The raw token SHALL be shown only once; only a hash is stored.

#### Scenario: Valid platform token

- **WHEN** the owner's agent connects to `/api/platform-mcp` with a valid platform token
- **THEN** the agent receives studio tools (`list_servers`, `create_server`, `delete_server`, `add_tool`, `add_tool_from_curl`, `delete_tool`, `set_variable`, `list_variables`, `delete_variable`, `list_tools`, `test_tool`, `get_connection_snippet`, `list_recent_calls`)

#### Scenario: Server token rejected

- **WHEN** a server-scoped agent token is sent to `/api/platform-mcp`
- **THEN** the system rejects the request with `MCP_AGENT_TOKEN_INVALID`

#### Scenario: Unauthenticated

- **WHEN** a client calls `/api/platform-mcp` without a token
- **THEN** the system rejects the request and does not list servers

### Requirement: Platform tools mutate only the owner's studio

Platform MCP tools SHALL enforce the same ownership, validation, mutation, and secret rules as the tRPC studio. They SHALL NOT expose ciphertext or other users' servers. `delete_server` SHALL apply the same cascading transaction as the tRPC delete.

#### Scenario: Create server via agent

- **WHEN** the owner's agent calls `create_server` with a valid name and base URL
- **THEN** a server owned by that user is created and returned without any secret variable value

#### Scenario: Add tool from curl via agent

- **WHEN** the owner's agent calls `add_tool_from_curl` with a valid curl and server id they own
- **THEN** a tool is created using the same parsing rules as the SPA import

#### Scenario: Cannot edit another user's server

- **WHEN** the agent passes another user's server id to `add_tool`
- **THEN** the tool fails with `MCP_SERVER_NOT_FOUND` and no row is inserted

#### Scenario: Cannot delete another user's server

- **WHEN** the agent passes another user's server id to `delete_server`
- **THEN** the tool fails with `MCP_SERVER_NOT_FOUND` and nothing is removed
