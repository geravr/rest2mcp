## MODIFIED Requirements

### Requirement: Owner can preview publication safely

The system SHALL provide a write-free publication preview for one observed draft revision. The preview SHALL rebuild the complete candidate, compile every enabled tool, validate references and publication invariants, derive deterministic tool/server contract fingerprints, and return blocking issues, warnings, readiness, and a secret-safe structured diff against the active revision. The review surface SHALL render each diff category as a counted, individually expandable group rather than as comma-joined prose, SHALL NOT repeat a full affected-tool list inside its acknowledgement copy, and SHALL render each blocking issue as a row naming its affected tool with a link that opens that tool in the tools surface. Grouping and navigation SHALL NOT change the preview payload, the acknowledgement requirements, the displayed fingerprints, or the publish command.

#### Scenario: Valid preview identifies exact candidate

- **WHEN** a draft is publish-ready
- **THEN** preview returns its observed draft revision, active revision identity, candidate fingerprint, contract fingerprint, safe diff, and warning acknowledgement requirements
- **AND** it writes no revision, plan, pointer, or value row

#### Scenario: Invalid enabled tool blocks readiness

- **WHEN** any enabled draft tool has a compile error, missing binding, or invalid runtime policy
- **THEN** preview returns location-aware blocking issues and marks the aggregate not ready
- **AND** valid tools are not published independently

#### Scenario: Diff omits values and secret identity

- **WHEN** authentication, a config value, or a secret binding changes
- **THEN** the diff reports only safe change categories and affected safe tool names
- **AND** it contains no config value, secret id/name, literal classified sensitive, ciphertext, or credential material

#### Scenario: Connection test is not implicit

- **WHEN** an owner previews publication
- **THEN** the system performs no upstream HTTP request
- **AND** an absent or stale explicit connection test may appear only as a warning

#### Scenario: Large tool change set stays scannable

- **WHEN** the candidate adds 50 tools
- **THEN** the review shows a collapsed group labeled with the added-tool count that expands to a scrollable list
- **AND** the acknowledgement text for that warning does not repeat all 50 names

#### Scenario: Blocking issue links to its tool

- **WHEN** a blocking issue names a draft tool
- **THEN** the review offers a link that closes the dialog, opens the tools surface, and starts that tool's editor
- **AND** publication remains unavailable until the underlying issue is resolved
