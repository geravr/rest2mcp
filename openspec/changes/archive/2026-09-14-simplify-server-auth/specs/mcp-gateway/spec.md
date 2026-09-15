## MODIFIED Requirements

### Requirement: Gateway proxies mapped REST calls

For an enabled tool call, the system SHALL render the upstream request from `baseUrl` (including any path prefix), path template, request template, server default headers and query, server variables, and the call arguments, per the `mcp-templates` resolution and escaping rules, then return the upstream body to the MCP client subject to the 256 KiB cap. A completed upstream HTTP response (including 4xx and 5xx) SHALL be returned as a tool result with `httpStatus` and body, not as `MCP_UPSTREAM_ERROR`.

#### Scenario: Successful GET

- **WHEN** the agent calls `get_contact` with `{ "contactId": "1" }` and the tool maps to `GET /contacts/{{contactId}}`
- **THEN** the gateway requests `https://{allowed-host}/contacts/1` with rendered default headers and variables, and returns the upstream JSON

#### Scenario: Disabled tool

- **WHEN** the agent calls a tool that exists but is not enabled
- **THEN** the gateway rejects the call and does not contact upstream

#### Scenario: Unresolved placeholder

- **WHEN** the agent calls a tool whose template references a placeholder that neither an argument nor a variable resolves
- **THEN** the gateway rejects with `MCP_TEMPLATE_UNRESOLVED` and does not contact upstream

#### Scenario: Paused server

- **WHEN** the server status is `paused`
- **THEN** the gateway rejects tool execution

#### Scenario: Upstream 401 is a tool result

- **WHEN** the agent calls an enabled tool and the upstream API returns 401
- **THEN** the MCP tool result includes `httpStatus` 401 and the capped upstream body, and does not use `MCP_UPSTREAM_ERROR`

### Requirement: Secrets stay out of MCP errors

Gateway and executor errors shown to the agent SHALL use stable `appCode` values and MUST NOT include credential secrets, agent tokens, or decrypted ciphertext. Upstream response bodies returned as tool results SHALL NOT be rewritten to inject secrets; persisted call-log summaries SHALL still redact secret variable values.

#### Scenario: Upstream 401 does not leak secret

- **WHEN** the upstream API returns 401 after the gateway sent a rendered bearer token
- **THEN** the agent result body does not contain a rest2mcp-injected copy of that token, and the call-log summary redacts the secret
