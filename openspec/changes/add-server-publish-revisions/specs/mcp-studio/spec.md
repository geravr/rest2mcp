## MODIFIED Requirements

### Requirement: Enabled and mutation controls are independent and truthful
The Studio SHALL represent draft availability and mutation permission without silently toggling an unrelated control or implying that a saved draft is already live. A mutating draft tool without permission cannot be enabled; removing permission from an enabled mutating draft tool SHALL explain and confirm the required draft disable. Read tools SHALL never be disabled merely because mutation permission is false. Changes to either control SHALL affect agents only after a successful server publication.

#### Scenario: Read tool remains enabled in the draft
- **WHEN** mutation permission is false for an enabled GET draft tool
- **THEN** the draft tool remains enabled

#### Scenario: Revoking mutation permission is explicit
- **WHEN** the owner revokes mutation permission from an enabled POST draft tool
- **THEN** the UI explains that the draft tool must also be disabled and applies both draft changes only after confirmation

#### Scenario: Saved enablement is not represented as published
- **WHEN** an owner enables, disables, or changes mutation permission on a live server's draft
- **THEN** Studio marks the server as having unpublished changes
- **AND** the active gateway behavior remains on the published revision until publication

## ADDED Requirements

### Requirement: Studio distinguishes draft, published, and operational state
The Studio SHALL display the active published revision, whether the draft differs, draft readiness, and paused/runtime state as separate concepts. Save actions SHALL use draft language, publication SHALL be a distinct action, and pause/resume SHALL remain immediately operational.

#### Scenario: Live server has unpublished changes
- **WHEN** a live server's draft fingerprint differs from its active revision
- **THEN** the server remains labeled live on its published revision and separately shows an unpublished-changes indicator

#### Scenario: Never-published server is draft
- **WHEN** a server has no published revision
- **THEN** Studio identifies it as unpublished draft and does not claim that connected agents can call it

#### Scenario: Pause does not discard draft or revision
- **WHEN** an owner pauses a server with unpublished changes
- **THEN** gateway availability stops immediately while both the active revision and dirty draft remain available for resume or editing

### Requirement: Studio reviews publication before commit
The Studio SHALL provide a publish review surface containing readiness, blocking issues, warnings, safe structured diff, current/candidate contract identity, and an optional bounded note. It SHALL require explicit acknowledgement of candidate-bound warnings and SHALL never show secret/config values in the diff.

#### Scenario: Blocking issue disables publish
- **WHEN** preview reports a blocking compiler, binding, or policy issue
- **THEN** the publish action remains unavailable and Studio links the issue to the affected draft location

#### Scenario: Successful publish refreshes all surfaces
- **WHEN** publication succeeds
- **THEN** Studio shows the new active revision, clears the dirty indicator for the matching draft, refreshes published contract/playground data, and retains revision history

#### Scenario: Publish conflict preserves form work
- **WHEN** publication conflicts with a newer draft or active revision
- **THEN** Studio reloads revision metadata, reports the conflict in the active locale, and does not report publication success or discard unsaved form state

### Requirement: Studio exposes revision history without secret material
The Studio SHALL list paginated revision summaries, display secret-safe change categories and actor/source metadata, and allow an owner to restore a selected revision to the current draft after confirmation.

#### Scenario: History distinguishes Studio and Platform publication
- **WHEN** revisions were published through the SPA and Platform MCP
- **THEN** history identifies each safe source and timestamp without exposing session ids, raw tokens, or secret references

#### Scenario: Restore is visibly draft-only
- **WHEN** an owner restores a prior revision
- **THEN** Studio explains that runtime remains unchanged and requires preview plus a new publication before agents see the restored structure

