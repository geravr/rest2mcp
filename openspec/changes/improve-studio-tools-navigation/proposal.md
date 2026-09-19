## Why

Groups shipped as a filter dropdown plus detached toolbar buttons, so group membership is invisible in the tool list, group CRUD is context-free, and moving tools requires a modal round trip. With up to 50 tools and 50 groups per server, owners need visible, direct-manipulation organization and a way to find a tool beyond stepping through pages.

## What Changes

- Replace the group filter dropdown and the toolbar create/rename/delete cluster with a persistent group navigation rail beside the one paginated tool table: `All`, `Ungrouped`, and every group with counts, an inline create control, contextual rename/delete menus, and drop targets for tool rows. Narrow viewports keep a compact filter control.
- Add a group column to the tools table so each row shows its current group.
- Add native drag-and-drop reassignment of a row — or the whole current selection when the dragged row is selected — onto rail targets, keeping the move dialog and row menu for keyboard, bulk, and accessibility flows.
- Extend the selection bar with a direct move-to-group dropdown and a remove-from-group action when a group filter is active.
- Add an optional trimmed name search `q` to the Studio tools list: one escaped, case-insensitive predicate applied to rows and count, combined with the group filter, persisted in the URL, and resetting the page on change.
- Add a filtered context header and actionable empty states while preserving the existing presentation-only group semantics, one paginated table, and owner-scoped not-found contracts.
- Non-goals: nested groups, multi-membership, runtime or Platform MCP exposure, search over method/path/body content, and new frontend dependencies.

## Capabilities

### Modified Capabilities

- `tool-groups`: the Studio filter requirement now specifies the rail presentation, group column, drag reassignment, and direct selection actions instead of only a filter control.

### Added Capabilities

- None. Name search is an ADDED requirement inside `mcp-studio`.

## Impact

API: Studio tools list input schema and `listTools` predicate with service/router tests. SPA: tools tab layout, a new group rail component, route search schema, hook pass-through, en/es localization, and component tests. No database, publication, runtime, or Platform MCP changes; group mutations remain presentation-only.
