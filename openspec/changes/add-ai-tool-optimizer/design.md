## Context

The `add-ai-provider-foundation` change defines encrypted account provider connections, dynamic model selection, the `structured-text-v1` capability profile, and a request-scoped Mastra runtime. This change consumes that runtime to improve MCP tool authoring without making the model an authority over tool state.

MCP tools have a mutable draft, a canonical request definition, a compiler, immutable published revisions, and atomic server write commands. OpenAPI preview is deterministic and write-free, while confirmation reparses the source, verifies its fingerprint, compiles selected candidates, and writes atomically. The optimizer must preserve those boundaries for a single tool, selected tools, all eligible tools, and import candidates. Large servers can contain hundreds of tools, so analysis cannot depend on one HTTP request or in-memory job state.

## Goals / Non-Goals

**Goals:**

- Give owners explicit, scoped AI assistance for agent-facing metadata and bounded request shaping.
- Require authorization before any MCP definition is sent to an external model.
- Treat endpoint documentation as untrusted data and model output as an untrusted proposal.
- Produce durable, inspectable recommendations with before/after diffs and no mutations during analysis.
- Apply only owner-selected operations through canonical validation and one atomic draft command.
- Reuse the same policy and review experience for existing drafts and OpenAPI candidates.
- Make progress, cancellation, partial analysis failures, model usage, and retention truthful.

**Non-Goals:**

- Automatic or scheduled optimization, automatic acceptance, or automatic publication.
- Giving the optimizer tools, MCP execution access, memory, RAG, or upstream network access.
- Executable AI changes to URL paths, HTTP methods, base URLs, allowed hosts, authentication, secrets, headers, mutation permission, enablement, groups, or publication state.
- Adding or deleting request nodes, introducing literals or server-value bindings, or changing input types/constraints/requiredness in the first policy version.
- Repairing deterministically blocked OpenAPI operations or replacing the OpenAPI mapper/compiler.

## Decisions

### 1. Make preflight a persisted authorization plan

The preflight endpoint creates an `ai_tool_optimization_run` in `planned` state plus ordered item identities and fingerprints. It performs no model call. The response shows the exact provider/model selection, scope, eligible/ineligible counts, data categories that will leave rest2mcp, policy version, fields the model can recommend, immutable fields, estimated input/output tokens, and cost when current provider pricing is available. Unknown cost is displayed as unknown rather than zero.

The plan expires after 15 minutes. Authorization is a separate authenticated mutation that records `authorizedAt`, snapshots sanitized item inputs, rechecks the server/model/source fingerprints, and transitions the run to `queued`. A stale or expired plan cannot be authorized. This makes consent auditable and prevents a generic confirmation flag from being replayed against a different scope.

Draft scopes are `single`, `selected`, or `all_eligible`. OpenAPI scope contains the server, document fingerprint, selected operation keys, and candidate fingerprints. One run is bounded by the server's configured tool capacity; processing is divided into smaller model batches rather than rejecting an otherwise valid all-tools scope.

Alternatives considered:

- A client-only confirmation cannot prove which data/model/scope was authorized.
- A signed stateless token avoids a table write but complicates cancellation, audit, expiry, and scope inspection.
- Starting model inference inside the authorization request would be vulnerable to request deadlines and process restarts.

### 2. Persist restart-safe runs and item recommendations

Add `ai_tool_optimization_run` and `ai_tool_optimization_item` tables. A run is owner- and server-scoped and records source kind (`draft` or `openapi`), state, scope, policy/prompt/profile/model fingerprints, expected server revisions, source fingerprint, counts, estimates, normalized usage, lease metadata, cancellation state, timestamps, and a stable error code. Items identify a draft tool or OpenAPI operation, retain only a sanitized before snapshot and fingerprint, and store normalized patch operations, advisory findings, validation previews, status, and any applied draft revision.

Run states are `planned`, `queued`, `running`, `completed`, `completed_with_errors`, `failed`, `cancel_requested`, `cancelled`, and `expired`. Item states are `queued`, `running`, `recommended`, `no_change`, `failed`, `cancelled`, `applied`, and `rejected`. Raw prompts, raw model responses, raw OpenAPI documents, credentials, and secret identities are never persisted.

Planned/failed/cancelled runs and completed recommendation history use bounded retention, initially 30 days. Account or server deletion cascades the records. Applied item records retain the tool ID and resulting draft revision until retention so the review can attribute the assisted change without modifying agent-visible tool contracts.

### 3. Use a PostgreSQL lease worker instead of an in-request job

A bounded worker loop runs with the API service and claims queued or expired-lease runs using `FOR UPDATE SKIP LOCKED`. Claims have a worker ID, lease expiry, heartbeat, and bounded attempt count. A crashed worker leaves no MCP mutation; another process can resume unprocessed items after the lease expires. Multiple API instances may work safely without Redis or BullMQ.

