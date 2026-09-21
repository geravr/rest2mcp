## Context

The OpenAPI importer currently applies two unrelated limits: documents contain at most 200 inventoried operations, while confirmation accepts at most 50 selections even when `MCP_MAX_TOOLS_PER_SERVER` permits more. Studio selects every importable operation, so a valid preview can produce a transport-level rejection before the authoritative server-capacity check runs.

The mapper also treats an OpenAPI array schema as a canonical JSON array containing one generated item node. That body graph describes a fixed one-element template rather than a variable-length agent value. Query entries have no serialization metadata, so the executor can only append one stringified value. Optional structured properties, schema composition, and normalized input-name collisions expose related gaps between valid OpenAPI semantics and the canonical request model.

The import pipeline must remain deterministic, secret-safe, origin-bound, fingerprint-bound, and atomic. Imported tools remain disabled with mutation permission off, and active agents continue reading only immutable published revisions.

## Goals / Non-Goals

**Goals:**

- Make confirmation capacity follow the configured per-server tool cap without an independent 50-operation product limit.
- Preserve variable-length JSON arrays and supported query-array serialization from authoring through MCP contract validation and upstream execution.
- Preserve omission of optional structured JSON fields.
- Support a conservative, deterministic subset of `allOf` and an explicit opaque-JSON fallback for transport-safe `oneOf` bodies.
- Resolve importer-generated input-name collisions without changing the upstream HTTP contract.
- Keep every newly selectable operation compiler-valid and executable with the same semantics advertised to agents.

**Non-Goals:**

- AI-assisted review or authoring.
- Changes to upstream methods, literal paths, base URLs, allowed hosts, or authentication.
- YAML, Swagger 2.0, external reference retrieval, cookie parameters, multipart, or file uploads.
- General JSON Schema intersection/union validation beyond the bounded subsets described below.
- Compatibility readers, dual execution, or runtime backfills for superseded pre-production request definitions.

## Decisions

### 1. Separate document bounds from server capacity

`MCP_OPENAPI_LIMITS.maxSelection` will be removed. The confirmation transport schema will remain bounded by `maxOperations`, because a valid preview cannot contain more operation keys than that document-level limit. Product capacity will be calculated as `max(0, configuredToolLimit - currentToolCount)` and shown by Studio.

Studio will stop accepting additional selections when remaining capacity is reached, and “select all” will select at most the remaining capacity. Confirmation will still lock the owned server and re-count tools before insertion; the UI projection is informative, while the locked service check is authoritative.

This is preferred over chunked confirmation because the existing all-or-nothing fingerprint and revision semantics are valuable. The transaction may contain up to the bounded document size, but parsing and mapping remain outside the lock and no network I/O occurs while locked.

### 2. Introduce a new canonical definition version with array-valued agent inputs

The request-definition version will be bumped and the old version removed from active authoring/runtime code. `McpAgentInput` will add an `array` type with a bounded item descriptor, item constraints for supported primitive types, and bounded `minItems`, `maxItems`, and `uniqueItems` metadata. Object-shaped items may use the existing `json` item type when their complete structure cannot be represented without loss; this preserves the runtime value and emits an explicit reduced-validation warning.

The compiler, contract builder, Studio editor/preview, publication fingerprinting, playground, and executor will consume the same array definition. Runtime validation will produce an actual array, not a JSON-encoded string.

For JSON request bodies, OpenAPI arrays will bind the complete agent-supplied array to the body root or object field. The existing body-graph array node remains available for intentionally fixed arrays, but the importer will not use a single generated item as a variable-array surrogate.

Alternative considered: map all arrays to generic `json`. This preserves transport shape but produces weak MCP schemas and loses primitive item validation, so it is retained only as a diagnosed fallback for structures outside the bounded array item model.

### 3. Add explicit query serialization to canonical named entries

Query entries and compiled query plan entries will carry a bounded serialization discriminator. The first supported forms are OpenAPI `style=form` arrays with:

- `explode=true`: one repeated query key per item.
- `explode=false`: one comma-delimited query value.

Scalar query behavior remains unchanged. Array serialization for headers, paths, cookies, deep objects, space-delimited, and pipe-delimited styles remains blocking until represented explicitly. The executor will serialize from validated array values and will never depend on JavaScript object stringification for supported array parameters.

### 4. Prefer whole-subtree inputs when omission cannot be expressed faithfully

An optional structured body property will map to one optional `json` or `array` agent input for the complete property. This allows the existing full-field omission rule to remove the key when the input is absent. Required structured objects may continue to expand into granular child inputs.

