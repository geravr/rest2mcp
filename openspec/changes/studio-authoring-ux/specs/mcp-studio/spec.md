# MCP Studio (delta)

## MODIFIED Requirements

### Requirement: Owner can create and list MCP servers

The system SHALL let an authenticated user create MCP servers they own, each with a name, optional description, required HTTPS or HTTP `baseUrl`, and a slug unique among that user's servers. The stored `baseUrl` SHALL preserve any path prefix (e.g. `https://api.example.com/v2` keeps `/v2`) and SHALL strip query and fragment. Collection list endpoints SHALL return the `@repo/core` pagination envelope (`items`, `page`, `pageSize`, `total`). Each list item SHALL carry the traffic light, enabled tool count, and the timestamp of the most recent call log (or null). A user SHALL NOT read or mutate another user's server.

#### Scenario: Create server

- **WHEN** the owner creates a server with name "CRM" and base URL `https://api.example.com`
- **THEN** the system stores a server owned by that user, derives `allowedHosts` to include `api.example.com`, and returns the server id and slug

#### Scenario: Path prefix preserved

- **WHEN** the owner creates a server with base URL `https://api.example.com/v2`
- **THEN** the stored `baseUrl` is `https://api.example.com/v2` and tool paths resolve under that prefix

#### Scenario: Paginated list is owner-scoped

- **WHEN** user A has two servers and user B has one
- **THEN** user A's list with page=1 returns only A's servers and a `total` of 2

#### Scenario: List items carry activity metadata

- **WHEN** the owner lists servers and one server has three enabled tools and a call logged yesterday
- **THEN** that item reports an enabled tool count of 3 and a `lastCallAt` matching that log

#### Scenario: Slug conflict

- **WHEN** the owner creates a second server with a slug already used on their account
- **THEN** the system rejects the request with `MCP_SERVER_SLUG_CONFLICT`

### Requirement: Owner can add a tool from curl

The system SHALL parse a curl command into method, URL, headers, and body and create a tool whose request template carries those values (query params become query template entries, non-auth headers become header entries, body becomes a typed body template). Create MAY include value markings (`{ value, as: "param" | "variable", name, isSecret? }`); each marking SHALL replace every occurrence of that exact value in the templates with a `{{name}}` placeholder, declare a param, or create/update a variable (encrypted when marked secret). When an auth header is detected and not marked, the system SHALL create or update a secret variable with that value plus the matching server default header. The response SHALL report what was captured. The literal secret SHALL NOT be stored on the tool.

#### Scenario: Curl captures credential as variable

- **WHEN** the owner imports `curl -H 'Authorization: Bearer secret' https://api.example.com/v1/items`
- **THEN** the system creates a GET tool for `/v1/items`, stores `secret` as an encrypted secret variable, adds default header `Authorization: Bearer {{...}}`, and the tool itself contains no secret

#### Scenario: Marked value becomes a param

- **WHEN** the owner imports a curl with `?locationId=loc_9` and marks `loc_9` as param `location_id`
- **THEN** the tool query template is `{ "locationId": "{{location_id}}" }` and the tool declares param `location_id`

#### Scenario: Invalid curl

- **WHEN** the owner submits a string that is not a parseable curl command
- **THEN** the system rejects the request with `MCP_CURL_INVALID`

## ADDED Requirements

### Requirement: Owner can preview a curl import without writing

The system SHALL provide a dry-run curl parse that returns the would-be method, path template, query/header/body templates, detected auth suggestion, and the list of literal values available for marking. The dry-run SHALL NOT create or modify any server, tool, or variable.

#### Scenario: Preview returns parsed shape

- **WHEN** the owner submits a valid curl to the preview endpoint
- **THEN** the response describes the parsed request and no tool row exists afterwards

#### Scenario: Preview rejects invalid curl

- **WHEN** the owner submits an unparseable curl to the preview endpoint
- **THEN** the system rejects with `MCP_CURL_INVALID` and writes nothing

### Requirement: Owner can edit and delete tools

The system SHALL let the owner update any tool field (name, description, method, path template, request template, params, `allowMutation`, `enabled`) on a server they own, and delete a tool. Deleting a tool SHALL keep its historical call logs (their `toolId` becomes null). Name uniqueness per server SHALL be enforced on update.

#### Scenario: Edit path template

- **WHEN** the owner updates a tool's path template from `/contacts/{{id}}` to `/contacts/{{contactId}}` and declares param `contactId`
- **THEN** subsequent executions resolve the new template

#### Scenario: Delete tool keeps history

- **WHEN** the owner deletes a tool that has call logs
- **THEN** the tool row is gone and its log rows remain with null `toolId`

#### Scenario: Rename to existing name conflicts

- **WHEN** the owner renames a tool to a name already used on that server
- **THEN** the system rejects with `MCP_TOOL_NAME_CONFLICT`

### Requirement: Owner can delete a server

The system SHALL let the owner delete a server they own in one transaction: that server's call logs, tools, variables, and agent tokens are removed with the server. Other users' servers SHALL NOT be deletable (not-found semantics).

#### Scenario: Delete cascades

- **WHEN** the owner deletes a server with tools, variables, tokens, and logs
- **THEN** no rows for that server remain in any of those tables

#### Scenario: Other user cannot delete

- **WHEN** user B deletes user A's server id
- **THEN** the system rejects with `MCP_SERVER_NOT_FOUND` and nothing is removed

### Requirement: Owner can test server connectivity

The system SHALL provide a connectivity probe that issues a GET to the server's `baseUrl` through the same SSRF guard and host allowlist as execution, rendering server default headers and query (secret variables included), with a 5 second timeout. The probe SHALL return `{ ok, httpStatus, durationMs, appCode? }`, SHALL NOT create a call-log row, and SHALL treat any HTTP response (including 401) as reachable.

#### Scenario: Reachable with auth failure

- **WHEN** the owner tests a server whose upstream answers 401
- **THEN** the probe returns `ok: true` with `httpStatus: 401`

#### Scenario: Blocked host

- **WHEN** the server `baseUrl` resolves to a private address
- **THEN** the probe returns `ok: false` with `MCP_HOST_NOT_ALLOWED` and no upstream connection is made