The worker packs sanitized items deterministically into batches capped by item count and a conservative fraction of the selected model's verified context window. It checks cancellation between batches and aborts an in-flight provider call when supported. It may retry the same read-only batch for a bounded transient provider failure, but never changes model, provider, scope, policy, or authority automatically. Per-item schema/analysis failures produce `completed_with_errors` when other items succeed.

Clients poll a paginated status/result API; WebSockets are unnecessary. A bounded reconciler expires abandoned plans, recovers expired leases, marks exhausted runs failed, and deletes retained history.

Alternatives considered:

- An in-memory promise loses state on restart and cannot coordinate multiple processes.
- Holding the browser request open is unsuitable for hundreds of tools and provider throttling.
- Adding a separate queue service is unnecessary while PostgreSQL can provide the required bounded lease semantics.

### 4. Sanitize inputs before authorization and model execution

One pure sanitizer converts either a persisted draft tool or deterministic OpenAPI candidate into `OptimizerToolSnapshotV1`. It includes stable local node IDs, current agent-facing names/descriptions, source kind, HTTP method, normalized path template, query/body field names and locations, input names/types/required flags/descriptions, array/query serialization, omission behavior, and stable compile/import issue codes needed for review.

It excludes base URLs, source URLs, allowed hosts, common headers/query, authentication configuration, all literal values, server-value/secret IDs, examples that may contain credentials, raw body templates, raw OpenAPI documents, and provenance labels. Header construction is summarized only as an immutable presence indicator and is not patchable. Sensitive inputs retain only type/location and a `sensitive` marker; their name and description are not sent.

The authorization screen is produced from the same snapshot schema the worker will send. Snapshot byte size, node count, and text lengths are bounded. Oversized or unparseable tools are marked ineligible instead of silently truncated. Existing compile issues remain data, not instructions.

### 5. Run a tool-free, versioned Mastra workflow

The optimizer uses the owner's verified `structured-text-v1` selection through `AiRuntimeService`. A versioned system prompt instructs the model to treat snapshots as quoted untrusted data, ignore embedded instructions, return only the strict recommendation schema, and never infer secret values. The Mastra workflow has no registered tools, memory, MCP client, retrieval source, or arbitrary network access.

Each result is parsed through a strict Zod schema and correlated to the batch's stable item/node IDs. Unknown fields, unknown targets, duplicate operations, unsupported operation kinds, out-of-bounds text, or model references to another item are rejected. The raw response is discarded after normalization. A bounded schema-repair attempt may ask the same model to re-emit valid structure but cannot broaden the patch policy.

Model and prompt fingerprints are captured when the plan is authorized. If the selected model readiness fingerprint changes before the worker claim, the run fails rather than silently using the replacement model.

### 6. Enforce a versioned three-class recommendation policy

`AI_TOOL_OPTIMIZATION_POLICY_V1` defines typed operations, not arbitrary JSON Patch.

Safe metadata operations are:

- Set tool name, title, or description.
- Set a non-sensitive agent input name or description while preserving its stable ID.

Guarded request-shaping operations are limited to existing canonical nodes:

- Set an existing query entry key, supported serialization, or `omitWhenAbsent` when its bound input is already optional.
- Rebind an existing query entry or JSON binding node to an existing non-sensitive agent input.
- Set an existing JSON object field key or optional omission flag.

Guarded operations cannot add/delete nodes, alter path segments, target headers/raw bodies/form fields, introduce literals/server values, reference sensitive inputs, or change input type, constraints, requiredness, method, or path. Every guarded operation produces a redacted effective-request diff and passes full definition parsing, ownership/security validation, and compilation.

Advisory findings can mention suspected issues outside the executable surface, including a possibly wrong path/method, missing parameter, type mismatch, auth concern, mutation classification, or unsupported restructuring. They contain bounded rationale and suggested manual review but no machine-applicable value. Immutable fields are omitted from the model's patch schema, and the server rejects them even if a provider returns extra data.

This policy supports useful query/body review without allowing the model to redefine endpoint identity or security. Later policy versions can expand only through an explicit spec change.

### 7. Build review artifacts on the server and perform no scan-time writes

After normalization, the server applies each valid operation to the captured snapshot in memory and produces field-level before/after values, severity/classification, rationale, compile results, and a redacted effective-request diff. The UI groups these by tool, separates advisory findings, and lets the owner select individual executable operations. Invalid recommendations are displayed as rejected diagnostics, never hidden or applied.

Analysis does not update `mcp_tool`, server revisions, OpenAPI candidates, or published revisions. Rejecting recommendations only changes optimization-item review metadata. No provider call occurs while reviewing or applying.

### 8. Apply selected draft patches atomically through the server aggregate

