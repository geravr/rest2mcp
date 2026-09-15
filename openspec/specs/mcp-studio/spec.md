# MCP Studio

## Purpose

Owner-scoped control plane for mapping REST APIs to hosted MCP tools: servers, tools, variables, and connection snippets.

## Requirements

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

### Requirement: Owner can add REST tools manually

The system SHALL let the owner add a tool with a MCP-safe name unique per server, description, HTTP method, path template, request template (query, headers, body, `bodyType`), and param metadata. GET and HEAD tools SHALL be enabled with `allowMutation` false. POST, PUT, PATCH, and DELETE tools SHALL require `allowMutation` true before they can be enabled. A server SHALL NOT exceed 50 tools.

#### Scenario: Add GET tool

- **WHEN** the owner adds tool `get_contact` with method GET, path `/contacts/{{contactId}}`, and a required param `contactId`
- **THEN** the tool is stored enabled with `allowMutation` false and source `manual`

#### Scenario: Mutation stays off until allowed

- **WHEN** the owner adds tool `delete_contact` with method DELETE and does not set `allowMutation`
- **THEN** the tool is stored with `allowMutation` false and `enabled` false

#### Scenario: Tool name conflict

- **WHEN** the owner adds a second tool named `get_contact` on the same server
- **THEN** the system rejects the request with `MCP_TOOL_NAME_CONFLICT`

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

### Requirement: Owner can copy a connection snippet

The system SHALL let the owner create a server-scoped agent token, display the raw token only once at creation, persist only a hash, and return a connection snippet containing the gateway URL `{API_ORIGIN}/mcp/{serverId}` and instructions to send that token as Bearer.

#### Scenario: Token shown once

- **WHEN** the owner creates an agent token
- **THEN** the response includes the raw token and prefix, and later list views show only the prefix and metadata

#### Scenario: Revoke token

- **WHEN** the owner revokes an agent token
- **THEN** that token MUST fail gateway authentication

### Requirement: Records are recipe-ready without secrets

Server, tool, and variable-definition fields SHALL be sufficient to reconstruct a template later: name, description, baseUrl, allowedHosts, defaultHeaders, defaultQuery, tool templates, params, and variable names with their `isSecret` flags. Secret values, ciphertext, agent tokens, and call logs SHALL NOT be part of that template shape.

#### Scenario: Template shape excludes secrets

- **WHEN** a server has tools, variables, and defaults
- **THEN** the exportable template includes variable names and flags but no secret values, ciphertext, or tokens

### Requirement: Studio tool fields choose a value origin

The SPA tool authoring form SHALL let the owner set each structured request value (query row, header row, form-body row, and each field of a flat JSON body) to exactly one origin: Fixed, Variable, or Agent. Fixed SHALL show a literal input. Variable SHALL show a picker of that server’s variables and an optional prefix. Agent SHALL show a param name, a description for the agent, a type, and a required flag on or directly under that row. The SPA SHALL compile origins to the existing template contract (`{{name}}` in the stored maps/body and matching `params` entries) and SHALL NOT require the owner to type `{{` as the primary way to attach a variable or agent param.

#### Scenario: Query row marked Agent

- **WHEN** the owner adds query key `locationId`, sets origin to Agent, names the param `location_id`, and enters a description
- **THEN** save stores query `{ "locationId": "{{location_id}}" }` and a param `location_id` with that description

#### Scenario: Header row marked Variable with prefix

- **WHEN** the owner adds header `Authorization`, sets origin to Variable, chooses `api_token`, and sets prefix to `Bearer `
- **THEN** save stores header `{ "Authorization": "Bearer {{api_token}}" }` and does not declare a param named `api_token`

#### Scenario: Fixed query value has no placeholder

- **WHEN** the owner adds query key `limit` with origin Fixed and value `50`
- **THEN** save stores `{ "limit": "50" }` and does not declare a param named `limit`

### Requirement: Studio path is text plus insertable tokens

The SPA tool authoring form SHALL present the path as static text plus insertable tokens. Each token SHALL use origin Variable or Agent (and Agent tokens SHALL collect the agent description inline). Compile SHALL concatenate text and `{{name}}` tokens into `pathTemplate`.

