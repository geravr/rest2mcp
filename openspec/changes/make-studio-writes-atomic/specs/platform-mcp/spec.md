## ADDED Requirements

### Requirement: Platform mutations share Studio write semantics
The system SHALL route Platform MCP mutations through the same atomic, revision-aware service commands used by the first-party Studio and SHALL not maintain a weaker agent-specific write path.

#### Scenario: Agent mutation commits completely
- **WHEN** an authorized Platform MCP command supplies the current server revision and valid input
- **THEN** all related configuration, compilation, lifecycle, and revision writes commit together
- **AND** the structured result includes the new revision without secret values

#### Scenario: Agent retry after an unknown outcome is safe
- **WHEN** an agent retries a server-scoped mutation with the same previously observed revision after losing the first response
- **THEN** the retry cannot create a duplicate or overwrite a committed result
- **AND** a revision conflict directs the agent to reread the aggregate before taking further action

#### Scenario: Concurrent browser and agent edits conflict explicitly
- **WHEN** a Studio user and Platform agent mutate the same server from one observed revision
- **THEN** at most one command commits from that revision
- **AND** the losing command receives `MCP_WRITE_CONFLICT` with no partial state or secret material

### Requirement: Platform token replacement is concurrency-safe
The system SHALL replace an account's active Platform token using a locked compare-and-swap operation and a database invariant that prevents multiple unrevoked Platform tokens.

#### Scenario: Concurrent replacement has one winner
- **WHEN** two replacement commands name the same previously observed active Platform token
- **THEN** only one replacement commits
- **AND** the other command returns a conflict instead of silently revoking the winner's newly issued token

#### Scenario: Token failure returns no recoverable plaintext
- **WHEN** token creation or replacement rolls back or its response is lost
- **THEN** no plaintext token is stored in a command receipt, log, error, or telemetry event
- **AND** the caller must inspect token metadata and explicitly revoke or create again

### Requirement: Platform conflicts are recoverable agent outcomes
The system SHALL expose write conflicts and transient fully rolled-back database failures as stable structured Platform MCP outcomes that distinguish reread-required conflicts from retryable infrastructure failures.

#### Scenario: Stale revision requires reread
- **WHEN** a Platform mutation uses a stale revision
- **THEN** the outcome identifies the conflict code, current revision, and affected server
- **AND** it does not instruct the agent to repeat the same mutation blindly

#### Scenario: Fully rolled-back transient failure is retryable
- **WHEN** a transient database failure is known to have rolled back the entire command and automatic retries are exhausted
- **THEN** the outcome marks the failure as retryable
- **AND** it contains no partial-success claim or secret-bearing diagnostic

