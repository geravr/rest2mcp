## 1. Prerequisites and Shared Contracts

- [ ] 1.1 Confirm `add-ai-provider-foundation` is implemented and quality-gated, including `structured-text-v1`, request-scoped Mastra resolution, readiness fingerprints, and provider usage metadata.
- [ ] 1.2 Consult current Mastra workflow and structured-output documentation through Context7/official sources before choosing the bounded generation, cancellation, and usage APIs.
- [ ] 1.3 Define shared optimizer limits, run/item states, source/scope kinds, policy/prompt versions, readiness/error codes, and strict tRPC schemas without leaking Mastra or database types into clients.
- [ ] 1.4 Define `OptimizerToolSnapshotV1`, typed safe/guarded operations, advisory findings, rejected diagnostics, review diffs, progress projections, and paginated result contracts with bounded fields.

## 2. Persistence and Migration

- [ ] 2.1 Add owner/server-scoped `ai_tool_optimization_run` and `ai_tool_optimization_item` Drizzle schemas with state checks, fingerprints, estimates/usage, lease fields, idempotency, retention timestamps, application attribution, cascades, and claim/query indexes.
- [ ] 2.2 Export the schemas and generate one Drizzle migration; add database invariant tests for states, ownership, uniqueness, cascades, and lease/retention indexes.
- [ ] 2.3 Implement owner-scoped run/item repositories for planned creation, authorization transition, pagination, progress aggregation, cancellation, recommendation persistence, rejection, and application markers.
- [ ] 2.4 Add repository tests proving raw prompts, raw model output, raw OpenAPI sources, credentials, secret IDs, and unrestricted provider errors cannot be stored in optimizer rows.

## 3. Sanitization, Fingerprints, and Preflight

- [ ] 3.1 Implement deterministic draft-tool and OpenAPI-candidate fingerprints over the exact fields relevant to optimization while preserving existing document/server fingerprints.
- [ ] 3.2 Implement the pure snapshot sanitizer with stable canonical IDs, sensitive-input minimization, header presence summaries, raw-template/value/provenance exclusion, and byte/node/text bounds.
- [ ] 3.3 Add sanitizer security fixtures for server values, auth-owned bindings, literal credentials, sensitive inputs, source URLs, raw templates, adversarial descriptions, deep JSON, arrays, and oversized tools.
- [ ] 3.4 Implement draft preflight for single, explicit selected, and all-eligible scopes using the full owned server set rather than the current paginated/search result.
- [ ] 3.5 Implement OpenAPI preflight that reparses/refetches the source, verifies document/server/candidate fingerprints, accepts only selectable operation keys, and stores no raw document.
- [ ] 3.6 Implement deterministic token estimation and provider-pricing cost projection with an explicit unknown-price state and no claim of zero cost.
- [ ] 3.7 Implement planned-run expiry and authorization transition that rechecks scope, revisions, source/model fingerprints, snapshots sanitized inputs, records consent, and queues atomically.
- [ ] 3.8 Add preflight/authorization tests for missing AI readiness, ineligible items, declined/no authorization, expired plans, draft drift, source drift, model drift, and exact disclosure fields.

## 4. Recommendation Policy and Validation

- [ ] 4.1 Implement `AI_TOOL_OPTIMIZATION_POLICY_V1` as an exhaustive operation registry with safe, guarded, advisory-only, and forbidden field classification.
- [ ] 4.2 Implement strict model-output parsing that rejects unknown fields/operations, duplicate IDs, unknown or cross-item targets, sensitive targets, and out-of-bounds values.
- [ ] 4.3 Implement the in-memory patch engine for allowed metadata, existing query, and existing JSON-node operations while preserving canonical IDs and all immutable fields.
- [ ] 4.4 Implement advisory normalization for suspected path/method/auth/host/header/secret/mutation/enablement/publication issues without retaining machine-applicable values.
- [ ] 4.5 Integrate canonical request-definition parsing, server-value ownership/security validation, compiler execution, tool-name collision checks, and redacted effective-request diff generation for every executable operation.
- [ ] 4.6 Add policy tests for every allowed operation and for forbidden path, method, base URL, allowed host, header, auth, secret, literal, node addition/deletion, type, requiredness, annotation, mutation, enablement, group, and publication attempts.
- [ ] 4.7 Add validation tests proving one invalid operation is recorded as rejected and cannot contaminate valid recommendations for the same or another item.

