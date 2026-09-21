## ADDED Requirements

### Requirement: Optimization requires an exact authorized plan

The system SHALL create a write-free, expiring optimization plan before any tool data is sent to a model, and SHALL require the owner to authorize that exact plan before queueing analysis.

#### Scenario: Preflight exposes exact disclosure

- **WHEN** the owner requests preflight for one tool, selected tools, all eligible tools, or selected OpenAPI candidates
- **THEN** the system reports provider/model, scope, eligible and ineligible counts, disclosed data categories, policy version, mutable and immutable fields, token estimates, and available cost estimates without calling the model

#### Scenario: Pricing is unavailable

- **WHEN** current provider metadata cannot produce a reliable cost estimate
- **THEN** preflight labels cost as unavailable rather than zero or free

#### Scenario: Verified model is missing

- **WHEN** the account has no current `structured-text-v1` selection
- **THEN** preflight returns a configuration-required state and no optimization run can be authorized

#### Scenario: Owner authorizes current plan

- **WHEN** the owner confirms an unexpired plan whose server, source, scope, and model fingerprints remain current
- **THEN** the system records authorization, snapshots sanitized inputs, and queues the run

#### Scenario: Plan expires or drifts

- **WHEN** authorization is attempted after plan expiry or after a referenced server, tool, source, or model fingerprint changes
- **THEN** the system rejects authorization without sending data to the model

### Requirement: Model inputs are bounded and secret-safe

The system SHALL build model inputs from a versioned sanitized snapshot and SHALL exclude credentials, secret identities, literal values, provider configuration, raw sources, and unrestricted request content.

#### Scenario: Draft tool is sanitized

- **WHEN** an eligible draft tool is authorized for analysis
- **THEN** the snapshot contains bounded agent-facing metadata, method and normalized path shape, non-secret input/query/body structure, serialization, omission behavior, and stable issue codes but excludes base URL, hosts, auth, values, server-value IDs, source URLs, and raw templates

#### Scenario: Sensitive input is represented minimally

- **WHEN** a tool contains an input marked sensitive
- **THEN** the snapshot includes only the minimum type/location and sensitive marker needed for structural context and excludes its name, description, examples, bindings, and values

#### Scenario: OpenAPI source remains absent

- **WHEN** selected OpenAPI candidates are authorized
- **THEN** the system sends only their deterministic sanitized candidate snapshots and never sends or persists the raw OpenAPI document

#### Scenario: Oversized tool is ineligible

- **WHEN** a snapshot would exceed configured byte, node, or text limits
- **THEN** the tool is reported as ineligible and its content is not silently truncated or sent

#### Scenario: Endpoint text contains prompt instructions

- **WHEN** a description or field name contains text instructing the model to ignore policy or perform an action
- **THEN** the workflow treats that text as untrusted data, exposes no tools or memory, and accepts only policy-valid structured recommendations

### Requirement: Optimization runs are durable and cancellable

The system SHALL persist owner-scoped run and item state, process queued work through bounded PostgreSQL leases, and expose paginated progress and results.

#### Scenario: Large scan progresses asynchronously

- **WHEN** the owner authorizes an all-eligible run
- **THEN** the API returns promptly while a bounded worker processes deterministic batches and status reports queued, running, completed, failed, and total item counts

#### Scenario: Worker lease expires

- **WHEN** a worker stops heartbeating before finishing a run
- **THEN** another worker may claim the expired lease and resume unprocessed items without applying any MCP change

#### Scenario: Owner cancels a run

- **WHEN** the owner requests cancellation of a planned, queued, or running run
- **THEN** no new batch starts, an in-flight call is aborted when possible, unfinished items become cancelled, and existing recommendations remain reviewable until retention

#### Scenario: Some items fail

- **WHEN** one or more items fail normalization or model analysis while other items succeed
- **THEN** the run completes with errors and preserves successful recommendations plus stable per-item failure codes

#### Scenario: Selected model changes before processing

- **WHEN** the authorized model-readiness fingerprint is no longer current when a worker claims the run
- **THEN** the run fails without silently selecting another model or sending a batch

#### Scenario: Transient batch failure is retried

- **WHEN** a model batch fails with a classified transient error within the retry budget
- **THEN** the worker may retry the same model, scope, prompt, and authority but cannot broaden or substitute them

### Requirement: Recommendation policy is typed and fail-closed

