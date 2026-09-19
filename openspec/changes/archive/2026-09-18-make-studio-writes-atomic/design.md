## Context

The Studio configuration for one MCP server is an aggregate spread across `mcp_server`, `mcp_tool`, `mcp_server_variable`, agent tokens, and compiled request plans. Some service methods already use transactions, but the boundary is inconsistent: ownership and reference reads can occur before a transaction, tool insertion and draft-to-live promotion are separate writes, common-value compilation happens before the transaction, and JSON-held variable references cannot be protected by foreign keys. PostgreSQL `READ COMMITTED` readers can also combine rows from different committed revisions when they issue several queries.

The React Studio and the Platform MCP both call the same service layer, so concurrency includes browser tabs, agent retries, simultaneous agents, and runtime invocations while configuration changes. The tool limit is bounded, making whole-aggregate validation practical. Object storage is a second system and cannot participate in the PostgreSQL transaction.

## Goals / Non-Goals

**Goals:**

- Give every server-scoped mutation one all-or-nothing database commit and one authoritative result.
- Prevent silent lost updates, duplicate retry effects, limit races, dangling JSON references, and stale compiled plans.
- Ensure runtime readers see one committed configuration revision.
- Preserve secret-safe errors, responses, telemetry, and cleanup records.
- Make icon replacement crash-tolerant without holding a database transaction open across S3 calls.

**Non-Goals:**

- Changing MCP tool input/output contracts or upstream execution behavior.
- Replacing PostgreSQL, Drizzle, tRPC, or the existing compiler.
- Providing a distributed transaction between PostgreSQL and S3.
- Replaying plaintext tokens or secrets after a response containing them is lost.
- Automatically changing a live server to draft when its last enabled tool is disabled or deleted; existing lifecycle policy remains unchanged.

## Decisions

### 1. Treat a server as a revisioned write aggregate

Add a non-null `configRevision` to `mcp_server`, initially `1`. Every server-scoped configuration or access mutation accepts `expectedRevision`, locks the owned server row with `SELECT ... FOR UPDATE`, compares the expected value, and either commits all work while incrementing the revision exactly once or returns `MCP_WRITE_CONFLICT` with the current revision and no writes. Server creation starts at revision `1` and relies on the existing owner/slug uniqueness constraint.

A shared `withOwnedServerWrite` command helper will own transaction creation, ownership lookup, lock order, revision comparison, bounded retry for PostgreSQL deadlock/serialization failures, and the final revision increment. Command callbacks receive only the transaction handle and locked aggregate snapshot; they must not fall back to the global database client. Routers remain thin and both Studio and Platform mutations call these commands.

The aggregate-wide revision is intentionally conservative. Independent edits may conflict, but this is preferable to silently combining stale authentication, values, tools, and compiled plans. A retry after an unknown create-tool outcome cannot create a second tool: the old revision conflicts, prompting a read that reveals whether the first command committed.

Alternatives considered:

- Per-row versions allow more parallel editing but do not protect cross-row compilation and JSON references.
- Serializable isolation alone detects some races but does not communicate user intent or prevent last-write-wins after an agent rereads incompletely.
- Idempotency receipts add storage and retention complexity and cannot safely replay one-time plaintext credentials. Revision compare-and-swap covers server-scoped retry ambiguity without persisting sensitive responses.

### 2. Lock first, then validate and mutate through the transaction

All server-scoped commands acquire the server lock before child reads. Capacity counts, uniqueness prechecks, variable-reference checks, lifecycle decisions, confirmation checks, and compilation use the same transaction. All commands use the lock order `user/account -> server -> child rows` when more than one aggregate is involved; a command must never acquire these in reverse order.

Database constraints remain the last line of defense. Existing owner/slug, server/tool-name, and server/value-name uniqueness constraints stay in place. Platform PAT creation, selected-token rotation, and revocation use a user-row lock plus compare-and-swap against the previously observed token identity; hash and active-name constraints protect multiple concurrent PATs without imposing a singleton-active-token invariant. Server-token changes use the server aggregate boundary. Constraint failures are translated to stable `AppError` codes rather than leaking database details.

External network calls, telemetry export, and object deletion never occur while locks are held. Pure validation, encryption, and compilation may run inside the transaction because the server has a bounded maximum number of tools.

### 3. Recompile the complete affected closure before commit

Commands produce an in-memory candidate aggregate, compile its affected enabled tools, and persist the candidate plus compiled plans in the same transaction. The invalidation rules are:

| Change                                                                | Compilation closure                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Tool request definition, bindings, enabled state, or agent parameters | That tool; promotion is evaluated in the same command                                                        |
| Base URL, allowed hosts, authentication, or common entries            | Every enabled tool                                                                                           |
| Variable kind, ownership, or removal                                  | Every enabled tool that references it, plus auth/common validation; recompiling all enabled tools is allowed |
| Variable plaintext/ciphertext rotation with unchanged metadata        | No structural recompile; reference and secret invariants are still validated                                 |
| Description, display name, or icon                                    | No tool recompile                                                                                            |

If any enabled tool in the closure is invalid, the command fails and persists neither the source change nor any compiled plan. Disabled invalid drafts may retain explicit invalid compile diagnostics where existing product behavior allows them. Adding or enabling the first valid tool and promoting a draft server is one commit. This design does not introduce automatic demotion.

