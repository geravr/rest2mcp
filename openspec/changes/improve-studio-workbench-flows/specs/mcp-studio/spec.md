## MODIFIED Requirements

### Requirement: Studio playground shows upstream HTTP results

When playground invoke returns an executor result (including non-2xx `httpStatus`), the SPA SHALL render the status, duration, and capped body and SHALL link to the call log when `callLogId` is present. It SHALL NOT treat that result as a generic product error toast. A new submit SHALL clear the previous result panel. Tools that cannot run (disabled, mutation not allowed, server paused) SHALL stay selectable with invoke disabled and an explanation. The playground SHALL present execution mode in one control with one derived statement of what that mode means, and SHALL NOT restate the same mode fact in both a control label and a separate explanation. Tool selection SHALL use a searchable list over the already-loaded tools so the owner can reach any tool without scrolling an unbounded native select, and the form and result panel SHALL be laid out side by side so a submitted result remains visible while the owner inspects or edits inputs.

#### Scenario: 401 is visible in the panel

- **WHEN** invoke returns `httpStatus` 401 and a JSON body
- **THEN** the playground shows status 401 and that body, and a toast does not claim a generic upstream product failure

#### Scenario: Disabled tool explains itself

- **WHEN** the owner selects a tool with `enabled` false
- **THEN** invoke is disabled and the copy states the tool is disabled

#### Scenario: Mode is stated once

- **WHEN** the owner switches the playground to draft preview
- **THEN** one statement describes the selected mode and its owner-only effect, and no separate paragraph repeats it

#### Scenario: Tool is reachable by search

- **WHEN** the owner types part of a tool name into the playground tool picker on a server with 50 tools
- **THEN** the list narrows to matching tools and the owner can select one without scrolling the full collection

#### Scenario: Result survives input editing

- **WHEN** the owner changes an agent input after a submit returns
- **THEN** the previous result panel remains visible until a new submit clears it

### Requirement: Owner can copy a connection snippet

The system SHALL let the owner create a server-scoped agent token, display the raw token only once at creation, persist only a hash, and return a connection snippet containing the gateway URL `{API_ORIGIN}/mcp/{serverId}` and instructions to send that token as Bearer. The connection surface SHALL order these as the sequential steps create a token, copy the gateway URL, and configure the client, and SHALL place transport and error-handling detail behind an explicit disclosure rather than in the primary instruction path.

#### Scenario: Token shown once

- **WHEN** the owner creates an agent token
- **THEN** the response includes the raw token and prefix, and later list views show only the prefix and metadata

#### Scenario: Revoke token

- **WHEN** the owner revokes an agent token
- **THEN** that token MUST fail gateway authentication

#### Scenario: Setup path is sequential

- **WHEN** the owner opens the connection tab for a server without tokens
- **THEN** token creation is presented as the first step, the gateway URL and copy control as the second, and Bearer client configuration as the third

#### Scenario: Protocol detail stays reachable

- **WHEN** the owner expands the connection detail disclosure
- **THEN** the non-2xx structured tool error behavior and the credential-handling note are shown without having appeared in the primary path

## ADDED Requirements

### Requirement: Studio tools toolbar keeps list controls adjacent to the table

The Studio tools surface SHALL render search, the active group label, and the tool creation actions in one toolbar directly above the tool table, and SHALL express tool capacity as an inline used-versus-limit indicator in that toolbar instead of a persistent full-width banner. Tool creation actions SHALL remain disabled at the cap. The table header SHALL stay visible while the owner scrolls the table body, activating a tool row SHALL open that tool's editor, and inline row controls SHALL keep their own activation without triggering the row action. The enabled and mutation controls SHALL be distinguishable by more than column position.

#### Scenario: Capacity is inline, not a banner

- **WHEN** a server has reached its tool limit
- **THEN** the toolbar shows the used and limit counts, the creation actions are disabled, and no full-width alert displaces the list

#### Scenario: Row opens the editor

- **WHEN** the owner activates a tool row outside its checkbox, switches, or action menu
- **THEN** the tool editor opens for that tool

#### Scenario: Inline controls keep their own behavior

- **WHEN** the owner toggles a row switch or opens the row action menu
- **THEN** only that control acts and the editor does not open

#### Scenario: Header stays while the body scrolls

- **WHEN** the owner scrolls a long tool table
- **THEN** the column headers remain visible above the rows

### Requirement: Studio Settings groups configuration into navigable sections

Studio Settings SHALL present server configuration as individually navigable sections for identity, authentication, server values, common entries, and the danger zone, rendering one section at a time with its own save action, instead of stacking all sections in one continuous scroll. The danger zone SHALL be visually separated from operational configuration and SHALL keep its existing destructive confirmation. Section selection SHALL be local view state and SHALL NOT change the route or persist server data.

#### Scenario: Sections are reached individually

- **WHEN** the owner opens Settings and selects authentication
- **THEN** only the authentication section renders, with its own save and connection-test actions, and the other sections are not stacked below it

#### Scenario: Danger zone stays destructive and confirmed

- **WHEN** the owner selects the danger zone
- **THEN** server deletion is visually separated from configuration and still requires the existing confirmation before any request is sent

#### Scenario: Section choice does not leak into the URL

- **WHEN** the owner moves between Settings sections
- **THEN** the route search parameters remain unchanged

### Requirement: Owner dashboard leads with MCP servers

The owner dashboard SHALL present the account's MCP servers as its primary block using only fields the existing queries return, and SHALL render account management destinations as a compact secondary row rather than full-height cards above the product content. The dashboard SHALL NOT display invented metrics, activity, or placeholder users, and collection counts SHALL use a grammatically correct singular form for a count of one.

#### Scenario: Servers are the first block

- **WHEN** an owner with at least one server opens the dashboard
- **THEN** the servers block appears first with each server's real status and counts and a direct action to create or open one

#### Scenario: New owner sees the product path

- **WHEN** an owner with no servers opens the dashboard
- **THEN** the dashboard leads with the create-server path instead of account management cards

#### Scenario: Singular count reads correctly

- **WHEN** the dashboard summarizes exactly one server
- **THEN** the count renders in singular form in both English and Spanish
