## MODIFIED Requirements

### Requirement: Hosted Streamable HTTP MCP per server

The system SHALL expose Streamable HTTP MCP at `/mcp/{serverId}` with server-scoped Bearer authentication. If an `Origin` header is present, the endpoint SHALL validate it against configured trusted origins and return HTTP 403 before MCP processing when invalid. The endpoint SHALL enforce request-size, per-token rate, and per-server concurrency limits. A valid token SHALL authenticate only its server and SHALL NOT authorize paused servers to advertise callable tools.

#### Scenario: Valid non-browser client

- **WHEN** a client omits Origin and sends a valid unrevoked token for the requested server
- **THEN** MCP processing proceeds subject to rate and concurrency limits

#### Scenario: Invalid Origin

- **WHEN** a request includes an Origin outside the trusted allowlist
- **THEN** the gateway returns HTTP 403 without authenticating, listing tools, or invoking upstream

#### Scenario: Token from another server

- **WHEN** a server-A token is sent to server B
- **THEN** the gateway rejects with `MCP_AGENT_TOKEN_INVALID`

#### Scenario: Rate limit exceeded

- **WHEN** a token exceeds its configured invocation budget
- **THEN** the gateway returns a retryable rate-limit error and does not contact upstream

### Requirement: Gateway proxies mapped REST calls

For an enabled valid tool, the gateway SHALL execute its compiled request plan within one deadline and return an MCP-native result. A 2xx response SHALL return compatibility text plus `structuredContent` containing `ok`, status, content type, parsed JSON data or text body, safe response headers, and truncation metadata. A 4xx or 5xx response SHALL return a tool execution result with `isError: true`, status, normalized code, safe details, and available retry metadata; it SHALL NOT use `MCP_UPSTREAM_ERROR` unless no completed upstream HTTP response exists.

#### Scenario: Successful JSON GET

- **WHEN** upstream returns JSON with status 200
- **THEN** the result has `isError` false, parsed `structuredContent.data`, and serialized compatibility text

#### Scenario: Upstream 401 is an MCP tool error

- **WHEN** upstream returns 401
- **THEN** the result has `isError: true`, status 401, a stable auth-related code, and no credential value

#### Scenario: Upstream 429 carries retry metadata

- **WHEN** upstream returns 429 with `Retry-After`
- **THEN** the tool error includes safe retry metadata the agent can use

#### Scenario: Disabled or invalid tool is unavailable

- **WHEN** a tool is disabled or has compile errors
- **THEN** it is not advertised and cannot contact upstream

### Requirement: Gateway advertises derived input schemas

Each advertised tool SHALL expose an `inputSchema` generated from its compiled agent inputs, including descriptions, required fields, JSON types, constraints, formats, enums, and examples supported by the definition. The gateway SHALL also advertise a stable `outputSchema` for the result envelope and behavior annotations for read-only, destructive, idempotent, and open-world behavior. Tools SHALL be listed in deterministic name order.

#### Scenario: Agent sees constrained input

- **WHEN** `limit` is an optional integer from 1 through 100 with an example
- **THEN** the advertised schema contains those constraints and does not mark it required

#### Scenario: Agent sees behavior annotations

- **WHEN** a DELETE tool is enabled and marked destructive and non-idempotent
- **THEN** its MCP definition advertises the corresponding annotations

#### Scenario: Tool without inputs is closed

- **WHEN** a tool has no agent inputs
- **THEN** its schema accepts an empty object and rejects unknown properties

### Requirement: Host allowlist and SSRF protections

The gateway SHALL enforce allowed host and resolved-address policy before every outbound hop. Redirects SHALL be same-origin by default; port changes, HTTPS downgrades, userinfo, private/link-local/metadata addresses, and cross-origin credential forwarding SHALL be rejected. HTTP redirect semantics SHALL preserve method/body for 307/308 and change method only where the HTTP standard permits. The final normalized path SHALL remain within the configured server base-path boundary.

#### Scenario: Same hostname different port is rejected

- **WHEN** upstream redirects from `https://api.example.com` to `https://api.example.com:8443`
- **THEN** the gateway rejects the redirect and does not forward auth

#### Scenario: HTTPS downgrade is rejected

- **WHEN** HTTPS upstream redirects to HTTP
- **THEN** the gateway rejects the redirect

#### Scenario: Path cannot escape base prefix

- **WHEN** a rendered path contains a dot segment that would normalize above the server base path
- **THEN** execution fails before fetch

#### Scenario: 307 preserves method only on safe redirect

- **WHEN** a POST receives a same-origin 307 within the allowed boundary
- **THEN** the gateway preserves method and body for the validated hop

### Requirement: Secrets stay out of MCP errors

Gateway results and errors SHALL NOT contain agent tokens, decrypted secret values, auth material, or inputs marked sensitive except where an authorized upstream response independently returns matching data that survives configured output policy. Agent-provided strings SHALL never be interpreted as templates. Error messages SHALL use stable app codes and sanitized details.

#### Scenario: Reflected secret is redacted

- **WHEN** an upstream error reflects a secret binding value
- **THEN** the MCP error replaces it with `[REDACTED]`

#### Scenario: Agent string cannot request secret expansion

- **WHEN** an agent argument contains text matching secret template syntax
- **THEN** the text remains data and no secret is added to the request or result

## ADDED Requirements

### Requirement: Invocation deadline and response bounds cover the full operation

The gateway SHALL apply one deadline across address validation, connection, redirects, response headers, and body consumption. Response caps SHALL be measured in bytes. Text SHALL be decoded only for supported textual content types; unsupported binary responses SHALL return metadata without corrupt text. Truncation SHALL be explicitly represented and SHALL NOT claim that truncated JSON is a complete parsed document.

#### Scenario: Slow response body times out

- **WHEN** upstream sends headers and then stalls while streaming the body past the deadline
- **THEN** execution aborts with a timeout tool error

#### Scenario: Oversized JSON is not presented as valid JSON

- **WHEN** a JSON response exceeds the byte cap
- **THEN** the result marks it truncated and does not expose a partially parsed JSON object as complete data

#### Scenario: Binary response is not UTF-8 decoded

- **WHEN** upstream returns an unsupported binary content type
- **THEN** the result contains content metadata and a bounded unsupported-binary error or reference, not replacement-character text

### Requirement: Gateway availability matches server state

The gateway SHALL advertise only enabled, successfully compiled tools on a live server. A paused server SHALL advertise no callable tools and tool ordering SHALL be deterministic. Draft or invalid tools SHALL remain visible only in owner Studio surfaces.

#### Scenario: Paused server lists no tools

- **WHEN** a client lists tools for a paused server
- **THEN** no callable product tools are returned

#### Scenario: Tool order is stable

- **WHEN** the same unchanged server is listed repeatedly
- **THEN** tools appear in the same name order
