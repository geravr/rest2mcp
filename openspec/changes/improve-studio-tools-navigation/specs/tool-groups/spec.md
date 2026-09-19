## MODIFIED Requirements

### Requirement: Studio can filter the paginated tool list by group

Studio SHALL present `All`, `Ungrouped`, and every owned group with its current tool count as a persistent group navigation rail beside the one paginated tool table, falling back to a compact filter control on narrow viewports. The rail SHALL expose inline group creation and contextual rename and delete for each group. The tool table SHALL include a group column identifying each row's current group. Tool list and count queries SHALL apply the same optional group predicate, changing the filter SHALL reset the page to the first page, and the active filter SHALL persist in the route URL. Owners SHALL be able to reassign a tool row — or the whole current selection when the dragged row belongs to it — by dragging it onto a rail target, including `Ungrouped`; the row menu, selection bar, and move dialog SHALL remain available for keyboard, bulk, and accessibility flows.

#### Scenario: Rail shows the bounded group list with counts

- **WHEN** the owner opens the tools tab on a server with two groups
- **THEN** the rail lists `All` and `Ungrouped` plus both groups, each group showing its current tool count, with the active entry highlighted

#### Scenario: Filter one group

- **WHEN** the owner selects group `Invoices` in the rail
- **THEN** the paginated response and total contain only tools assigned to `Invoices`, the page resets, and the URL carries the group

#### Scenario: Filter ungrouped tools

- **WHEN** the owner selects `Ungrouped`
- **THEN** the response contains only tools whose group id is null

#### Scenario: All includes every group

- **WHEN** the owner selects `All`
- **THEN** the existing server-wide pagination behavior includes grouped and ungrouped tools exactly once

#### Scenario: Group membership is visible in the table

- **WHEN** the owner views the unfiltered list containing grouped and ungrouped tools
- **THEN** each grouped row shows its group name in the group column and ungrouped rows show an empty membership cell

#### Scenario: Drag a row onto a group

- **WHEN** the owner drags the `fb_pause_ad` row onto the `Ad Manager` rail entry
- **THEN** the tool is assigned to `Ad Manager` with a revision-checked assignment command and the group counts refresh

#### Scenario: Drag the selection to ungroup

- **WHEN** the owner selects three tools inside the `Ad Manager` filter and drags one selected row onto `Ungrouped`
- **THEN** all three selected tools are removed from the group and no other tool changes

#### Scenario: Contextual group management

- **WHEN** the owner opens the per-group menu on the `Ad Manager` rail entry
- **THEN** rename and delete open the existing group dialogs scoped to that group without touching the toolbar

#### Scenario: Selection bar moves tools directly

- **WHEN** the owner selects two tools and picks a group in the selection bar's move-to control
- **THEN** both tools are assigned to that group in one revision-checked command and the selection clears
