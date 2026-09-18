## Why

Studio mutations currently mix strong transactional paths with multi-step writes whose validation, compilation, lifecycle changes, or dependent cleanup happen outside the transaction. Concurrent browser actions, Platform MCP calls, retries, and failures between statements can therefore leave inserted tools without the expected server promotion, exceed limits, retain stale compiled request plans, lose another editor's update, or orphan uploaded assets. The product needs one consistent write boundary so a successful response means the complete configuration change committed and a failure means no partial configuration became visible.

## What Changes

- Introduce a shared server-scoped write command boundary that performs ownership checks, reads, validation, compilation, capacity checks, and database mutations in one transaction while serializing concurrent writes to the same server.
- Add explicit revision-based conflict detection so stale Studio or Platform MCP mutations fail with a stable conflict result instead of silently overwriting newer configuration.
- Make tool create, duplicate, update, enable/disable, delete, and server lifecycle promotion commit as one unit.
- Rebuild and persist every affected compiled request plan in the same transaction when server URL settings, authentication, common values, variable metadata, or tool bindings change; reject the whole command if any affected enabled tool becomes invalid.
- Make variable existence checks, reference checks, kind changes, value rotation, and deletion race-safe, while preserving secret-safe responses and logs.
- Strengthen token replacement and destructive server operations against concurrent writes with transactional locking and database constraints where an invariant can be enforced structurally.
- Treat object storage as an explicit non-transactional boundary: stage icon uploads, claim the selected asset during the database commit, and reconcile unclaimed or replaced objects through durable post-commit cleanup.
- Add failure-injection and concurrency coverage proving that commands have no partial outcomes and that Platform MCP mutations use the same service semantics as the Studio UI.

Non-goals: changing tool schemas or runtime execution contracts, redesigning Studio screens, introducing a distributed transaction across PostgreSQL and object storage, or guaranteeing replay of one-time plaintext credentials after a response is lost.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-studio`: Studio configuration and lifecycle mutations become atomic, concurrency-safe, revision-aware commands, including commit-aware icon replacement.
- `mcp-templates`: Authentication, variables, common values, and their dependent compiled request plans change together or not at all.
- `platform-mcp`: Agent-initiated mutations share the same transaction, conflict, retry-safety, and invariant enforcement as first-party Studio writes.

## Impact

- Backend services in `apps/api/services`, Studio and Platform tRPC routers, stable application error codes, and request-plan compilation orchestration.
- Drizzle schemas and migrations for revisions, durable asset state/cleanup, and any uniqueness constraints required to protect write invariants.
- Studio mutation inputs and cache reconciliation in `apps/app`, primarily to send expected revisions and recover visibly from conflicts.
- Object-storage upload/finalization flows and background or opportunistic cleanup of staged/replaced assets.
- Integration tests using PostgreSQL concurrency and injected failures, plus focused service/router tests for atomic rollback and secret-safe errors.
