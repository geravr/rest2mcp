## MODIFIED Requirements

### Requirement: Gateway availability matches server state

The gateway SHALL advertise only enabled, successfully compiled tools from the server's one active published revision while runtime status is live. A server without a published revision or with paused status SHALL advertise no callable tools. Mutable draft and invalid/disabled revision tools SHALL remain unavailable to product agents, and published tool ordering SHALL be deterministic.

#### Scenario: Unpublished server lists no tools

- **WHEN** a valid server token connects to a server with no published revision
- **THEN** no callable product tools are returned even if its draft contains enabled valid tools

#### Scenario: Paused server lists no tools

- **WHEN** the owner pauses a server with an active published revision
- **THEN** no callable product tools are returned and the published pointer remains intact

#### Scenario: Dirty draft does not alter listing

- **WHEN** the draft differs from the active revision
- **THEN** repeated gateway listings continue returning the active revision's deterministic tool set and contract identity

#### Scenario: Tool order is stable

- **WHEN** the same published revision is listed repeatedly
- **THEN** tools appear in the same name order with the same revision and contract fingerprints

## ADDED Requirements

### Requirement: Gateway executes one published revision snapshot

The gateway SHALL materialize server settings, one published tool plan, revision config values, and current referenced secret slots from a single committed active revision before upstream execution. A concurrent publication SHALL not change an invocation after materialization, and no gateway path SHALL read mutable draft plans or config.

#### Scenario: Publish races with invocation preparation

- **WHEN** a publication commits while an invocation loads its execution snapshot
- **THEN** the invocation uses either the complete prior revision or the complete new revision
- **AND** it never mixes their settings, plans, config, or contract metadata

#### Scenario: Publish occurs during upstream request

- **WHEN** a new revision becomes active after an invocation has materialized the previous revision
- **THEN** that in-flight request completes using its original immutable snapshot while later requests use the new revision

#### Scenario: Draft row is deleted after publication

- **WHEN** an owner deletes a tool from the mutable draft but has not published that deletion
- **THEN** the active published tool remains discoverable and executable from its revision row

### Requirement: Stale agent contracts fail with refresh guidance

The gateway SHALL NOT fall back to a superseded revision when a client calls a removed tool or supplies input incompatible with the active published contract. Safe not-found or validation errors SHALL include the current published revision number and contract fingerprint plus machine-readable refresh guidance.

#### Scenario: Removed cached tool is called

- **WHEN** an agent calls a tool name removed by the active revision
- **THEN** the gateway contacts no upstream and returns a safe error directing the client to refresh tools

#### Scenario: Cached input schema is stale

- **WHEN** an agent submits input valid for a previous tool fingerprint but invalid for the active revision
- **THEN** validation fails against the active contract and includes current revision identity without exposing draft or historical definitions
