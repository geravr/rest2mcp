# MCP Observability

## Purpose

Playground invoke, traffic-light health, and paginated call logs for MCP servers without exposing secrets.

## Requirements

### Requirement: Owner can invoke a tool from the playground

The system SHALL provide an authenticated playground invoke that uses the same executor as the gateway (allowlist, mutation rules, variable rendering, timeouts). Playground calls SHALL be logged with source `playground`.

#### Scenario: Playground success

- **WHEN** the owner invokes an enabled GET tool with valid arguments
- **THEN** the SPA receives the upstream result (capped) and a new call log row with source `playground` and status success

#### Scenario: Playground respects mutation flag

- **WHEN** the owner invokes a DELETE tool with `allowMutation` false
- **THEN** the invoke fails with `MCP_MUTATION_NOT_ALLOWED` and no upstream request is made

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

The system SHALL list call logs for a server owned by the caller using the `@repo/core` pagination envelope. Stored summaries SHALL be redacted and capped at 64 KiB. Redaction SHALL cover every secret variable value used in the render (in raw, URL-encoded, and form-encoded variants), not only a single credential. Logs SHALL never contain secret variable values or raw agent tokens.

#### Scenario: Owner reads logs

- **WHEN** the owner lists logs for their server
- **THEN** the response includes `items`, `page`, `pageSize`, `total`, and each item has source, status, duration, and redacted summaries

#### Scenario: Other user cannot read logs

- **WHEN** user B lists logs for user A's server id
- **THEN** the system rejects the request with `MCP_SERVER_NOT_FOUND` (or equivalent not-found, not a leak)

#### Scenario: Secret variable not logged

- **WHEN** a call rendered a secret variable into a query param and body field
- **THEN** the persisted request summary shows `[REDACTED]` in place of the secret value in both positions
