# MCP Templates

## Purpose

Server variables with secrecy, request templates with context-aware escaping, declared tool params, and server-level default headers/query — the model that lets one studio express any REST API without per-auth-scheme special cases.

## Requirements

### Requirement: Owner can manage server variables

The system SHALL let the owner create, update, list, and delete named variables scoped to a server they own. Variable names SHALL match `[a-z][a-z0-9_]*` and be unique per server. Each variable SHALL be marked secret or not. Secret values SHALL be encrypted at rest and write-only: reads return `name`, `isSecret`, and `hasValue`, never the secret value. Non-secret values SHALL be stored in plaintext and are readable by the owner.

#### Scenario: Create secret variable

- **WHEN** the owner creates variable `api_token` marked secret with value `sk_live_123`
- **THEN** the value is stored encrypted and subsequent reads show `hasSecret`-style metadata without `sk_live_123`

#### Scenario: Create plain variable

- **WHEN** the owner creates variable `location_id` not marked secret with value `loc_9`
- **THEN** the owner can read back `loc_9` in studio responses

#### Scenario: Variable name conflict

- **WHEN** the owner creates a second variable named `api_token` on the same server
- **THEN** the system rejects the request with `MCP_VARIABLE_NAME_CONFLICT`

#### Scenario: Other user cannot read variables

- **WHEN** user B lists variables for user A's server id
- **THEN** the system rejects the request with `MCP_SERVER_NOT_FOUND`

### Requirement: Requests are defined as templates

A tool SHALL define its upstream request as templates: a path template plus a request template with optional query map, header map, body string, and `bodyType` of `json`, `form`, or `raw`. Any value MAY contain `{{placeholder}}` references. GET and HEAD tools SHALL NOT send a body.

#### Scenario: Template tool stored

- **WHEN** the owner creates a tool with path `/contacts/{{contactId}}/notes`, query `{ "limit": "{{limit}}" }`, and a JSON body template containing `{{content}}`
- **THEN** the tool is stored with those templates and params for `contactId`, `limit`, and `content`

#### Scenario: Raw body is explicit

- **WHEN** the owner sets `bodyType` to `raw`
- **THEN** the body string is sent as-is after placeholder resolution, with no content-type imposed beyond the tool or server headers

### Requirement: Placeholders resolve args-first with context-aware escaping

At execution, each `{{placeholder}}` SHALL resolve from the agent argument of that name first, then from a server variable of that name. An unresolved placeholder SHALL fail the call with `MCP_TEMPLATE_UNRESOLVED` and no upstream request SHALL be made. Escaping SHALL match context: URL-encoding in path and query, CRLF-stripped raw in headers, JSON string escaping for quoted placeholders in JSON bodies, raw JSON values for bare placeholders in JSON bodies, and URL-encoding in form bodies.

#### Scenario: Argument wins over variable

- **WHEN** a server variable `limit` = `10` exists and the agent passes argument `limit` = `50`
- **THEN** the upstream request uses `50`

#### Scenario: Unresolved placeholder

- **WHEN** a template references `{{missing}}` and neither an argument nor a variable provides it
- **THEN** the call fails with `MCP_TEMPLATE_UNRESOLVED` and upstream is not contacted

#### Scenario: Path value is URL-encoded

- **WHEN** the agent passes `contactId` = `a/b c` for path `/contacts/{{contactId}}`
- **THEN** the upstream path contains `a%2Fb%20c`

#### Scenario: Bare JSON placeholder injects raw value

- **WHEN** a JSON body template contains `"address": {{address}}` and the agent passes an object for `address`
- **THEN** the upstream body embeds the object as JSON, not a string

### Requirement: Tools declare agent params

Each tool SHALL store param metadata: name, optional description, required flag, and type (`string`, `number`, `boolean`, or `json`). Save-time validation SHALL warn when a template placeholder has no param entry or a param matches no placeholder; runtime resolution SHALL remain strict per the resolution requirement.

#### Scenario: Param with description stored

- **WHEN** the owner declares param `contactId` as required string with a description
- **THEN** the tool record keeps that metadata for schema derivation

#### Scenario: Placeholder without param warns

- **WHEN** the owner saves a tool whose template references `{{limit}}` with no declared param and no matching variable
- **THEN** the response includes a warning naming `limit`

### Requirement: Server default headers and query

A server SHALL store default headers and default query params whose values are templates. These SHALL apply to every tool call on that server, merged under tool-level entries (tool wins on key conflict). Variables MAY be referenced from defaults.

#### Scenario: Shared version header

- **WHEN** the server has default header `Version: 2021-07-28` and a tool executes
- **THEN** the upstream request includes that header without the tool declaring it

#### Scenario: Tool overrides default

- **WHEN** the server has default header `Accept: application/json` and a tool sets header `Accept: text/csv`
- **THEN** the upstream request sends `text/csv`

### Requirement: Plaintext secrets are rejected in auth positions

Auth-ish header names (Authorization, proxy-authorization, api-key variants) SHALL reject literal values at save time with `MCP_PLAINTEXT_SECRET`, pointing the owner to secret variables. Templated values referencing variables SHALL be accepted. No header SHALL be silently dropped at execution.

#### Scenario: Literal bearer rejected

- **WHEN** the owner saves a header `Authorization: Bearer sk_live_123` as a literal
- **THEN** the system rejects with `MCP_PLAINTEXT_SECRET`

#### Scenario: Templated bearer accepted

- **WHEN** the owner saves a header `Authorization: Bearer {{api_token}}` with secret variable `api_token` defined
- **THEN** the header is stored and renders at execution