## 5. Mastra Optimization Workflow

- [ ] 5.1 Create the versioned optimizer system prompt and batch input/output schemas that treat all endpoint text as quoted untrusted data and request only typed policy operations and bounded advisories.
- [ ] 5.2 Implement deterministic batch packing by item count and conservative verified context-window budget without splitting one item or silently truncating content.
- [ ] 5.3 Implement the tool-free, memory-free Mastra workflow through `AiRuntimeService`, including model/prompt fingerprint checks, abort signals, token limits, deadlines, normalized usage, and raw-response disposal.
- [ ] 5.4 Implement one bounded schema-repair attempt using the same model, scope, prompt policy, and authority, followed by stable failure if output remains invalid.
- [ ] 5.5 Convert normalized model output into server-owned review artifacts with per-operation before/after values, class, rationale, rejected diagnostics, compile results, and redacted effective-request differences.
- [ ] 5.6 Add workflow tests for prompt injection text, fabricated IDs, cross-item references, unsupported fields, malformed output, repair success/failure, cancellation, context bounds, and absence of registered tools, memory, retrieval, or MCP clients.

## 6. Durable Worker and Retention

- [ ] 6.1 Implement indexed `FOR UPDATE SKIP LOCKED` run claims with worker identity, lease expiry, heartbeat, bounded attempt count, and idempotent item transitions.
- [ ] 6.2 Implement batch processing with bounded concurrency, progress aggregation, same-authority transient retry, per-item persistence, partial-success completion, and model-fingerprint fail-closed behavior.
- [ ] 6.3 Implement cancellation checks between batches plus best-effort abort of in-flight provider calls while preserving already completed recommendations.
- [ ] 6.4 Implement lease recovery so a replacement worker resumes only unfinished items and can never apply MCP draft changes.
- [ ] 6.5 Implement the bounded reconciler for expired plans, exhausted leases, terminal-state cleanup, and 30-day recommendation retention, with dry-run/summary support where appropriate.
- [ ] 6.6 Wire worker and reconciler lifecycle into API startup/shutdown with configurable bounded polling/concurrency and no busy loop or unhandled background rejection.
- [ ] 6.7 Add database integration tests for competing workers, lease expiry, crash recovery, duplicate uncertain inference persistence, cancellation races, partial failure, retention, and account/server cascades.

## 7. Optimization Services and API

- [ ] 7.1 Implement owner-scoped services for run inventory, detail, paginated items, preflight, authorization, cancellation, and review selection with stable secret-safe `AppError` codes.
- [ ] 7.2 Add thin authenticated tRPC procedures with strict schemas for draft and OpenAPI preflight, authorize, status, list items, cancel, reject, and apply actions.
- [ ] 7.3 Implement atomic draft application through `withOwnedServerWrite`, including run/item ownership, expected config/draft revisions, original tool fingerprints, current policy revalidation, all-tool compilation, and one draft/config revision increment.
- [ ] 7.4 Add application idempotency so a repeated committed key returns the original revision/result and a reused key with different operations fails closed.
- [ ] 7.5 Commit optimizer application markers in the same draft transaction and prove failure cannot leave tools changed without attribution or attribution without tool changes.
- [ ] 7.6 Add service tests for foreign/missing runs, stale tools, stale server revisions, changed policy, duplicate names, compile/security failure, empty selection, atomic rollback, immutable published revision, and no provider calls during review/apply.

## 8. OpenAPI Confirmation Integration

