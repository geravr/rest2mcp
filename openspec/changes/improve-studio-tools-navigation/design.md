## Context

The archived `add-openapi-import-and-tool-groups` change delivered owner-managed groups as a `<Select>` filter plus three toolbar buttons, a modal move dialog, and a table without group information. Studio servers hold up to 50 tools and 50 groups, and the tools list currently offers only pagination for navigation. The canonical group semantics are already proven: presentation-only membership, one paginated table with a shared rows/count predicate, `draftMutation: false`, and no runtime or Platform surface. This change reworks the Studio presentation of those semantics and adds a name search to the tools list; it does not introduce a new authoring representation or new group behavior.

## Goals / Non-Goals

**Goals:**

- Make group membership and counts permanently visible without leaving the tools tab.
- Move group CRUD next to the groups themselves instead of detached toolbar buttons.
- Let owners reassign tools by dragging rows — singly or as a selection — while keeping accessible dialog paths.
- Let owners find a tool by name without paging, including inside a group filter.
- Keep one paginated table, the shared rows/count predicate, and all existing owner-scoped and presentation-only guarantees.

**Non-Goals:**

- Nested groups, group ordering controls, multi-membership, or group-scoped runtime behavior.
- Searching method, path, descriptions, or body content; search matches tool names only.
- Any Platform MCP or gateway change, including group metadata exposure.
- Adding drag-and-drop or search dependencies to the workspace.

## Decisions

### 1. The rail is a filter control, so the one-table decision stands

The archived `tool-groups` decision locked "one flat paginated tool list with the same optional group predicate", rejecting expandable per-group tables. A navigation rail only changes the control that sets `?group=`; the table, its pagination, and the shared predicate are untouched. The rail renders on `md+` viewports; below that the existing `ToolGroupFilter` select remains the fallback, so no new responsive layout is invented. The rail active entry mirrors the URL value owned by the parent route, preserving the existing page-reset-on-filter-change behavior.

This is preferred to chips/tabs because 50 groups do not fit a horizontal strip, and preferred to keeping the select because counts and actions stay hidden behind a closed dropdown today.

### 2. Group CRUD lives in the rail, not the toolbar

The rail header carries a create control (disabled at the 50-group cap with the existing conflict/capacity errors). Each group entry gets a hover/focus dropdown with Rename and Delete that opens the unchanged `ToolGroupDialog` flows, including the delete-to-ungroup confirmation. The three toolbar buttons disappear; the toolbar keeps only tool creation and imports. Deleting or renaming acts on the exact entry the owner pointed at, removing the implicit "menus target the filtered group" behavior.

### 3. A group column makes membership visible everywhere

The table gains a muted badge column resolved from the cached groups query by `groupId`. A tool whose group vanished between queries renders an empty cell rather than guessing a name. The column shows the badge in every filter state, including `All` and `Ungrouped`, which is where the current UI is silent about membership.

### 4. Native HTML5 drag and drop, no new dependency

Rows are draggable; rail entries are drop targets (`Ad Manager` → assign, `Sin grupo` → ungroup). The payload is the dragged row, or the whole current selection when the dragged row is selected, so dragging one of twenty selected rows moves all twenty. `dragover` highlights the candidate target and the mutation reuses `useAssignMcpToolGroup` with optimistic-free pending handling and error toasts. Keyboard and screen-reader users keep the row menu, the selection bar, and the move dialog; drag is an accelerator, never the only path. No library is added because a two-target list does not justify `@dnd-kit` and the workspace deliberately avoids frontend dependency growth.

### 5. Selection bar gains direct actions

With rows selected, the bar shows "Move to…" as a dropdown of groups (plus ungroup) so one click completes the move for the common case, while the existing dialog button stays for the full labeled flow. When the active filter is a group, the bar additionally shows "Remove from group", which assigns `groupId: null` for the selection. All actions pass `expectedRevision` and surface `MCP_WRITE_CONFLICT` through the existing recovery path.

### 6. Name search is one escaped predicate in the existing list query

`q` is optional, trimmed, and bounded; empty means unfiltered. `listTools` adds `ilike(name, likeContainsPattern(q))` to the same `where` used for rows and count, combined with the group predicate, so page totals can never diverge from rows. The SPA keeps `q` in the route search schema, debounces the input into the URL, and resets the page on change. LIKE metacharacters match literally through `escapeLikePattern`. Search stays name-only because names are the unique, agent-visible identity owners use in MCP clients; extending to paths later would only widen this predicate.

## Risks / Trade-offs

- **[Drag discoverability]** Native DnD has no built-in affordance. → Add `grabbing` cursors, drop-target highlighting, and keep the always-visible menu/dialog paths as the documented alternative.
- **[Stale counts during drag]** Group counts can lag the assignment mutation. → Counts come from the invalidated groups query after the mutation commits, matching current behavior elsewhere.
- **[Two filter controls to maintain]** Rail and mobile select must stay consistent. → Both render from the same groups query and URL value; the select is the existing component, unchanged.
- **[Search abuse]** Unbounded `q` could scan excessively. → Trim and cap its length; the table is owner-scoped and capped at 50 rows per server, and the predicate applies to one indexed column.
- **[Toolbar density while at tool cap]** Removing group buttons frees space but the cap alert remains. → Cap alert and import buttons keep their current behavior.

## Migration Plan

1. Ship the API `q` predicate with tests, then the SPA search param and hook pass-through.
2. Build the rail and column behind the existing components' contracts (no dialog or hook signature changes beyond adding `q`).
3. Add drag, selection actions, header, and empty states.
4. Update en/es copy and component tests, then run typecheck, lint, focused and full tests, formatting, strict OpenSpec validation, and the quality gate.

No database migration, data backfill, or compatibility path is involved; the previous state is recoverable by reverting the presentation components.
