## Context

The current authoring model has no durable boundary between editing and serving. `mcp_server`, `mcp_tool`, and `mcp_server_variable` are both the Studio draft and the source used by gateway/executor reads. Typed saves compile immediately into `mcp_tool.compiledPlan`, server-wide changes rewrite dependent plans, and the draft server is promoted to `live` after its first enabled tool. This is better than runtime compilation, but a sequence of otherwise valid saves can still change the agent-visible contract one form at a time.

Three planned changes provide necessary foundations: `make-studio-writes-atomic` supplies server locks and optimistic configuration revisions; `improve-agent-tool-contracts` supplies deterministic tool/server contract fingerprints; and `secure-platform-mcp-and-token-scopes` separates draft `author` authority from runtime `publish` authority. This design connects them without making publication responsible for operational security actions.

The server configuration contains different kinds of state:

- **Versioned structure:** base URL and host policy, auth bindings, common bindings, tool definitions, enabled state, mutation permission, agent contracts, and non-secret config values.
- **Operational state:** pause/resume, server and Platform token revocation, secret material rotation, rate-limit state, and health.
- **Studio-only presentation:** icon and other display-only data that does not affect an agent request.

Only versioned structure participates in publication. Operational security actions must remain immediate.

## Goals / Non-Goals

**Goals:**

- Let owners save, validate, compare, and test a complete draft without changing live agent behavior.
- Switch every tool and server-wide request dependency to a new immutable revision in one atomic publication.
- Give the gateway an unambiguous revision for discovery, invocation, errors, call logs, and health.
- Preserve immediate pause, credential revocation, and secret-material rotation.
- Provide linear, auditable history and safe restore-to-draft without resurrecting secrets.
- Establish the published-revision boundary cleanly without preserving mutable-row runtime behavior.

**Non-Goals:**

- Branching, merging, multiple named drafts, scheduled publishing, or multi-user approvals.
- Publishing one tool independently from the rest of its server aggregate.
- Storing historical plaintext or ciphertext secret material.
- Automatically publishing after save, preview, connection test, or draft playground execution.
- Executing an older revision merely because an agent cached its contract.
- Bit-for-bit replay of historical invocations whose operational secret material has since rotated.

## Decisions

### 1. Keep current rows as the mutable draft and add normalized immutable revisions

Existing `mcp_server` publishable columns, `mcp_tool`, and `mcp_server_variable` remain the editable draft to avoid duplicating every Studio write path. Add:

- `mcp_server.draftRevision`: monotonic number incremented only by publishable draft changes.
- `mcp_server.publishedRevisionId`: nullable pointer to the active immutable revision.
- `mcp_server_revision`: server-level versioned fields, revision number, source draft revision, schema version, canonical aggregate and contract fingerprints, publish request id, safe diff summary, note, actor/source metadata, and timestamps.
- `mcp_server_revision_tool`: one immutable row per draft tool, including stable logical tool id, definition, compiled plan/diagnostics, enabled state, mutation permission, annotations, source, and tool-contract fingerprint.
- `mcp_server_revision_config`: immutable copies of non-secret config values used to resolve the published request plans.

Revision numbers are unique and monotonically increasing per server. Revision rows have no mutable `active` flag; activity is derived solely from the server pointer. The server lock allocates the next number. Database permissions are not available as a second defense in this architecture, so application exports expose insert/select only and tests assert that no update path targets revision tables.

Normalized revision/tool/config rows are preferred over one large JSONB snapshot. A server can have up to 50 tools with sizable typed definitions and compiled plans; separate rows keep tool lookup/indexing bounded, let retention cascade cleanly, and avoid rewriting or parsing a multi-megabyte aggregate blob for one execution. Server-level JSON fields such as common entries and auth configuration remain JSON within the revision row because they are small aggregate values.

The draft has two concurrency identities:

- `configRevision` from the atomic-write change remains the broad compare-and-swap token for server aggregate mutations.
- `draftRevision` changes only when versioned structure changes. Token lifecycle, icon changes, pause/resume, secret-material rotation, and other operational writes do not make the draft dirty.

Dirty state is determined by comparing the current canonical draft fingerprint with the active revision's source fingerprint, not solely by comparing counters. This permits a user to edit and then exactly revert without showing a false unpublished-change state.

### 2. Define the exact published boundary

A revision captures:

- Agent-relevant server name/description, base URL, allowed hosts, structural authentication configuration, and common header/query bindings.
- Every draft tool, including disabled or invalid drafts for faithful history/restore. Only enabled valid tools contribute to the published agent contract and runtime index.
- Non-secret config identity, metadata needed by bindings, and its value at publication time.
- Secret slot ids and expected kind/ownership metadata referenced by auth/common/tool bindings, but never plaintext or ciphertext.
- Derived input/output schemas, behavior annotations, compiled request plans, per-tool fingerprints, aggregate contract fingerprint, and schema/compiler versions.

