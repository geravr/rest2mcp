# MCP Studio (delta)

## MODIFIED Requirements

### Requirement: Owner can create and list MCP servers

The system SHALL let an authenticated user create MCP servers they own, each with a name, optional description, required HTTPS or HTTP `baseUrl`, and a slug unique among that user's servers. The stored `baseUrl` SHALL preserve any path prefix (e.g. `https://api.example.com/v2` keeps `/v2`) and SHALL strip query and fragment. Collection list endpoints SHALL return the `@repo/core` pagination envelope (`items`, `page`, `pageSize`, `total`). A user SHALL NOT read or mutate another user's server.

#### Scenario: Create server

- **WHEN** the owner creates a server with name "CRM" and base URL `https://api.example.com`
- **THEN** the system stores a server owned by that user, derives `allowedHosts` to include `api.example.com`, and returns the server id and slug

#### Scenario: Path prefix preserved

- **WHEN** the owner creates a server with base URL `https://api.example.com/v2`
- **THEN** the stored `baseUrl` is `https://api.example.com/v2` and tool paths resolve under that prefix

#### Scenario: Paginated list is owner-scoped

- **WHEN** user A has two servers and user B has one
- **THEN** user A's list with page=1 returns only A's servers and a `total` of 2

#### Scenario: Slug conflict

- **WHEN** the owner creates a second server with a slug already used on their account
- **THEN** the system rejects the request with `MCP_SERVER_SLUG_CONFLICT`

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

The system SHALL parse a curl command into method, URL, headers, and body and create a tool whose request template carries those values (query params become query template entries, non-auth headers become header entries, body becomes a typed body template). When an auth header is detected, the system SHALL create or update a secret variable with that value plus the matching server default header, and the response SHALL report what was captured. The literal secret SHALL NOT be stored on the tool.

#### Scenario: Curl captures credential as variable

- **WHEN** the owner imports `curl -H 'Authorization: Bearer secret' https://api.example.com/v1/items`
- **THEN** the system creates a GET tool for `/v1/items`, stores `secret` as an encrypted secret variable, adds default header `Authorization: Bearer {{...}}`, and the tool itself contains no secret

#### Scenario: Invalid curl

- **WHEN** the owner submits a string that is not a parseable curl command
- **THEN** the system rejects the request with `MCP_CURL_INVALID`

### Requirement: Records are recipe-ready without secrets

Server, tool, and variable-definition fields SHALL be sufficient to reconstruct a template later: name, description, baseUrl, allowedHosts, defaultHeaders, defaultQuery, tool templates, params, and variable names with their `isSecret` flags. Secret values, ciphertext, agent tokens, and call logs SHALL NOT be part of that template shape.

#### Scenario: Template shape excludes secrets

- **WHEN** a server has tools, variables, and defaults
- **THEN** the exportable template includes variable names and flags but no secret values, ciphertext, or tokens

## REMOVED Requirements

### Requirement: Owner can store one encrypted upstream credential

**Reason**: The single-credential box cannot express Basic auth, two-secret APIs, or secrets in body/query. Server variables (see `mcp-templates`) replace it with one uniform, encrypted, redacted mechanism.

**Migration**: Existing `mcp_credential` rows are backfilled to a secret variable plus a server default header (or per-tool query entries when `valueLocation` was `query`), then the table is dropped. `setCredential` APIs are replaced by variable management.
