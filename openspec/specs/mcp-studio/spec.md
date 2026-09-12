# MCP Studio

## Purpose

Owner-scoped control plane for mapping REST APIs to hosted MCP tools: servers, tools, credentials, and connection snippets.

## Requirements

### Requirement: Owner can create and list MCP servers

The system SHALL let an authenticated user create MCP servers they own, each with a name, optional description, required HTTPS or HTTP `baseUrl`, and a slug unique among that user's servers. Collection list endpoints SHALL return the `@repo/core` pagination envelope (`items`, `page`, `pageSize`, `total`). A user SHALL NOT read or mutate another user's server.

#### Scenario: Create server

- **WHEN** the owner creates a server with name "CRM" and base URL `https://api.example.com`
- **THEN** the system stores a server owned by that user, derives `allowedHosts` to include `api.example.com`, and returns the server id and slug

#### Scenario: Paginated list is owner-scoped

- **WHEN** user A has two servers and user B has one
- **THEN** user A's list with page=1 returns only A's servers and a `total` of 2

#### Scenario: Slug conflict

- **WHEN** the owner creates a second server with a slug already used on their account
- **THEN** the system rejects the request with `MCP_SERVER_SLUG_CONFLICT`

### Requirement: Owner can add REST tools manually

The system SHALL let the owner add a tool with a MCP-safe name unique per server, description, HTTP method, path template, and parameter map (path, query, header, body). GET and HEAD tools SHALL be enabled with `allowMutation` false. POST, PUT, PATCH, and DELETE tools SHALL require `allowMutation` true before they can be enabled. A server SHALL NOT exceed 50 tools.

#### Scenario: Add GET tool

- **WHEN** the owner adds tool `get_contact` with method GET and path `/contacts/{id}`
- **THEN** the tool is stored enabled with `allowMutation` false and source `manual`

#### Scenario: Mutation stays off until allowed

- **WHEN** the owner adds tool `delete_contact` with method DELETE and does not set `allowMutation`
- **THEN** the tool is stored with `allowMutation` false and `enabled` false

#### Scenario: Tool name conflict

- **WHEN** the owner adds a second tool named `get_contact` on the same server
- **THEN** the system rejects the request with `MCP_TOOL_NAME_CONFLICT`

### Requirement: Owner can add a tool from curl

The system SHALL parse a curl command into method, URL, headers, and body and create a tool. Credential-bearing headers (Authorization, api-key style) SHALL NOT be copied into the tool parameter map. If the server already has a `baseUrl`, the tool path SHALL be the remainder after that origin.

#### Scenario: Curl without secrets in the tool

- **WHEN** the owner imports `curl -H 'Authorization: Bearer secret' https://api.example.com/v1/items`
- **THEN** the system creates a GET tool for `/v1/items` and does not store `secret` on the tool

#### Scenario: Invalid curl

- **WHEN** the owner submits a string that is not a parseable curl command
- **THEN** the system rejects the request with `MCP_CURL_INVALID`

### Requirement: Owner can store one encrypted upstream credential

The system SHALL allow at most one credential per server with a recipe-ready scheme (`bearer`, `api_key`, or `header`) plus header name and value location. The secret value SHALL be encrypted at rest and SHALL never be returned by list or get APIs (only `hasSecret`).

#### Scenario: Set credential

- **WHEN** the owner sets a bearer credential with token `abc`
- **THEN** subsequent reads return `hasSecret` true and do not include `abc`

#### Scenario: Replace credential

- **WHEN** the owner sets a credential on a server that already has one
- **THEN** the previous ciphertext is replaced and `hasSecret` remains true

### Requirement: Owner can copy a connection snippet

The system SHALL let the owner create a server-scoped agent token, display the raw token only once at creation, persist only a hash, and return a connection snippet containing the gateway URL `{API_ORIGIN}/mcp/{serverId}` and instructions to send that token as Bearer.

#### Scenario: Token shown once

- **WHEN** the owner creates an agent token
- **THEN** the response includes the raw token and prefix, and later list views show only the prefix and metadata

#### Scenario: Revoke token

- **WHEN** the owner revokes an agent token
- **THEN** that token MUST fail gateway authentication

### Requirement: Records are recipe-ready without secrets

Server, tool, and credential-scheme fields SHALL be sufficient to reconstruct a template later. Ciphertext, agent tokens, and call logs SHALL NOT be part of that template shape.

#### Scenario: Template shape excludes secrets

- **WHEN** a server has tools and a stored credential
- **THEN** the exportable template fields include name, description, baseUrl, allowedHosts, tool mappings, and credential scheme, and exclude ciphertext and tokens