Presentation-only icon changes are immediate and excluded. Runtime status remains on `mcp_server`: no published pointer means `draft`; a pointer plus active status means `live`; `paused` is an immediate override that preserves the pointer. Editing a live server leaves it live and marks its draft dirty. Disabling every tool in the draft does not take the live revision offline; publishing requires at least one enabled valid tool, and pausing is the explicit way to remove availability.

Secret material is an operational slot keyed by stable server-value id. Rotation updates encrypted material immediately and does not change revision or contract fingerprints. Structural secret changes—creating a reference, changing kind/owner, moving auth bindings, or removing a reference—are draft changes and require publication. A secret slot referenced by the active revision cannot be deleted. After a later publication removes the active reference, the owner may delete it; historical revisions then remain viewable but cannot be restored to a publish-ready draft without rebinding the missing secret.

This split avoids copying credentials into history while keeping emergency rotation immediate. The trade-off is that a revision proves structure, not the exact credential bytes used at a past instant; security events and timestamps cover material rotation separately.

### 3. Preview publication from a canonical candidate

`previewPublish` builds a candidate from one locked or revision-checked draft snapshot, recompiles every enabled tool, validates all references and publication invariants, derives deterministic contracts/fingerprints, and compares it with the active revision. It returns:

- observed `draftRevision`, active revision id/number, and candidate fingerprint;
- blocking errors and location-aware compiler issues;
- warnings such as an untested connection or a removed/changed agent contract;
- a secret-safe structured diff: server routing/auth category changed, common entries changed, tools added/removed/changed/enabled/disabled, config values changed, and contract fingerprints changed;
- readiness and the warning codes/fingerprint that must be acknowledged.

Diffs never contain config values, secret ids, auth material, binding literals classified sensitive, request/response bodies, or ciphertext. They identify tools by safe name/logical id and changes by category. Connection tests remain explicit external I/O and can produce a warning, but publishing never performs upstream network calls while holding a database transaction.

Preview is advisory. The publish command repeats all validation under the server aggregate lock. Warning acknowledgement is valid only for the exact candidate fingerprint, preventing a changed draft from reusing an older approval.

### 4. Publish through one idempotent aggregate command

`publishServer` accepts `serverId`, `expectedDraftRevision`, `expectedPublishedRevisionId`, a client-generated `publishRequestId`, the preview candidate fingerprint, acknowledged warning codes, and an optional bounded note. Under `withOwnedServerWrite`, it:

1. locks the server and compares draft and published expectations;
2. checks whether the same publish request already committed;
3. rebuilds and validates the complete candidate;
4. rejects mismatched preview/warning acknowledgements;
5. inserts the immutable revision, tool rows, and config rows;
6. atomically switches `publishedRevisionId`, makes a never-published server `live`, and records safe publication telemetry/audit data.

If the same `publishRequestId` and candidate fingerprint are retried after a lost response, the command returns the committed revision. Reusing the id with another candidate is a stable idempotency conflict. Any database/compiler failure rolls back both rows and pointer, leaving the previous runtime active and the draft untouched.

Publication does not clear or rewrite the draft. Because the revision source fingerprint matches, it becomes clean. Subsequent saves increment `draftRevision` and become dirty again.

### 5. Serve and execute only the active published revision

Gateway discovery and execution preparation read `publishedRevisionId`, server operational status, the revision row, its enabled tool rows, the revision's config snapshot, and current referenced secret slots in one repeatable-read snapshot. The database transaction ends before upstream HTTP. The resulting immutable execution object carries revision id/number, aggregate fingerprint, tool fingerprint, and logical tool id.

An in-flight call continues using the revision it materialized when a new pointer commits. A later `tools/list` or call uses the new pointer. The gateway never reads or falls back to mutable draft rows. If an agent calls a removed tool or sends input valid only for an older contract, the safe error includes the current published revision/fingerprint and explicit refresh guidance; the server does not silently execute the old plan.

Contract metadata defined by `improve-agent-tool-contracts` derives its version/fingerprint from the published revision. Publishing the same canonical candidate is prevented as a no-op unless an explicit note-only audit operation is later introduced. Stateless MCP cannot push reliable list-change notifications to every client, so revision metadata and bounded list cache semantics are the consistency mechanism.

Call logs store nullable revision id plus denormalized revision number, aggregate fingerprint, and tool fingerprint. The denormalized identity survives revision retention cleanup. Runtime source tool rows may later be deleted from the draft without affecting published execution or historical call attribution.

### 6. Restore history to the draft, never directly to runtime

Owners can list paginated revision summaries and retrieve a secret-safe detailed revision. `restoreRevisionToDraft` requires the current `expectedDraftRevision`, locks the aggregate, and replaces publishable draft server fields, tool rows, and non-secret config with the selected historical structure. It preserves operational state, tokens, icon, current secret material, and the active published pointer.

