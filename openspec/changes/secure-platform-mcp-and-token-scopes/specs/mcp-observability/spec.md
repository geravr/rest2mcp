## ADDED Requirements

### Requirement: Owner can inspect Platform PAT activity

The authenticated owner SHALL be able to list Platform PAT metadata and a paginated recent security-event ledger from first-party Settings. Token metadata SHALL include name, safe prefix, scopes, resource mode and selected-server count, policy version, creation, last use, expiration, revocation, and rotation relationship. The Platform MCP itself SHALL NOT expose the account security-event ledger to PATs.

#### Scenario: Multiple token inventory is clear

- **WHEN** an owner has multiple active and recently revoked PATs
- **THEN** Settings identifies each by name and safe prefix with its effective grants and lifecycle timestamps
- **AND** it never displays a raw PAT after its creation response

#### Scenario: Security events are owner-only

- **WHEN** a Platform PAT attempts to discover or call the security-event listing
- **THEN** no such Platform tool is advertised or callable
- **AND** an authenticated first-party owner can retrieve the paginated ledger

#### Scenario: Rotation relationship is visible

- **WHEN** an owner rotates a PAT
- **THEN** inventory metadata identifies the revoked predecessor and active successor without exposing either bearer value

### Requirement: Platform security events are durable and secret-safe

The system SHALL durably record Platform PAT issuance, rotation, revocation, scope/resource denial, failed high-risk step-up, destructive Studio action, and mutating upstream invocation with owner scope and bounded retention. Events SHALL contain only token ids or safe prefix snapshots, public scope names, optional authorized server ids, outcome codes, and bounded non-sensitive metadata. They SHALL NOT contain raw tokens, authorization headers, request arguments or bodies, server-value ids, secret metadata, ciphertext, or decrypted values.

#### Scenario: Grant lifecycle event commits atomically

- **WHEN** PAT creation, rotation, or revocation succeeds
- **THEN** its corresponding security event commits in the same transaction as the lifecycle change
- **AND** failure to persist that event rolls back the lifecycle mutation

#### Scenario: Runtime denial is audited without changing denial

- **WHEN** a valid PAT is denied by scope or resource policy
- **THEN** the caller receives the predetermined safe denial
- **AND** audit persistence failure is reported through secret-safe telemetry without granting access or replacing the denial

#### Scenario: High-risk call event omits arguments

- **WHEN** a PAT performs a destructive Studio operation or mutating upstream invocation
- **THEN** the event records the safe token/resource/action identity and outcome
- **AND** it stores no invocation arguments, request body, response body, or server-value references

#### Scenario: Security events expire

- **WHEN** a Platform security event exceeds the configured 90-day retention
- **THEN** cleanup removes it without changing PAT validity, Studio resources, or execution call logs
