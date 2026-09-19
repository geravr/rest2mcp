## 1. Shared Presentation Primitives

- [ ] 1.1 Add a disclosure composite and a counted, individually expandable list group with an internal scroll region, built on existing `@repo/ui` primitives and with no new dependency.
- [ ] 1.2 Add tests for collapse state, count labeling, singular and plural counts, and keyboard reachability of the toggle.

## 2. Publication Review

- [ ] 2.1 Re-render every publication diff category through the counted expandable group, collapse above the design threshold, and remove the duplicated tool-name list from acknowledgement copy.
- [ ] 2.2 Render blocking issues as one row per affected tool with a link that closes the review, switches to the tools tab, and opens that tool's editor.
- [ ] 2.3 Add tests proving the preview payload, acknowledgement requirements, and fingerprint display are unchanged, a 50-tool add renders as one collapsed counted group, and an issue link reaches the correct tool.

## 3. Playground Workbench

- [ ] 3.1 Replace the execution-mode card with one mode control plus one derived statement and delete the duplicated explanatory paragraph.
- [ ] 3.2 Build the searchable tool picker from the existing in-repo search-input plus filter-list pattern over already-loaded tools, and lay the form and result panel side by side with the result panel persistent across input edits.
- [ ] 3.3 Add tests for mode statement singularity, narrowing 50 tools by search, selecting a match, invoke-disabled explanations, and result persistence until the next submit.

## 4. Tools Toolbar and Table

- [ ] 4.1 Move search, the active group label, and the creation actions into one toolbar directly above the table and replace the cap alert with an inline used-versus-limit indicator that keeps creation disabled at the cap.
- [ ] 4.2 Make the table header sticky inside its scroll container, open the editor on row activation with inline controls stopping propagation, and add icon plus tooltip affordances to the enabled and mutation switches.
- [ ] 4.3 Add tests for inline capacity display, disabled creation at the cap, row activation opening the editor, inline controls not opening it, and the existing group and search behavior remaining intact.

## 5. Settings Sections and Connection Sequence

- [ ] 5.1 Split Settings into individually navigable sections (identity, authentication, server values, common entries, danger zone) rendering one at a time with per-section save, keeping section state out of the URL.
- [ ] 5.2 Visually isolate the danger zone with its existing destructive confirmation unchanged.
- [ ] 5.3 Reorder the connection tab into the create-token, copy-URL, configure-client sequence and move transport and error-handling detail behind a disclosure.
- [ ] 5.4 Add tests for single-section rendering, per-section save targeting, URL stability across section changes, danger confirmation, and the connection step order with the disclosure collapsed by default.

## 6. Dashboard Priority

- [ ] 6.1 Make the servers block the dashboard's primary content using only existing query fields, demote account destinations to a compact link row, and add the singular count form for a count of one.
- [ ] 6.2 Add tests for the servers-first ordering with and without servers, absence of invented metrics, and singular and plural count copy in both locales.

## 7. Copy and Verification

- [ ] 7.1 Add every new English and Spanish string in the same change and verify locale parity.
- [ ] 7.2 Run `bun typecheck`, `bun lint`, focused app tests, full `bun test`, and `bunx prettier --write .` with re-verification.
- [ ] 7.3 Exercise the playground, tools table, publish review, Settings, connection, and dashboard in the browser at desktop and narrow widths, then validate the change with strict OpenSpec validation and run the quality gate, addressing all actionable findings.