The system SHALL parse model output into versioned typed operations and SHALL reject any unknown operation, target, field, cross-item reference, or out-of-bounds value.

#### Scenario: Safe metadata operation is accepted

- **WHEN** the model proposes a bounded tool name, title, description, or non-sensitive input name/description targeting a stable existing ID
- **THEN** the operation is classified as safe and proceeds to collision and canonical validation

#### Scenario: Guarded request-shaping operation is accepted

- **WHEN** the model proposes an allowed change to an existing query key/serialization/optional omission, JSON field key/optional omission, or existing non-sensitive input binding
- **THEN** the operation is classified as guarded and proceeds to security, compiler, and effective-request diff validation

#### Scenario: Structural addition is advisory only

- **WHEN** the model identifies a missing request parameter, node, literal, server value, or type/requiredness change
- **THEN** the system records a bounded advisory finding and creates no executable operation

#### Scenario: Immutable identity or security change is attempted

- **WHEN** model output attempts to change path, method, base URL, host, headers, authentication, secrets, mutation permission, enablement, group, or publication state
- **THEN** strict parsing or policy validation rejects it and no machine-applicable value is retained

#### Scenario: Recommendation references another item

- **WHEN** one item output targets a tool or canonical node outside its authorized snapshot
- **THEN** that recommendation is rejected without affecting the referenced item

### Requirement: Recommendations are reviewable before mutation

The system SHALL generate server-owned review artifacts with field-level before/after values, recommendation class, rationale, canonical validation, and redacted effective-request differences before allowing application.

#### Scenario: Completed run has no draft side effects

- **WHEN** a run finishes with recommendations
- **THEN** no MCP tool, server revision, published revision, or import candidate has changed

#### Scenario: Owner reviews executable operations

- **WHEN** the owner opens a completed item
- **THEN** the UI can display every valid safe or guarded operation with its before/after value and allow individual selection

#### Scenario: Owner reviews advisory findings

- **WHEN** an item contains a suspected immutable or unsupported structural issue
- **THEN** the UI displays it separately as manual review guidance with no apply control

#### Scenario: Invalid model recommendation is visible

- **WHEN** a returned operation fails schema, policy, compiler, collision, or security validation
- **THEN** the review records a stable rejected diagnostic and never presents the operation as selectable

### Requirement: Selected recommendations apply atomically to the draft

The system SHALL apply owner-selected operations through one owner-scoped server write command that rechecks run ownership, policy version, source fingerprints, server revisions, canonical schemas, compiler output, security invariants, and cross-tool uniqueness.

#### Scenario: Current selected operations apply

- **WHEN** the owner applies valid selected operations against unchanged tools and current server revisions
- **THEN** every selected tool update and application marker commits atomically while server `configRevision` and `draftRevision` each increment exactly once

#### Scenario: One selected operation is invalid

- **WHEN** any selected operation fails current policy, parsing, compilation, security, or name uniqueness
- **THEN** the command rolls back every selected tool and application marker

#### Scenario: Tool changed after authorization

- **WHEN** any selected tool fingerprint or server revision differs from the authorized snapshot
- **THEN** application fails with stale guidance and does not rebase or partially apply recommendations

#### Scenario: Apply request is retried

- **WHEN** the owner repeats an already committed application with the same idempotency key
- **THEN** the system returns the original committed result without incrementing revisions again

#### Scenario: Published behavior remains unchanged

- **WHEN** recommendations are applied successfully
- **THEN** only the mutable draft changes and active agents continue using the prior immutable published revision until ordinary publication

### Requirement: Optimization history and observability are bounded

The system SHALL retain optimization plans, recommendations, usage, and applied attribution for a bounded period and SHALL keep operational telemetry free of endpoint content and secrets.

#### Scenario: Retention expires a run

- **WHEN** a run passes the configured retention deadline and is not actively leased
- **THEN** the reconciler removes the run and its item history without changing any MCP tool or published revision

#### Scenario: Account or server is deleted

- **WHEN** an owning account or server is deleted
- **THEN** its optimization runs and items are removed through ownership cascades

#### Scenario: Usage metadata is recorded

- **WHEN** a model batch completes
- **THEN** the system may record provider/model identity, versions, token counts, estimates, actual cost when available, latency, and normalized outcome without prompts, outputs, snapshots, endpoint paths, descriptions, credentials, or raw errors
