## Context

rest2mcp currently has no AI runtime or account-level model configuration. Existing MCP credentials are encrypted for server execution, but AI provider credentials have a different owner, lifecycle, outbound policy, and future consumers. The product is pre-production, uses single-user accounts, and already exposes a user Settings area through authenticated tRPC procedures.

The near-term consumer is structured analysis of MCP tools, while later consumers may use tool calling, memory, or longer agent workflows. The foundation therefore needs provider portability and Mastra orchestration without granting an AI model authority over MCP drafts, secrets, or publication.

## Goals / Non-Goals

**Goals:**

- Let an account owner configure and verify supported AI providers without deployment-time provider keys.
- Keep credentials encrypted, owner-scoped, non-exportable, and absent from logs and telemetry.
- Discover current models from provider APIs and dynamic registries rather than shipping model ID allowlists.
- Qualify models against versioned capability profiles and distinguish direct providers from multiprovider gateways.
- Resolve a verified account model into a Mastra execution at request time without mutating process-global state.
- Provide one truthful server-side availability contract that AI feature UIs can use for disabled states.

**Non-Goals:**

- Tool auto-improvement, AI-authored MCP mutations, or publication changes.
- Arbitrary OpenAI-compatible URLs or user-controlled provider hosts.
- Durable long-running AI jobs, memory, RAG, chat history, or autonomous tool execution.
- Provider billing aggregation, usage invoicing, or model-quality rankings.
- Multiple credentials for the same provider within one account in the first version.

## Decisions

### 1. Persist provider connections separately from MCP server secrets

Add an `ai_provider_connection` table with one row per `(user_id, provider_kind)`. It stores provider identity, versioned credential ciphertext, credential revision, optimistic configuration revision, verification status, last successful verification time, and a stable non-sensitive error code. Add an `ai_model_selection` table with one row per `(user_id, capability_profile)` referencing a connection and storing the model ID, resolved protocol/route metadata, normalized capability snapshot, verification fingerprint, and verification time. Deleting a connection cascades its selections.

The supported provider kinds are `openai`, `anthropic`, `xai`, `meta`, `openrouter`, `opencode_zen`, and `opencode_go`. Provider display names, endpoints, and protocol behavior belong to a typed code registry, not database rows.

Connection mutations use optimistic revisions and lock in `user -> connection -> selection` order. Network calls occur before any write transaction. A successful verification is committed only if the credential/configuration revision observed before the call is still current.

Alternatives considered:

- Reusing `mcp_server_variable` would incorrectly scope account credentials to one MCP server and entangle AI lifecycle with published server execution.
- Storing one global provider/model column on `user` would make verification, rotation, capability profiles, and future per-feature choices difficult to evolve.
- Supporting multiple same-provider credentials immediately would add selection ambiguity without a current product requirement.

### 2. Use a dedicated authenticated credential envelope

Introduce `AI_CREDENTIAL_SECRET` as deployment key material distinct from `MCP_CREDENTIAL_SECRET`. Provider keys are encrypted with AES-256-GCM using a random IV and authenticated additional data containing the envelope version, user ID, connection ID, and provider kind. The serialized envelope is versioned so a later KMS or key-rotation format can replace it cleanly.

Plaintext exists only in the service call that verifies or constructs the provider client. API responses expose only whether a credential exists and verification metadata; they never expose plaintext, ciphertext, or a reversible credential derivative. Rotation replaces the ciphertext and increments the credential revision. Existing MCP ciphertext is not migrated or reinterpreted.

Alternatives considered:

- Hashing is insufficient because inference requires the original provider key.
- Reusing Better Auth or MCP encryption key material would collapse security domains and increase blast radius.
- Returning a masked key would require retaining a key fragment; the initial UI only needs a truthful `configured` state.

### 3. Put provider differences behind a narrow adapter registry

Define a server-only `AiProviderAdapter` contract for credential verification, model discovery, normalized route metadata, and AI SDK model construction. The registry fixes HTTPS endpoints and allowed hosts for each supported provider. It does not accept base URLs from the browser.

OpenAI, Anthropic, xAI, and Meta Model API are classified as direct providers. OpenRouter, OpenCode Zen, and OpenCode Go are gateways. The classification affects qualification confidence, not credential security. OpenCode adapters must respect the protocol declared for each model because models may use OpenAI Responses, Chat Completions, or Anthropic Messages. If a gateway route cannot be resolved from current metadata, the model is excluded rather than guessed.

Alternatives considered:

- Calling every provider through OpenRouter would simplify transport but defeat direct-provider credentials and add an unnecessary intermediary.
- Using only Mastra `provider/model` strings would normally couple credentials to process environment variables and is unsuitable for per-user database keys.
- A generic user-supplied OpenAI-compatible adapter would create SSRF and protocol-trust problems and remains out of scope.

### 4. Discover model IDs live and normalize capabilities

Provider adapters fetch the authenticated model catalog and normalize each entry into a bounded `AiModelDescriptor`: model ID, display name, model type/modalities, context limits when available, protocol/route, advertised capabilities, optional pricing metadata, and source confidence. Models.dev public registry metadata may enrich sparse provider catalogs through its documented data API, but it never grants access to a model absent from the authenticated provider response. If enrichment is unavailable, direct-provider models remain discoverable with unknown optional metadata, while gateway routes that cannot be resolved safely remain unsupported.

There is no source-controlled model ID allowlist or fallback list. The provider registry and versioned capability profiles are intentionally code-defined because endpoint authentication and product requirements cannot be discovered safely from a model ID.

