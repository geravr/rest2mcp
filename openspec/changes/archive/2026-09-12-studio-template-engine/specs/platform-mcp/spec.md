# Platform MCP (delta)

## MODIFIED Requirements

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

### Requirement: Platform calls stay secret-safe

Platform MCP responses and logs SHALL NOT include secret variable values, raw platform tokens after issuance, or raw server agent tokens except the one-time token-create response. `list_variables` SHALL return names, `isSecret` flags, and `hasValue` metadata only.

#### Scenario: list_variables omits secrets

- **WHEN** the agent calls `list_variables` for a server with a secret variable
- **THEN** the item includes the variable name, `isSecret` true, and `hasValue` true, and MUST NOT include the value

#### Scenario: list_servers omits secrets

- **WHEN** the agent calls `list_servers`
- **THEN** each item may include secret-presence metadata and MUST NOT include any secret variable value
