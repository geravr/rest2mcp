## MODIFIED Requirements

### Requirement: Owner can add REST tools manually

The system SHALL let the owner create a tool with a unique MCP-safe name, agent-facing description, HTTP method, versioned typed request definition, behavior annotations, mutation policy, and enabled state. The request definition SHALL be the canonical create payload and persistence source. Before writing, the backend SHALL compile the complete effective request and return location-aware issues for invalid references, duplicate ids or names, incompatible types, invalid headers or JSON, GET/HEAD bodies, unsupported optional placements, protected-auth overrides, unsafe paths, or invalid mutation metadata. Invalid tools SHALL NOT be enabled or advertised. The backend SHALL reject creating, duplicating, or importing tools beyond the deployment's configured tool cap, and SHALL reject publishing a candidate whose enabled tools exceed it. The cap defaults to 50 and is validated against a bounded range by the same schema that parses the environment; an unset or blank setting means the default. Lowering the cap below a server's existing tool count leaves the surplus in place until the owner removes it, and blocks further tools and publication until then.

#### Scenario: Add valid typed GET tool

- **WHEN** the owner adds `get_contact` with literal and agent-input path segments referencing stable ids
- **THEN** the typed definition and compiled plan are stored atomically and the enabled tool is available to the gateway

#### Scenario: Fixed braces remain fixed

- **WHEN** the owner creates a tool with a fixed header value `Example {{name}}`
- **THEN** the persisted binding remains literal after save and reopen

#### Scenario: Invalid typed tool is not enabled

- **WHEN** a definition references a missing server-value or agent-input id
- **THEN** save returns a structured issue at that binding and does not enable the tool

#### Scenario: Optional path input is rejected

- **WHEN** the owner marks an agent input used in a path segment as optional
- **THEN** compilation returns a blocking issue explaining that path segments cannot be omitted

#### Scenario: Mutation stays off until allowed

- **WHEN** the owner adds a DELETE tool without explicit mutation permission
- **THEN** the tool remains disabled and is not described as read-only

#### Scenario: Tool name conflict

- **WHEN** the owner adds a second tool with the same normalized name on one server
- **THEN** the system rejects the request with `MCP_TOOL_NAME_CONFLICT`

#### Scenario: Cap follows configuration

- **WHEN** the deployment configures a tool cap and the owner creates tools beyond it
- **THEN** the backend rejects creation with the configured limit, a settings save compiling more enabled tools than the cap is rejected, and a publish whose candidate enables more tools than the cap is rejected with the configured limit and the observed count

#### Scenario: Studio reports the configured cap

- **WHEN** the owner opens a server whose tool count reaches the configured cap
- **THEN** the Studio disables the creation actions and states the server's tool count and the configured limit
