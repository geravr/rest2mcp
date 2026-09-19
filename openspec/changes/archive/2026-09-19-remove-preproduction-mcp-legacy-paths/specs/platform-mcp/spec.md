## ADDED Requirements

### Requirement: Platform authoring accepts only canonical commands

Platform MCP SHALL expose only strict typed server and tool authoring commands shared with Studio. Tool create, update, duplicate, and preview inputs SHALL use versioned request definitions; server configuration inputs SHALL use ordered common entries and explicit authentication configuration. Unknown fields SHALL fail validation before ownership lookup, compilation, or persistence, and no compatibility authoring procedures SHALL be registered or advertised.

#### Scenario: Unknown tool field is rejected

- **WHEN** an agent sends a tool field outside the current typed command schema
- **THEN** Platform MCP returns a structured validation failure and writes nothing

#### Scenario: Tool inventory is canonical only

- **WHEN** an authorized agent lists available Platform authoring tools
- **THEN** no compatibility create, update, conversion, or preview procedure is advertised

#### Scenario: Server common entries retain typed origins

- **WHEN** an agent updates a common header bound to an existing config server-value id
- **THEN** Platform persists that binding directly without generating a string map

## MODIFIED Requirements

### Requirement: Platform tool authoring exposes typed bindings

Platform MCP SHALL describe tool authoring with discriminated literal, server-value, and agent-input bindings, stable definition-local ids, an agent-input registry, and typed body variants. Responses SHALL return only the canonical stored request definition and location-aware compile issues so an AI agent can repair a draft using stable identifiers and structured error data.

#### Scenario: Agent repairs a binding by issue path

- **WHEN** preview reports an unresolved agent-input id at a query entry id
- **THEN** the response identifies both ids and the agent can resubmit a corrected definition

#### Scenario: Typed response returns one authoring model

- **WHEN** Platform MCP creates a valid typed tool
- **THEN** its result contains the canonical request definition without a second writable projection

#### Scenario: Literal brace text is unambiguous

- **WHEN** a literal binding contains undeclared brace text
- **THEN** the Platform response preserves it as literal data and does not describe it as another value origin
