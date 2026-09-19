## Context

The Playground currently renders an execution-mode card whose select and its explanatory sentence repeat the same fact, then a full-width native `<select>` listing every tool, an invoke button, and an empty result area. The tools tab keeps its search box floating to the right of the group rail, a permanent full-width alert once the 50-tool cap is reached, and two unlabeled switches per row. Settings stacks seven full-width cards, ending with the destructive zone as just another card. The publish review receives a structured diff and renders its added-tool list as one comma-joined paragraph, then repeats the same names inside the acknowledgement warning. The account dashboard opens with three equal-size account cards and pushes the server summary below the fold.

The data is already sufficient for every fix here: the tools query returns `{ items, total }` with a server-wide tool count on `getServer`, the publication preview already returns structured diff categories, blocking issues, warnings, and acknowledgement requirements, and the OpenAPI import dialog already implements an in-repo searchable list with a plain `Input` plus a filter helper.

## Goals / Non-Goals

**Goals:**

- Make the Playground usable with 50 tools and give the owner a persistent place to read results.
- Keep every control that affects a list adjacent to that list, and state capacity inline instead of as a permanent banner.
- Cut Settings and publish-review scanning cost dramatically without hiding information.
- Make the dashboard lead with the product's real object.
- Preserve every draft-versus-published, readiness, acknowledgement, and secret-safety guarantee.

**Non-Goals:**

- The group rail, its counts, and drag behavior, which shipped in `improve-studio-tools-navigation`.
- Server header consolidation and the shared empty/pagination shell, delivered by `fix-studio-server-header-and-empty-states`.
- New API fields, new tRPC procedures, or additional requests.
- New Radix or third-party UI dependencies.
- Multi-step wizards that block saving; each surface keeps direct, independently saved actions.

## Decisions

### 1. Playground becomes a two-column workbench with one mode statement

An execution-mode strip replaces the mode card: a single segmented control (published revision / draft preview) plus one derived sentence, and the long explanatory paragraph is deleted. The tool picker becomes a searchable list built from the existing pattern in `openapi-import-dialog.tsx` (plain `Input` plus a filter helper over the already-loaded tools), never a native `<select>`, and it adds no dependency. The left column holds the picker and the agent-input form; the right column holds the result panel, which stays mounted so status, duration, capped body, and the call-log link survive re-renders and a new submit clears it as today. Unrunnable tools remain selectable with invoke disabled and an explanation.

### 2. One tools toolbar, capacity stated inline

Search, the group filter's active label, and the creation actions share a single toolbar row directly above the table. The 50-tool alert becomes an inline `used/limit` counter in the toolbar, and the creation buttons disable at the cap exactly as now, so the permanent banner disappears. The table header is sticky inside its scroll container, a row click opens the editor (checkbox, switches, and the row menu stop propagation), and the enabled and mutation switches gain icons plus tooltips so they are not distinguished by position alone.

This is preferred over a per-column filter bar because the group rail already owns filtering; the toolbar only holds what acts on the whole list.

### 3. Settings gains in-page sections with an isolated danger zone

Settings uses a secondary section navigation (identity, authentication, server values, common entries, danger zone) that renders one section at a time, so each form gets a normal-width column instead of seven stacked cards. The danger section keeps the existing confirmation dialog and destructive styling and is separated by an explicit destructive border. Section choice lives in component state, not the URL, because these are not shareable locations and the tab already owns the URL.

### 4. Publication review groups, counts, and links

The review renders each diff category as a collapsible section with a count, defaulting to collapsed above a small threshold, with an internal scroll region, so 50 added tools become "Herramientas añadidas · 50" instead of two paragraphs of names. Acknowledgement warnings reference their grouped detail rather than repeating the full list. Blocking issues render as one row per affected tool with a link that closes the review, switches to the tools tab, and opens that tool's editor. The preview payload, acknowledgement requirement, fingerprint display, and publish command are unchanged; only presentation and navigation are added.

### 5. Connection becomes an ordered setup sequence

The tab presents three numbered steps in order — create an agent token, copy the gateway URL, configure the client with the Bearer header — with the token list attached to step one and the copy control to step two. The transport detail currently in the lead paragraph (structured tool errors for non-2xx upstream responses, curl imports never storing credentials) moves behind a disclosure so the primary path is scannable and the information is still reachable.

### 6. Dashboard leads with servers

The dashboard's primary block becomes the owner's servers with real data (name, traffic light, enabled and total tool counts, last call) plus a direct create action, and profile, security, and privacy collapse into one compact link row beneath it. No metric is invented: the block renders only fields the existing queries already return, satisfying the truthful-dashboard rule in the root `AGENTS.md`.

## Risks / Tradeoffs

- **[Row click versus inline controls]** A clickable row can hijack switch and menu interaction. → Every inline control stops propagation, and the row exposes the editor through the existing menu as well, so nothing is only reachable by clicking the row.
- **[Sticky header inside a scroll container]** Can misalign with the table's own horizontal scroll. → The header sticks within the same scroll container as the body and is verified at desktop and narrow widths.
- **[Collapsing the diff hides review information]** → Sections default collapsed only above the count threshold, each shows its count, and acknowledgement text still summarizes what is being accepted.
- **[One-section-at-a-time Settings hides related fields]** → Section navigation is always visible, and each section keeps its own save action so nothing is lost between sections.
- **[Two active changes touch the server detail route]** This change owns tab content; the header change owns the header and shared shells. → This change is applied after that one archives.

## Migration Plan

1. Land the shared disclosure and collapsible-counted-list composites, then rebuild the publish review on them.
2. Rebuild the Playground workbench and its searchable picker.
3. Rework the tools toolbar, sticky header, row click, and switch affordances.
4. Split Settings into sections and isolate the danger zone.
5. Reorder the connection steps and demote the dashboard account cards.
6. Update en/es copy, run typecheck, lint, focused and full tests, formatting, strict OpenSpec validation, browser verification of each flow, and the quality gate.

Reverting the touched components restores the previous presentation; no persisted shape changes.

## Open Questions

None. The searchable picker reuses the existing in-repo pattern, and section state stays local by decision.
