## ADDED Requirements

### Requirement: Platform create_server accepts an auth recipe

`create_server` SHALL accept the same optional authentication recipe as tRPC `createServer` (`none` / omit, `bearer`, `header`, `query`, `basic`) and SHALL persist it through the same transactional mapping. Secret values SHALL NOT appear in the tool result.

#### Scenario: Create server with bearer via agent

- **WHEN** the owner's agent calls `create_server` with a name, HTTPS base URL, and `{ type: "bearer", token: "sk_live_123" }`
- **THEN** the server is created with encrypted `api_token` and default `Authorization: Bearer {{api_token}}`, and the result does not include `sk_live_123`

### Requirement: Platform can set server authentication

The platform MCP SHALL expose `set_server_auth` that applies the same recipe as studio Settings (`none` to clear). It SHALL enforce owner scope and SHALL NOT return secret values.

#### Scenario: Set header auth via agent

- **WHEN** the owner's agent calls `set_server_auth` with type `header`, header name `X-API-Key`, and a value
- **THEN** a secret variable and that default header exist, and the result omits the value

## MODIFIED Requirements

### Requirement: Owner can connect a platform MCP

The system SHALL expose a Streamable HTTP MCP at `/api/platform-mcp` authenticated by a platform agent token (not a server token). The owner SHALL be able to create and revoke that token from the authenticated SPA. The raw token SHALL be shown only once; only a hash is stored.

#### Scenario: Valid platform token

- **WHEN** the owner's agent connects to `/api/platform-mcp` with a valid platform token
- **THEN** the agent receives studio tools (`list_servers`, `create_server`, `delete_server`, `add_tool`, `add_tool_from_curl`, `delete_tool`, `set_variable`, `set_server_auth`, `list_variables`, `delete_variable`, `list_tools`, `test_tool`, `get_connection_snippet`, `list_recent_calls`)

#### Scenario: Server token rejected

- **WHEN** a server-scoped agent token is sent to `/api/platform-mcp`
- **THEN** the system rejects the request with `MCP_AGENT_TOKEN_INVALID`

#### Scenario: Unauthenticated

- **WHEN** a client calls `/api/platform-mcp` without a token
- **THEN** the system rejects the request and does not list servers

### Requirement: Platform tools mutate only the owner's studio

Platform MCP tools SHALL enforce the same ownership, validation, mutation, and secret rules as the tRPC studio. They SHALL NOT expose ciphertext or other users' servers. `delete_server` SHALL apply the same cascading transaction as the tRPC delete. `add_tool_from_curl` SHALL use the same parsing and keep-existing-auth rules as the SPA import.

#### Scenario: Create server via agent

- **WHEN** the owner's agent calls `create_server` with a valid name and base URL
- **THEN** a server owned by that user is created and returned without any secret variable value

#### Scenario: Add tool from curl via agent

- **WHEN** the owner's agent calls `add_tool_from_curl` with a valid curl and server id they own
- **THEN** a tool is created using the same parsing rules as the SPA import

#### Scenario: Curl keeps existing server auth via agent

- **WHEN** the server already has Bearer defaults and the agent imports a curl with a different Bearer token
- **THEN** the existing secret is not rotated and the new tool contains no secret

#### Scenario: Cannot edit another user's server

- **WHEN** the agent passes another user's server id to `add_tool`
- **THEN** the tool fails with `MCP_SERVER_NOT_FOUND` and no row is inserted

#### Scenario: Cannot delete another user's server

- **WHEN** the agent passes another user's server id to `delete_server`
- **THEN** the tool fails with `MCP_SERVER_NOT_FOUND` and nothing is removed
