## 1. Persistence and Contract Foundations

- [ ] 1.1 Add `configRevision` to the MCP server schema and expose it in server detail/list service result types.
- [ ] 1.2 Add the user-owned storage-asset schema, lifecycle state constraints, indexes, and nullable server icon asset reference as the only icon source.
- [ ] 1.3 Add multi-PAT-safe hash and active-name uniqueness plus supporting metadata for user-locked selected-token rotation without a singleton-token constraint.
- [ ] 1.4 Add stable `MCP_WRITE_CONFLICT` and fully-rolled-back transient failure application codes with secret-safe metadata shapes in `packages/core` and the API error layer.
- [ ] 1.5 Generate the Drizzle migration for revisions/assets and removal of the superseded icon URL field, then inspect it without hand-editing generated SQL.
- [ ] 1.6 Update canonical seeds and fixtures for initial revisions and asset ids, documenting reset/reseed for disposable development records instead of adding a backfill.
- [ ] 1.7 Add schema and clean-migration tests for revision defaults, asset ownership/state, absence of icon URL storage, and multi-PAT invariants.

## 2. Server Aggregate Command Boundary

- [ ] 2.1 Define the transaction-scoped database type and a `withOwnedServerWrite` API that prevents command callbacks from using the global database client.
- [ ] 2.2 Implement owned server row locking, `expectedRevision` comparison, and exactly-once revision increment inside the aggregate transaction.
- [ ] 2.3 Implement stable translation for stale revisions, uniqueness violations, deadlocks, and serialization failures without exposing SQL or secret data.
- [ ] 2.4 Add bounded automatic retry for known fully rolled-back PostgreSQL failures while excluding validation and revision conflicts.
- [ ] 2.5 Add post-commit hooks for buffered telemetry and cleanup work so no external I/O runs while the server lock is held.
- [ ] 2.6 Add unit tests for ownership, lock ordering, current/stale revisions, single revision increments, retry limits, rollback, and post-commit hook behavior.
- [ ] 2.7 Add a PostgreSQL integration test proving that two commands from one revision have at most one winner.

## 3. Atomic Server and Tool Commands

- [ ] 3.1 Move server settings updates into the aggregate boundary and build the complete candidate server state before persistence.
- [ ] 3.2 Move manual and typed tool creation into the aggregate boundary with transactional capacity and name checks.
- [ ] 3.3 Move curl-confirm tool creation into the same tool command path without changing curl preview or import ownership rules.
- [ ] 3.4 Move tool update and enable/disable behavior into the aggregate boundary with candidate compilation before persistence.
- [ ] 3.5 Move tool duplication into the aggregate boundary with transactional capacity, generated-name, compilation, and revision handling.
- [ ] 3.6 Move tool deletion and confirmation checks into the aggregate boundary without introducing automatic live-to-draft demotion.
- [ ] 3.7 Commit first-valid-tool insertion or enablement and draft-to-live promotion in the same transaction.
- [ ] 3.8 Move server deletion and server-token create/revoke operations behind the server lock and expected revision contract.
- [ ] 3.9 Add rollback tests that inject a failure after each tool/lifecycle write and assert that no partial row or revision change remains.
- [ ] 3.10 Add concurrency tests for capacity enforcement, duplicate names, delete-versus-child-write ordering, and safe retries after an unknown tool-create outcome.

## 4. Atomic Authentication, Common Values, and Variables

- [ ] 4.1 Extract candidate-aggregate compilation with an explicit invalidation closure for tool, server-wide, variable-metadata, and value-only changes.
- [ ] 4.2 Move common header/query validation, dependent compilation, server update, and compiled-plan writes into one aggregate transaction.
- [ ] 4.3 Move authentication recipe application, auth-owned secret creation/rotation, obsolete-value cleanup, and dependent compilation into one aggregate transaction.
- [ ] 4.4 Move variable creation and set-by-name behavior into the aggregate boundary so existence checks and writes cannot race.
- [ ] 4.5 Move variable metadata/kind updates into the aggregate boundary and validate all secret-required placements before changing storage representation.
- [ ] 4.6 Move variable deletion and JSON reference checks into the aggregate boundary so a concurrent binding cannot become dangling.
- [ ] 4.7 Keep value-only rotation on the no-structural-recompile path while validating identity, ownership, encryption, and revision invariants transactionally.
- [ ] 4.8 Buffer compiler telemetry until commit and discard candidate success events when the command rolls back.
- [ ] 4.9 Add tests for all invalidation classes, invalid dependent-tool rollback, auth rollback, kind-transition rejection, and secret-safe failures.
- [ ] 4.10 Add concurrency tests for variable delete-versus-reference creation and same-name variable creation.

## 5. Consistent Runtime Read Snapshots

