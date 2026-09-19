## 1. Coordinate the revision model with active changes

- [x] 1.1 Reconcile `configRevision`, `draftRevision`, and published revision numbers so each counter has one documented purpose and no write path increments the wrong one.
- [x] 1.2 Reuse the canonical tool-contract fingerprint from `improve-agent-tool-contracts` as an input to publication instead of introducing a second fingerprint algorithm.
- [x] 1.3 Reuse the Platform MCP author/publish scope boundary from `secure-platform-mcp-and-token-scopes` for every new publication command.
- [x] 1.4 Reuse the transactional mutation primitives from `make-studio-writes-atomic` for draft writes and publish compare-and-swap checks.
- [x] 1.5 Add stable application error codes and shared types for stale drafts, stale published revisions, changed candidates, unacknowledged warnings, no-op publishes, and missing secret bindings.

## 2. Add the publication persistence model

- [x] 2.1 Extend `mcp_server` with a monotonic `draftRevision` and nullable `publishedRevisionId` without creating an unsafe circular foreign-key migration.
- [x] 2.2 Add `mcp_server_revision` with server ownership, monotonic revision number, source draft revision, candidate fingerprint, publication attribution, note, and timestamps.
- [x] 2.3 Add `mcp_server_revision_tool` with immutable tool identity, ordering, enabled state, agent contract, request mapping, response mapping, compiled plan, and contract fingerprint.
- [x] 2.4 Add `mcp_server_revision_config` with immutable non-secret configuration values and secret-slot references, never decrypted secret material.
- [x] 2.5 Add publication request identity storage or an equivalent uniqueness constraint that makes a repeated `publishRequestId` idempotent per server.
- [x] 2.6 Add published revision identity and contract fingerprint fields to MCP call-log storage.
- [x] 2.7 Add uniqueness, ownership, and lookup indexes for revision numbers, active pointers, request identities, tool snapshots, and revision-attributed logs.
- [x] 2.8 Generate and review the Drizzle migration so retained development servers have no active revision, with intentional constraint ordering and no automatic publication/backfill.
- [x] 2.9 Add database tests for ownership constraints, immutable revision relations, monotonic numbering, request idempotency, and active-pointer integrity.

## 3. Build canonical publication candidates

- [x] 3.1 Add a typed draft-aggregate loader that reads the server, every tool, request mappings, response mappings, variables, authentication configuration, and defaults under one consistent snapshot.
- [x] 3.2 Canonicalize aggregate ordering, nullable fields, JSON values, and omitted defaults before calculating a publication candidate fingerprint.
- [x] 3.3 Compile and validate every draft tool when building a candidate, retaining disabled tools in the snapshot while excluding them from runtime discovery.
- [x] 3.4 Snapshot fixed and agent-facing non-secret configuration values while representing secrets only as stable secret-slot references.
- [x] 3.5 Produce a secret-safe diff between the active revision and candidate using structural paths and redacted secret metadata.
- [x] 3.6 Produce deterministic readiness errors and warnings for invalid tools, unresolved bindings, missing defaults, authentication gaps, contract changes, and destructive removals.
- [x] 3.7 Add unit tests proving semantically equivalent drafts produce the same fingerprint and meaningful contract changes produce a different fingerprint.
- [x] 3.8 Add tests proving preview output cannot expose decrypted secrets, authorization headers, token values, or secret-derived defaults.

## 4. Implement preview and atomic publication services

- [x] 4.1 Implement a read-only `previewPublish` service returning the expected draft revision, expected published revision, candidate fingerprint, readiness, warnings, and safe diff.
- [x] 4.2 Implement `publishServer` inside a database transaction that locks the server, checks expected revisions, rebuilds the candidate, and verifies its fingerprint.
- [x] 4.3 Insert the immutable server, tool, and configuration revision rows before atomically switching `publishedRevisionId` and server status.
- [x] 4.4 Reject publication when the candidate has blocking readiness errors or is identical to the active revision.
- [x] 4.5 Bind warning acknowledgements to the candidate fingerprint so a changed draft cannot inherit approval for an older preview.
- [x] 4.6 Make retries with the same `publishRequestId` return the original success without creating another revision.
- [x] 4.7 Return structured conflict data containing current revisions and a refresh/re-preview action when optimistic checks fail.
- [x] 4.8 Add transaction tests for concurrent publishers, candidate changes between preview and publish, partial insert failures, no-op attempts, and idempotent retries.

