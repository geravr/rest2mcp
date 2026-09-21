## 1. External Runtime and Shared Contracts

- [ ] 1.1 Consult current Mastra, AI SDK, provider, and Models.dev documentation through Context7/official sources; record the supported public APIs and choose compatible pinned versions for Bun.
- [ ] 1.2 Add Mastra and the minimum direct/OpenAI-compatible provider dependencies to the API workspace without exposing framework dependencies through shared packages.
- [ ] 1.3 Add `AI_CREDENTIAL_SECRET` to environment validation and `.env.example`, keeping it distinct from Better Auth and MCP credential key material.
- [ ] 1.4 Define shared provider kinds, connection/readiness projections, capability-profile identifiers, bounded catalog schemas, and stable `AI_*` application error codes with client locale mappings.

## 2. Persistence and Credential Security

- [ ] 2.1 Add Drizzle schemas for one owner-scoped `ai_provider_connection` per provider and one `ai_model_selection` per capability profile, including revisions, verification state, fingerprints, indexes, uniqueness, and cascading ownership relations.
- [ ] 2.2 Export the new schemas and generate one Drizzle migration; update schema invariants and disposable development seed/reset behavior without adding compatibility tables or readers.
- [ ] 2.3 Implement a versioned AES-256-GCM AI credential envelope with random IVs and AAD bound to user, connection, and provider identity.
- [ ] 2.4 Add crypto tests for round trips, nondeterministic ciphertext, malformed envelopes, wrong deployment key, and cross-user/connection/provider transplant rejection.
- [ ] 2.5 Add owner-scoped repository helpers that enforce `user -> connection -> selection` lock order, optimistic revisions, and secret-free projections.

## 3. Provider Adapter and Catalog Infrastructure

- [ ] 3.1 Define the server-only provider adapter interface and typed registry for OpenAI, Anthropic, xAI, Meta Model API, OpenRouter, OpenCode Zen, and OpenCode Go, including direct/gateway classification and fixed HTTPS origins.
- [ ] 3.2 Implement a bounded provider HTTP client with credential-safe headers, deadlines, response-size limits, redirect policy, normalized failure classes, and no raw provider body logging.
- [ ] 3.3 Implement bounded model descriptor normalization, strict catalog entry isolation, protocol/route metadata, confidence sources, and deterministic sorting.
- [ ] 3.4 Integrate the documented Models.dev public data API as optional enrichment while ensuring it can neither add account-inaccessible models nor make unresolved gateway routes selectable.
- [ ] 3.5 Implement the credential-revision-aware in-memory catalog cache, explicit refresh, visibly stale fallback, bounded eviction, and invalidation on rotation/removal.

## 4. Supported Provider Implementations

- [ ] 4.1 Implement and unit-test authenticated model discovery and model construction for the OpenAI direct adapter without hardcoded model IDs.
- [ ] 4.2 Implement and unit-test authenticated model discovery and model construction for the Anthropic direct adapter, preserving current capability metadata when provided.
- [ ] 4.3 Implement and unit-test authenticated model discovery and model construction for the xAI direct adapter.
- [ ] 4.4 Implement and unit-test authenticated model discovery and model construction for the Meta Model API direct adapter.
- [ ] 4.5 Implement and unit-test OpenRouter discovery, supported-parameter normalization, and exact route construction.
- [ ] 4.6 Implement and unit-test OpenCode Zen discovery and model-specific OpenAI Responses, Chat Completions, or Anthropic Messages routing.
- [ ] 4.7 Implement and unit-test OpenCode Go discovery and model-specific OpenAI Responses, Chat Completions, or Anthropic Messages routing.
- [ ] 4.8 Add one common adapter contract suite using bounded HTTP fixtures for authentication failure, transient failure, malformed entries, unsafe redirects, oversized responses, and unknown protocol metadata.

## 5. Capability Qualification and Mastra Runtime

