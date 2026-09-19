## Why

The Studio's working surfaces were built one screen at a time and now fight each other for attention: the Playground explains its draft mode twice and then hides the tool picker behind a native select that cannot be used with 50 tools; the tools tab floats its search box away from the table it filters and parks a permanent limit banner above everything; Settings stacks seven full-width cards into one long scroll with the destructive zone inline; the publish review dumps up to 50 tool names as comma-separated prose, twice; and the account dashboard buries the product under three account cards.

## What Changes

- Rebuild the Playground as a two-column workbench: one execution-mode strip that states the mode once, a searchable tool picker, the agent-input form, and a persistent result panel with status, duration, body, and the call-log link.
- Give the tools tab one toolbar that keeps search, the group filter, the creation actions, and an inline `used/limit` capacity counter adjacent to the table, replacing the permanent cap banner; make the table header sticky, open the editor on row click, and label the enabled and mutation switches with icons and tooltips instead of position alone.
- Split Settings into navigable sections (identity, authentication, server values, common entries, danger zone) with the destructive section visually isolated, replacing the single long card stack.
- Present the publication review as grouped, collapsible, counted lists instead of comma-joined name blobs, and render blocking issues as a per-tool list that links to the affected draft tool.
- Turn the connection tab into an ordered setup sequence (create token, copy URL, configure client) with protocol detail behind a disclosure.
- Lead the account dashboard with the owner's MCP servers as the primary block and demote profile, security, and privacy to a compact link row.
- Non-goals: the group rail and its counts, server header consolidation, shared empty and pagination states, and any API, schema, publication, gateway, or Platform MCP change.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `mcp-studio`: the playground result requirement now specifies the workbench layout, single mode statement, and searchable picker; the connection snippet requirement now specifies the ordered setup sequence; and new requirements govern the tools toolbar, Settings sectioning, and the dashboard's primary block.
- `mcp-publishing`: the publication preview requirement now specifies grouped counted diff lists and per-tool blocking issue presentation.

## Impact

SPA only: `apps/app/components/servers/` playground, tools tab, settings tab, connection tab, and publish review dialog, the `(app)` dashboard route, the shared disclosure and collapsible-list composites, and en/es locale modules with component tests. Publication preview data, tool list queries, and token contracts are consumed exactly as they are today; the review surface re-groups fields the preview already returns.