Compiler telemetry is buffered and emitted only after commit. A rolled-back candidate never produces authoritative success telemetry.

### 4. Load runtime configuration from one committed snapshot

Gateway listing and invocation preparation will use a read-only `REPEATABLE READ` transaction to load the server, selected or enabled tools, compiled plans, and referenced values. The transaction ends before any upstream HTTP request begins. The resulting immutable execution snapshot carries `configRevision` for diagnostics.

This prevents a runtime request from combining an old server/auth row with a newly committed tool plan or value set. It does not freeze configuration for the duration of the upstream call; that call executes from the already materialized snapshot.

An alternative is to copy every effective value into each compiled plan. That would duplicate encrypted material, increase rotation cost, and weaken the secret boundary, so snapshot loading is preferred.

### 5. Model icon uploads as staged assets with durable cleanup state

Add a user-owned storage-asset record containing the object key, purpose, state (`staging`, `ready`, `attached`, `delete_pending`, `deleted`), timestamps, and safe metadata. The upload endpoint creates `staging` before the S3 `PutObject`, marks it `ready` afterward, and returns an opaque asset id. A crash at either side leaves a state that reconciliation can inspect.

The server stores an asset id rather than accepting an arbitrary access URL for new writes. `setServerIcon` uses the server command transaction to verify owner/purpose/readiness, attach the new asset, detach the previous asset into `delete_pending`, and increment `configRevision`. Clearing or deleting a server follows the same state transition. After commit, a bounded reconciler attempts `DeleteObject` for pending assets and garbage-collects expired staging/ready assets. Failed deletion remains pending for the next opportunistic or operator-triggered reconciliation run.

The new asset reference is the only persisted icon source. The generated migration removes the superseded `iconImage` URL field instead of dual-reading or backfilling it; disposable development icon data may be cleared and reseeded. S3 success never makes an icon visible before the database commit, and S3 cleanup failure never rolls back a committed configuration.

### 6. Define conflict and failure behavior as part of the contract

Successful mutation results include the new `configRevision`. A stale request returns HTTP/tRPC conflict semantics with stable `MCP_WRITE_CONFLICT`, the current revision, and no secret values. The SPA invalidates and reloads the server aggregate, explains that the configuration changed elsewhere in both locales, and preserves unsaved form input where practical. Platform MCP commands expose the same conflict as a structured, recoverable result and direct the agent to reread before deciding whether to retry.

Database failures, compiler failures, and injected failures after any statement roll back the command. Automatic retries are limited to database failures known to have rolled back completely; business conflicts and validation errors are never retried automatically. One-time credential creation responses explicitly remain non-replayable: after an unknown network outcome, the caller must list/revoke and create again rather than expect the plaintext to be returned.

## Risks / Trade-offs

- **[Aggregate locking reduces parallel write throughput]** -> Servers are small, human/agent authoring writes are infrequent, and locks are never held across external I/O. Instrument lock duration and conflict rates.
- **[Recompiling up to the tool limit increases mutation latency]** -> Compile only the invalidation closure where safe, retain the bounded tool cap, and measure compile time separately from lock wait time.
- **[A missed write path could bypass locking]** -> Centralize exported mutations, prohibit direct router writes, add service-contract tests, and document the aggregate invariant in `apps/api/AGENTS.md`.
- **[Runtime snapshot transactions add database work]** -> End them before upstream I/O and select only required rows/columns. Compare latency in integration tests.
- **[Asset cleanup is eventually consistent]** -> Keep durable state, use idempotent deletes, run bounded opportunistic sweeps, and provide an operator command with metrics for oldest pending assets.
- **[Required revisions break stale development clients]** -> Update every first-party caller and Platform tool schema in the same change and reject missing revisions immediately with a clear structured error.
- **[Concurrent token replacement can surprise callers]** -> Use compare-and-swap on the observed active token and let only one replacement commit; never silently invalidate a token created by a losing concurrent request.
- **[Destructive development migration discards old icon URLs]** -> Treat existing records as disposable, document reset/reseed, and verify the clean schema from an empty database rather than retaining a runtime fallback.

## Migration Plan

1. Add `configRevision`, storage-asset state, the server asset reference, multi-PAT-safe uniqueness support, and removal of the superseded icon URL through one generated Drizzle migration.
2. Add aggregate command and execution-snapshot helpers, stable error codes, and tests as the only server-scoped write/read boundary.
3. Move every Studio and Platform write path to the command helpers, including tool, auth, common-entry, variable, token, icon, and server deletion paths; delete direct mutation exports in the same change.
4. Update the SPA and Platform MCP schemas atomically to require revisions, handle conflicts, and use staged asset ids; reject missing or old mutation shapes immediately.
5. Add post-commit telemetry and asset reconciliation, then remove old icon URL helpers, input schemas, tests, and documentation.
6. Verify a database created from migrations and seeds plus a reset development database both use only the new revision and asset contracts.

If development rollback is needed before the migration is shared, revert the code and regenerate the migration or reset the database. Once shared, use a forward generated migration; do not retain dual reads or old mutation handlers.

## Open Questions

- Production scheduling for the asset reconciler is intentionally deferred until the owner declares a deployment model. The pre-production implementation uses bounded post-commit reconciliation plus an explicit root operator command without preserving any legacy icon path.
