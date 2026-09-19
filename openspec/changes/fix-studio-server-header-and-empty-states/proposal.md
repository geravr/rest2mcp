## Why

Every Studio server screen repeats the same publication state up to four times across a header that consumes roughly a third of the viewport before any content appears, and every list surface renders a bare sentence plus disabled pagination controls when it is empty. Two list labels are also actively wrong: the server card reports the enabled tool count under the label "tools", so a server with 50 disabled tools reads "0 herramientas".

## What Changes

- Collapse the server detail header into one identity line (breadcrumb, icon, name, status badge, base URL, primary action) plus a single conditional status banner that names the blocking condition and links to the fix, replacing the duplicated "Borrador" text, the standalone "Aún no se publica…" sentence, and the parallel "Cambios sin publicar" / "Publicación bloqueada" badges.
- Move pause/resume and other secondary server actions into the header overflow menu so the identity line carries one primary action.
- Introduce shared Studio list presentation: a real empty state (icon, title, description, optional action) and pagination that renders only when the total exceeds one page, with table headers still visible when a list is empty. Apply it to tools, call logs, revisions, servers, agent tokens, server values, and common entries.
- Label the server card tool count truthfully as the enabled count instead of presenting it as the total.
- Correct the account dashboard server-count pluralization.
- Non-goals: Playground workbench layout, tools toolbar repositioning, Settings sectioning, publication diff presentation, and any change to draft-versus-published semantics, API contracts, or the group rail delivered by `improve-studio-tools-navigation`.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `mcp-studio`: the draft/published/operational state requirement now specifies the consolidated header and single actionable status banner; the server list requirement now requires a truthful enabled-count label; and a new requirement governs shared empty and pagination presentation for Studio list surfaces.

## Impact

SPA only: `apps/app/routes/(app)/servers/$serverId.tsx` header and tab grouping, `apps/app/routes/(app)/servers/index.tsx` card label, `apps/app/routes/(app)/index.tsx` dashboard count copy, the shared list/pagination helpers under `apps/app/components/`, en/es locale modules, and their component tests. No API, schema, publication, gateway, or Platform MCP change; the underlying state fields already come from `getServer` and the paginated list envelopes.
