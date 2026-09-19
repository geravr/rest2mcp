## ADDED Requirements

### Requirement: Dependent compiled plans change atomically

The system SHALL compile and persist the complete affected closure of enabled tools in the same transaction as any source configuration change that can alter their effective requests.

#### Scenario: Server-wide request setting recompiles enabled tools

- **WHEN** an owner changes the base URL, allowed hosts, authentication, or common header or query bindings
- **THEN** the system validates and recompiles every affected enabled tool against the candidate configuration
- **AND** the source change and all new compiled plans commit together

#### Scenario: One invalid dependent tool rejects the source change

- **WHEN** a candidate server-wide or variable-metadata change makes any affected enabled tool invalid
- **THEN** the system rejects the whole command with actionable compile issues
- **AND** neither the source configuration nor any compiled plan changes

#### Scenario: Value rotation preserves structural plans

- **WHEN** an owner rotates a config or secret value without changing its kind, owner, or identity
- **THEN** the value update commits atomically without requiring structurally unchanged plans to be rewritten
- **AND** subsequent execution snapshots resolve only the committed value

### Requirement: Variable reference checks are race-safe

The system SHALL serialize variable create, update, and delete commands with tool, common-entry, and authentication mutations for the same server so persisted bindings cannot reference a missing server value.

#### Scenario: Delete races with a new reference

- **WHEN** one command deletes a server value while another command adds a binding to it
- **THEN** the commands serialize on the server aggregate
- **AND** the final committed state either retains both the value and reference or contains neither reference nor value

#### Scenario: Concurrent same-name creation remains singular

- **WHEN** concurrent commands create or set a value with the same normalized name
- **THEN** at most one value row with that server and name commits
- **AND** the losing command returns a stable conflict or duplicate-name error without changing another row

#### Scenario: Kind transition validates every protected placement

- **WHEN** a value changes between config and secret kinds
- **THEN** the system validates authentication and other secret-required placements before committing
- **AND** an invalid transition leaves the original encrypted or plaintext representation unchanged

### Requirement: Authentication transitions are atomic and secret-safe

The system SHALL treat authentication configuration, auth-owned secret values, replaced-value cleanup, dependent compilation, and the revision increment as one server command.

#### Scenario: Authentication replacement commits as a unit

- **WHEN** an owner replaces one authentication recipe with another valid recipe
- **THEN** the new auth-owned values, authentication bindings, dependent plans, and cleanup of no-longer-used auth values commit together

#### Scenario: Authentication compilation failure rolls back secret rotation

- **WHEN** the candidate authentication makes an enabled tool invalid or a database statement fails
- **THEN** the prior authentication and auth-owned values remain active
- **AND** no plaintext or ciphertext is included in the error, telemetry, or conflict details