Draft application accepts a completed run, selected operation IDs, the observed server configuration/draft revisions, and an idempotency key. Inside `withOwnedServerWrite`, it locks the owned server, verifies the run/item ownership and original tool fingerprints, reapplies the current policy to the selected operations, parses and compiles every resulting tool, checks cross-tool name uniqueness, and writes all selected recommendations or none.

One successful batch increments `configRevision` and `draftRevision` exactly once. The item application markers and resulting revision commit in the same transaction. If any tool changed since authorization, any selected operation is invalid, or any compilation/security check fails, the command rolls back without rebasing or partially applying. Repeating the same idempotency key returns the committed result.

AI application only changes mutable draft rows. It cannot enable a tool, grant mutation permission, alter authentication, update the active published revision, or publish. The ordinary publication review remains the sole route to agent-visible behavior.

### 9. Apply import recommendations only within normal confirmation

OpenAPI optimization begins only from selectable deterministic candidates. Preflight reparses/refetches the source, confirms its document fingerprint, creates sanitized snapshots for selected operation keys, and stores no raw source. Blocked operations remain blocked and cannot be made selectable by AI.

Import confirmation is extended with an optional completed optimization run and selected operation IDs. It reparses the source as usual, verifies the same document/server/candidate fingerprints and run ownership, applies policy-valid operations in memory, then performs the existing name, capacity, group, compile, and atomic write checks. Owner-entered final tool name overrides an accepted AI name operation; other manual changes after optimization require a new review. Recommendation application and tool creation commit together, so no optimization state can create a partial import.

Method, path, security, origin, provenance, and deterministic diagnostics always come from the importer. AI cannot remove warnings/errors, alter source provenance, or bypass confirmation.

### 10. Keep audit and observability content-safe

Telemetry and persisted usage may include run ID, source kind, scope/counts, policy/prompt versions, provider kind, public model ID, token counts, estimated/actual cost when available, latency, normalized outcome, accepted operation classes, and resulting draft revision. They exclude sanitized snapshots themselves, endpoint paths, descriptions, prompts, outputs, credentials, secret metadata, request bodies, and raw provider diagnostics.

The UI provides English/Spanish parity for authorization, progress, cancellation, partial failure, recommendation classes, immutable-field explanations, stale conflicts, and apply results. Cost estimates are clearly labeled estimates; missing pricing is shown as unavailable.

## Risks / Trade-offs

- **Prompt injection in endpoint descriptions** → Serialize descriptions as bounded untrusted data, register no tools/memory, use strict output schemas, and enforce policy entirely after generation.
- **Model suggests a plausible but behavior-breaking query/body change** → Mark request shaping as guarded, show effective-request diffs, require per-operation approval, and run canonical compilation/security checks.
- **Owner authorizes one snapshot but the draft changes later** → Fingerprint plans/items and fail authorization or apply on revision/tool drift; never silently rebase.
- **Large all-tools scans create cost or throttling** → Show estimates before authorization, batch below context limits, cap concurrency/retries, support cancellation, and preserve partial results.
- **Worker crash duplicates inference** → Lease items and make recommendation persistence idempotent; duplicate read-only inference is possible after an uncertain crash but can never duplicate an MCP mutation.
- **PostgreSQL polling adds load** → Use indexed states, bounded claim intervals, leases, and one compact status query; no busy loop.
- **Cost metadata is incomplete** → Show token estimates and unknown price honestly; never invent a zero-cost estimate.
- **Recommendation history contains API structure** → Store only sanitized bounded snapshots, enforce owner scope and retention, cascade on account/server deletion, and exclude content from telemetry.
- **OpenAPI source changes after optimization** → Recompute document and candidate fingerprints at confirmation and reject the run without importing.

## Migration Plan

1. Implement and validate `add-ai-provider-foundation` before enabling optimizer routes or controls.
2. Add optimization run/item schemas and generate one migration with state/index/retention constraints.
3. Add sanitizer, policy, prompt/output contracts, worker leasing, Mastra workflow, validation/diff services, and retention reconciler.
4. Add draft and OpenAPI preflight/authorization/status/cancel/apply APIs.
5. Add Studio/OpenAPI controls, authorization and progress dialogs, comparison UI, readiness gating, and localized copy.
6. Run security, concurrency, worker-recovery, compiler, import, and end-to-end quality gates before exposing the feature.

There is no backfill. Existing tools remain unchanged and optimization is opt-in. Rollback first disables worker claims and UI entry points; previous code ignores the new tables. Removing retained recommendation data requires an explicitly authorized generated migration or the normal retention reconciler.

## Open Questions

- Should the default retention remain 30 days for applied recommendations, or should applied provenance use a longer bounded period once production data-retention policy is defined?
- Should future policy versions allow adding/removing request nodes, or keep structural discovery permanently advisory-only?
