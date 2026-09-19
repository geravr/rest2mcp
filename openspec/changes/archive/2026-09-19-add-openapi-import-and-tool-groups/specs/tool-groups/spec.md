## ADDED Requirements

### Requirement: Owner can manage bounded tool groups

The system SHALL let an authenticated owner create, list, rename, and delete up to 50 groups on an owned server. Group names SHALL be non-empty, bounded, and unique per server after normalization. Group reads and writes SHALL use owner-scoped not-found semantics and optimistic server revision checks.

#### Scenario: Create a group

- **WHEN** the owner creates group `Customers` on their server with the current configuration revision
- **THEN** the group is stored for that server and returned in the bounded group list with a tool count of zero

#### Scenario: Normalized name conflict

- **WHEN** the same server already has group `Customers` and the owner attempts to create an equivalent normalized name
- **THEN** the command fails with a stable group conflict and no group is added

#### Scenario: Foreign server is concealed

- **WHEN** a user attempts to list or mutate groups on another user's server
- **THEN** the system returns the same not-found contract used for an unknown server

#### Scenario: Group cap is enforced atomically

- **WHEN** two concurrent commands would exceed the 50-group server limit
- **THEN** at most one commits and the other fails without exceeding the limit

### Requirement: A tool has at most one optional Studio group

Each mutable draft tool SHALL reference either one group belonging to the same server or no group. The database and service layer SHALL reject cross-server group assignments. Manual creation/editing, curl confirmation, and OpenAPI confirmation SHALL accept optional group placement through their Studio-specific commands.

#### Scenario: Manual tool is created in a group

- **WHEN** the owner creates a valid manual tool and selects an owned group on the same server
- **THEN** the draft tool is created with that group assignment

#### Scenario: Tool is moved between groups

- **WHEN** the owner assigns an existing tool to another group with the current configuration revision
- **THEN** only its Studio group membership changes

#### Scenario: Cross-server group is rejected

- **WHEN** a tool command references a group from a different server or owner
- **THEN** the command fails without revealing whether the foreign group exists and without changing the tool

### Requirement: Studio can filter the paginated tool list by group

Studio SHALL present `All`, `Ungrouped`, and every owned group with its current tool count, and SHALL keep one paginated tool table. Tool list and count queries SHALL apply the same optional group predicate, and changing the filter SHALL reset the page to the first page.

#### Scenario: Filter one group

- **WHEN** the owner selects group `Invoices`
- **THEN** the paginated response and total contain only tools assigned to `Invoices`

#### Scenario: Filter ungrouped tools

- **WHEN** the owner selects `Ungrouped`
- **THEN** the response contains only tools whose group id is null

#### Scenario: All includes every group

- **WHEN** the owner selects `All`
- **THEN** the existing server-wide pagination behavior includes grouped and ungrouped tools exactly once

### Requirement: Deleting a group preserves its tools

Deleting a group SHALL atomically set every member tool's group id to null and remove only the group. It SHALL NOT delete, disable, rename, recompile, or otherwise change any member tool.

#### Scenario: Delete populated group

- **WHEN** the owner deletes a group containing three tools
- **THEN** the group is removed and all three tools remain unchanged in `Ungrouped`

### Requirement: Group changes are presentation-only

Creating, renaming, deleting, or assigning groups SHALL increment the broad server configuration revision exactly once per committed command but SHALL NOT increment `draftRevision`, mark publication dirty, change publication candidates or diffs, modify immutable revision rows, alter contract fingerprints, or change gateway discovery/execution.

#### Scenario: Move a published tool between groups

- **WHEN** the owner moves the draft row corresponding to an active published tool into another group
- **THEN** publication remains clean and connected agents observe no tool-list or execution change

#### Scenario: Rename a group

- **WHEN** the owner renames a group containing enabled tools
- **THEN** no tool is recompiled and the active published revision remains unchanged

### Requirement: Revision restore preserves current Studio grouping

Restoring an immutable published revision into the mutable draft SHALL preserve current group assignments for tool ids that survive the restore and whose groups still exist. Restored tools without a surviving assignment SHALL be ungrouped. Group rows themselves SHALL never be created, renamed, deleted, or restored by revision operations.

#### Scenario: Surviving tool retains group

- **WHEN** a grouped tool id exists both before and after revision restoration
- **THEN** the reconstructed draft tool remains in its current Studio group

#### Scenario: Resurrected tool is ungrouped

- **WHEN** restoration recreates a tool id that has no current group assignment
- **THEN** the restored draft tool is placed in `Ungrouped`

### Requirement: Group membership has no Platform MCP surface

Platform MCP read and authoring tools SHALL NOT expose, accept, filter by, or mutate Studio group metadata. Tools created through Platform MCP SHALL be ungrouped, while otherwise retaining their existing draft and publication behavior.

#### Scenario: Platform tool output omits group metadata

- **WHEN** a Platform PAT lists or reads a tool that Studio has grouped
- **THEN** the Platform result is identical to the result for an ungrouped tool except for unrelated tool state

#### Scenario: Platform-created tool is ungrouped

- **WHEN** an authorized Platform MCP caller creates a tool
- **THEN** the resulting draft tool has no Studio group assignment