## 5. Separate draft mutations from operational mutations

- [x] 5.1 Classify server settings, authentication structure, tool definitions, bindings, fixed values, defaults, and non-secret configuration as publishable draft state.
- [x] 5.2 Increment `draftRevision` exactly once for each successful publishable aggregate mutation, including batched and nested writes.
- [x] 5.3 Keep pause/resume, token revocation, icon metadata, and secret-material rotation operational so they take effect immediately without making the draft dirty.
- [x] 5.4 Ensure creating, editing, enabling, disabling, reordering, or deleting a tool changes only the draft until publication.
- [x] 5.5 Replace ambiguous live-save responses with explicit draft state, dirty state, active revision, and candidate fingerprint metadata.
- [x] 5.6 Add regression tests covering every Studio and Platform MCP write path and asserting the correct revision counter behavior.

## 6. Enforce configuration and secret semantics

- [x] 6.1 Resolve published fixed values and defaults from the active revision snapshot rather than mutable draft tables.
- [x] 6.2 Resolve secret material at execution time from the current operational secret slot referenced by the active revision.
- [x] 6.3 Allow secret rotation to affect new calls immediately without changing the published revision identity.
- [x] 6.4 Prevent deletion or incompatible renaming of a secret slot referenced by the active revision.
- [x] 6.5 Mark historical revisions with unavailable secret slots as not restorable until the binding is repaired, without exposing the missing value.
- [x] 6.6 Add tests for secret rotation, active-slot deletion attempts, historical missing slots, fixed-value isolation, and secret-safe errors.

## 7. Pin gateway discovery and execution to published revisions

- [x] 7.1 Add a `PublishedExecutionSnapshot` loader that resolves one active revision and all required immutable rows under a consistent read boundary.
- [x] 7.2 Serve MCP tool discovery exclusively from enabled tools in the active published revision.
- [x] 7.3 Execute tool calls exclusively from the compiled plan, bindings, defaults, and response mapping stored in the pinned revision.
- [x] 7.4 Keep an in-flight request pinned to its starting revision when a newer revision is published concurrently.
- [x] 7.5 Return machine-actionable refresh guidance when an agent calls a removed tool or submits arguments matching a stale contract.
- [x] 7.6 Never fall back to mutable draft rows or an older revision when the active revision is missing or inconsistent.
- [x] 7.7 Add an architecture test that fails if gateway or executor modules import mutable draft repositories.
- [x] 7.8 Attribute every execution, validation failure, and upstream failure to the pinned revision number and tool contract fingerprint.
- [x] 7.9 Add gateway tests for unpublished edits, concurrent publication, disabled tools, stale calls, missing revisions, and failed snapshot loads.

## 8. Add history, restore, and retention services

- [x] 8.1 Implement paginated revision-history queries scoped to the owning server with publication actor, note, fingerprint, and active-state metadata.
- [x] 8.2 Implement a secret-safe revision-detail query with tool contracts, redacted configuration, readiness, and comparison metadata.
- [x] 8.3 Implement restore-to-draft as one transactional aggregate replacement that increments `draftRevision` but does not alter the active published pointer.
- [x] 8.4 Preserve stable tool identities where safe during restore and define deterministic handling for identities that no longer exist.
- [x] 8.5 Implement bounded cleanup that always retains the active revision and at least the 20 newest revisions, and only removes older superseded revisions after 90 days.
- [x] 8.6 Add history, authorization, restore, identity-preservation, unavailable-secret, pagination, and retention tests.

## 9. Expose typed application and Platform MCP contracts

