## MODIFIED Requirements

### Requirement: Preview maps representable operations to canonical typed candidates

For each supported operation, the system SHALL deterministically map the operation identifier, summary, description, supported HTTP method, effective path/query/header parameters, supported request body, requiredness, primitive constraints, supported formats, enum values, array item semantics, supported query serialization, and omission behavior into the canonical typed tool definition and compiler preview. `operationId` SHALL be the preferred name source; method plus path SHALL be the fallback. Mapping SHALL preserve the resolved upstream method, literal path, parameter location, server boundary, and authentication requirement exactly rather than modifying them heuristically.

#### Scenario: Typed GET operation is mapped

- **WHEN** a GET operation declares a required string path parameter and an optional integer query parameter
- **THEN** preview returns a typed candidate with a required path agent input, an optional omitted-when-absent query input, and a read-only annotation

#### Scenario: JSON request body is mapped

- **WHEN** an operation has a representable `application/json` request body with supported constraints
- **THEN** preview returns a canonical JSON body graph and agent inputs that preserve those representable constraints

#### Scenario: Variable JSON array remains variable

- **WHEN** a JSON body property declares an array of strings
- **THEN** preview exposes one array-valued agent input and execution sends every supplied item rather than a generated one-element template

#### Scenario: Optional structured property can be absent

- **WHEN** an optional JSON body property is an object or array
- **THEN** preview maps the complete property to an optional structured input whose absence omits the property from the request body

#### Scenario: Supported query arrays preserve serialization

- **WHEN** a query array uses OpenAPI `style=form` with either `explode=true` or `explode=false`
- **THEN** preview records the matching repeated-key or comma-delimited serialization in the canonical definition

#### Scenario: Compatible allOf composition is normalized

- **WHEN** a body property uses a single-entry `allOf` local reference or conflict-free object composition
- **THEN** preview maps the normalized schema without losing required keys or compatible constraints

#### Scenario: Colliding input names are namespaced

- **WHEN** independent request locations normalize to the same MCP input name
- **THEN** preview returns deterministic location/path-aware input names while preserving each original request location and binding

#### Scenario: Upstream path is immutable

- **WHEN** names or schemas are normalized during import
- **THEN** the resulting candidate retains the exact resolved HTTP method and literal upstream path from the OpenAPI operation

#### Scenario: Missing operation id uses fallback

- **WHEN** an operation has no `operationId`
- **THEN** preview returns a deterministic MCP-safe suggested name derived from its method and path

### Requirement: Unsupported semantics are explicit per-operation diagnostics

The importer SHALL NOT silently approximate OpenAPI semantics that the canonical request model cannot preserve. Unsupported methods, external or cyclic references, cookie parameters, multipart/file bodies, unsupported parameter serialization, ambiguous server variables, conflicting schema composition, and unrepresentable request shapes SHALL produce stable blocking diagnostics on only the affected operations. Deprecated or safely ignorable metadata and transport-faithful JSON-body union fallbacks with reduced structural validation SHALL produce stable warnings.

#### Scenario: One unsupported operation does not hide valid operations

- **WHEN** one document contains a valid GET operation and a multipart upload operation
- **THEN** preview marks the GET operation selectable and the upload operation blocked with a location-aware issue

#### Scenario: Unsupported serialization blocks selection

- **WHEN** a parameter requires an array/object serialization style the executor cannot reproduce
- **THEN** that operation cannot be confirmed until it is excluded or the serialization becomes representable

#### Scenario: Conflicting composition blocks selection

- **WHEN** `allOf` branches assign incompatible schemas to the same property
- **THEN** the operation is blocked with a diagnostic pointing to the conflicting composition

#### Scenario: Opaque JSON union warns

- **WHEN** a locally resolved JSON body `oneOf` can be transported faithfully but its branch constraints cannot be represented
- **THEN** preview exposes the complete value as a JSON input and warns that structural validation is reduced

#### Scenario: Deprecated operation warns

- **WHEN** an otherwise supported operation is marked deprecated
- **THEN** preview returns it as selectable with a warning rather than silently enabling or excluding it

### Requirement: Owner can curate an OpenAPI import candidate

Studio SHALL let the owner search and select previewed operations, inspect warnings and blockers, edit suggested tool names, and choose one group strategy: ungrouped, one existing/new group for all selected operations, or first-tag mapping. Selection SHALL be bounded by the remaining capacity derived from the deployment-configured per-server tool cap, not by an independent fixed import batch limit. Confirmation SHALL be unavailable while a selected operation is blocked, names conflict, the tool/group cap would be exceeded, or a referenced group is invalid.

#### Scenario: Common group overrides tags

- **WHEN** the owner selects a common existing group for operations with different OpenAPI tags
- **THEN** every imported tool is assigned to that group and the tag mapping creates no groups

#### Scenario: First-tag mapping

- **WHEN** the owner chooses first-tag mapping and selected operations have `customers` and `invoices` as their first tags
- **THEN** preview shows the existing groups to reuse and missing groups to create before confirmation

#### Scenario: Capacity follows deployment configuration

- **WHEN** the deployment permits 120 tools, the server contains 30 tools, and the document has 79 selectable operations
- **THEN** Studio permits all 79 operations to be selected and confirmed as one atomic import

#### Scenario: Selection stops at remaining capacity

- **WHEN** only 10 tool slots remain and more than 10 selectable operations are visible
- **THEN** Studio selects at most 10 operations, prevents an eleventh selection, and explains the configured server capacity

#### Scenario: Concurrent capacity change is authoritative

- **WHEN** another command consumes remaining capacity after preview but before confirmation
- **THEN** locked confirmation rejects the import with one stable capacity error and persists no selected tool or group
