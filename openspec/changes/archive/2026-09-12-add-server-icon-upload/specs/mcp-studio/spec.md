# MCP Studio (delta)

## MODIFIED Requirements

### Requirement: Owner can create and list MCP servers

The system SHALL let an authenticated user create MCP servers they own, each with a name, optional description, optional `iconImage` (a storage access URL or null), required HTTPS or HTTP `baseUrl`, and a slug unique among that user's servers. The stored `baseUrl` SHALL preserve any path prefix (e.g. `https://api.example.com/v2` keeps `/v2`) and SHALL strip query and fragment. Collection list endpoints SHALL return the `@repo/core` pagination envelope (`items`, `page`, `pageSize`, `total`). Each list item SHALL carry the traffic light, enabled tool count, the timestamp of the most recent call log (or null), and `iconImage`. A user SHALL NOT read or mutate another user's server.

#### Scenario: Create server

- **WHEN** the owner creates a server with name "CRM" and base URL `https://api.example.com`
- **THEN** the system stores a server owned by that user, derives `allowedHosts` to include `api.example.com`, sets `iconImage` to null, and returns the server id and slug

#### Scenario: Path prefix preserved

- **WHEN** the owner creates a server with base URL `https://api.example.com/v2`
- **THEN** the stored `baseUrl` is `https://api.example.com/v2` and tool paths resolve under that prefix

#### Scenario: Paginated list is owner-scoped

- **WHEN** user A has two servers and user B has one
- **THEN** user A's list with page=1 returns only A's servers and a `total` of 2

#### Scenario: List items carry activity metadata

- **WHEN** the owner lists servers and one server has three enabled tools and a call logged yesterday
- **THEN** that item reports an enabled tool count of 3, a `lastCallAt` matching that log, and its current `iconImage`

#### Scenario: Slug conflict

- **WHEN** the owner creates a second server with a slug already used on their account
- **THEN** the system rejects the request with `MCP_SERVER_SLUG_CONFLICT`

## ADDED Requirements

### Requirement: Owner can set a custom server icon

The system SHALL let the owner set or clear `iconImage` on a server they own via `updateServer`. The value SHALL be null or a URL pointing at an object the owner uploaded through the existing authenticated storage upload flow under their user scope. The system SHALL NOT accept arbitrary external URLs on update. Clearing `iconImage` SHALL revert the server to automatic icon resolution in the SPA.

#### Scenario: Upload and persist icon

- **WHEN** the owner uploads a PNG to storage and updates the server with the returned access URL
- **THEN** subsequent `getServer` and list responses include that `iconImage` value

#### Scenario: Remove custom icon

- **WHEN** the owner updates the server with `iconImage: null`
- **THEN** the stored value is null and the SPA shows the automatic fallback icon

#### Scenario: Reject foreign storage URL

- **WHEN** the owner updates `iconImage` to a storage URL scoped to another user
- **THEN** the system rejects the request with a validation error and does not change the server

### Requirement: Server icon display uses custom image or DiceBear rings

The SPA SHALL render each owned server's icon using, in order: (1) `iconImage` when set, otherwise (2) a locally generated DiceBear **rings** SVG data URI seeded by the server id. The SPA SHALL NOT use Google's s2 favicon service or text initials as the automatic fallback.

#### Scenario: Custom icon wins

- **WHEN** a server has `iconImage` set
- **THEN** list and detail views show that image for the server icon

#### Scenario: Rings fallback is deterministic

- **WHEN** a server has no `iconImage`
- **THEN** list and detail views show the same rings icon for that server id on every render until an icon is uploaded

#### Scenario: Rings fallback replaces initials

- **WHEN** a server has no `iconImage` and an unparseable `baseUrl`
- **THEN** the SPA still shows the rings icon seeded by server id (not text initials)
