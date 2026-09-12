# MCP Gateway (delta)

## MODIFIED Requirements

### Requirement: Gateway proxies mapped REST calls

For an enabled tool call, the system SHALL render the upstream request from `baseUrl` (including any path prefix), path template, request template, server default headers and query, server variables, and the call arguments, per the `mcp-templates` resolution and escaping rules, then return the upstream body to the MCP client subject to the 256 KiB cap.

#### Scenario: Successful GET

- **WHEN** the agent calls `get_contact` with `{ "contactId": "1" }` and the tool maps to `GET /contacts/{{contactId}}`
- **THEN** the gateway requests `https://{allowed-host}/contacts/1` with rendered default headers and variables, and returns the upstream JSON

#### Scenario: Disabled tool

- **WHEN** the agent calls a tool that exists but is not enabled
- **THEN** the gateway rejects the call and does not contact upstream

#### Scenario: Unresolved placeholder

- **WHEN** the agent calls a tool whose template references a placeholder that neither an argument nor a variable resolves
- **THEN** the gateway rejects with `MCP_TEMPLATE_UNRESOLVED` and does not contact upstream

## ADDED Requirements

### Requirement: Gateway advertises derived input schemas

Each advertised tool SHALL expose an MCP `inputSchema` derived from its declared params: one property per param with the declared JSON type, per-param description when present, and required params listed as required. A tool with no params SHALL advertise an empty-properties object schema.

#### Scenario: Agent sees params

- **WHEN** an MCP client lists tools for a server with tool `get_contact` declaring required param `contactId` (type string, described)
- **THEN** the advertised `inputSchema` has property `contactId` of type string with its description and lists it as required

#### Scenario: Tool without params

- **WHEN** an MCP client lists a tool with an empty params list
- **THEN** the advertised `inputSchema` is an object schema with no properties
