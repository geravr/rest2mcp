# MCP Observability (delta)

## MODIFIED Requirements

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
