## ADDED Requirements

### Requirement: Hosted Streamable HTTP MCP per server

The system SHALL expose a Streamable HTTP MCP endpoint at `/mcp/{serverId}` on Hono (not tRPC). Unauthenticated requests SHALL fail. A valid unrevoked server agent token SHALL authenticate only that server.

#### Scenario: Valid token lists tools

- **WHEN** an MCP client connects to `/mcp/{serverId}` with a valid Bearer server token
- **THEN** the server advertises the owner's enabled tools for that server and no other server's tools

#### Scenario: Missing or unknown token

- **WHEN** a client calls the gateway without a token or with an unknown token
- **THEN** the system rejects the request with `MCP_AGENT_TOKEN_INVALID` and does not proxy upstream

#### Scenario: Token from another server

- **WHEN** a token issued for server A is sent to `/mcp/{serverB}`
- **THEN** the system rejects the request with `MCP_AGENT_TOKEN_INVALID`

### Requirement: Gateway proxies mapped REST calls

For an enabled tool call, the system SHALL build the upstream request from `baseUrl`, path template, parameter map, and the server credential (if present), then return the upstream body to the MCP client subject to the 256 KiB cap.

#### Scenario: Successful GET

- **WHEN** the agent calls `get_contact` with `{ id: "1" }` and the tool maps to `GET /contacts/{id}`
- **THEN** the gateway requests `https://{allowed-host}/contacts/1` with the stored credential and returns the upstream JSON

#### Scenario: Disabled tool

- **WHEN** the agent calls a tool that exists but is not enabled
- **THEN** the gateway rejects the call and does not contact upstream

#### Scenario: Paused server

- **WHEN** the server status is `paused`
- **THEN** the gateway rejects tool execution

### Requirement: Mutations require explicit allow

The gateway SHALL execute GET and HEAD tools when enabled. It SHALL reject POST, PUT, PATCH, or DELETE tools unless `allowMutation` is true and the tool is enabled. It SHALL reject execution if the stored method does not match the method used upstream.

#### Scenario: Blocked mutation

- **WHEN** the agent calls a DELETE tool with `allowMutation` false
- **THEN** the gateway rejects with `MCP_MUTATION_NOT_ALLOWED` and does not contact upstream

#### Scenario: Allowed mutation

- **WHEN** the owner has set `allowMutation` true and enabled a POST tool
- **THEN** the gateway proxies the POST to the mapped path

### Requirement: Host allowlist and SSRF protections

The gateway SHALL refuse upstream URLs whose host is not in `allowedHosts`. It SHALL refuse loopback, private, link-local, and cloud metadata targets after DNS resolution. It SHALL NOT follow redirects to a different host.

#### Scenario: Host not allowed

- **WHEN** a tool path or parameter would send the request to a host outside `allowedHosts`
- **THEN** the gateway rejects with `MCP_HOST_NOT_ALLOWED`

#### Scenario: Private IP

- **WHEN** the resolved address of an allowed hostname is a private or metadata IP
- **THEN** the gateway rejects with `MCP_HOST_NOT_ALLOWED`

### Requirement: Secrets stay out of MCP errors

Gateway and executor errors shown to the agent SHALL use stable `appCode` values and MUST NOT include credential secrets, agent tokens, or decrypted ciphertext.

#### Scenario: Upstream 401

- **WHEN** the upstream API returns 401
- **THEN** the agent receives a failure with `MCP_UPSTREAM_ERROR` (or equivalent) and no bearer token value
