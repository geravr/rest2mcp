## 1. Change Coordination and Security Baseline

- [ ] 1.1 Reconcile `make-studio-writes-atomic` by removing its single-active-Platform-token constraint while preserving user-locked per-token rotation and revocation atomicity.
- [ ] 1.2 Confirm the implementation order with `improve-agent-tool-contracts` and define one shared Platform tool registry shape for contract and authorization metadata.
- [ ] 1.3 Add a checked-in scope-to-operation matrix covering every existing Platform MCP tool, dynamic publish checks, resource extraction, and risk tier.
- [ ] 1.4 Add canonical policy-version, scope, dependency, risk, PAT-count, TTL, retention, and rate-limit constants to `packages/core` or the API policy module without duplicating SPA constants.
- [ ] 1.5 Add stable error codes and safe detail shapes for invalid grant composition, step-up required/expired, PAT limit, policy conflict, and resource denial.

## 2. Token Grant and Security-Event Persistence

- [ ] 2.1 Extend the agent-token schema with Platform policy version, resource mode, rotation linkage, and lifecycle metadata while leaving server-token rows compatible.
- [ ] 2.2 Add normalized Platform PAT scope rows with scope constraints, uniqueness, and cascading token ownership.
- [ ] 2.3 Add normalized selected-server grant rows with token/server uniqueness and cascades that cannot promote a token to account-wide mode.
- [ ] 2.4 Add active-name and token-hash uniqueness plus indexes for owner inventory, authentication, expiration, and revocation queries.
- [ ] 2.5 Add session-bound, expiring, single-use Platform step-up grant storage with an exact authorization-request fingerprint.
- [ ] 2.6 Add the owner-scoped Platform security-event schema, safe metadata type, indexes, and 90-day retention fields.
- [ ] 2.7 Generate one Drizzle migration for the schema changes and inspect it without hand-editing generated SQL.
- [ ] 2.8 Add schema tests for normalized grant integrity, policy/resource consistency, cascades, token uniqueness, step-up consumption, and security-event ownership.

## 3. Grant Validation and Platform Principal

- [ ] 3.1 Implement canonical scope sorting, deduplication rejection, dependency validation, high-risk classification, and grant fingerprinting.
- [ ] 3.2 Implement resource-mode validation for non-empty selected grants and account-wide grants without selected rows.
- [ ] 3.3 Implement `PlatformPrincipal` as an immutable validated value containing token, user, scopes, resource boundary, policy version, and expiration.
- [ ] 3.4 Split Platform PAT authentication from server-token authentication so each path validates only its own authoritative storage and audience.
- [ ] 3.5 Load normalized scopes and server grants during Platform authentication and fail uniformly for malformed, unknown-version, expired, revoked, or legacy principals.
- [ ] 3.6 Throttle `lastUsedAt` persistence to avoid a database write on every MCP protocol request without losing useful owner activity data.
- [ ] 3.7 Add table-driven tests for every valid/invalid scope combination, resource mode, policy version, expiration, revocation, and server-token rejection.
- [ ] 3.8 Add tests proving malformed grants never fall back to legacy JSON scopes or broaden access.

## 4. Multiple PAT Lifecycle and Step-Up

- [ ] 4.1 Replace singleton token metadata retrieval with paginated owner-scoped PAT inventory including grants, safe prefix, timestamps, and rotation relationships.
- [ ] 4.2 Implement low-risk PAT creation with required name, read-only default, active-token cap, bounded TTL, immutable grants, and one-time raw response.
- [ ] 4.3 Consult current Better Auth Email OTP documentation and implement a session-bound step-up challenge without exposing OTP verification to Platform MCP.
- [ ] 4.4 Issue short-lived single-use step-up grants only after successful OTP verification and bind them to the exact canonical grant fingerprint.
- [ ] 4.5 Require and atomically consume matching step-up grants for account-wide, publish, invoke-mutation, secret-reference, or destructive PAT creation.
- [ ] 4.6 Implement target-specific PAT rotation under a user-row lock, atomically creating successor grants, revoking the predecessor, and recording the event.
- [ ] 4.7 Implement target-specific PAT revocation under the user-row lock without affecting unrelated PATs.
- [ ] 4.8 Enforce 90-day low-risk and 30-day high-risk maximum TTLs with 30-day and 7-day defaults respectively.
- [ ] 4.9 Add transaction failure-injection tests for PAT creation, scope rows, server grants, step-up consumption, event insertion, rotation, and revocation.
- [ ] 4.10 Add concurrency tests for active-token limits, same-name issuance, double step-up consumption, concurrent rotation, and rotate-versus-revoke.
- [ ] 4.11 Add tests proving raw PATs appear only in successful creation/rotation responses and never in rows, errors, telemetry, or event metadata.

