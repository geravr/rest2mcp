## MODIFIED Requirements

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
