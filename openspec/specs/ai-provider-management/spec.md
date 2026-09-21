# AI Provider Management

## Purpose

Account-scoped provider credential lifecycle, connection verification, Settings UI, and AI feature availability for supported direct and gateway providers.

## Requirements

### Requirement: Owner can configure supported AI providers

The system SHALL let an authenticated account owner configure at most one connection for each supported provider kind: OpenAI, Anthropic, xAI, Meta Model API, OpenRouter, OpenCode Zen, and OpenCode Go.

#### Scenario: Valid provider credential is connected

- **WHEN** the owner submits a supported provider and a credential that can access its authenticated model catalog
- **THEN** the system stores an encrypted provider connection, records it as verified, and returns only non-secret connection metadata

#### Scenario: Invalid provider credential is rejected

- **WHEN** the provider rejects a submitted credential as unauthorized
- **THEN** the system returns a stable localized error and persists neither the submitted credential nor a new connection

#### Scenario: Unsupported provider is rejected

- **WHEN** the owner submits a provider kind outside the supported registry
- **THEN** the system rejects the request without making an outbound call or database write

#### Scenario: Connection ownership is enforced

- **WHEN** an authenticated user addresses another user's provider connection identifier
- **THEN** the system returns the same not-found contract as for a nonexistent connection and reveals no connection metadata

### Requirement: Provider credentials remain confidential

The system SHALL persist AI provider credentials only as versioned authenticated ciphertext bound to the owning user, connection, and provider, using deployment key material dedicated to AI credentials.

#### Scenario: Stored row contains no plaintext credential

- **WHEN** a valid provider connection is committed
- **THEN** its database row contains versioned ciphertext and contains neither the submitted plaintext nor a reversible display fragment

#### Scenario: Settings response never returns secret material

- **WHEN** the owner loads AI settings after configuring a provider
- **THEN** the response reports that a credential is configured without returning plaintext, ciphertext, authentication headers, or credential-derived identifiers

#### Scenario: Ciphertext cannot be transplanted

- **WHEN** ciphertext is evaluated under a different user, connection, or provider identity
- **THEN** authenticated decryption fails closed and no provider request is attempted

#### Scenario: Diagnostics omit credentials

- **WHEN** connection verification, decryption, catalog discovery, or provider inference fails
- **THEN** logs, telemetry, API errors, and UI messages contain no plaintext credential, ciphertext, prompt, generated content, or raw provider response

### Requirement: Provider lifecycle changes are atomic and concurrency-safe

The system SHALL rotate and remove provider connections through owner-scoped commands with optimistic revision checks, and SHALL perform external provider calls outside database transactions.

#### Scenario: Successful credential rotation

- **WHEN** the owner submits a valid replacement credential with the current connection revision
- **THEN** the system atomically replaces the ciphertext, increments the credential and configuration revisions, and invalidates dependent model selections

#### Scenario: Failed rotation preserves current connection

- **WHEN** verification of a replacement credential fails or the provider is temporarily unavailable
- **THEN** the existing ciphertext, verification state, model selections, and revisions remain unchanged

#### Scenario: Stale settings write is rejected

- **WHEN** a connection mutation supplies a revision older than the committed connection revision
- **THEN** the system rejects the mutation with a conflict response and performs no write

#### Scenario: Confirmed removal clears dependent selection

- **WHEN** the owner confirms removal of a provider connection with the current revision
- **THEN** the connection and every model selection referencing it are removed atomically

### Requirement: Provider network destinations are fixed and bounded

The system SHALL send provider verification and catalog traffic only to HTTPS origins and protocols registered by the application for the selected provider.

#### Scenario: Browser cannot supply a provider base URL

- **WHEN** a connection request includes an unrecognized field or attempts to override a provider endpoint
- **THEN** strict validation rejects the request before any outbound call

#### Scenario: Unsafe redirect is rejected

- **WHEN** a registered provider responds with a redirect outside its approved origin policy
- **THEN** the system stops the request and returns a stable provider-network error without forwarding the credential

#### Scenario: Provider response exceeds bounds

- **WHEN** a catalog response exceeds the configured deadline or maximum response size
- **THEN** the system aborts processing, persists no candidate credential, and returns a retryable bounded error

### Requirement: AI Settings truthfully represents readiness

The Settings area SHALL expose localized provider connection and model-readiness states, and AI-dependent controls SHALL remain disabled unless the server reports a verified compatible selection for their required capability profile.

#### Scenario: No AI configuration exists

- **WHEN** the account has no verified provider connection and compatible selected model
- **THEN** AI-dependent controls are disabled and link the owner to the AI Settings tab

#### Scenario: Provider is connected but no model is selected

- **WHEN** a provider connection is verified but no model is verified for the required capability profile
- **THEN** Settings identifies the missing model selection and AI-dependent controls remain disabled

#### Scenario: Compatible model is ready

- **WHEN** the server reports a current verified selection for a feature's capability profile
- **THEN** the feature may enable its AI control while its execution endpoint independently enforces the same readiness check

#### Scenario: English and Spanish settings remain equivalent

- **WHEN** the AI Settings experience exposes a label, state, confirmation, or request-facing failure
- **THEN** corresponding English and Spanish locale entries exist and raw provider error text is not displayed
