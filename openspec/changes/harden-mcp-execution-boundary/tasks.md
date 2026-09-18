## 1. Policy Decisions and Shared Contracts

- [x] 1.1 Choose and document the initial call-log retention, safe response-header allowlist, query-auth policy, and single-process rate/concurrency defaults from the design open questions.
- [x] 1.2 Define versioned Zod schemas for request definitions, bindings, agent inputs, behavior annotations, auth configuration, server values, and structured execution results.
- [x] 1.3 Define stable validation issue paths and `APP_ERROR_CODES` for compilation, policy, rate-limit, timeout, upstream HTTP, and indeterminate mutation failures.
- [x] 1.4 Replace divergent tRPC and Platform MCP authoring inputs with shared domain command schemas and add parity tests for field and payload limits.

## 2. Persistence and Migration Foundation

- [x] 2.1 Extend the Drizzle schema with request-definition versions, compiled-plan metadata, server-value kind/owner, explicit auth configuration, tool annotations, platform-token scopes/expiry, and log-policy fields.
- [x] 2.2 Generate the Drizzle migration and verify nullable/default choices preserve current production rows during the compatibility phase.
- [x] 2.3 Implement legacy-template analysis that identifies literal, server-value, and agent-input bindings without args-first guessing and emits location-aware diagnostics.
- [x] 2.4 Backfill only unambiguous legacy tools and auth mappings, preserving legacy source fields and disabling ambiguous or unsafe tools atomically.
- [x] 2.5 Add migration tests for name collisions, invalid JSON, duplicate headers/query keys, unsafe paths, auth ownership, partial failure, and idempotent reruns.
- [x] 2.6 Revoke existing unscoped Platform MCP tokens during migration while preserving server-scoped agent tokens.

## 3. Request Compiler and Effective Plan

- [x] 3.1 Implement a pure compiler from versioned request definitions plus server common values and auth configuration to an immutable effective request plan.
- [x] 3.2 Validate stable references, duplicate names/keys, unused inputs, conflicting metadata, forbidden headers, protected auth keys, GET/HEAD bodies, and mutation metadata.
- [x] 3.3 Implement typed JSON-tree compilation and explicit raw-body bindings without recursive placeholder interpretation.
- [x] 3.4 Implement optional-entry semantics for query entries and JSON object fields while rejecting optional paths and ambiguous mixed compositions.
- [x] 3.5 Enforce base-path confinement and secret-placement rules, including the configured query-auth acknowledgement policy.
- [x] 3.6 Add compiler tests for literal braces, null/string JSON roots, repeated references, empty required strings, collisions, secret overrides, and deterministic output.
- [x] 3.7 Add a compatibility reader and legacy-template dual writer so new tools remain executable during rollback.

## 4. Server Values and Authentication Ownership

- [x] 4.1 Update server-value services to use stable ids, `config`/`secret` kind, and `manual`/`auth` ownership while keeping secrets write-only.
- [x] 4.2 Implement explicit Bearer, header, query, Basic, and Custom auth configurations backed only by auth-owned secret references and protected request keys.
- [x] 4.3 Make auth create, rotate, replace, and clear operations transactional and prevent name-based overwrite or deletion of manual server values.
- [x] 4.4 Preserve credential colons unless a pasted `Name:` prefix exactly matches the selected auth field, and test all supported recipes.
- [x] 4.5 Block deletion of referenced server values and return structured references from tools, common values, and auth configuration.
- [x] 4.6 Add authorization and isolation tests proving one account cannot read, reference, mutate, or infer another account's values or auth state.

## 5. Safe Curl Import

- [x] 5.1 Refactor curl parsing into a side-effect-free preview service with an explicit supported-flag allowlist and rejection of ambiguous request-affecting flags.
- [x] 5.2 Validate exact target origin and normalized base-path boundaries while preserving ordered repeated query entries.
- [x] 5.3 Remove credentials, cookies, proxy credentials, and unsafe transport headers from preview output without returning their values in diagnostics.
- [x] 5.4 Replace global value matching with stable location and occurrence identifiers for path, query, header, form, and JSON selections.
- [x] 5.5 Implement confirmation as one transaction that creates exactly one disabled draft tool and cannot mutate auth, secrets, server values, or common defaults.
- [x] 5.6 Apply the same sanitized importer to Platform MCP, rejecting secret-bearing agent input and preserving the no-server-side-effects invariant.
- [x] 5.7 Add regression tests proving curl import cannot overwrite existing auth, secrets, variables, defaults, or similarly valued fields and leaves no rows on failure.

## 6. Studio Authoring and Clarity