## 5. Centralized Authorization Registry

- [ ] 5.1 Extend the centralized Platform tool contract with required scopes, risk tier, resource argument metadata, and optional dynamic policy evaluation.
- [ ] 5.2 Add a registry completeness assertion so every registered Platform tool has contract, output, behavior, and authorization metadata.
- [ ] 5.3 Implement one policy evaluator for static scope dependencies, account-versus-selected resources, and safe insufficient-scope details.
- [ ] 5.4 Filter `tools/list` from the authenticated principal through the registry while retaining deterministic contract ordering and fingerprints.
- [ ] 5.5 Preflight direct `tools/call` requests against static registry scopes before resource lookup or handler execution.
- [ ] 5.6 Wrap every handler with the same policy evaluator and pass `PlatformPrincipal` into Platform service adapters for defense in depth.
- [ ] 5.7 Remove ad hoc `hasScope` branches and direct `userId`-only Platform service calls after registry coverage is complete.
- [ ] 5.8 Add matrix tests comparing discovery, direct calls, handler checks, and service checks for every tool and scope preset.
- [ ] 5.9 Add a regression test that fails when a future tool is registered without authorization metadata or bypasses the principal-aware adapter.

## 6. Resource Isolation and Safe Read Projections

- [ ] 6.1 Add principal-aware server predicates that apply selected grants to both paginated item and count queries.
- [ ] 6.2 Apply resource predicates to tool, value, connection-snippet, call-log, preview, mutation, invocation, and destructive service lookups.
- [ ] 6.3 Return the same not-found contract for foreign, ungranted, deleted, and nonexistent server ids without emitting distinguishable audit metadata to the caller.
- [ ] 6.4 Restrict `create_server` to account-wide author principals and force Platform-created servers to remain credential-free drafts.
- [ ] 6.5 Change `list_tools` read projection to return safe agent-visible contracts without stored authoring definitions or server-value ids.
- [ ] 6.6 Add a separate authoring-definition read guarded by author and conditionally by secret-reference scope.
- [ ] 6.7 Make non-secret config ids the only server-value ids visible without secret-reference scope.
- [ ] 6.8 Return one generic policy denial for secret, foreign, and unknown value ids that are outside the caller's visible config catalog.
- [ ] 6.9 Gate recent call logs and detailed operational data behind observe scope while keeping ordinary read metadata minimal.
- [ ] 6.10 Add cross-account and cross-grant tests for every read/mutation path, pagination totals, deleted grants, and empty remaining selected grants.
- [ ] 6.11 Add non-disclosure tests that compare responses for secret, nonexistent, and foreign value-id probes and inspect serialized output for forbidden ids/fields.

## 7. Draft, Publish, Destructive, and Invocation Policy

- [ ] 7.1 Classify each Platform authoring mutation as draft-only or runtime-effective using current persisted state and the candidate change.
- [ ] 7.2 Force create, duplicate, and curl-import operations to disabled drafts when the principal lacks publish scope.
- [ ] 7.3 Require publish scope before enabling a tool, modifying an enabled tool, or rotating config used by an enabled compiled plan.
- [ ] 7.4 Preserve destructive scope plus current-name confirmation for server, tool, and value deletion after resource authorization.
- [ ] 7.5 Classify invocation authority from the compiled HTTP method rather than caller-provided behavior annotations.
- [ ] 7.6 Require invoke scope for GET/HEAD and invoke plus invoke-mutation for POST/PUT/PATCH/DELETE before acquiring an upstream slot.
- [ ] 7.7 Preserve the product `allowMutation` check and add current-tool-name confirmation for compiled destructive invocations.
- [ ] 7.8 Record safe security events for destructive Studio actions and mutating upstream invocation outcomes without arguments or bodies.
- [ ] 7.9 Add policy tests for edits to enabled/disabled tools, publish transitions, referenced/unreferenced config, and draft server creation.
- [ ] 7.10 Add executor integration tests for method-versus-annotation disagreement, missing invoke-mutation, `allowMutation` false, destructive confirmation, and zero upstream contact on denial.

## 8. Platform HTTP Boundary and Limits