Catalogs use a short in-memory TTL keyed by connection ID, credential revision, provider adapter version, and requested profile. Responses, entry counts, and field lengths are bounded. An explicit refresh bypasses the cache. If a live refresh fails, a cache entry for the same credential revision may be returned as visibly stale; otherwise the request fails with a stable transient code. Catalog snapshots are not persisted as account truth.

### 5. Qualify models against versioned capability profiles

The first profile is `structured-text-v1`: text input, text output, schema-conforming structured generation, and an advertised context window of at least 16,384 tokens. Profiles describe product needs rather than vendor features and can be added without changing provider records.

Direct-provider catalog entries that match the required model type are presented as provider-compatible. Gateway entries additionally require enough current route/protocol metadata to construct the correct client. A model becomes `verified` for a profile only after a minimal Mastra structured-output smoke test succeeds. The test uses non-sensitive synthetic content, a tiny output schema and token budget, no tools, no MCP data, and a strict deadline.

Successful selection persists a verification fingerprint over provider kind, connection credential revision, adapter version, model ID, route/protocol identity, and capability-profile version. Any constituent change invalidates the selection until it is verified again. Authentication or permanent model-unavailable errors invalidate readiness; rate limits and provider outages remain transient and do not erase a valid selection.

Alternatives considered:

- Treating every `/models` entry as compatible would expose embedding, image, audio, or inaccessible routes.
- Probing every listed model would create cost, latency, and rate-limit problems.
- One global `compatible` flag would not support future features with different tool-calling or multimodal requirements.

### 6. Use Mastra behind an application-owned runtime boundary

Add Mastra as the orchestration layer, but keep PostgreSQL and rest2mcp services as the source of truth. An `AiRuntimeService` resolves an owner and capability profile to one verified selection, decrypts the credential, asks the adapter to construct an AI SDK language model, and supplies that model instance to a short-lived Mastra agent or workflow. It never writes a user key to `process.env`, a global provider singleton, Mastra storage, or browser state.

The foundation exposes a narrow structured-generation operation used by verification and future features. Mastra types do not leak into tRPC contracts, database schemas, or shared core types. Memory, tool registration, and persistent Mastra storage remain disabled. This isolates framework churn and keeps future application policies outside model orchestration.

### 7. Verify before persistence and expose truthful readiness

Connecting or rotating a provider follows: validate input, call the provider's authenticated catalog outside a transaction, encrypt the key, lock the account/connection, compare the expected revision, and commit. Invalid credentials are never persisted. A transient provider failure returns a retryable error and does not replace a previously verified credential.

Selecting a model follows: load the current connection and credential revision, resolve the live descriptor, perform the bounded structured-output smoke test, then atomically persist the selection only if the connection revision is unchanged. The Settings UI discloses that model verification sends a synthetic request and may incur a small provider charge.

The server exposes readiness per capability profile. Readiness requires a verified connection and a non-stale verified selection fingerprint. AI-dependent clients SHALL use this response for disabled controls and a Settings call to action, but every AI API independently enforces the same check.

### 8. Keep outbound calls and diagnostics fail-closed

Catalog and inference traffic uses fixed HTTPS origins, bounded redirects, response-size limits, deadlines, and the existing outbound safety posture. Provider error bodies are normalized into stable `AI_*` application codes and are not returned verbatim. Logs and telemetry may include provider kind, public model ID, operation, latency, and normalized outcome, but never credentials, prompts, generated content, ciphertext, or raw provider responses.

The Settings UI adds an `AI` tab with provider connection state, secret-entry/rotation controls, refreshable compatible model selection, verification confidence, and localized English/Spanish errors. A user can remove a connection only through an explicit confirmation; dependent selections are removed atomically.

## Risks / Trade-offs

- **Provider catalogs expose inconsistent metadata** → Normalize conservatively, enrich only from dynamic public metadata, and require a selected-model smoke test.
- **Gateway behavior can drift by route even when the model ID is stable** → Include route/protocol and adapter version in the verification fingerprint and fail closed when route metadata is missing.
- **Database compromise exposes ciphertext** → Use separate authenticated encryption key material, owner/provider-bound AAD, non-exportable APIs, and secret-free observability. A deployment-key compromise remains a documented security boundary.
- **Mastra or AI SDK releases can change provider behavior** → Pin compatible versions, keep them behind `AiRuntimeService`, and add provider contract tests.
- **Verification creates a small external cost** → Use one explicit, minimal smoke request and disclose it before selection; never probe an entire catalog.
- **In-memory catalog caches are per process** → Accept duplicate refreshes across instances; correctness relies on live provider data and persisted selection fingerprints, not cache coherence.
- **A provider outage can block first-time configuration** → Return a transient retryable state without persisting unverified credentials or replacing a valid connection.
- **Meta or OpenCode endpoint availability may vary by account or region** → Show the adapter as supported but only mark a connection ready after its authenticated catalog and selected route succeed.

## Migration Plan

1. Add pinned Mastra/provider dependencies and `AI_CREDENTIAL_SECRET` validation plus environment documentation.
2. Add Drizzle schemas and generate one migration for provider connections and model selections.
3. Add encryption, provider adapters, catalog normalization, capability profiles, runtime resolution, tRPC procedures, and stable errors.
4. Add the Settings AI tab, localized copy, and readiness hooks.
5. Run focused security/integration tests and the repository quality gate before enabling future consumers.

There is no data backfill because the capability is new. Deployment must provide `AI_CREDENTIAL_SECRET` before the API version that accepts connections starts. On application rollback, previous code ignores the new tables; encrypted rows should remain inert until an explicitly authorized migration removes them. No plaintext credential migration or compatibility reader is introduced.

## Open Questions

- Should a later production lifecycle transition replace the environment root secret with a managed KMS and key ring before real customer credentials are accepted?
