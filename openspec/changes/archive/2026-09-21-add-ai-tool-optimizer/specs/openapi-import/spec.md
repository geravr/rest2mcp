## ADDED Requirements

### Requirement: Owner can optionally optimize selected OpenAPI candidates

The OpenAPI import flow SHALL offer AI optimization only after deterministic preview and owner selection, and SHALL preserve importer eligibility, diagnostics, source identity, and security boundaries.

#### Scenario: Selected candidates enter preflight

- **WHEN** the owner requests optimization for selectable preview candidates
- **THEN** the server reparses or refetches the source, verifies the document fingerprint, and creates a write-free authorization plan for exactly those operation keys

#### Scenario: Blocked operation is selected for optimization

- **WHEN** an operation has a deterministic blocking diagnostic
- **THEN** it remains ineligible and AI cannot remove the diagnostic or make it selectable

#### Scenario: Candidate snapshot is sanitized

- **WHEN** an import optimization plan is authorized
- **THEN** the model receives only bounded deterministic candidate structure and documentation, never the raw OpenAPI document, source URL, security values, examples containing values, or server configuration

#### Scenario: Candidate identity changes before authorization

- **WHEN** the source document, server revision, operation selection, or candidate fingerprint changes after preflight
- **THEN** authorization is rejected without calling the model

#### Scenario: AI readiness is unavailable

- **WHEN** the account lacks a verified `structured-text-v1` model
- **THEN** the optional optimization control is disabled while deterministic preview and import remain available

### Requirement: Approved import recommendations remain fingerprint-bound

OpenAPI confirmation SHALL apply owner-selected optimization operations only after recomputing the original document and candidate fingerprints, and SHALL include those operations inside the existing atomic import validation and write.

#### Scenario: Approved recommendation is reviewed before import

- **WHEN** optimization completes for a selectable candidate
- **THEN** the import UI shows the before/after candidate comparison, rejected diagnostics, and advisory-only findings before confirmation

#### Scenario: Document changes after optimization

- **WHEN** confirmation reparses or refetches a document whose fingerprint or candidate definition differs from the completed run
- **THEN** the entire import is rejected without writing tools, groups, or optimization application markers

#### Scenario: Owner manually overrides the final name

- **WHEN** the owner accepts an AI name recommendation and then supplies an explicit final name in import confirmation
- **THEN** the explicit owner name wins while every other selected operation remains fingerprint-validated

#### Scenario: Optimized candidate fails canonical validation

- **WHEN** any selected recommendation produces an invalid definition, compile failure, security violation, duplicate name, or capacity failure
- **THEN** the normal atomic confirmation rolls back all selected candidates and group writes

#### Scenario: Immutable import identity is preserved

- **WHEN** approved recommendations are applied during confirmation
- **THEN** method, path, origin, security requirements, source provenance, deterministic diagnostics, mutation gating, and server authentication remain importer-owned and unchanged

#### Scenario: Optimized import remains draft-only

- **WHEN** optimized candidates import successfully
- **THEN** the created tools exist only in the mutable draft and do not affect active agents until normal publication
