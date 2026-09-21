# openapi-import Specification

## Purpose

TBD - created by archiving change add-openapi-import-and-tool-groups. Update Purpose after archive.

## Requirements

### Requirement: Owner can preview OpenAPI JSON from three source modes

The system SHALL let an authenticated owner preview an OpenAPI document for an owned server from UTF-8 JSON file content, pasted JSON text, or a public HTTPS URL. It SHALL accept OpenAPI 3.0 and 3.1 documents only, enforce bounded document and operation limits, compute a deterministic document fingerprint, and perform no persistent writes during preview.

#### Scenario: Preview pasted OpenAPI JSON

- **WHEN** the owner submits a valid OpenAPI 3.1 JSON document as pasted content
- **THEN** the system returns its version, title when present, fingerprint, operation inventory, suggested names/groups, and diagnostics without changing the server

#### Scenario: Preview uploaded JSON file

- **WHEN** Studio reads a valid UTF-8 JSON file within the size limit and submits its content
- **THEN** the same preview pipeline and result contract used for pasted content is applied

#### Scenario: Unsupported document version

- **WHEN** the owner submits Swagger 2.0, OpenAPI 3.2, YAML, malformed JSON, or a document without a supported OpenAPI version
- **THEN** preview fails with a stable OpenAPI document error and writes nothing

### Requirement: URL document retrieval is SSRF-safe and bounded

The system SHALL fetch an OpenAPI URL only over public HTTPS without userinfo, credentials, cookies, server authentication, or caller-supplied headers. It SHALL validate DNS/IP targets on every hop, allow at most three same-origin redirects, enforce a 10-second deadline and 5 MiB post-decompression limit, and SHALL NOT fetch external references.

#### Scenario: Public URL succeeds

- **WHEN** the owner provides a public HTTPS URL that returns valid bounded OpenAPI JSON
- **THEN** the system retrieves it without credentials and returns the normal write-free preview

#### Scenario: Private address is blocked

- **WHEN** the document URL or any resolved address targets loopback, private, link-local, metadata, or another blocked range
- **THEN** the system rejects the fetch before accepting document content

#### Scenario: Cross-origin redirect is blocked

- **WHEN** the document URL redirects to a different origin or downgrades to HTTP
- **THEN** the system rejects the redirect and writes nothing

#### Scenario: External reference is not fetched

- **WHEN** a document contains a `$ref` whose target is outside the submitted JSON document
- **THEN** affected operations receive a blocking diagnostic and no request is made to the reference target

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

### Requirement: Imported security remains configuration-only

The importer SHALL describe effective OpenAPI security requirements only by safe scheme name, type, and placement. It SHALL NOT persist or return credential values from examples, defaults, extensions, URLs, or security definitions, and SHALL NOT create, rotate, replace, or delete server authentication, server values, secrets, common entries, or defaults.

#### Scenario: Bearer requirement is reported without a value

- **WHEN** an operation requires an HTTP Bearer security scheme
- **THEN** preview reports that Bearer authentication must be configured separately without returning or storing a token

#### Scenario: Existing authentication is untouched

- **WHEN** an owner imports operations into a server with existing authentication
- **THEN** the authentication configuration and all secret material remain unchanged byte-for-byte

### Requirement: Imported operations must match the selected server boundary

The importer SHALL resolve OpenAPI server precedence at operation, path, and document levels and require each selected operation to be compatible with the selected MCP server origin and base-path boundary. Templated or alternative server definitions that cannot be resolved unambiguously against the selected server SHALL block the affected operation.

#### Scenario: Compatible server and base path

- **WHEN** an operation resolves under the selected server's origin and configured base path
- **THEN** the importer derives a relative canonical path within that boundary

#### Scenario: Foreign operation origin

- **WHEN** an operation-level server resolves to a different origin
- **THEN** that operation is blocked rather than widening `allowedHosts` or changing the server base URL

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

### Requirement: OpenAPI confirmation is fingerprint-bound and atomic

Confirmation SHALL resubmit or refetch the source, recompute its canonical fingerprint, require it to equal the previewed fingerprint, and bind the selected operation keys and overrides to that document. After source processing and before writing, the system SHALL lock the owned server, enforce `expectedRevision`, revalidate capacity, names and group ownership, compile every selected canonical definition against the locked aggregate, and create all requested groups and tools in one transaction with exactly one config/draft revision increment.

#### Scenario: Selected tools import atomically

- **WHEN** the unchanged candidate contains three selected valid operations
- **THEN** all three tools and any requested tag-derived groups are committed together, disabled, with mutation permission off, and the server draft changes once

#### Scenario: Document changed after preview

- **WHEN** a URL returns content whose canonical fingerprint differs from the preview
- **THEN** confirmation fails with a stale-preview error and creates no group or tool

#### Scenario: Concurrent server edit

- **WHEN** the server configuration revision changes after preview
- **THEN** confirmation fails with `MCP_WRITE_CONFLICT` and creates no group or tool

#### Scenario: One selected candidate fails compilation

- **WHEN** one selected operation cannot compile against the locked server aggregate
- **THEN** no selected tool or requested group is persisted

### Requirement: OpenAPI imports remain draft-only until normal publication

Every OpenAPI-created tool SHALL have source `openapi`, a valid canonical request definition when import succeeds, `enabled=false`, and `allowMutation=false`. Import SHALL modify only the owner's mutable draft; gateway discovery and execution SHALL continue using the unchanged active published revision until the owner explicitly enables valid tools and publishes a new revision.

#### Scenario: Import does not affect active agents

- **WHEN** the owner imports tools into a server with an active published revision
- **THEN** connected agents continue discovering and executing the same published tool set

#### Scenario: Mutating operation stays gated

- **WHEN** a POST operation is imported successfully
- **THEN** its draft tool is disabled with mutation permission off and cannot be published as callable until the owner explicitly reviews and changes those settings

### Requirement: OpenAPI provenance is secret-safe and restorable

Each imported tool SHALL retain versioned provenance sufficient to identify its import batch and source operation: stable operation key, document fingerprint, generated-definition hash, original tags, OpenAPI version, and sanitized source label. The system SHALL NOT persist the raw document, credential-bearing URL components, examples, or secret values as provenance. Publication restoration SHALL restore provenance for imported tools without including it in agent contracts or runtime fingerprints.

#### Scenario: URL provenance is sanitized

- **WHEN** a document URL contains a query or fragment
- **THEN** persisted provenance omits the query, fragment, userinfo, raw document, and any credential-like value

#### Scenario: Restored imported tool keeps identity

- **WHEN** the owner restores a published revision containing an OpenAPI-imported tool
- **THEN** the reconstructed draft tool retains its safe operation identity and import fingerprint metadata
