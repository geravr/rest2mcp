## 1. Change Coordination and Security Baseline

- [x] 1.1 Reconcile `make-studio-writes-atomic` by removing its single-active-Platform-token constraint while preserving user-locked per-token rotation and revocation atomicity.
- [x] 1.2 Confirm the implementation order with `improve-agent-tool-contracts` and define one shared Platform tool registry shape for contract and authorization metadata.
- [x] 1.3 Add a checked-in scope-to-operation matrix covering every existing Platform MCP tool, dynamic publish checks, resource extraction, and risk tier.
- [x] 1.4 Add canonical policy-version, scope, dependency, risk, PAT-count, TTL, retention, and rate-limit constants to `packages/core` or the API policy module without duplicating SPA constants.
- [x] 1.5 Add stable error codes and safe detail shapes for invalid grant composition, step-up required/expired, PAT limit, policy conflict, and resource denial.

## 2. Token Grant and Security-Event Persistence

- [x] 2.1 Extend the agent-token schema with Platform policy version, resource mode, rotation linkage, and lifecycle metadata while keeping server gateway tokens as a distinct credential audience.
- [x] 2.2 Add normalized Platform PAT scope rows with scope constraints, uniqueness, and cascading token ownership.
- [x] 2.3 Add normalized selected-server grant rows with token/server uniqueness and cascades that cannot promote a token to account-wide mode.
- [x] 2.4 Add active-name and token-hash uniqueness plus indexes for owner inventory, authentication, expiration, and revocation queries.
- [x] 2.5 Add session-bound, expiring, single-use Platform step-up grant storage with an exact authorization-request fingerprint.
- [x] 2.6 Add the owner-scoped Platform security-event schema, safe metadata type, indexes, and 90-day retention fields.
- [x] 2.7 Generate one Drizzle migration that adds normalized Platform grants/events, deletes development Platform PATs, and removes legacy Platform scope/singleton fields without hand-editing generated SQL.
- [x] 2.8 Add schema tests for normalized grant integrity, policy/resource consistency, cascades, token uniqueness, step-up consumption, and security-event ownership.

## 3. Grant Validation and Platform Principal

- [x] 3.1 Implement canonical scope sorting, deduplication rejection, dependency validation, high-risk classification, and grant fingerprinting.
- [x] 3.2 Implement resource-mode validation for non-empty selected grants and account-wide grants without selected rows.
- [x] 3.3 Implement `PlatformPrincipal` as an immutable validated value containing token, user, scopes, resource boundary, policy version, and expiration.
- [x] 3.4 Split Platform PAT authentication from server-token authentication so each path validates only its own authoritative storage and audience.
- [x] 3.5 Load normalized scopes and server grants during Platform authentication and fail uniformly for malformed, unknown-version, expired, or revoked principals.
- [x] 3.6 Throttle `lastUsedAt` persistence to avoid a database write on every MCP protocol request without losing useful owner activity data.
- [x] 3.7 Add table-driven tests for every valid/invalid scope combination, resource mode, policy version, expiration, revocation, and server-token rejection.
- [x] 3.8 Add tests proving malformed grants have no alternate storage or fallback path and never broaden access.

## 4. Multiple PAT Lifecycle and Step-Up

- [x] 4.1 Replace singleton token metadata retrieval with paginated owner-scoped PAT inventory including grants, safe prefix, timestamps, and rotation relationships.
- [x] 4.2 Implement low-risk PAT creation with required name, read-only default, active-token cap, bounded TTL, immutable grants, and one-time raw response.
- [x] 4.3 Consult current Better Auth Email OTP documentation and implement a session-bound step-up challenge without exposing OTP verification to Platform MCP.
- [x] 4.4 Issue short-lived single-use step-up grants only after successful OTP verification and bind them to the exact canonical grant fingerprint.
- [x] 4.5 Require and atomically consume matching step-up grants for account-wide, publish, invoke-mutation, secret-reference, or destructive PAT creation.
- [x] 4.6 Implement target-specific PAT rotation under a user-row lock, atomically creating successor grants, revoking the predecessor, and recording the event.
- [x] 4.7 Implement target-specific PAT revocation under the user-row lock without affecting unrelated PATs.
- [x] 4.8 Enforce 90-day low-risk and 30-day high-risk maximum TTLs with 30-day and 7-day defaults respectively.
- [x] 4.9 Add transaction failure-injection tests for PAT creation, scope rows, server grants, step-up consumption, event insertion, rotation, and revocation.
- [x] 4.10 Add concurrency tests for active-token limits, same-name issuance, double step-up consumption, concurrent rotation, and rotate-versus-revoke.
- [x] 4.11 Add tests proving raw PATs appear only in successful creation/rotation responses and never in rows, errors, telemetry, or event metadata.