- [x] 6.1 Update tool editors to persist and reload explicit Fixed, Server configuration, Server secret, and Agent input origins by stable id.
- [x] 6.2 Add agent-input controls for description, type, constraints, examples, required state, and sensitive state with en/es copy parity.
- [x] 6.3 Add backend-compiled effective-request preview showing inherited common values, protected auth injection, omission behavior, and redacted secrets.
- [x] 6.4 Update the curl preview/confirmation UI to show excluded credential metadata, require separate Auth-card configuration, and never offer credential promotion.
- [x] 6.5 Rename user-facing variables to server values/configuration and secrets where appropriate, while keeping migration-safe API compatibility.
- [x] 6.6 Separate enabled state from mutation permission and add explicit confirmation when revoking permission must disable a mutating tool.
- [x] 6.7 Show compile and legacy-migration diagnostics at precise request locations and prevent invalid tools from being enabled.
- [x] 6.8 Update common-value and Auth-card editors to display auth-owned protected keys and transactional Custom-recipe replacement details.

## 7. Bounded Outbound Executor

- [x] 7.1 Execute only compiled plans and resolve every binding from its declared source without agent-to-secret fallback or recursive interpolation.
- [x] 7.2 Apply one abort deadline across address validation, connection, redirects, response headers, and response-body consumption.
- [x] 7.3 Enforce same-origin redirect policy, port and downgrade rejection, per-hop address validation, standard method/body redirect semantics, and credential non-forwarding.
- [x] 7.4 Enforce the normalized server base-path boundary immediately before each fetch, including encoded and dot-segment cases.
- [x] 7.5 Stream response bytes to configured caps, decode only textual content types, and represent truncated JSON and unsupported binary safely.
- [x] 7.6 Normalize completed 2xx, 4xx, and 5xx responses into the shared envelope with safe headers, retry metadata, and indeterminate mutation semantics.
- [x] 7.7 Add adversarial executor tests for DNS/address policy, redirect chains, slow bodies, oversized multibyte payloads, binary bodies, path escape, and reflected secrets.

## 8. MCP Gateway Contract and Limits

- [x] 8.1 Generate deterministic MCP input schemas from compiled agent inputs and a stable output schema for the structured result envelope.
- [x] 8.2 Derive MCP read-only, destructive, idempotent, and open-world annotations from method plus explicit author metadata.
- [x] 8.3 Return compatibility text plus `structuredContent` for success and `isError: true` structured tool results for completed upstream 4xx/5xx responses.
- [x] 8.4 Advertise only enabled successfully compiled tools in deterministic name order and advertise no callable tools for paused servers.
- [x] 8.5 Enforce request-size limits, present-Origin validation, per-token token buckets, per-server concurrency semaphores, and stricter mutation budgets.
- [x] 8.6 Add gateway protocol tests for absent/invalid Origin, cross-server tokens, closed empty schemas, rate-limit retries, paused servers, and redacted errors.

## 9. Platform MCP Authority Boundary

- [x] 9.1 Issue expiring hashed Platform MCP tokens with explicit read, author, invoke, secret-reference, and destructive scopes.
- [x] 9.2 Make Platform token replacement atomic so a failed insert leaves the previous token active.
- [x] 9.3 Filter or deny Platform tools by scope before reading resources, revealing secret existence, or contacting upstream.
- [x] 9.4 Remove plaintext auth/secret arguments from Platform tools and permit only scoped references to already configured secret ids.
- [x] 9.5 Require current-resource-name confirmation plus destructive scope for delete operations and use shared ownership-safe services.
- [x] 9.6 Route Platform `test_tool` through the shared compiler/executor and ensure connection snippets never mint or return tokens.
- [x] 9.7 Add Platform MCP tests for expiry, scope combinations, validation parity, cross-owner ids, destructive confirmation, curl safety, and secret non-disclosure.

## 10. Observability, Privacy, and Lifecycle

- [x] 10.1 Decouple invocation results from call-log persistence with a bounded best-effort queue, drop telemetry, and graceful shutdown draining.
- [x] 10.2 Redact auth material, cookies, agent tokens, secret bindings, sensitive inputs, and encoded variants before any log or error persistence.
- [x] 10.3 Store byte-bounded metadata and previews according to the selected body policy and expose execution phase/outcome telemetry.
- [x] 10.4 Implement retention cleanup and verify account/server deletion removes associated call logs without orphaning ownership.
- [x] 10.5 Update playground input handling to preserve absent optional values and render the same structured success/error envelope as the gateway.
- [x] 10.6 Add failure-injection tests proving audit queue/database failures never alter completed upstream results or traffic-light health.

## 11. End-to-End Verification and Rollout

- [x] 11.1 Add end-to-end tests from Studio authoring through MCP discovery and invocation for Fixed, configuration, secret, and Agent input bindings.
- [x] 11.2 Add end-to-end migration tests proving existing unambiguous tools remain callable and ambiguous tools become disabled with actionable diagnostics.
- [x] 11.3 Add security regression tests covering credential leakage, cross-account access, SSRF redirects, auth-key overrides, payload abuse, and agent-controlled template text.
- [x] 11.4 Update owner-facing documentation and en/es connection guidance for structured MCP errors, scoped Platform tokens, separate auth setup, and curl import guarantees.
- [x] 11.5 Document the initial single-process limiter assumption, operational defaults, retention cleanup, queue telemetry, and rollback procedure.
- [x] 11.6 Run database migration checks, focused tests, `bun typecheck`, `bun lint`, the full test suite, and final formatting before rollout.
