## ADDED Requirements

### Requirement: Studio configuration commands are atomic

The system SHALL execute each server-scoped Studio mutation as one transaction that includes ownership validation, invariant checks, all related database writes, and the server revision increment.

#### Scenario: Tool creation promotes a draft server atomically

- **WHEN** an owner creates the first enabled valid tool on a draft server
- **THEN** the tool insertion, compiled plan, draft-to-live promotion, and revision increment commit together
- **AND** a failure in any step leaves the tool absent and the server unchanged

#### Scenario: Concurrent tool creation respects the capacity limit

- **WHEN** concurrent create or duplicate commands would exceed the maximum tool count
- **THEN** the system serializes the capacity check for that server
- **AND** only commands that fit within the limit commit

#### Scenario: Server deletion excludes concurrent child writes

- **WHEN** a server deletion races with a tool, variable, authentication, token, or settings mutation
- **THEN** the commands serialize on the same server aggregate
- **AND** the final state is either the complete non-deleted mutation followed by deletion or no server aggregate at all

### Requirement: Studio rejects stale configuration writes

The system SHALL require the last observed server configuration revision for mutations of an existing server and SHALL reject a stale revision without changing persistent state.

#### Scenario: Current revision commits once

- **WHEN** a mutation supplies the current configuration revision and passes validation
- **THEN** the system commits the command and increments the server revision exactly once
- **AND** the response includes the new revision

#### Scenario: Stale form cannot overwrite a newer change

- **WHEN** a Studio form submits an expected revision older than the current server revision
- **THEN** the system returns the stable `MCP_WRITE_CONFLICT` application code and the current revision
- **AND** no portion of the stale mutation is persisted

#### Scenario: Studio recovers visibly from a conflict

- **WHEN** the SPA receives `MCP_WRITE_CONFLICT`
- **THEN** it reloads the current server aggregate and presents localized conflict guidance
- **AND** it does not report the stale mutation as successful

### Requirement: Runtime readers observe one committed server revision

The system SHALL materialize gateway tool listings and invocation configuration from a single committed database snapshot before performing external work.

#### Scenario: Invocation overlaps a configuration commit

- **WHEN** an invocation loads configuration while a Studio command is committing
- **THEN** the invocation uses either the complete previous revision or the complete new revision
- **AND** it never combines server settings, compiled plans, authentication, or values from different revisions

#### Scenario: Upstream HTTP does not hold the snapshot transaction

- **WHEN** invocation preparation has materialized a valid immutable snapshot
- **THEN** the read transaction ends before the upstream HTTP request begins

### Requirement: Server icon changes are commit-aware

The system SHALL represent server icons only as user-owned staged assets referenced by opaque asset id and SHALL make attachment and replacement visible only through a committed server mutation. Server mutation contracts SHALL NOT accept or read a legacy icon URL field.

#### Scenario: Legacy icon URL is not accepted

- **WHEN** a caller submits the superseded icon URL field instead of a ready owned asset id
- **THEN** validation rejects the request and no compatibility write or fallback read is performed

#### Scenario: Uploaded asset is not attached after a failed mutation

- **WHEN** an icon upload succeeds but the server mutation fails or conflicts
- **THEN** the current server icon remains unchanged
- **AND** the unattached asset remains eligible for durable garbage collection

#### Scenario: Replacing an icon preserves the committed icon until commit

- **WHEN** an owner replaces a server icon
- **THEN** attaching the new asset and marking the prior asset for deletion commit with the server revision increment
- **AND** object deletion starts only after the database commit

#### Scenario: Object deletion failure is recoverable

- **WHEN** deletion of a replaced or abandoned object fails
- **THEN** the committed server configuration remains valid
- **AND** durable cleanup state retains enough information for an idempotent retry without exposing another user's object
