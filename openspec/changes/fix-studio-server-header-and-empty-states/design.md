## Context

The server detail route renders a header stack — breadcrumb, title with a "Borrador" badge, base URL, a full sentence about agents not being able to call the server, two status badges, and two action buttons — before the tab strip. `ServerPublicationStatus` already receives `publishedRevisionNumber`, `dirty`, and `publishReady`, and the same facts are then restated by the badges and the sentence. Below it, every Studio list renders its own ad hoc empty case: a bare muted paragraph followed by the shared pagination control showing "0–0 de 0" with both arrows disabled. The server card in the list route renders `enabledToolCount` through the generic `toolCount` string, so a fully disabled server advertises zero tools.

The data needed for all of this is already exposed: `getServer` returns the traffic light, publication state, and dirty flag, and every collection endpoint returns the `@repo/core` `{ items, page, pageSize, total }` envelope. This change is presentation-only.

## Goals / Non-Goals

**Goals:**

- Give the server header one line of identity and one conditional, actionable status statement.
- Make "empty" and "paginated" mean the same thing in every Studio list.
- Stop the server card from misreporting an enabled count as a total.
- Keep every existing draft-versus-published, readiness, and traffic-light guarantee intact.

**Non-Goals:**

- Playground workbench layout, tools toolbar placement, Settings sectioning, and publication diff presentation, all handled by `improve-studio-workbench-flows`.
- Any change to the group rail, its counts, or its drag behavior.
- New API fields, new queries, or additional requests.
- Restyling the marketing site or admin surfaces.

## Decisions

### 1. Header becomes identity plus one derived status line

The identity line keeps the breadcrumb, server icon, name, traffic light, base URL, and the single primary action. Everything the current header says about publication collapses into one derived sentence computed from the fields `ServerPublicationStatus` already receives, in strict precedence: never published → "Aún no se publica" plus the reason; blocked → the blocking reason with a link that opens the publish review; dirty → "Cambios sin publicar" with the publish action; otherwise the active revision identity. Pause/resume moves into the header overflow menu alongside delete, because they are operational rather than primary.

This is preferred over keeping separate badges because the badges and the sentence describe the same two booleans, and a user reading four overlapping signals still cannot tell what to do next.

### 2. One shared list shell owns empty, loading, error, and pagination

A single `StudioListShell` composite renders the loading skeleton, the error line, the empty state, the children table, and pagination, and it renders pagination only when `total > pageSize`. Table headers stay rendered when the collection is empty so the surface still communicates what it would contain. The empty state takes an icon, a title, an optional description, and an optional action, and each caller supplies copy specific to its domain (tools, call logs, revisions, agent tokens, server values, common entries, servers).

This replaces the current per-screen `text-sm text-muted-foreground` paragraphs rather than adding an `isEmpty` prop to `AdminListPagination`, because the suppression decision belongs with the surface that owns the total.

The existing loading rules from `apps/app/AGENTS.md` still apply: `TableRowsSkeleton` for first load of a known layout, and cached data stays visible on background refetch.

### 3. Enabled counts are labeled as enabled

The server card renders the enabled count with a dedicated string ("{n} activas" / "{n} active") and keeps the traffic light as the health signal. No new field is fetched and the total is not added, because the list endpoint does not return it and the detail page is where totals belong.

### 4. Dashboard copy uses a real singular form

The dashboard count gains a `countOne` variant so one server reads "1 servidor". This is a locale correctness fix inside the touched slice, not a dashboard redesign, which stays with the workbench change.

## Risks / Tradeoffs

- **[Losing information in the condensed header]** Four signals become one sentence. → The sentence is derived from the same fields and the publish review still shows the full readiness breakdown; nothing is hidden behind a tooltip.
- **[Shared shell hides pagination when owners want page-size control]** `total <= pageSize` means there is exactly one page. → The page-size control hides with it, which is correct when there is nothing to page through.
- **[Two active changes touch the server detail route]** This change owns the header and list shells; the workbench change owns tab content. → Implementation stays in separate components, and this change archives first.
- **[Empty-state copy drift across locales]** Every new string needs en and es in the same commit. → Locale parity is a verification task with an explicit check.

## Migration Plan

1. Add `StudioListShell` and the empty-state composite, then migrate the servers list and the tools tab first as the reference usage.
2. Migrate call logs, revisions, agent tokens, server values, and common entries to the same shell.
3. Rebuild the server detail header and status derivation, then move operational actions to the overflow menu.
4. Fix the enabled-count label and the dashboard pluralization.
5. Run typecheck, lint, focused app tests, the full suite, formatting, strict OpenSpec validation, and the quality gate.

No data or contract migration is involved; reverting the components restores the previous presentation.

## Open Questions

None. The header precedence order and the pagination suppression threshold are settled above.