- [x] 9.1 Add Zod inputs and outputs for preview, publish, revision history, revision detail, revision comparison, and restore-to-draft.
- [x] 9.2 Add thin protected tRPC procedures that delegate publication logic to services and translate service errors at the edge.
- [x] 9.3 Add explicit Platform MCP authoring tools for draft inspection and mutation without granting publication implicitly.
- [x] 9.4 Add explicit Platform MCP publication tools guarded by the publish scope, expected revisions, candidate fingerprint, and warning acknowledgements.
- [x] 9.5 Keep revision history and result resources tenant-scoped, bounded, secret-safe, and inaccessible through guessed identifiers.
- [x] 9.6 Add router and Platform MCP integration tests for scopes, ownership, stale conflicts, idempotency, pagination, and secret redaction.

## 10. Make publication state clear in Studio

- [x] 10.1 Add typed client queries and mutations for draft status, publication preview, publish, history, detail, comparison, and restore.
- [x] 10.2 Show distinct draft, unpublished-changes, published-revision, paused, and publication-blocked states in the server detail view.
- [x] 10.3 Change mutation feedback to say that edits were saved to the draft rather than implying they are live.
- [x] 10.4 Add a publish review flow that presents readiness, contract changes, destructive warnings, redacted configuration changes, and the candidate fingerprint.
- [x] 10.5 Require explicit acknowledgement of blocking-category warnings and recover gracefully when the candidate becomes stale.
- [x] 10.6 Add revision history and secret-safe comparison UI with restore-to-draft, never direct rollback of the live pointer.
- [x] 10.7 Add matching English and Spanish copy for publication, conflicts, warnings, empty history, and restore outcomes.
- [x] 10.8 Add component and flow tests for dirty-state transitions, preview refresh, warning acknowledgement, concurrent conflicts, publish success, and restore.

## 11. Align playground and observability behavior

- [x] 11.1 Require the playground to select published mode or draft-preview mode explicitly and display the chosen source prominently.
- [x] 11.2 Reuse the canonical candidate materializer for draft-preview calls without persisting a revision or changing production state.
- [x] 11.3 Mark draft-preview log entries separately and exclude them from production health calculations.
- [x] 11.4 Display revision number and contract fingerprint on published call-log rows and call details.
- [x] 11.5 Calculate server and tool health from the currently active revision while retaining historical revision filters for diagnosis.
- [x] 11.6 Add observability tests for revision attribution, draft-preview isolation, active-revision health, and secret-safe log details.

## 12. Perform the clean pre-production cutover

- [x] 12.1 Update canonical seeds and fixtures so servers start as unpublished drafts and required end-to-end fixtures publish revision 1 explicitly.
- [x] 12.2 Document reset/reseed for disposable development databases and the optional manual review/publish path for retained drafts.
- [x] 12.3 Delete mutable-row gateway loaders, executor fallbacks, dual-write/shadow branches, compatibility metrics, and their tests.
- [x] 12.4 Switch Studio, Platform authoring, publication, gateway discovery, and execution to the draft/revision boundary in one implementation slice.
- [x] 12.5 Add architecture checks proving gateway and executor production paths cannot import draft repositories or mutable compiled-plan loaders.
- [x] 12.6 Add clean-migration tests for empty databases, retained unpublished drafts, invalid drafts, reset/reseed, and explicitly published fixtures.

## 13. Document, instrument, and verify the boundary

- [x] 13.1 Update the relevant `AGENTS.md` contracts with draft-versus-published ownership, revision immutability, runtime pinning, and secret-slot invariants.
- [x] 13.2 Add structured telemetry for preview failures, publish conflicts, publication latency, revision load failures, and stale agent calls without logging secret material.
- [x] 13.3 Add end-to-end coverage proving an unpublished edit cannot affect discovery or execution and publication switches the full aggregate atomically.
- [x] 13.4 Add end-to-end coverage proving pause, token revocation, and secret rotation remain immediate operational controls.
- [x] 13.5 Run focused API, gateway, Platform MCP, database, and Studio tests for the affected slices.
- [x] 13.6 Run `bun typecheck`, `bun lint`, and `bun test` from the repository root.
- [x] 13.7 Run `bunx prettier --write .`, inspect the scoped diff, and re-run any checks affected by formatting.
- [x] 13.8 Search source, schemas, tests, fixtures, and documentation for mutable-runtime reads, automatic revision backfills, dual-read/write branches, shadow cutover code, or compatibility flags and remove every remaining occurrence.
