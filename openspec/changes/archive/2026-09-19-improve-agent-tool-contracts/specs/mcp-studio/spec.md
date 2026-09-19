## ADDED Requirements

### Requirement: Studio validates agent-facing contract readiness

The Studio SHALL compile deterministic contract-readiness diagnostics from the same backend contract compiler used by the gateway. A tool SHALL NOT be enabled unless it has a valid human-facing title, nonblank outcome-oriented description, descriptions for every exposed agent input, supported schema constraints, and non-contradictory annotations. Incomplete tools MAY be saved only as disabled drafts. The system SHALL NOT generate placeholder title/description copy to preserve an incomplete enabled tool.

#### Scenario: Missing input description blocks enable

- **WHEN** a new tool exposes required input `contact_id` without a description
- **THEN** the owner may save it disabled but cannot enable it until the description is supplied

#### Scenario: Contradictory annotation blocks enable

- **WHEN** a POST tool is marked read-only
- **THEN** readiness reports the contradiction and the tool is not enabled

#### Scenario: Incomplete development tool is not preserved as enabled

- **WHEN** a development tool lacks required contract copy during the clean migration
- **THEN** the tool is disabled or removed by an explicit development-data reset and no generated placeholder copy is persisted

#### Scenario: Disabled draft supports iterative authoring

- **WHEN** a contract has readiness errors and the owner saves without enabling
- **THEN** the typed request definition and diagnostics persist as a disabled Studio draft and the gateway does not advertise it

### Requirement: Studio previews the exact agent-visible MCP contract

Before enabling a tool, Studio SHALL provide a backend-generated preview of the exact normalized `tools/list` item, including name, title, description, input schema, output schema, annotations, contract version, fingerprint, and readiness diagnostics. The preview SHALL use the unsaved typed definition, perform no writes, and redact secret values, sensitive examples, internal database ids, and resolved credential-bearing URLs.

#### Scenario: Preview matches listed contract

- **WHEN** the owner previews, saves, and enables an unchanged valid definition against unchanged server configuration
- **THEN** the gateway advertises the same normalized contract and fingerprint shown in preview

#### Scenario: Preview explains mutation behavior

- **WHEN** a mutating tool is destructive and non-idempotent
- **THEN** preview displays those exact annotations and safe retry implications before enable

#### Scenario: Preview never resolves secret binding

- **WHEN** a request header references a server secret
- **THEN** preview may describe the binding's effect but contains neither the secret value nor secret-derived text

#### Scenario: Preview is write-free

- **WHEN** contract compilation fails
- **THEN** preview returns location-aware diagnostics without modifying the tool, compiled plan, server values, or enabled state
