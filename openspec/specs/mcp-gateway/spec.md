# MCP Gateway

## Purpose

Hosted Streamable HTTP MCP endpoint per server that proxies enabled tools to upstream REST APIs with SSRF protections and secret-safe errors.

## Requirements

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

For an enabled valid tool, the gateway SHALL execute its compiled request plan within one deadline and return an MCP-native result matching the tool's advertised output schema. Every completed call SHALL contain MCP `content` text and matching `structuredContent`. A 2xx response SHALL include the canonical success-envelope fields. Every failure SHALL include `ok: false` plus one structured `error` with stable category/code, safe message, explicit retryability, and available retry delay, indeterminate-outcome state, and location-aware issues. Superseded flat error fields SHALL NOT be emitted. A 4xx or 5xx upstream response SHALL return `isError: true` and SHALL NOT use `MCP_UPSTREAM_ERROR` unless no completed upstream HTTP response exists.

#### Scenario: Successful JSON GET

- **WHEN** upstream returns JSON with status 200
- **THEN** the result has `isError` false, parsed `structuredContent.data`, the declared success-envelope fields, and MCP text serialized from the same safe envelope

#### Scenario: Invalid arguments are structured

- **WHEN** a caller sends a string where a required integer is expected
- **THEN** the result has `isError: true`, category `invalid_arguments`, a non-retryable flag, and an issue naming the input path without echoing a sensitive value

#### Scenario: Upstream 401 is an MCP tool error

- **WHEN** upstream returns 401
- **THEN** the result has `isError: true`, status 401, category `auth`, a stable code, non-retryable guidance without changed credentials, and no credential value

#### Scenario: Upstream 429 carries retry metadata

- **WHEN** upstream returns 429 with `Retry-After`
- **THEN** the tool error has category `rate_limit`, `retryable: true`, and a safe retry delay

#### Scenario: Indeterminate mutation is not safe to retry

- **WHEN** a mutating request may have reached upstream but completion cannot be determined
- **THEN** the error has `indeterminate: true` and `retryable: false`

#### Scenario: Unexpected failure still matches output schema

- **WHEN** an unclassified internal exception reaches the tool callback
- **THEN** the gateway returns a minimal redacted internal-error envelope that validates against the advertised output schema

#### Scenario: Disabled or invalid tool is unavailable

- **WHEN** a tool is disabled or has compile or contract-readiness errors
- **THEN** it is not advertised and cannot contact upstream

### Requirement: Gateway advertises derived input schemas

Each advertised tool SHALL expose a human-facing title, an explicit outcome-oriented description, and a closed `inputSchema` generated from compiled agent inputs. Every exposed property SHALL have a description and SHALL preserve required state, JSON type, supported format, bounds, pattern, enum, examples, and sensitivity metadata. The gateway SHALL advertise the stable result-envelope `outputSchema`, safe behavior annotations, and namespaced contract version/fingerprint metadata. Runtime validation SHALL use the same normalized schema semantics. Tools SHALL be listed in deterministic name order.

#### Scenario: Agent sees constrained input

- **WHEN** `limit` is an optional integer from 1 through 100 with an example and description
- **THEN** the advertised property contains those constraints and does not appear in the required list

#### Scenario: String format is preserved

- **WHEN** an input declares supported format `date-time`
- **THEN** both the advertised schema and runtime validation enforce `date-time`

#### Scenario: Sensitive input carries metadata without a value

- **WHEN** an exposed input is marked sensitive
- **THEN** its schema identifies it as write-only/sensitive but contains no example, default, or resolved value that reveals data

#### Scenario: Agent sees behavior annotations

- **WHEN** a DELETE tool is enabled and marked destructive and non-idempotent
- **THEN** its MCP definition advertises the corresponding annotations and does not describe it as read-only

#### Scenario: Tool without inputs is closed

- **WHEN** a tool has no agent inputs
- **THEN** its schema accepts `{}` and rejects unknown properties

#### Scenario: Invalid constraint is not silently dropped

- **WHEN** an input contains an invalid regular expression or incompatible enum value
- **THEN** the tool has a contract-readiness error and is not advertised

### Requirement: Agent-visible tool contracts are deterministic and versioned

