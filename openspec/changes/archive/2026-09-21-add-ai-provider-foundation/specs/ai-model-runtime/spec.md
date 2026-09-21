## ADDED Requirements

### Requirement: Model catalogs are discovered dynamically

The system SHALL derive the models available to an account from the configured provider's authenticated live catalog, optionally enriched by current public registry metadata, and SHALL NOT ship a source-controlled model ID allowlist or fallback catalog.

#### Scenario: Newly available model appears without deployment

- **WHEN** a provider adds a model to the authenticated catalog and the owner refreshes after cache expiry
- **THEN** the normalized model appears without a rest2mcp code or configuration release

#### Scenario: Inaccessible registry model is excluded

- **WHEN** public registry metadata describes a model that is absent from the account's authenticated provider catalog
- **THEN** the model is not offered for selection

#### Scenario: Catalog refresh serves a marked stale result

- **WHEN** live refresh fails transiently and a bounded cache entry exists for the same connection credential revision
- **THEN** the system may return that entry marked stale with its retrieval time rather than presenting it as current

#### Scenario: Catalog has no valid cache fallback

- **WHEN** live discovery fails and no cache entry exists for the current credential revision
- **THEN** the system returns a retryable discovery error and does not substitute hardcoded models

#### Scenario: Malformed catalog entry is isolated

- **WHEN** one provider catalog entry exceeds normalization bounds or lacks a usable model identity
- **THEN** the system excludes that entry without failing otherwise valid bounded entries

### Requirement: Models are evaluated against versioned capability profiles

The system SHALL qualify model descriptors against a named, versioned product capability profile and SHALL distinguish advertised compatibility from successfully verified compatibility. The `structured-text-v1` profile requires text input, text output, schema-conforming structured generation, and an advertised context window of at least 16,384 tokens.

#### Scenario: Direct-provider text model is a candidate

- **WHEN** a direct provider returns a conversational text model that satisfies the advertised requirements of `structured-text-v1`
- **THEN** the model is shown as provider-compatible but not verified until its selection smoke test succeeds

#### Scenario: Non-language model is excluded

- **WHEN** a catalog entry is only for embeddings, image generation, audio, transcription, or another incompatible modality
- **THEN** the model is excluded from the `structured-text-v1` compatible list

#### Scenario: Gateway route is fully described

- **WHEN** OpenRouter, OpenCode Zen, or OpenCode Go returns a model with sufficient current route and protocol metadata
- **THEN** the system evaluates that exact route against the requested capability profile

#### Scenario: Gateway route cannot be resolved

- **WHEN** a gateway model lacks enough metadata to select OpenAI Responses, Chat Completions, Anthropic Messages, or another supported protocol safely
- **THEN** the system marks the model unsupported for selection and does not guess a transport

#### Scenario: Different feature requires different capabilities

- **WHEN** a future AI feature requests a profile with requirements different from `structured-text-v1`
- **THEN** compatibility and readiness are evaluated for that profile independently of other verified selections

### Requirement: Selected models are verified with bounded structured generation

The system SHALL persist a model selection only after a Mastra-backed, schema-constrained smoke test succeeds for the requested capability profile.

#### Scenario: Selected model passes verification

- **WHEN** the model returns the required synthetic structured result within the token, time, and response-size limits
- **THEN** the system stores the owner-scoped selection, normalized capability snapshot, verification time, and verification fingerprint

#### Scenario: Verification sends no product data

- **WHEN** the system tests a selected model
- **THEN** the request contains only bounded synthetic content, registers no tools, includes no MCP definitions or credentials, and retains no generated content

#### Scenario: Verification may incur provider cost

- **WHEN** the owner initiates model verification from Settings
- **THEN** the UI discloses before the request that a minimal inference call may incur a provider charge

#### Scenario: Verification fails schema conformance

- **WHEN** the selected model cannot produce output conforming to the required schema after the bounded attempt policy
- **THEN** no selection is persisted and the UI receives a stable compatibility error

### Requirement: Verification fingerprints prevent stale readiness

The system SHALL bind model readiness to provider kind, connection credential revision, adapter version, model ID, route/protocol identity, and capability-profile version.

#### Scenario: Credential rotation invalidates readiness

- **WHEN** the owner rotates a provider credential
- **THEN** every selection using that connection becomes unavailable until verified with the new credential revision

#### Scenario: Gateway route changes

- **WHEN** refreshed metadata resolves the selected gateway model to a different route or protocol than the stored fingerprint
- **THEN** the existing selection is reported as stale and cannot satisfy feature readiness until reverified

#### Scenario: Capability profile changes

- **WHEN** application code advances a capability profile version or required capability set
- **THEN** selections verified under the previous profile do not satisfy the new profile

#### Scenario: Transient provider failure preserves selection

- **WHEN** runtime execution encounters a rate limit, timeout, or provider outage
- **THEN** the failure is reported as transient without deleting or permanently invalidating the verified selection

#### Scenario: Permanent model loss invalidates selection

- **WHEN** the provider authoritatively reports that the selected model or account access no longer exists
- **THEN** the selection stops satisfying readiness and Settings requests a new model selection

### Requirement: Mastra runtime resolves owner-scoped database credentials

The system SHALL construct the Mastra model for each execution from the authenticated owner's current verified selection and encrypted provider connection, without placing user credentials in process-global environment or shared provider state.

#### Scenario: Ready owner resolves selected model

- **WHEN** an authenticated execution requests a capability profile with a current verified selection
- **THEN** the runtime decrypts that owner's credential only in server memory, constructs the selected provider model, and supplies it to the bounded Mastra execution

#### Scenario: Owner has no ready selection

- **WHEN** an execution requests a capability profile without a current verified selection
- **THEN** the server rejects execution before model construction with a stable configuration-required error

#### Scenario: Selection from another account is unusable

- **WHEN** execution attempts to resolve a connection or model selection owned by another user
- **THEN** resolution fails closed without decrypting a credential or making a provider request

#### Scenario: Concurrent users use different providers

- **WHEN** two owners execute the same capability profile concurrently with different provider credentials or models
- **THEN** each execution uses only its request-scoped selection and neither can affect process-global configuration for the other

### Requirement: AI runtime operations are bounded and secret-safe

The system SHALL enforce provider-specific HTTPS allowlists, request deadlines, response-size limits, normalized errors, and secret-safe observability for discovery, verification, and runtime model calls.

#### Scenario: Provider returns raw diagnostic content

- **WHEN** a provider error contains request fragments, credentials, prompts, or generated text
- **THEN** the API and telemetry emit only a stable application code and bounded non-sensitive metadata

#### Scenario: Runtime deadline expires

- **WHEN** a provider does not complete within the operation deadline
- **THEN** the system aborts the request and reports a retryable timeout without retaining partial generated content

#### Scenario: Telemetry records normalized outcome

- **WHEN** discovery, verification, or execution completes or fails
- **THEN** telemetry may record provider kind, public model ID, operation, latency, and normalized outcome but excludes credentials, prompts, outputs, ciphertext, and raw provider responses
