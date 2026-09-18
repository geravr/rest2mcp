## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Execution telemetry distinguishes outcome phases

The system SHALL distinguish validation rejection, policy rejection, connection failure, timeout before completion, completed upstream error, completed upstream success, indeterminate mutation outcome, and audit persistence failure. Traffic-light health SHALL use upstream execution outcome and SHALL NOT mark a successful call failed solely because audit persistence failed.

#### Scenario: Mutation timeout is indeterminate

- **WHEN** a mutating request was sent but completion cannot be determined before timeout
- **THEN** telemetry and the caller error identify an indeterminate outcome and warn against blind retry

#### Scenario: Audit failure does not turn traffic light red

- **WHEN** recent upstream calls succeed but their log persistence fails
- **THEN** health does not classify those executions as upstream failures