## 5. Centralized Authorization Registry

- [x] 5.1 Extend the centralized Platform tool contract with required scopes, risk tier, resource argument metadata, and optional dynamic policy evaluation.
- [x] 5.2 Add a registry completeness assertion so every registered Platform tool has contract, output, behavior, and authorization metadata.
- [x] 5.3 Implement one policy evaluator for static scope dependencies, account-versus-selected resources, and safe insufficient-scope details.
- [x] 5.4 Filter `tools/list` from the authenticated principal through the registry while retaining deterministic contract ordering and fingerprints.
- [x] 5.5 Preflight direct `tools/call` requests against static registry scopes before resource lookup or handler execution.
- [x] 5.6 Wrap every handler with the same policy evaluator and pass `PlatformPrincipal` into Platform service adapters for defense in depth.
- [x] 5.7 Remove ad hoc `hasScope` branches and direct `userId`-only Platform service calls after registry coverage is complete.
- [x] 5.8 Add matrix tests comparing discovery, direct calls, handler checks, and service checks for every tool and scope preset.
- [x] 5.9 Add a regression test that fails when a future tool is registered without authorization metadata or bypasses the principal-aware adapter.

## 6. Resource Isolation and Safe Read Projections

- [x] 6.1 Add principal-aware server predicates that apply selected grants to both paginated item and count queries.
- [x] 6.2 Apply resource predicates to tool, value, connection-snippet, call-log, preview, mutation, invocation, and destructive service lookups.
- [x] 6.3 Return the same not-found contract for foreign, ungranted, deleted, and nonexistent server ids without emitting distinguishable audit metadata to the caller.
- [x] 6.4 Restrict `create_server` to account-wide author principals and force Platform-created servers to remain credential-free drafts.
- [x] 6.5 Change `list_tools` read projection to return safe agent-visible contracts without stored authoring definitions or server-value ids.
- [x] 6.6 Add a separate authoring-definition read guarded by author and conditionally by secret-reference scope.
- [x] 6.7 Make non-secret config ids the only server-value ids visible without secret-reference scope.
- [x] 6.8 Return one generic policy denial for secret, foreign, and unknown value ids that are outside the caller's visible config catalog.
- [x] 6.9 Gate recent call logs and detailed operational data behind observe scope while keeping ordinary read metadata minimal.
- [x] 6.10 Add cross-account and cross-grant tests for every read/mutation path, pagination totals, deleted grants, and empty remaining selected grants.
- [x] 6.11 Add non-disclosure tests that compare responses for secret, nonexistent, and foreign value-id probes and inspect serialized output for forbidden ids/fields.

## 7. Draft, Publish, Destructive, and Invocation Policy

- [x] 7.1 Classify each Platform authoring mutation as draft-only or runtime-effective using current persisted state and the candidate change.
- [x] 7.2 Force create, duplicate, and curl-import operations to disabled drafts when the principal lacks publish scope.
- [x] 7.3 Require publish scope before enabling a tool, modifying an enabled tool, or rotating config used by an enabled compiled plan.
- [x] 7.4 Preserve destructive scope plus current-name confirmation for server, tool, and value deletion after resource authorization.
- [x] 7.5 Classify invocation authority from the compiled HTTP method rather than caller-provided behavior annotations.
- [x] 7.6 Require invoke scope for GET/HEAD and invoke plus invoke-mutation for POST/PUT/PATCH/DELETE before acquiring an upstream slot.
- [x] 7.7 Preserve the product `allowMutation` check and add current-tool-name confirmation for compiled destructive invocations.
- [x] 7.8 Record safe security events for destructive Studio actions and mutating upstream invocation outcomes without arguments or bodies.
- [x] 7.9 Add policy tests for edits to enabled/disabled tools, publish transitions, referenced/unreferenced config, and draft server creation.
- [x] 7.10 Add executor integration tests for method-versus-annotation disagreement, missing invoke-mutation, `allowMutation` false, destructive confirmation, and zero upstream contact on denial.

## 8. Platform HTTP Boundary and Limits

