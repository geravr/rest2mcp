## Why

OpenAPI confirmation has a hardcoded 50-operation batch limit that conflicts with the deployment-configured per-server tool cap and lets Studio submit selections the API rejects. The importer also blocks valid, common OpenAPI constructs and can silently reduce variable-length arrays to one-element request templates, so importable operations are not always faithful to their source contract.

## What Changes

- Remove the fixed 50-operation confirmation limit and derive selectable capacity from the server's configured `MCP_MAX_TOOLS_PER_SERVER` limit, while retaining document bounds, locked capacity revalidation, fingerprint binding, and atomic confirmation.
- Make Studio selection controls enforce and explain remaining server capacity before confirmation, and return localized domain errors rather than raw duplicated schema failures.
- Represent variable-length JSON and query arrays faithfully from agent input through advertised contract, compilation, preview, and execution, including supported OpenAPI `form` query serialization with `explode=true` and `explode=false`.
- Preserve omission semantics for optional structured body properties instead of always emitting placeholder objects or arrays.
- Normalize representable schema composition, beginning with single-entry `allOf` wrappers and conflict-safe object composition, while continuing to block lossy or ambiguous composition.
- Resolve flattened agent-input name collisions deterministically through compatible input reuse or stable location/path-aware names; do not change the upstream method, literal path, base URL, host boundary, or authentication.
- Add an explicitly diagnosed fallback for representable opaque JSON payloads where exact transport fidelity is possible but structural validation is not, rather than silently approximating unsupported `oneOf` shapes.
- Add regression fixtures and integration coverage based on the observed HighLevel Ad Manager patterns.

Non-goals: AI-assisted tool improvement, YAML or Swagger 2.0 import, external `$ref` fetching, multipart/file upload support, automatic authentication changes, and AI or heuristic modification of upstream paths or methods.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openapi-import`: Replace the fixed confirmation batch bound and expand faithful mapping for arrays, omission, serialization, composition, and input-name collisions.
- `mcp-studio`: Extend canonical typed authoring and compile preview to preserve array-valued inputs, serialization metadata, and optional structured request semantics.
- `mcp-gateway`: Advertise, validate, and execute array-valued inputs using the same compiled serialization and body semantics.

## Impact

Affected areas include shared OpenAPI limits and contracts, document mapping, canonical request-definition schemas, compiler and executor behavior, Studio import/editor/preview UI, localized diagnostics, publication fingerprints, and API/SPA/integration tests. Persisted unreleased request definitions may be replaced cleanly under the project's `PRE_PRODUCTION` policy; no compatibility reader or dual execution path will be added.