- [ ] 5.1 Implement the versioned `structured-text-v1` profile for text input/output, schema-conforming generation, and a minimum advertised context window of 16,384 tokens.
- [ ] 5.2 Implement profile filtering that excludes non-language modalities, distinguishes direct-provider candidates from gateway routes, and reports unsupported/unknown reasons without static model allowlists.
- [ ] 5.3 Build an application-owned Mastra runtime factory that accepts request-scoped AI SDK model instances created from decrypted database credentials and never mutates `process.env` or global provider state.
- [ ] 5.4 Implement the bounded, tool-free, synthetic structured-output smoke test with a tiny schema, token cap, deadline, no product data, and no generated-content retention.
- [ ] 5.5 Implement deterministic verification fingerprints over provider, credential revision, adapter version, model, route/protocol, and capability-profile version.
- [ ] 5.6 Implement readiness resolution and invalidation for credential rotation, adapter/profile/route drift, permanent model loss, and transient provider failures.
- [ ] 5.7 Add runtime tests proving owner isolation, concurrent different-provider executions, no process-global credential mutation, bounded failures, and secret-free diagnostics.

## 6. Provider Management Services and API

- [ ] 6.1 Implement connection listing and readiness queries with non-secret owner-scoped projections and no ciphertext access outside the service layer.
- [ ] 6.2 Implement connect and rotate commands that verify credentials before persistence, perform no network I/O under database locks, compare expected revisions, and preserve the current connection on failure.
- [ ] 6.3 Implement confirmed connection removal with atomic dependent-selection deletion, revision checks, and cache invalidation.
- [ ] 6.4 Implement model catalog and refresh services that decrypt credentials only for the bounded provider call and return normalized compatibility states.
- [ ] 6.5 Implement selected-model verification and persistence with pre-call revision capture, post-call locked recheck, fingerprint storage, and no partial write on failure.
- [ ] 6.6 Implement the shared server-side feature-readiness guard and a narrow structured-generation entry point for future AI consumers.
- [ ] 6.7 Add a thin authenticated tRPC router with strict Zod inputs for provider lifecycle, catalog discovery, model selection, and readiness; reject unknown endpoint/base-URL fields.
- [ ] 6.8 Add database integration tests for owner isolation, one-connection-per-provider uniqueness, stale revisions, rotation races, selection races, atomic removal, and zero network activity while locks are held.

## 7. AI Settings Experience

- [ ] 7.1 Add the `AI` Settings search/tab contract, typed query/mutation hooks, loading/error states, and cache invalidation behavior.
- [ ] 7.2 Build provider connection cards for all supported providers with secret entry, explicit verification progress, verified/error states, rotation, and confirmed removal without redisplaying credentials.
- [ ] 7.3 Build the refreshable compatible-model picker with direct/gateway confidence, stale-catalog indication, unsupported reasons, and no hardcoded model options.
- [ ] 7.4 Add the model verification authorization/disclosure state, including the possible minimal provider charge, pending behavior, success state, and stable localized failures.
- [ ] 7.5 Add a reusable readiness hook/component contract so future AI controls stay disabled with an AI Settings call to action until the server reports a current verified profile selection.
- [ ] 7.6 Add complete English and Spanish AI Settings copy and locale-parity assertions.
- [ ] 7.7 Add component and hook tests for no configuration, connected-without-model, verified readiness, invalid credentials, transient catalog failure, stale catalog, rotation, removal, and raw-error suppression.

## 8. Security, Documentation, and Verification

- [ ] 8.1 Add security regression tests proving credentials, ciphertext, prompts, outputs, and raw provider responses never appear in API payloads, logs, telemetry, snapshots, or thrown errors.
- [ ] 8.2 Add outbound-policy tests for fixed provider origins, strict input rejection, redirect blocking, deadline/size enforcement, and gateway protocol fail-closed behavior.
- [ ] 8.3 Document AI credential setup, supported provider connection behavior, live model discovery, and verification cost disclosure in the appropriate human-facing README while keeping behavioral invariants in AGENTS.md.
- [ ] 8.4 Run focused API, database, and SPA tests for provider management, catalog normalization, qualification, Mastra resolution, Settings, and locale parity.
- [ ] 8.5 Run `bun typecheck`, `bun lint`, and `bun test` from the repository root and resolve every touched-slice failure.
- [ ] 8.6 Run `bunx prettier --write .` as the final formatting step, then rerun typecheck, lint, and focused tests affected by formatting.
- [ ] 8.7 Run strict OpenSpec validation for `add-ai-provider-foundation` and reconcile the implementation with every requirement scenario before requesting the quality gate.