- [x] 8.1 Reorder the Platform route to validate Origin, declared size, Bearer PAT, and authenticated request capacity before consuming a body.
- [x] 8.2 Implement a bounded streaming body reader that cancels chunked payloads immediately after the byte limit.
- [x] 8.3 Add RFC 6750 `WWW-Authenticate` responses for invalid tokens and statically insufficient scopes without publishing false OAuth discovery metadata.
- [x] 8.4 Extend rate limiting with per-PAT control-plane request, write, and concurrent-request budgets while retaining invocation and per-server upstream limits.
- [x] 8.5 Guarantee token and server slots are released on body errors, protocol errors, scope denials, handler throws, executor completion, and client cancellation.
- [x] 8.6 Remove limiter state when a PAT is revoked or expires and bound idle bucket retention to prevent unbounded memory growth.
- [x] 8.7 Add transport tests proving invalid-token bodies are not read, oversized chunked bodies are cancelled, challenges are correct, and MCP handlers are not constructed on denial.
- [x] 8.8 Add deterministic rate/concurrency tests for reads, writes, invocations, retries, slot refunds, revocation, and idle cleanup.

## 9. Security Events and Owner Observability

- [x] 9.1 Implement typed security-event writers with an allowlisted metadata schema and explicit prohibition of bodies, arguments, value ids, credentials, and secret metadata.
- [x] 9.2 Persist issuance, rotation, and revocation events inside their lifecycle transactions.
- [x] 9.3 Persist scope/resource denials, failed step-up, destructive actions, and mutating invocation outcomes without allowing audit failure to change authorization results.
- [x] 9.4 Add secret-safe telemetry for security-event persistence failures, denial counts, high-risk grants, and active PAT inventory without token-name cardinality.
- [x] 9.5 Add owner-scoped paginated security-event listing and retention cleanup services that are unavailable through Platform MCP.
- [x] 9.6 Add tests for owner isolation, pagination, retention, lifecycle rollback on event failure, non-blocking runtime audit failure, and forbidden metadata scanning.

## 10. Settings UX and Localization

- [x] 10.1 Replace the singleton Platform token card with a paginated inventory of active and recently revoked PATs and clear lifecycle metadata.
- [x] 10.2 Add required token naming, Inspect/Build drafts/Operate read-only presets, and an advanced custom-scope editor with dependency visualization.
- [x] 10.3 Add selected-server versus account-wide resource controls with selected mode recommended and effective access summarized before issuance.
- [x] 10.4 Add risk-tier warnings, TTL choices constrained by risk, and explicit explanations of author versus publish and invoke versus invoke-mutation.
- [x] 10.5 Add the email OTP step-up interaction for high-risk creation/rotation and handle expired, mismatched, and consumed grants clearly.
- [x] 10.6 Add individual rotate and revoke flows with destructive confirmation, one-time raw PAT display, and no browser persistence of the raw credential.
- [x] 10.7 Add a paginated recent security-event view that maps only safe event codes to user-facing copy.
- [x] 10.8 Add complete English and Spanish copy for presets, scopes, resource modes, risk, step-up, activity, and errors without legacy-token migration messaging.
- [x] 10.9 Add SPA tests for safe defaults, dependency controls, server selection, high-risk step-up, TTL caps, multiple PATs, rotation, revocation, raw-token disappearance, and locale parity.

## 11. Clean Cutover, Documentation, and Verification

- [x] 11.1 Delete existing development Platform PAT rows and obsolete JSON/singleton grant storage in the generated migration while leaving the distinct server-gateway credential audience unchanged.
- [x] 11.2 Remove old scope casts, singleton token procedures, serializers, UI state, compatibility flags, fixtures, and documentation in the same change.
- [x] 11.3 Update canonical seeds and document reset/reseed for local development without creating or persisting a raw Platform PAT automatically.
- [x] 11.4 Document Platform principal, scope dependencies, resource predicates, authorization-before-lookup, PAT/OAuth distinction, and safe event metadata in `apps/api/AGENTS.md`.
- [x] 11.5 Update human-facing command/onboarding documentation only where PAT authentication mode or a new retention command needs explanation.
- [x] 11.6 Add end-to-end tests covering PAT creation, MCP connection, discovery, read, draft authoring, publish, read-only invoke, mutating invoke, denial, rotation, revocation, and unknown-policy rejection.
- [x] 11.7 Run focused API, Platform MCP, service, migration, database, and SPA test suites for every touched area.
- [x] 11.8 Run `bun typecheck`, `bun lint`, and `bun test`, fixing all regressions attributable to this change.
- [x] 11.9 Run `bunx prettier --write .`, inspect the final diff for unrelated changes or credential-bearing fixtures, and map every spec scenario to automated coverage.
- [x] 11.10 Search source, schemas, migrations, clients, tests, and docs for legacy Platform scope JSON, singleton-token assumptions, migration notices, or compatibility flags and remove every remaining occurrence.
