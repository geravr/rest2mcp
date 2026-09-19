## ADDED Requirements

### Requirement: Published config values are revision snapshots

The system SHALL copy non-secret configuration values required by a published candidate into the immutable revision and SHALL resolve published requests from that snapshot rather than current draft value rows. Editing, renaming, changing kind, or deleting draft config SHALL require publication before changing agent behavior.

#### Scenario: Draft config edit does not affect live calls

- **WHEN** an owner changes a non-secret config value used by an enabled published tool
- **THEN** draft preview/testing uses the new value while gateway calls continue using the active revision's snapshot

#### Scenario: Publishing config switches dependents together

- **WHEN** a ready draft with changed non-secret config is published
- **THEN** the new config snapshot and every dependent compiled plan become active in the same revision switch

#### Scenario: Revision diff hides config content

- **WHEN** a config value changes between revisions
- **THEN** publication history reports that configuration changed without returning the old or new value

### Requirement: Published secrets remain operational slots

Published revisions SHALL reference secrets by stable owned slot id and expected kind/owner metadata without copying secret material. Secret value rotation SHALL take effect immediately for the active revision, while structural secret/auth changes SHALL remain draft-only until publication. Deleting a slot referenced by the active revision SHALL be rejected with safe reference guidance.

#### Scenario: Active secret can rotate without publish

- **WHEN** an owner securely rotates ciphertext for a secret slot referenced by the active revision
- **THEN** subsequent published execution resolves the new material without changing the revision contract

#### Scenario: Active secret deletion is blocked

- **WHEN** an owner attempts to delete a secret slot referenced by the active revision
- **THEN** deletion fails and identifies safe affected categories or tools without exposing the secret value

#### Scenario: Unreferenced historical secret can be deleted

- **WHEN** no active revision or current draft references a secret slot but an old retained revision does
- **THEN** the owner may delete the slot material
- **AND** restoring that historical revision later produces a missing-secret readiness issue rather than resurrecting it
