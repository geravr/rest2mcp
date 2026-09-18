## ADDED Requirements

### Requirement: Platform tools expose complete agent contracts

Every Platform MCP tool SHALL be registered from a centralized contract containing a stable name, human-facing title, outcome-oriented description, closed input schema with descriptions for every property, explicit output schema, behavior annotations, and namespaced contract version/fingerprint metadata. Scope filtering SHALL remove unauthorized tools and properties; it SHALL NOT represent undisclosed state as false or null. Contract ordering and fingerprints SHALL be deterministic.

#### Scenario: Read tool is fully described

- **WHEN** a read-scoped token lists `list_servers`
- **THEN** the tool has title, purpose, described pagination inputs, paginated output schema, read-only/non-destructive annotations, and contract metadata

#### Scenario: Destructive tool advertises risk

- **WHEN** a destructive-scoped token lists `delete_server`
- **THEN** the tool describes the confirmation requirement and has destructive, non-read-only annotations while server-side confirmation remains mandatory

#### Scenario: Unauthorized property is omitted

- **WHEN** a read token lacks secret-reference scope
- **THEN** result schemas and data omit secret-existence properties rather than returning a misleading false or null value

#### Scenario: Unchanged Platform contract is stable

- **WHEN** the same scoped token lists tools repeatedly without a deployment or scope change
- **THEN** tool order, normalized contracts, and fingerprints are identical

### Requirement: Platform tool outcomes use the structured contract

Every completed Platform MCP tool call SHALL return compatibility text and `structuredContent` matching its advertised output schema. Successes SHALL use the shared base envelope with explicitly typed data. Failures SHALL use the shared structured error object with category, stable code, safe message, retryability, optional retry delay, and location-aware issues. Scope, authorization, destructive confirmation, validation, rate-limit, and internal failures SHALL NOT fall back to an unrelated text-only shape.

#### Scenario: Validation error is repairable

- **WHEN** an agent calls `create_server` with an invalid base URL
- **THEN** the result has `isError: true`, category `invalid_arguments`, a non-retryable flag, and an issue identifying `baseUrl`

#### Scenario: Scope denial does not reveal resource existence

- **WHEN** a token without secret-reference scope submits a secret id
- **THEN** the result uses category `policy`, identifies the missing scope, and omits whether the secret exists

#### Scenario: Rate limit tells the agent when to retry

- **WHEN** a Platform tool exceeds its token budget
- **THEN** the result has category `rate_limit`, `retryable: true`, and the available retry delay

#### Scenario: Successful pagination is typed

- **WHEN** `list_servers` succeeds
- **THEN** `structuredContent.data` matches the advertised pagination schema and compatibility text represents the same safe envelope

#### Scenario: Internal error remains schema-valid

- **WHEN** an unexpected exception occurs inside a Platform operation
- **THEN** the result is a redacted internal-error envelope that validates against the advertised output schema