For unchanged persisted tool intent, the gateway SHALL emit a byte-stable normalized tool contract and fingerprint regardless of database row order or request timing. The fingerprint SHALL cover only agent-visible title, description, schemas, annotations, and contract version. It SHALL NOT include secrets, internal ids, resolved URLs, timestamps, or runtime health. Any agent-visible contract change SHALL produce a different fingerprint.

#### Scenario: Unchanged contract keeps its fingerprint

- **WHEN** the same tool is listed repeatedly with unchanged metadata and bindings
- **THEN** its normalized contract and fingerprint are identical

#### Scenario: Description change updates fingerprint

- **WHEN** the owner changes the agent-facing description
- **THEN** the next listed contract has a different fingerprint

#### Scenario: Secret rotation does not update fingerprint

- **WHEN** a referenced secret value rotates without changing the request binding or schema
- **THEN** the contract fingerprint remains unchanged and no secret-derived material appears in it

### Requirement: Mutations require explicit allow

The gateway SHALL execute GET and HEAD tools when enabled. It SHALL reject POST, PUT, PATCH, or DELETE tools unless `allowMutation` is true and the tool is enabled. It SHALL reject execution if the stored method does not match the method used upstream.

#### Scenario: Blocked mutation

- **WHEN** the agent calls a DELETE tool with `allowMutation` false
- **THEN** the gateway rejects with `MCP_MUTATION_NOT_ALLOWED` and does not contact upstream

#### Scenario: Allowed mutation

- **WHEN** the owner has set `allowMutation` true and enabled a POST tool
- **THEN** the gateway proxies the POST to the mapped path

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

The gateway SHALL advertise only enabled, successfully compiled tools from the server's one active published revision while runtime status is live. A server without a published revision or with paused status SHALL advertise no callable tools. Mutable draft and invalid/disabled revision tools SHALL remain unavailable to product agents, and published tool ordering SHALL be deterministic.

#### Scenario: Unpublished server lists no tools

- **WHEN** a valid server token connects to a server with no published revision
- **THEN** no callable product tools are returned even if its draft contains enabled valid tools

#### Scenario: Paused server lists no tools

- **WHEN** the owner pauses a server with an active published revision
- **THEN** no callable product tools are returned and the published pointer remains intact

#### Scenario: Dirty draft does not alter listing

- **WHEN** the draft differs from the active revision
- **THEN** repeated gateway listings continue returning the active revision's deterministic tool set and contract identity

#### Scenario: Tool order is stable

- **WHEN** the same published revision is listed repeatedly
- **THEN** tools appear in the same name order with the same revision and contract fingerprints

### Requirement: Gateway executes one published revision snapshot

The gateway SHALL materialize server settings, one published tool plan, revision config values, and current referenced secret slots from a single committed active revision before upstream execution. A concurrent publication SHALL not change an invocation after materialization, and no gateway path SHALL read mutable draft plans or config.

#### Scenario: Publish races with invocation preparation

- **WHEN** a publication commits while an invocation loads its execution snapshot
- **THEN** the invocation uses either the complete prior revision or the complete new revision
- **AND** it never mixes their settings, plans, config, or contract metadata

#### Scenario: Publish occurs during upstream request

- **WHEN** a new revision becomes active after an invocation has materialized the previous revision
- **THEN** that in-flight request completes using its original immutable snapshot while later requests use the new revision

#### Scenario: Draft row is deleted after publication

- **WHEN** an owner deletes a tool from the mutable draft but has not published that deletion
- **THEN** the active published tool remains discoverable and executable from its revision row

### Requirement: Stale agent contracts fail with refresh guidance

The gateway SHALL NOT fall back to a superseded revision when a client calls a removed tool or supplies input incompatible with the active published contract. Safe not-found or validation errors SHALL include the current published revision number and contract fingerprint plus machine-readable refresh guidance.

#### Scenario: Removed cached tool is called

- **WHEN** an agent calls a tool name removed by the active revision
- **THEN** the gateway contacts no upstream and returns a safe error directing the client to refresh tools

#### Scenario: Cached input schema is stale

- **WHEN** an agent submits input valid for a previous tool fingerprint but invalid for the active revision
- **THEN** validation fails against the active contract and includes current revision identity without exposing draft or historical definitions