- [ ] 8.1 Extend OpenAPI optimization contracts with candidate fingerprints, optional completed run identity, and selected recommendation operation IDs while retaining strict payload bounds.
- [ ] 8.2 Recompute the source document and candidate definitions during confirmation, verify run ownership/source/model/policy fingerprints, and reject stale or blocked candidates before writes.
- [ ] 8.3 Apply accepted candidate operations in memory, then run existing owner-name override, capacity, group, security, canonical compile, provenance, and atomic import validation in the established order.
- [ ] 8.4 Commit tool/group creation and optimizer application markers together so optimized import remains all-or-nothing and draft-only.
- [ ] 8.5 Add OpenAPI integration tests for selectable-only optimization, raw-source non-persistence, owner name precedence, document/candidate drift, blocked-operation preservation, immutable method/path/security/provenance, capacity races, compile failure, and published isolation.

## 9. Studio Optimization Experience

- [ ] 9.1 Add readiness-gated optimization actions for one tool, explicit row selection, and all eligible server tools without conflating all-tools scope with the visible page or search filter.
- [ ] 9.2 Build the preflight authorization dialog showing provider/model, exact scope, eligibility, disclosed data, mutable/immutable fields, token/cost estimates, unknown pricing, expiry, and explicit authorize/cancel actions.
- [ ] 9.3 Build restart-safe queued/running progress with polling, counts, current state, cancellation, partial failures, and navigation/reload recovery.
- [ ] 9.4 Build the grouped recommendation comparator with individual safe/guarded operation selection, old/new values, guarded effective-request diffs, rejected diagnostics, advisory-only findings, and select-all-safe controls.
- [ ] 9.5 Implement atomic apply feedback, stale-conflict preservation, query invalidation, refreshed compile/publication state, and truthful saved-to-draft messaging.
- [ ] 9.6 Add Studio component/hook tests for no AI configuration, single/selected/all scopes, ineligible tools, declined/expired authorization, progress recovery, cancellation, partial results, operation selection, guarded warnings, stale apply, and successful draft-only application.

## 10. OpenAPI Import Optimization Experience

- [ ] 10.1 Add an optional readiness-gated optimize action for currently selected selectable candidates without blocking normal deterministic preview/import when AI is unavailable.
- [ ] 10.2 Reuse the authorization/progress/review components with OpenAPI-specific candidate identity, blocked-operation explanations, raw-source disclosure guarantees, and source-fingerprint status.
- [ ] 10.3 Preserve owner final-name editing after AI review and include the completed run plus selected operation IDs only in the explicit confirmation request.
- [ ] 10.4 Add import UI tests for unavailable AI, selected-candidate scope, blocked candidates, authorization cancellation, partial recommendations, advisory-only immutable concerns, owner name precedence, stale source, and atomic confirmation failures.

## 11. Localization, Security, and Observability

- [ ] 11.1 Add English and Spanish copy for readiness, authorization, disclosure, estimates, progress, cancellation, partial failures, recommendation classes, immutable advisories, stale conflicts, rejection reasons, apply results, and retention with locale-parity tests.
- [ ] 11.2 Add security regression tests proving credentials, secret IDs, values, base/source URLs, allowed hosts, auth, raw documents, raw prompts/responses, endpoint paths/descriptions, and provider diagnostics never enter unauthorized API responses, telemetry, or logs.
- [ ] 11.3 Add telemetry and usage tests for allowed run/model/version/count/token/cost/latency/outcome fields and verify content-bearing fields are sanitized or rejected.
- [ ] 11.4 Add an adversarial end-to-end fixture whose descriptions request secret disclosure, policy bypass, path mutation, tool execution, and publication; prove the result is either a bounded advisory or rejected operation with no side effect.
- [ ] 11.5 Document the authorization disclosure, recommendation classes, immutable fields, draft-only application, cancellation, retention, and possible provider cost in human-facing onboarding.

## 12. Verification

- [ ] 12.1 Run focused unit and integration tests for schemas, sanitizer, policy, Mastra workflow, worker leases, services, draft application, OpenAPI confirmation, Studio, import UI, and locale parity.
- [ ] 12.2 Run `bun typecheck`, `bun lint`, and `bun test` from the repository root and resolve every touched-slice failure.
- [ ] 12.3 Run `bunx prettier --write .` as the final formatting step, then rerun typecheck, lint, and focused tests affected by formatting.
- [ ] 12.4 Run strict OpenSpec validation for `add-ai-tool-optimizer` and reconcile the implementation with every requirement scenario before requesting the quality gate.