#### Scenario: Path token for an agent id

- **WHEN** the owner sets path text `/contacts/` and inserts an Agent token named `contactId` with a description
- **THEN** save stores `pathTemplate` `/contacts/{{contactId}}` and param `contactId` with that description

#### Scenario: Path token for a variable

- **WHEN** the owner inserts a Variable token `api_version` after `/`
- **THEN** save stores `pathTemplate` `/{{api_version}}` and does not declare a param named `api_version`

### Requirement: Studio tool dialog is a request builder

The create/edit/duplicate tool dialog SHALL show identity (name, description), method and path together, then inner tabs for Query, Headers, and Body. It SHALL NOT show a standalone Params list for values already represented as Agent origins on those parts. Body type `form` SHALL use the same origin rows as query. Body type `json` SHALL use origin rows when the stored body is a flat JSON object, and an Advanced textarea otherwise. Body type `raw` SHALL use Advanced. Advanced SHALL offer variable insert/autocomplete and SHALL list Agent leftovers only for placeholders in that textarea that are not server variables.

#### Scenario: Structured fields do not repeat in a Params list

- **WHEN** the owner sets one Agent query row and no Advanced body placeholders
- **THEN** the dialog does not render a separate Params section listing that query param

#### Scenario: Nested JSON stays Advanced

- **WHEN** the owner edits a tool whose JSON body is a nested object
- **THEN** the Body tab shows the Advanced textarea, not origin rows

### Requirement: Studio infers origins when opening a saved tool

When the owner opens the edit (or duplicate) tool dialog, the SPA SHALL infer origins from stored templates and the server’s variable names: exact or prefixed `{{variable}}` → Variable; exact `{{name}}` that is not a variable → Agent (reusing stored param metadata); any other string → Fixed. Path SHALL be split on `{{name}}` into text and tokens using the same rules.

#### Scenario: Prefixed bearer infers Variable

- **WHEN** the stored header is `Authorization: Bearer {{api_token}}` and `api_token` is a server variable
- **THEN** the Headers tab shows origin Variable, prefix `Bearer `, and variable `api_token`

#### Scenario: Unknown placeholder infers Agent

- **WHEN** the stored query is `{ "q": "{{search}}" }`, `search` is not a variable, and param `search` has a description
- **THEN** the Query tab shows origin Agent with that description

### Requirement: Studio can edit a server variable

The Settings variables list SHALL offer an edit action that opens a dialog. The name SHALL be read-only. The owner SHALL be able to replace the value and change `isSecret`. Secret values SHALL NOT be shown. Rotating a secret or turning a secret into a non-secret SHALL require a newly entered value. Turning a non-secret into a secret MAY reuse the visible current value.

#### Scenario: Rotate secret

- **WHEN** the owner edits secret `api_token`, enters a new value, and saves
- **THEN** the list still shows the secret badge and no plaintext value

#### Scenario: Secret value stays hidden

- **WHEN** the owner opens the edit dialog for a secret variable
- **THEN** the value field is empty and the previous secret is not displayed

### Requirement: Studio confirms variable deletion

The Settings variables list SHALL NOT delete on a single click. The SPA SHALL open a confirm dialog (cancel and destructive confirm). When any loaded tool template or server default contains `{{name}}` for that variable, the dialog SHALL warn that those templates will keep the placeholder.

#### Scenario: Cancel leaves the variable

- **WHEN** the owner clicks delete on `api_token` and cancels the dialog
- **THEN** the variable remains and no delete request is sent

#### Scenario: Referenced variable warns

- **WHEN** a loaded tool header contains `{{api_token}}` and the owner opens delete for `api_token`
- **THEN** the dialog text states that existing templates still reference it

### Requirement: Server defaults use Fixed or Variable origins

The Settings default headers and default query editors SHALL use the same origin-row model as tools, limited to Fixed and Variable (no Agent). Variable rows SHALL include the optional prefix and variable picker.

#### Scenario: Default header from a variable

- **WHEN** the owner sets default header `Version` to origin Variable `api_version`
- **THEN** save stores `{ "Version": "{{api_version}}" }`
