# MCP Publishing

## Purpose

TBD

## Requirements

### Requirement: Publishable server changes remain in a mutable draft

The system SHALL maintain one owner-editable draft for each server separately from its active published revision. Changes to publishable server settings, structural authentication, common bindings, tools, enabled state, mutation permission, and non-secret configuration SHALL update only the draft and SHALL NOT alter gateway discovery or execution until publication succeeds.

#### Scenario: Saving a live tool creates unpublished changes

- **WHEN** an owner saves a valid change to a tool on a live server
- **THEN** the draft revision and draft fingerprint change
- **AND** the active published revision and agent-visible tool remain unchanged

#### Scenario: Exact draft revert becomes clean

- **WHEN** an owner edits publishable configuration and later restores it to the exact active published content
- **THEN** the canonical draft fingerprint matches the published source fingerprint
- **AND** the server no longer reports unpublished changes even if its draft counter advanced

#### Scenario: Operational action does not dirty the draft

- **WHEN** an owner pauses the server, revokes a token, rotates secret material, or changes a presentation-only icon
- **THEN** the action takes effect through its operational boundary
- **AND** it does not change the publishable draft fingerprint or create unpublished changes

### Requirement: Owner can preview publication safely

The system SHALL provide a write-free publication preview for one observed draft revision. The preview SHALL rebuild the complete candidate, compile every enabled tool, validate references and publication invariants, derive deterministic tool/server contract fingerprints, and return blocking issues, warnings, readiness, and a secret-safe structured diff against the active revision.

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

### Requirement: Publication creates one immutable aggregate revision

The system SHALL publish the complete candidate through one server-locked transaction that verifies expected draft and active revision identities, repeats readiness validation, inserts a monotonically numbered immutable revision with its tool/config snapshot, and atomically switches the server's published pointer. A failed command SHALL leave the previous runtime and draft unchanged.

#### Scenario: First publication activates the server

- **WHEN** a never-published server has at least one enabled valid tool and publication succeeds
- **THEN** revision 1 becomes the active published revision and the runtime status becomes live in the same commit

#### Scenario: Existing server switches all tools together

- **WHEN** a live server publishes a ready draft
- **THEN** all server settings, enabled contracts, compiled plans, and non-secret config values switch to the new revision together
- **AND** no request can observe a partially published aggregate

#### Scenario: Stale draft cannot publish

- **WHEN** publication supplies an expected draft revision or active revision id that no longer matches
- **THEN** the command returns a stable conflict and creates no revision or pointer change

#### Scenario: Warning acknowledgement is candidate-bound

- **WHEN** the draft changes after warnings were previewed
- **THEN** the old candidate fingerprint and acknowledgements cannot authorize publication of the new candidate

#### Scenario: Publish retry is idempotent

- **WHEN** a caller repeats the same publish request id and candidate fingerprint after losing a successful response
- **THEN** the system returns the already committed revision without allocating another revision number
- **AND** reuse of that request id for different content returns an idempotency conflict

#### Scenario: No-op publication is rejected

- **WHEN** the canonical draft fingerprint equals the active revision source fingerprint
- **THEN** the system reports that there are no publishable changes and creates no revision

### Requirement: Published revisions are immutable and secret-free

Each published revision SHALL contain the complete structural server configuration, all draft tool definitions and compile state, immutable compiled plans for enabled tools, non-secret config values, schema/compiler versions, actor/source metadata, and deterministic fingerprints. It SHALL reference current secret slots only by stable id and expected metadata and SHALL never contain plaintext or ciphertext secret material.

#### Scenario: Disabled invalid draft is retained but not served

- **WHEN** a disabled draft tool has compile issues while all enabled tools are valid
- **THEN** publication may retain that disabled tool and its safe diagnostics in history
- **AND** the gateway does not advertise or execute it

#### Scenario: Secret rotation preserves revision identity

- **WHEN** an owner rotates material in a secret slot referenced by the active revision
- **THEN** subsequent calls resolve the rotated material immediately
- **AND** the published revision number and contract fingerprint do not change

#### Scenario: Revision rows cannot be edited

- **WHEN** application code attempts to alter a published revision, revision tool, or revision config row
- **THEN** no supported repository/service operation permits the update
- **AND** corrections require a new draft publication

### Requirement: Owner can inspect and restore revision history

The system SHALL expose owner-scoped paginated revision summaries and secret-safe revision details. Restoring a historical revision SHALL replace only publishable draft structure under optimistic concurrency and SHALL NOT change the active pointer, operational status, tokens, icon, or current secret material. A restored draft SHALL require normal preview and publication to affect agents.

#### Scenario: Restore creates unpublished draft changes

- **WHEN** an owner restores a superseded revision to the draft
- **THEN** the active runtime remains on the current revision
- **AND** the restored structure becomes a new dirty draft that can be reviewed and published as a higher revision number

#### Scenario: Missing historical secret is not resurrected

- **WHEN** a restored revision references a secret slot that no longer exists
- **THEN** restore creates an editable draft with a blocking missing-secret issue
- **AND** it does not recreate secret metadata, plaintext, or ciphertext

#### Scenario: Stale restore is rejected

- **WHEN** the draft changed after the caller loaded revision history
- **THEN** restore rejects the stale expected draft revision and preserves the newer draft

### Requirement: Revision retention is bounded and attribution survives cleanup

The system SHALL always retain the active revision and at least the 20 most recent revisions per server. Superseded revisions older than 90 days outside that minimum MAY be deleted with their tool/config children. Call logs SHALL retain denormalized revision and contract identity after revision cleanup.

#### Scenario: Active revision is never collected

- **WHEN** the active revision is older than the retention window and the server has many newer draft or historical records
- **THEN** cleanup preserves the active revision and all rows required for execution

#### Scenario: Old superseded revision is collected safely

- **WHEN** a superseded revision is older than 90 days and outside the 20 most recent
- **THEN** cleanup removes its revision children without deleting draft resources, secret slots, or call-log attribution

### Requirement: Published runtime has no compatibility path

The system SHALL serve product MCP discovery and execution only from an active immutable revision from the first deployment of this capability. Existing development records SHALL remain unpublished drafts or be removed by reset/reseed; the system SHALL NOT backfill them automatically, dual-read mutable rows, shadow a legacy runtime, or fall back when no valid active revision exists.

#### Scenario: Existing development server starts unpublished

- **WHEN** a retained development server has draft tools but no active published revision after migration
- **THEN** its gateway advertises no tools until the owner explicitly reviews and publishes a valid candidate

#### Scenario: Invalid draft has no runtime fallback

- **WHEN** a retained draft cannot compile into a valid revision
- **THEN** publication reports blocking issues and the gateway remains unavailable
- **AND** no mutable tool plan is advertised or executed
