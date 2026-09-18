## MODIFIED Requirements

### Requirement: Gateway proxies mapped REST calls

For an enabled valid tool, the gateway SHALL execute its compiled request plan within one deadline and return an MCP-native result matching the tool's advertised output schema. Every completed call SHALL contain compatibility text and `structuredContent`. A 2xx response SHALL include the existing success-envelope fields. Every failure SHALL include `ok: false` plus a structured `error` with stable category/code, safe message, explicit retryability, and available retry delay, indeterminate-outcome state, and location-aware issues. Legacy flat error fields SHALL remain populated during contract version 1. A 4xx or 5xx upstream response SHALL return `isError: true` and SHALL NOT use `MCP_UPSTREAM_ERROR` unless no completed upstream HTTP response exists.

#### Scenario: Successful JSON GET

- **WHEN** upstream returns JSON with status 200
- **THEN** the result has `isError` false, parsed `structuredContent.data`, the declared success-envelope fields, and serialized compatibility text

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

## ADDED Requirements

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

