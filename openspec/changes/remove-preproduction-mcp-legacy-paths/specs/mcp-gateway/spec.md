## ADDED Requirements

### Requirement: Execution has no fallback authoring path

Every execution surface SHALL render upstream requests only from a valid canonical compiled artifact produced from the versioned typed definition, canonical common entries, and explicit authentication configuration. The gateway SHALL NOT analyze template strings, infer value origins, synthesize a compiled plan from an alternate projection, or retry execution through another authoring model. A missing, stale, structurally invalid, or unsupported artifact SHALL make the tool unavailable before any secret resolution or upstream contact.

#### Scenario: Missing canonical artifact is unavailable

- **WHEN** an enabled tool does not have a valid canonical compiled artifact
- **THEN** the gateway does not advertise it and cannot contact upstream for it

#### Scenario: Invalid artifact does not trigger runtime compilation

- **WHEN** the stored execution artifact fails version or structural validation
- **THEN** invocation fails with a stable sanitized configuration outcome and no runtime converter or fallback compiler runs

#### Scenario: Agent data is never reparsed

- **WHEN** an agent argument contains text resembling binding syntax
- **THEN** execution treats it only as validated argument data and does not use it to select or resolve another source

#### Scenario: Owner test shares the fail-closed rule

- **WHEN** Studio playground or Platform test_tool targets a tool without a valid canonical artifact
- **THEN** the owner-facing surface returns structured diagnostics and makes no upstream request
