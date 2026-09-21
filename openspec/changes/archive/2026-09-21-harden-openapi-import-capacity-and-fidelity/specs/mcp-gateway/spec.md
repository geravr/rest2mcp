## MODIFIED Requirements

### Requirement: Gateway advertises derived input schemas

Each advertised tool SHALL expose a human-facing title, an explicit outcome-oriented description, and a closed `inputSchema` generated from compiled agent inputs. Every exposed property SHALL have a description and SHALL preserve required state, JSON type, supported format, bounds, pattern, enum, examples, sensitivity metadata, and bounded array item semantics. The gateway SHALL advertise the stable result-envelope `outputSchema`, safe behavior annotations, and namespaced contract version/fingerprint metadata. Runtime validation SHALL use the same normalized schema semantics. Tools SHALL be listed in deterministic name order.

#### Scenario: Agent sees constrained input

- **WHEN** `limit` is an optional integer from 1 through 100 with an example and description
- **THEN** the advertised property contains those constraints and does not appear in the required list

#### Scenario: Agent sees constrained array input

- **WHEN** `fields` is a required array whose string items have an enum and whose length is bounded
- **THEN** the advertised schema declares an array with the same item enum and length bounds and runtime validation rejects invalid items or lengths

#### Scenario: String format is preserved

- **WHEN** an input declares supported format `date-time`
- **THEN** both the advertised schema and runtime validation enforce `date-time`

#### Scenario: Sensitive input carries metadata without a value

- **WHEN** an exposed input is marked sensitive
- **THEN** its schema identifies it as write-only/sensitive but contains no example, default, or resolved value that reveals data

#### Scenario: Agent sees behavior annotations

- **WHEN** a DELETE tool is enabled and marked destructive and non-idempotent
- **THEN** its MCP definition advertises the corresponding annotations and does not describe it as read-only

#### Scenario: Tool without inputs is closed

- **WHEN** a tool has no agent inputs
- **THEN** its schema accepts `{}` and rejects unknown properties

#### Scenario: Invalid constraint is not silently dropped

- **WHEN** an input contains an invalid regular expression or incompatible enum value
- **THEN** the tool has a contract-readiness error and is not advertised

## ADDED Requirements

### Requirement: Gateway executes compiled array semantics faithfully

The gateway SHALL execute validated array inputs according to the compiled request definition. JSON body arrays SHALL remain arrays with all supplied items and optional structured fields SHALL be omitted when absent. Supported query arrays SHALL use their declared repeated-key or comma-delimited form serialization. The gateway SHALL NOT serialize supported arrays through generic JSON stringification.

#### Scenario: JSON body receives every array item

- **WHEN** an agent supplies three values to an array-bound JSON body field
- **THEN** the upstream JSON request contains the same three values in order

#### Scenario: Optional array field stays absent

- **WHEN** an optional array-bound JSON body field is not supplied
- **THEN** the upstream JSON object does not contain that field

#### Scenario: Exploded query repeats the key

- **WHEN** an agent supplies `fields=["id", "name"]` to a form query array with explode enabled
- **THEN** the upstream query contains `fields=id&fields=name` after normal URL encoding

#### Scenario: Non-exploded query joins values

- **WHEN** an agent supplies `fields=["id", "name"]` to a form query array with explode disabled
- **THEN** the upstream query contains one `fields=id,name` value after normal URL encoding

#### Scenario: Runtime and advertised validation agree

- **WHEN** an agent supplies a scalar where the advertised contract requires an array
- **THEN** gateway validation rejects the call before any upstream request is made
