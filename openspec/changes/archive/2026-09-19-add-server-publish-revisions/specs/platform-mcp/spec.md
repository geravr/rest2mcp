## ADDED Requirements

### Requirement: Platform authoring uses explicit draft and publish commands

Platform MCP SHALL save authoring changes only to the mutable draft. It SHALL expose publication preview to an authorized author, publication only to a principal with publish scope, safe paginated revision history to read scope, and restore-to-draft to author scope. Platform commands SHALL use the same expected draft/active revision, candidate fingerprint, warning acknowledgement, idempotency, compiler, and transaction contracts as first-party Studio.

#### Scenario: Author save does not change agent runtime

- **WHEN** a Platform PAT with author scope creates or updates a draft tool
- **THEN** the result identifies the new draft revision and unpublished state
- **AND** the product gateway remains on its active published revision

#### Scenario: Author can preview but cannot publish

- **WHEN** a PAT has author scope without publish scope
- **THEN** it may request publish readiness and safe diff
- **AND** `publish_server` is absent or denied before any revision write

#### Scenario: Publish-scoped command switches revisions

- **WHEN** an authorized publish command supplies current expectations, matching candidate acknowledgement, and a new publish request id
- **THEN** it atomically creates/activates the revision and returns its number and contract fingerprint

#### Scenario: Agent retry returns committed revision

- **WHEN** an agent retries the same successful publish request id after an unknown response outcome
- **THEN** Platform MCP returns the existing committed revision rather than publishing a duplicate

#### Scenario: Restore remains a draft operation

- **WHEN** an author-scoped PAT restores a granted historical revision
- **THEN** the draft changes under optimistic concurrency but the gateway pointer does not

### Requirement: Platform revision results stay secret-safe

Platform publication previews, histories, conflicts, and results SHALL return stable ids, revision numbers, fingerprints, safe actor/source metadata, and categorized issues/diffs only. They SHALL omit config values, secret ids/names, ciphertext, raw PATs, session identity, and sensitive literals.

#### Scenario: Platform preview contains auth change category only

- **WHEN** a draft changes authentication or secret bindings
- **THEN** preview reports a structural authentication change and affected safe contracts
- **AND** it returns no binding id or credential-bearing value

#### Scenario: Platform history respects server resource grants

- **WHEN** a resource-restricted PAT requests revision history for an ungranted server
- **THEN** the service returns the same not-found outcome as a nonexistent server and reveals no revision metadata