Alternative considered: add presence conditions to every constructed JSON subtree. That is more expressive but introduces a second conditional language into the body graph. Whole-subtree binding is smaller, deterministic, and faithful to optionality.

### 5. Normalize only conflict-safe schema composition

Schema normalization will run after bounded local reference expansion and before request mapping:

- A single-entry `allOf` is unwrapped while preserving compatible sibling annotations and constraints.
- A multi-entry `allOf` is merged only when every branch is object-shaped, required keys can be unioned, and duplicate properties are structurally equivalent or can be combined without contradictory constraints.
- Cycles, incompatible types, conflicting property definitions, and unsupported keywords remain blocking with a pointer to the conflicting composition.

For `oneOf`/`anyOf` in a JSON body position, the importer may bind the complete value as `json` only when every branch is locally resolved, contains no forbidden transport semantics, and sending the selected JSON value is faithful even though branch validation is reduced. The candidate remains selectable with a stable reduced-validation warning. Other union positions remain blocking.

### 6. Namespace colliding importer inputs deterministically

The importer will assign names from the complete request location rather than rejecting normalized duplicates. Non-colliding inputs keep their concise names. Every member of a collision set receives a stable prefix/path, such as `path_campaign_group_id`, `query_type`, or `body_media_name`; long names are deterministically truncated with a hash suffix.

The importer will not infer that independently declared path, query, header, or body fields should share one value. Reuse occurs only where OpenAPI parameter override/merge has already established one effective parameter. Stable internal binding ids remain the source of truth.

Literal path segments, parameter positions, method, server boundary, and auth configuration are copied only from deterministic source resolution and cannot be changed by collision handling.

### 7. Keep diagnostics explicit and localized

New stable warning/error codes will distinguish reduced schema validation, conflicting composition, unsupported serialization, and exhausted server capacity. Transport schemas will bound payload size, but owner-facing capacity failures will come from domain validation so Studio can render one localized English/Spanish message rather than raw Zod issue arrays.

### 8. Validate with minimized real-world regression fixtures

Tests will use minimized fixtures for the HighLevel patterns rather than depending on a live URL or committing the entire upstream document. Unit tests will cover mapping and normalization; compiler/contract/executor tests will prove advertised and executed array semantics; service integration tests will prove atomic capacity behavior; SPA tests will cover selection controls and localized errors.

## Risks / Trade-offs

- **[Larger confirmations hold the server lock longer]** → Keep the 200-operation document bound, perform fetch/parse/map before locking, perform no network I/O under the lock, retain transaction telemetry, and add a worst-case integration test.
- **[Array support expands a cross-cutting versioned contract]** → Bump the definition/compiler version once, update every first-party caller and fixture atomically, and reject obsolete development rows instead of maintaining dual readers.
- **[Opaque JSON fallback reduces validation]** → Limit it to transport-faithful body positions, emit a stable warning, preserve source descriptions, and keep unsupported transport semantics blocked.
- **[`allOf` merging can hide contradictions]** → Merge only structurally compatible object branches and block on the first conflict with an exact pointer.
- **[Namespaced inputs can be verbose]** → Apply namespacing only to collision sets, use deterministic shortening, and preserve concise non-colliding names.
- **[Existing imported tools retain old one-item array intent]** → Do not reinterpret persisted intent silently; under `PRE_PRODUCTION`, reset/reseed disposable data or re-import affected tools after the new definition version ships.

## Migration Plan

1. Replace the canonical request-definition and compiled-plan versions across API, SPA, gateway, Platform MCP schemas, fixtures, seeds, and publication code.
2. Add array validation/serialization and body omission behavior before enabling the importer mappings that depend on them.
3. Replace the fixed selection bound with the document bound plus configured-capacity projection and locked revalidation.
4. Add schema normalization, collision naming, and opaque-union diagnostics.
5. Reset or reseed disposable development data and re-import affected OpenAPI tools; do not add compatibility parsing for obsolete definitions.
6. Run typecheck, lint, focused API/SPA tests, full tests, formatting, and OpenSpec validation.

Rollback during development is a code rollback plus database reseed. No production data migration or external API rollback path is required while the declared lifecycle remains `PRE_PRODUCTION`.

## Open Questions

- Whether future work should add fully structured object-valued agent inputs rather than using diagnosed `json` items for arrays of objects.
- Whether query styles beyond `form` should be added in a separate capability after real source demand is measured.
