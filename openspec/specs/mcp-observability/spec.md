# MCP Observability

## Purpose

Playground invoke, traffic-light health, and paginated call logs for MCP servers without exposing secrets.

## Requirements

### Requirement: Owner can invoke a tool from the playground

The authenticated playground SHALL use the same compiled plan, input schema, policy checks, deadline, and response envelope as the gateway. It SHALL display successful and non-2xx upstream responses with their status, safe headers, parsed/text data, truncation state, and call-log link when available. Failure to persist a call log SHALL NOT replace a completed upstream result. Optional booleans and other optional inputs SHALL support an explicit absent state distinct from false, null, or empty string.

#### Scenario: Playground matches gateway rendering

- **WHEN** the owner invokes a tool with the same inputs as an MCP client
- **THEN** both construct the same upstream request and normalize the same response

#### Scenario: Optional boolean can be absent

- **WHEN** an optional boolean is left unset
- **THEN** the playground omits it instead of sending false

#### Scenario: Upstream error remains inspectable

- **WHEN** upstream returns 401 or 429
- **THEN** the playground shows the error status and sanitized details while the agent-facing gateway uses `isError: true`

#### Scenario: Log failure does not change result

- **WHEN** upstream completes a POST successfully and audit persistence fails
- **THEN** the playground receives the successful upstream result and telemetry records the audit failure

### Requirement: Traffic light reflects recent health

The system SHALL expose a derived traffic light for each server: `paused` when status is paused; `draft` when there are no enabled tools; otherwise `red` if the last five product or playground calls all failed, `yellow` if any of those failed, and `green` if none failed or the server has never been called.

#### Scenario: Green when unused but ready

- **WHEN** a live server has at least one enabled tool and zero call logs
- **THEN** the traffic light is `green`

#### Scenario: Red after consecutive failures

- **WHEN** the last five playground or agent calls for a server failed
- **THEN** the traffic light is `red`

#### Scenario: Paused overrides

- **WHEN** the owner pauses a server that was green
- **THEN** the traffic light is `paused`

### Requirement: Paginated call log without secrets

The system SHALL list owner-scoped call logs with the shared pagination envelope. Audit persistence SHALL be best-effort through a bounded queue and SHALL never control the invocation result. Stored request/response summaries SHALL use byte caps, configurable body policy, configured retention, and redaction for secret bindings, sensitive agent inputs, auth values, cookies, agent tokens, and encoded variants. Account and server deletion SHALL remove associated logs rather than leave orphaned summaries.

#### Scenario: Secret and sensitive input are redacted

- **WHEN** a call uses an auth secret and a sensitive agent input
- **THEN** neither value appears in the stored request or response summary

#### Scenario: Queue failure is observable but non-blocking

- **WHEN** the audit queue is full or PostgreSQL rejects a log write
- **THEN** the call result is unchanged and a telemetry counter/error is emitted

#### Scenario: Retention removes old logs

- **WHEN** a log is older than the configured retention period
- **THEN** cleanup removes it without affecting current server data

#### Scenario: Account deletion removes logs

- **WHEN** an account is deleted and its servers cascade
- **THEN** no call-log row from those servers remains with null ownership

### Requirement: Execution telemetry distinguishes outcome phases

The system SHALL distinguish validation rejection, policy rejection, connection failure, timeout before completion, completed upstream error, completed upstream success, indeterminate mutation outcome, and audit persistence failure. Traffic-light health SHALL use upstream execution outcome and SHALL NOT mark a successful call failed solely because audit persistence failed.

#### Scenario: Mutation timeout is indeterminate

- **WHEN** a mutating request was sent but completion cannot be determined before timeout
- **THEN** telemetry and the caller error identify an indeterminate outcome and warn against blind retry

#### Scenario: Audit failure does not turn traffic light red

- **WHEN** recent upstream calls succeed but their log persistence fails
- **THEN** health does not classify those executions as upstream failures

### Requirement: Owner can inspect Platform PAT activity

The authenticated owner SHALL be able to list Platform PAT metadata and a paginated recent security-event ledger from first-party Settings. Token metadata SHALL include name, safe prefix, scopes, resource mode and selected-server count, policy version, creation, last use, expiration, revocation, and rotation relationship. The Platform MCP itself SHALL NOT expose the account security-event ledger to PATs.

#### Scenario: Multiple token inventory is clear

- **WHEN** an owner has multiple active and recently revoked PATs
- **THEN** Settings identifies each by name and safe prefix with its effective grants and lifecycle timestamps
- **AND** it never displays a raw PAT after its creation response

#### Scenario: Security events are owner-only

- **WHEN** a Platform PAT attempts to discover or call the security-event listing
- **THEN** no such Platform tool is advertised or callable
- **AND** an authenticated first-party owner can retrieve the paginated ledger

#### Scenario: Rotation relationship is visible

- **WHEN** an owner rotates a PAT
- **THEN** inventory metadata identifies the revoked predecessor and active successor without exposing either bearer value

### Requirement: Platform security events are durable and secret-safe

The system SHALL durably record Platform PAT issuance, rotation, revocation, scope/resource denial, failed high-risk step-up, destructive Studio action, and mutating upstream invocation with owner scope and bounded retention. Events SHALL contain only token ids or safe prefix snapshots, public scope names, optional authorized server ids, outcome codes, and bounded non-sensitive metadata. They SHALL NOT contain raw tokens, authorization headers, request arguments or bodies, server-value ids, secret metadata, ciphertext, or decrypted values.

#### Scenario: Grant lifecycle event commits atomically

- **WHEN** PAT creation, rotation, or revocation succeeds
- **THEN** its corresponding security event commits in the same transaction as the lifecycle change
- **AND** failure to persist that event rolls back the lifecycle mutation

#### Scenario: Runtime denial is audited without changing denial

- **WHEN** a valid PAT is denied by scope or resource policy
- **THEN** the caller receives the predetermined safe denial
- **AND** audit persistence failure is reported through secret-safe telemetry without granting access or replacing the denial

#### Scenario: High-risk call event omits arguments

- **WHEN** a PAT performs a destructive Studio operation or mutating upstream invocation
- **THEN** the event records the safe token/resource/action identity and outcome
- **AND** it stores no invocation arguments, request body, response body, or server-value references

#### Scenario: Security events expire

- **WHEN** a Platform security event exceeds the configured 90-day retention
- **THEN** cleanup removes it without changing PAT validity, Studio resources, or execution call logs
