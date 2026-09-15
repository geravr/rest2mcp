## MODIFIED Requirements

### Requirement: Owner can invoke a tool from the playground

The system SHALL provide an authenticated playground invoke that uses the same executor as the gateway (allowlist, mutation rules, variable rendering, timeouts). Playground calls SHALL be logged with source `playground`. When the upstream returns an HTTP response, the invoke SHALL return that `httpStatus`, capped body, and `callLogId` to the SPA even when the status is not 2xx; the call log status SHALL be `success` for 2xx and `error` otherwise. Invoke SHALL fail with an `appCode` (no upstream body) only when execution is blocked or the socket fails (disabled tool, paused server, `MCP_MUTATION_NOT_ALLOWED`, `MCP_TEMPLATE_UNRESOLVED`, `MCP_HOST_NOT_ALLOWED`, network/timeout).

#### Scenario: Playground success

- **WHEN** the owner invokes an enabled GET tool with valid arguments
- **THEN** the SPA receives the upstream result (capped) and a new call log row with source `playground` and status success

#### Scenario: Playground respects mutation flag

- **WHEN** the owner invokes a DELETE tool with `allowMutation` false
- **THEN** the invoke fails with `MCP_MUTATION_NOT_ALLOWED` and no upstream request is made

#### Scenario: Playground shows upstream 401

- **WHEN** the owner invokes an enabled GET tool and the upstream responds 401 with a JSON body
- **THEN** the SPA receives `ok: false`, `httpStatus` 401, the capped body, and a call log id, and the log row has status error