- [ ] 8.1 Reorder the Platform route to validate Origin, declared size, Bearer PAT, and authenticated request capacity before consuming a body.
- [ ] 8.2 Implement a bounded streaming body reader that cancels chunked payloads immediately after the byte limit.
- [ ] 8.3 Add RFC 6750 `WWW-Authenticate` responses for invalid tokens and statically insufficient scopes without publishing false OAuth discovery metadata.
- [ ] 8.4 Extend rate limiting with per-PAT control-plane request, write, and concurrent-request budgets while retaining invocation and per-server upstream limits.
- [ ] 8.5 Guarantee token and server slots are released on body errors, protocol errors, scope denials, handler throws, executor completion, and client cancellation.
- [ ] 8.6 Remove limiter state when a PAT is revoked or expires and bound idle bucket retention to prevent unbounded memory growth.
- [ ] 8.7 Add transport tests proving invalid-token bodies are not read, oversized chunked bodies are cancelled, challenges are correct, and MCP handlers are not constructed on denial.
- [ ] 8.8 Add deterministic rate/concurrency tests for reads, writes, invocations, retries, slot refunds, revocation, and idle cleanup.

## 9. Security Events and Owner Observability

- [ ] 9.1 Implement typed security-event writers with an allowlisted metadata schema and explicit prohibition of bodies, arguments, value ids, credentials, and secret metadata.
- [ ] 9.2 Persist issuance, rotation, and revocation events inside their lifecycle transactions.
- [ ] 9.3 Persist scope/resource denials, failed step-up, destructive actions, and mutating invocation outcomes without allowing audit failure to change authorization results.
- [ ] 9.4 Add secret-safe telemetry for security-event persistence failures, denial counts, high-risk grants, and active PAT inventory without token-name cardinality.
- [ ] 9.5 Add owner-scoped paginated security-event listing and retention cleanup services that are unavailable through Platform MCP.
- [ ] 9.6 Add tests for owner isolation, pagination, retention, lifecycle rollback on event failure, non-blocking runtime audit failure, and forbidden metadata scanning.

## 10. Settings UX and Localization

- [ ] 10.1 Replace the singleton Platform token card with a paginated inventory of active and recently revoked PATs and clear lifecycle metadata.
- [ ] 10.2 Add required token naming, Inspect/Build drafts/Operate read-only presets, and an advanced custom-scope editor with dependency visualization.
- [ ] 10.3 Add selected-server versus account-wide resource controls with selected mode recommended and effective access summarized before issuance.
- [ ] 10.4 Add risk-tier warnings, TTL choices constrained by risk, and explicit explanations of author versus publish and invoke versus invoke-mutation.
- [ ] 10.5 Add the email OTP step-up interaction for high-risk creation/rotation and handle expired, mismatched, and consumed grants clearly.
- [ ] 10.6 Add individual rotate and revoke flows with destructive confirmation, one-time raw PAT display, and no browser persistence of the raw credential.
- [ ] 10.7 Add a paginated recent security-event view that maps only safe event codes to user-facing copy.
- [ ] 10.8 Add complete English and Spanish copy for presets, scopes, resource modes, risk, migration revocation, step-up, activity, and errors.
- [ ] 10.9 Add SPA tests for safe defaults, dependency controls, server selection, high-risk step-up, TTL caps, multiple PATs, rotation, revocation, raw-token disappearance, and locale parity.

## 11. Migration, Documentation, and Verification

- [ ] 11.1 Implement an idempotent migration/backfill command that revokes current legacy Platform tokens without touching server-scoped gateway tokens.
- [ ] 11.2 Add a temporary compatibility flag for staged rollout that never translates legacy scopes into new grants and defaults to disabled after migration.
- [ ] 11.3 Add a Settings migration notice explaining why Platform PATs must be recreated and confirming that product MCP server tokens remain valid.
- [ ] 11.4 Document Platform principal, scope dependencies, resource predicates, authorization-before-lookup, PAT/OAuth distinction, and safe event metadata in `apps/api/AGENTS.md`.
- [ ] 11.5 Update human-facing command/onboarding documentation only where token recreation, PAT compatibility mode, or a new retention command needs explanation.
- [ ] 11.6 Add end-to-end tests covering PAT creation, MCP connection, discovery, read, draft authoring, publish, read-only invoke, mutating invoke, denial, rotation, revocation, and legacy rejection.
- [ ] 11.7 Run focused API, Platform MCP, service, migration, database, and SPA test suites for every touched area.
- [ ] 11.8 Run `bun typecheck`, `bun lint`, and `bun test`, fixing all regressions attributable to this change.
- [ ] 11.9 Run `bunx prettier --write .`, inspect the final diff for unrelated changes or credential-bearing fixtures, and map every spec scenario to automated coverage.