- [ ] 5.1 Implement a read-only repeatable-read loader that materializes server, tool, compiled plan, and referenced values with one `configRevision`.
- [ ] 5.2 Update gateway tool listing to consume one immutable committed configuration snapshot.
- [ ] 5.3 Update invocation preparation and executor value resolution to consume the snapshot and close the transaction before upstream HTTP begins.
- [ ] 5.4 Include the loaded revision in safe diagnostic and telemetry context without changing agent-visible tool contracts.
- [ ] 5.5 Add integration tests that pause a writer between statements and prove listing/invocation preparation observes either the complete old or complete new revision.
- [ ] 5.6 Add a test proving no database transaction remains open during a delayed upstream HTTP request.

## 6. Staged Icon Assets and Reconciliation

- [ ] 6.1 Implement storage-asset creation before S3 upload and transitions from `staging` to `ready` using opaque user-owned asset ids.
- [ ] 6.2 Add S3 object deletion support with idempotent not-found handling and secret-safe failure reporting.
- [ ] 6.3 Replace new server-icon URL writes with an aggregate command that validates and attaches a ready icon asset by id.
- [ ] 6.4 Mark replaced, cleared, and deleted-server icon assets `delete_pending` in the same database commit as the server revision change.
- [ ] 6.5 Implement a bounded reconciler for expired staging/ready assets and `delete_pending` objects that records retryable failures.
- [ ] 6.6 Add opportunistic post-commit reconciliation and an operator command with dry-run output, then register and document that command in the repository command sources of truth.
- [ ] 6.7 Add tests for upload crashes before and after S3 success, failed icon mutation, cross-user asset rejection, replacement, clearing, server deletion, and repeated cleanup.
- [ ] 6.8 Remove legacy icon URL validators, serializers, service branches, UI inputs, tests, and documentation; verify no runtime path reads or writes them.

## 7. Studio and Platform Mutation Contracts

- [ ] 7.1 Add `expectedRevision` to every existing-server Studio tRPC mutation input and return the new revision from successful mutations.
- [ ] 7.2 Update Platform MCP server-scoped mutation schemas and descriptions to require the observed revision and explain reread-before-retry behavior.
- [ ] 7.3 Route every Platform mutation through the shared aggregate commands and remove any direct or weaker agent-specific write path.
- [ ] 7.4 Implement structured Platform outcomes that distinguish stale conflicts from retryable fully-rolled-back infrastructure failures without changing tool execution contracts.
- [ ] 7.5 Implement user-row locking and compare-and-swap Platform-token replacement so concurrent rotations have one winner.
- [ ] 7.6 Add Studio router tests for required/current/stale revisions and secret-safe conflict metadata.
- [ ] 7.7 Add Platform MCP tests for browser-versus-agent conflicts, safe create retries, structured recovery guidance, and non-replayable plaintext token behavior.

## 8. SPA Conflict and Asset UX

- [ ] 8.1 Carry `configRevision` through Studio server query data and mutation helpers without maintaining a second local source of truth.
- [ ] 8.2 Send the last observed revision from server, tool, auth, common-value, variable, token, icon, and deletion mutations.
- [ ] 8.3 Centralize `MCP_WRITE_CONFLICT` handling to invalidate and reload the aggregate while preventing stale optimistic state from being reported as saved.
- [ ] 8.4 Add concise English and Spanish conflict copy and preserve unsaved form values where the existing form architecture permits resubmission.
- [ ] 8.5 Update the icon flow to upload a staged asset id, attach it through the revisioned mutation, and leave failed/unselected uploads for reconciliation.
- [ ] 8.6 Add SPA tests for successful revision advancement, stale-tab conflict recovery, agent-caused conflict recovery, and failed icon attachment.

## 9. Invariants, Verification, and Rollout

- [ ] 9.1 Document the server aggregate, lock order, transaction-client-only rule, runtime snapshot boundary, and no-external-I/O invariant in `apps/api/AGENTS.md`.
- [ ] 9.2 Add instrumentation for aggregate lock wait/duration, revision conflicts, compile duration, transient retries, and oldest pending asset cleanup age without secret-bearing labels.
- [ ] 9.3 Enforce required revisions and asset-id-only icon writes immediately after updating every first-party caller; add tests rejecting missing revisions and old input shapes.
- [ ] 9.4 Run the asset reconciler in dry-run mode against newly staged test assets and verify reset/reseed plus forward-migration recovery without legacy data conversion.
- [ ] 9.5 Run focused service, router, gateway, executor, storage, Platform MCP, and SPA tests for all touched paths.
- [ ] 9.6 Run `bun typecheck`, `bun lint`, and `bun test`, fixing all regressions attributable to this change.
- [ ] 9.7 Run `bunx prettier --write .`, inspect the final diff for unrelated or secret-bearing changes, and confirm every delta-spec scenario has test coverage.
- [ ] 9.8 Search source, schema, routers, clients, fixtures, and docs for direct server writes, compatibility flags, legacy icon URL fields, or singleton Platform-token assumptions and remove every remaining occurrence.
