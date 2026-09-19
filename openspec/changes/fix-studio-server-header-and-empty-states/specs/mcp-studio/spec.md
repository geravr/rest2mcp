## MODIFIED Requirements

### Requirement: Owner can create and list MCP servers

The system SHALL let an authenticated user create MCP servers they own, each with a name, optional description, an optional server icon asset (`iconAssetId`, with its resolved `iconUrl`), required HTTPS or HTTP `baseUrl`, and a slug unique among that user's servers. The stored `baseUrl` SHALL preserve any path prefix (e.g. `https://api.example.com/v2` keeps `/v2`) and SHALL strip query and fragment. Collection list endpoints SHALL return the `@repo/core` pagination envelope (`items`, `page`, `pageSize`, `total`). Each list item SHALL carry the traffic light, enabled tool count, the timestamp of the most recent call log (or null), and its resolved `iconUrl`. The server list surface SHALL label the enabled tool count as enabled and SHALL NOT present it as the server's total tool count. A user SHALL NOT read or mutate another user's server.

#### Scenario: Create server

- **WHEN** the owner creates a server with name "CRM" and base URL `https://api.example.com`
- **THEN** the system stores a server owned by that user, derives `allowedHosts` to include `api.example.com`, leaves `iconAssetId` null, and returns the server id and slug

#### Scenario: Path prefix preserved

- **WHEN** the owner creates a server with base URL `https://api.example.com/v2`
- **THEN** the stored `baseUrl` is `https://api.example.com/v2` and tool paths resolve under that prefix

#### Scenario: Paginated list is owner-scoped

- **WHEN** user A has two servers and user B has one
- **THEN** user A's list with page=1 returns only A's servers and a `total` of 2

#### Scenario: List items carry activity metadata

- **WHEN** the owner lists servers and one server has three enabled tools and a call logged yesterday
- **THEN** that item reports an enabled tool count of 3, a `lastCallAt` matching that log, and its current `iconUrl`

#### Scenario: Enabled count is not presented as a total

- **WHEN** the owner lists a server that has 50 tools with none enabled
- **THEN** the card labels the count as zero enabled and does not state or imply that the server has no tools

### Requirement: Studio distinguishes draft, published, and operational state

The Studio SHALL display the active published revision, whether the draft differs, draft readiness, and paused/runtime state as separate concepts. Save actions SHALL use draft language, publication SHALL be a distinct action, and pause/resume SHALL remain immediately operational. The server detail header SHALL present server identity on a single line containing exactly one derived status statement, computed in the order never-published, publication-blocked, unpublished-changes, published, and that names the current condition plus its next action instead of restating the same facts as separate badges and sentences. Operational controls such as pause and resume SHALL live in the header overflow menu rather than beside the primary publication action.

#### Scenario: Live server has unpublished changes

- **WHEN** a live server's draft fingerprint differs from its active revision
- **THEN** the server remains labeled live on its published revision and its single status line reports unpublished changes with the publish action

#### Scenario: Never-published server is draft

- **WHEN** a server has no published revision
- **THEN** Studio identifies it as unpublished draft in one status line and does not claim that connected agents can call it

#### Scenario: Blocked publication names the blocker

- **WHEN** publication is blocked by draft errors
- **THEN** the single status line states that publication is blocked and links to the publish review instead of rendering a separate alarm badge

#### Scenario: Operational controls stay immediately effective

- **WHEN** the owner pauses a server with unpublished changes from the header overflow menu
- **THEN** gateway availability stops immediately while both the active revision and dirty draft remain available for resume or editing, and the status line still reports unpublished changes

## ADDED Requirements

### Requirement: Studio list surfaces share empty and pagination states

Every Studio collection surface SHALL render loading, error, empty, populated, and paginated states through one shared presentation contract. An empty collection SHALL render an empty state with an icon, a domain-specific title, an optional description, and an optional action, and SHALL keep column headers visible when the collection is a table. Pagination controls and the page-size control SHALL render only when the reported total exceeds the current page size. These rules apply to the servers list, the tools list, call logs, revisions, agent tokens, server values, and common entries, and SHALL NOT change the underlying paginated queries.

#### Scenario: Empty list offers guidance instead of a bare sentence

- **WHEN** the owner opens call logs for a server that has never been called
- **THEN** the surface renders the empty state with an icon, a title naming the collection, and an explanatory description, and it does not render a "0–0 de 0" counter or disabled page arrows

#### Scenario: Pagination hides when one page holds everything

- **WHEN** a collection reports a total equal to or below the current page size
- **THEN** no pagination or page-size control renders, and the rows still render normally

#### Scenario: Pagination appears once the total exceeds a page

- **WHEN** a collection reports a total greater than the current page size
- **THEN** the pagination and page-size controls render with the reported total

#### Scenario: Empty table keeps its headers

- **WHEN** the owner filters the tools list to a group that contains no tools
- **THEN** the column headers remain visible above the empty state so the surface still communicates what it lists
