## 1. Contracts and API

- [x] 1.1 Extend the Studio tools list input with an optional trimmed, length-bounded `q` and apply the same escaped, case-insensitive name predicate to page rows and count in `listTools`, combined with the group predicate.
- [x] 1.2 Add service tests for name search: narrowing with pagination parity, combination with `all`/`ungrouped`/group filters, blank query, and literal `%`/`_`/`\` matching.

## 2. SPA Data Layer and Routing

- [x] 2.1 Add `q` to the server detail search schema, reset `page` when it changes, and thread it through `useMcpTools` calls.
- [x] 2.2 Add English/Spanish copy for the rail, contextual group menus, search placeholder, selection bar move-to/remove actions, filtered context header, and empty states.

## 3. Group Rail and Table Rework

- [x] 3.1 Implement the group navigation rail with `All`, `Ungrouped`, and counted groups, active state from the URL value, inline create (disabled at the group cap), and per-group rename/delete menus reusing the existing dialogs.
- [x] 3.2 Rework the tools tab layout to the rail-plus-table composition on `md+` viewports, keeping the existing compact select fallback on narrow viewports and removing the toolbar group cluster.
- [x] 3.3 Add the group column with per-row badges resolved from the groups query, rendering an empty cell for a concurrently missing group.
- [x] 3.4 Implement native drag-and-drop reassignment of rows onto rail targets, selection-aware payloads, drag-over highlighting, and `useAssignMcpToolGroup` submission with conflict recovery; keep menu, selection bar, and dialog paths intact.
- [x] 3.5 Extend the selection bar with a direct move-to group dropdown and a remove-from-group action when a group filter is active, both passing `expectedRevision`.
- [x] 3.6 Add the filtered context header and actionable empty states for an empty group, empty `Ungrouped`, and no tools.

## 4. Search Input

- [x] 4.1 Add a debounced name search input bound to the `q` URL param that resets the page and combines with the active group filter.

## 5. Tests

- [x] 5.1 Extend tools-tab component tests for rail filtering, counts, contextual CRUD entry points, group column, drag reassignment, selection actions, empty states, and the narrow-viewport fallback.
- [x] 5.2 Add component tests for search URL sync, page reset, and combination with group filters, and keep all existing group, curl, and OpenAPI import tests passing.

## 6. Verification and Quality Gate

- [x] 6.1 Run `bun typecheck`, `bun lint`, focused API/app tests, full `bun test`, and `bunx prettier --write .` with re-verification.
- [x] 6.2 Validate the change with strict OpenSpec validation and run the quality gate, addressing all actionable findings.