Stable logical tool/value ids are reused where safe. Missing secret slots are not recreated; the restored draft records blocking issues and remains editable. Restore is therefore allowed even when not publish-ready, but it never changes agent behavior until a normal preview and publish create a new monotonically numbered revision. This preserves a linear audit history and revalidates against current compiler/security policy.

Directly repointing to an old revision was rejected because it bypasses current validation, can depend on deleted secrets or obsolete compiler schemas, and makes revision order ambiguous.

### 7. Make draft and published testing explicit

The Studio playground has two explicit modes:

- `published`: executes the active revision through the identical gateway execution snapshot and contributes to active-revision health.
- `draft`: compiles/materializes the current draft for owner-only testing, displays the observed `draftRevision`, and never changes or impersonates the published revision.

Draft test logs are labeled with draft source/revision and do not affect production traffic-light health. Platform `test_tool` continues to target the published revision; agent-side draft execution is not added in this change. Platform authoring can call publish preview, while only a PAT with `publish` authority can publish. Revision summary/history requires safe read; restore requires author; detailed secret-backed definitions remain subject to secret-reference policy.

Traffic light is `draft` when no published pointer exists, `paused` on the operational override, and otherwise derives red/yellow/green from calls attributed to the current active revision. A new publication starts with no health history rather than inheriting failures from a superseded contract.

### 8. Retain useful history without unbounded growth

Always retain the active revision and at least the 20 most recent revisions. Superseded revisions older than 90 days may be deleted once they are outside that minimum. Cleanup cascades revision tool/config rows but preserves denormalized call-log attribution. Revision deletion never deletes current secret slots or draft resources.

Retention runs through the existing operational cleanup mechanism or a documented root command. Metrics report revision counts, bytes where available, oldest retained revision, publish failures, and cleanup failures without configuration contents or fingerprints as high-cardinality labels.

## Risks / Trade-offs

- **[Revision storage grows quickly]** -> Normalize tool rows, cap tool count, retain the active plus a bounded recent history, and instrument size/cleanup.
- **[Users may expect Save to be live]** -> Use explicit “Save draft” and “Publish changes” language, persistent dirty badges, and revision identity in both locales.
- **[Draft and runtime can be confused in code]** -> Use distinct types/repositories (`DraftAggregate`, `PublishedExecutionSnapshot`), prohibit gateway imports from draft loaders, and add architecture tests.
- **[Publishing under a server lock recompiles many tools]** -> Keep the 50-tool bound, perform no network I/O, measure compile/lock duration, and reject stale previews rather than publishing precomputed unchecked plans.
- **[Operational secret rotation reduces historical reproducibility]** -> Audit rotation separately, never claim byte-for-byte replay, and keep structural revision fingerprints independent of secret material.
- **[Deleting an active secret becomes more restrictive]** -> Block deletion with explicit active-revision references and provide rotate/pause/republish guidance.
- **[Old agents call stale contracts after publish]** -> Return current revision/fingerprint and refresh guidance; never execute an old revision implicitly.
- **[Existing development servers become unavailable until published]** -> Treat records as disposable drafts, show unpublished status clearly, update seeds, and document reset/reseed or explicit review/publish without adding a runtime fallback.
- **[Active changes define overlapping revisions]** -> Treat atomic `configRevision` as concurrency, `draftRevision` as publishable change sequence, and published revision number as runtime history; document this vocabulary before implementation.

## Migration Plan

1. Complete or reconcile atomic-write and contract-fingerprint foundations; add explicit draft/published terminology to backend agent guidance.
2. Add revision, revision-tool, revision-config, published pointer, draft revision, and call-log identity columns/tables through one generated Drizzle migration. Existing development servers receive no published pointer.
3. Update canonical seeds and fixtures to create unpublished drafts and document reset/reseed for disposable development databases.
4. Switch authoring services, Studio, Platform APIs, gateway discovery, and execution together: writes target drafts, publication creates revisions, and runtime reads only active revision tables.
5. Delete mutable-runtime loaders, fallback branches, dual-write/shadow comparison code, obsolete tests, metrics, and documentation in the same change.
6. Verify empty-database and reset-development-database flows, then explicitly publish fixture servers needed for end-to-end tests.
7. Enable history retention cleanup and monitor publish conflicts/failures, stale-agent errors, snapshot load latency, and storage growth.

If development rollback is required before the migration is shared, revert code and regenerate/reset the database. Once shared, use a forward generated migration. The mutable gateway runtime is never restored as a rollback mechanism.

## Open Questions

- Should a future change support a deliberate “publish empty contract” operation, or should pause remain the only supported way to take a published server offline? This design chooses pause to keep availability intent explicit.
