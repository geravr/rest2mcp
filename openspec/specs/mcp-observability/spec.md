# MCP Observability

## Purpose

Playground invoke, traffic-light health, and paginated call logs for MCP servers without exposing secrets.

## Requirements

### Requirement: Owner can invoke a tool from the playground

The authenticated playground SHALL require an explicit published or draft mode. Published mode SHALL use the exact active revision snapshot, input schema, policy checks, deadline, and response envelope as the gateway. Draft mode SHALL compile/materialize the observed owner draft for testing without publishing it and SHALL label results with the draft revision. Both modes SHALL display successful and non-2xx upstream responses with safe bounded details, and audit persistence failure SHALL NOT replace a completed result. Optional inputs SHALL preserve an explicit absent state.

#### Scenario: Published playground matches gateway

- **WHEN** the owner invokes a published tool with the same inputs as an MCP client
- **THEN** both use the same published revision plan and normalize the same response

#### Scenario: Draft playground tests unpublished change

- **WHEN** the owner explicitly selects draft mode for a valid unpublished tool
- **THEN** the request uses the observed draft candidate and reports its draft revision
- **AND** no published revision or gateway pointer changes

#### Scenario: Draft changes during test preparation

- **WHEN** the draft revision changes before draft execution materializes its candidate
- **THEN** the test rejects the stale request rather than combining draft states

#### Scenario: Optional boolean can be absent

- **WHEN** an optional boolean is left unset
- **THEN** the playground omits it instead of sending false

#### Scenario: Upstream error remains inspectable

- **WHEN** upstream returns 401 or 429
- **THEN** the playground shows sanitized status/details while the agent-facing gateway uses `isError: true`

#### Scenario: Log failure does not change result

- **WHEN** upstream completes a POST successfully and audit persistence fails
- **THEN** the playground receives the successful result and telemetry records the audit failure

### Requirement: Traffic light reflects recent health

The system SHALL expose a derived traffic light for the active published revision: `paused` when runtime status is paused; `draft` when no published revision exists; otherwise `red` if the last five product or published-playground calls attributed to the active revision all failed, `yellow` if any failed, and `green` if none failed or the active revision has never been called. Draft-playground and superseded-revision calls SHALL NOT affect current runtime health.

#### Scenario: New publication starts green

- **WHEN** a new live revision has no attributed product or published-playground calls
- **THEN** its traffic light is `green` regardless of failures on the superseded revision

#### Scenario: Red after active-revision failures

- **WHEN** the last five qualifying calls for the active revision all failed
- **THEN** the traffic light is `red`

#### Scenario: Draft tests do not affect health

- **WHEN** draft-playground calls fail while active-revision calls succeed
- **THEN** the active traffic light remains based only on qualifying active-revision calls

#### Scenario: Paused overrides

- **WHEN** the owner pauses a server that was green
- **THEN** the traffic light is `paused` while preserving its active revision history

### Requirement: Paginated call log without secrets

The system SHALL list owner-scoped call logs with the shared pagination envelope and identify each call's published revision id/number, aggregate and tool fingerprints, or draft revision/mode where applicable. Audit persistence SHALL remain best-effort and SHALL never control invocation results. Stored summaries SHALL use byte caps, retention, and redaction for secret bindings, sensitive inputs, auth values, cookies, tokens, and encoded variants. Revision cleanup SHALL preserve denormalized attribution, and account/server deletion SHALL remove associated logs.

#### Scenario: Published call is attributable

- **WHEN** a gateway or published-playground call is logged
- **THEN** the row records safe published revision and tool-contract identity without copying revision definitions or secret references

#### Scenario: Draft call is visibly isolated

- **WHEN** a draft-playground call is logged
- **THEN** its source and observed draft revision distinguish it from published runtime traffic

#### Scenario: Secret and sensitive input are redacted

- **WHEN** a call uses an auth secret and a sensitive agent input
- **THEN** neither value appears in the stored request/response summary or revision metadata

#### Scenario: Queue failure is observable but non-blocking

- **WHEN** the audit queue is full or PostgreSQL rejects a log write
- **THEN** the call result is unchanged and a telemetry counter/error is emitted

#### Scenario: Revision cleanup preserves attribution

- **WHEN** retention removes a superseded revision referenced by an older call log
- **THEN** the log retains its denormalized revision number/fingerprints without retaining configuration content

#### Scenario: Retention removes old logs

- **WHEN** a log is older than the configured call-log retention period
- **THEN** cleanup removes it without affecting current server or revision data

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
