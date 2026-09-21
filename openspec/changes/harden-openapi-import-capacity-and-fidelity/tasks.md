## 1. Canonical Request Model

- [x] 1.1 Bump the canonical request-definition/compiler version and add bounded array agent-input schemas with primitive or opaque JSON item descriptors, item constraints, and collection constraints in the API and SPA adapters.
- [x] 1.2 Add explicit OpenAPI query serialization metadata to named request entries and compiled request plans, including strict validation for supported location, style, and explode combinations.
- [x] 1.3 Update definition traversal, ID scanning, rekeying, redaction, serialization, and platform contracts for the new canonical version, removing superseded readers instead of retaining a compatibility path.
- [x] 1.4 Update seeds, factories, and canonical-definition fixtures for the new version and add checks that no first-party runtime or authoring path accepts the superseded version.

## 2. Compiler, Contract, and Executor

- [x] 2.1 Compile array inputs, query serialization metadata, and whole-field optional structured omission into executable plans, with precise compile issues for invalid combinations.
- [x] 2.2 Extend MCP input-contract generation and runtime validation to expose arrays with item types, item constraints, and collection bounds, and cover the resulting contract fingerprints with tests.
- [x] 2.3 Execute complete JSON body arrays and OpenAPI `form` query arrays using repeated keys for `explode: true` and comma-delimited values for `explode: false`; reject invalid input before any upstream request.
- [x] 2.4 Update compile previews, redacted request summaries, playground execution, publication snapshots, and gateway tests to prove that array and optional structured semantics remain identical across authoring and runtime.

## 3. OpenAPI Normalization and Mapping

- [x] 3.1 Add a bounded schema normalizer that unwraps single-branch `allOf`, safely merges compatible object branches, and reports cycles, depth limits, and incompatible composition without guessing.
- [x] 3.2 Map body arrays as complete dynamic inputs, preserve primitive item constraints and array bounds, and map optional structured properties so their entire subtree can be omitted.
- [x] 3.3 Map supported query arrays with explicit `form` serialization metadata and block unsupported styles or unsupported item shapes with stable operation diagnostics.
- [x] 3.4 Add a locally resolved opaque JSON fallback for transport-faithful body `oneOf`/`anyOf` positions, accompanied by a stable reduced-validation warning.
- [x] 3.5 Add deterministic namespacing for colliding parameter identities, including stable truncation and hashing, and verify that collision handling never changes the upstream server, path, HTTP method, or authentication structure.
- [x] 3.6 Add minimized HighLevel-derived fixtures covering body arrays, query arrays, optional structured fields, composition, and collisions, with assertions for diagnostics, canonical definitions, compiled plans, and execution behavior.

## 4. Import Capacity and Transactional Safety

- [x] 4.1 Remove the fixed `maxSelection` limit from shared OpenAPI import limits and transport validation, bounding preview and confirmation payloads only by the existing maximum operation count.
- [x] 4.2 Enforce selection capacity from `MCP_MAX_TOOLS_PER_SERVER` minus the current locked tool count during confirmation, while allowing previews and user selection beyond 50 when capacity permits.
- [x] 4.3 Add service and integration tests for imports above 50 tools, partially occupied servers, exact-capacity imports, over-capacity failures, and concurrent confirmations that contend for the remaining capacity.
- [x] 4.4 Verify the worst-case 200-operation confirmation path remains atomic, performs parsing and compilation outside the database lock where safe, and emits bounded telemetry without leaking imported documents or secrets.

## 5. MCP Studio Experience

- [x] 5.1 Extend the Studio request-definition editor and client adapters to author, reopen, and preserve array inputs, item constraints, collection bounds, and query serialization metadata without regenerating stable IDs.
- [x] 5.2 Make the OpenAPI import dialog derive remaining capacity from the configured server limit and current tool count; constrain row selection and select-all to that capacity while preserving deselection and reselection.
- [x] 5.3 Add localized English and Spanish copy for remaining capacity, unsupported serialization, composition conflicts, reduced validation, and collision namespacing, with component tests that never expose raw validation errors.
- [x] 5.4 Update Studio compile previews and request summaries to accurately display repeated versus delimited query arrays, dynamic body arrays, and omitted optional structured fields.

## 6. Regression and Security Coverage

- [x] 6.1 Add an integration flow using minimized fixtures representative of the observed HighLevel document to prove newly supported operations become selectable and compilable while genuinely unsupported operations remain blocked.
- [x] 6.2 Add security regression tests proving import normalization and collision handling cannot modify structural authentication, secret bindings, base URLs, allowed hosts, upstream paths, or HTTP methods.
- [x] 6.3 Add published-revision and gateway regression tests proving runtime discovery and execution use only the immutable compiled revision and contain no mutable-draft or legacy-definition fallback.
- [x] 6.4 Record the disposable development-data impact and provide a reimport handoff; perform any database reseed or replacement only with explicit owner authorization.

## 7. Verification

- [x] 7.1 Run focused API and SPA tests for canonical definitions, OpenAPI mapping, import confirmation, Studio selection, compiler output, and gateway execution.
- [x] 7.2 Run `bun typecheck`, `bun lint`, and `bun test` from the repository root and resolve all failures in the touched slice.
- [x] 7.3 Run `bunx prettier --write .` as the final formatting step, then rerun typecheck, lint, and the focused tests affected by formatting.
- [x] 7.4 Run OpenSpec validation for `harden-openapi-import-capacity-and-fidelity` and reconcile the implementation and artifacts with every requirement scenario before requesting the quality gate.
