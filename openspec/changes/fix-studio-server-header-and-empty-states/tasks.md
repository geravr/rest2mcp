## 1. Shared List Presentation

- [ ] 1.1 Add the shared empty-state composite (icon, title, optional description, optional action) and the list shell that renders loading, error, empty, populated, and pagination states, showing pagination and the page-size control only when `total` exceeds the page size.
- [ ] 1.2 Migrate the servers list and the tools tab to the shared shell with domain-specific empty copy, keeping table headers visible when a table is empty.
- [ ] 1.3 Migrate call logs, revisions, agent tokens, server values, and common entries to the shared shell with their own empty copy.
- [ ] 1.4 Add tests proving pagination suppresses at or below one page, appears above it, empty tables keep headers, and each migrated surface renders its empty state.

## 2. Server Header Consolidation

- [ ] 2.1 Rebuild the server detail header as one identity line (breadcrumb, icon, name, traffic light, base URL, primary action) plus a single derived status statement with the never-published, blocked, dirty, published precedence from design decision 1.
- [ ] 2.2 Move pause/resume and other operational server actions into the header overflow menu, keeping their immediate-effect behavior and confirmation copy unchanged.
- [ ] 2.3 Add tests for each status precedence, the blocker link into publish review, the unchanged pause/resume effect, and the absence of duplicated status badges.

## 3. Truthful Counts and Copy

- [ ] 3.1 Label the server card tool count as the enabled count with a dedicated en/es string so an all-disabled server no longer reads as having no tools.
- [ ] 3.2 Add the singular dashboard server-count variant and fix the "1 servidores" rendering.
- [ ] 3.3 Verify English/Spanish parity for every new or changed string and add tests for the enabled-count label and the dashboard singular form.

## 4. Verification and Quality Gate

- [ ] 4.1 Run `bun typecheck`, `bun lint`, focused app tests, full `bun test`, and `bunx prettier --write .` with re-verification.
- [ ] 4.2 Exercise every migrated surface in the browser at desktop and narrow widths, then validate the change with strict OpenSpec validation and run the quality gate, addressing all actionable findings.
