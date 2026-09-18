## 1. Finalize the Typed Authoring Contract

- [x] 1.1 Decide whether legacy compatibility operations are internal-only or available for one release window, and record the deprecation boundary.
- [x] 1.2 Decide whether compatibility projection status needs persisted metadata and update the Drizzle schema plus generated migration only if required.
- [x] 1.3 Harden the shared request-definition Zod schemas with strict objects, definition-local id uniqueness, entry limits, and cross-reference validation.
- [x] 1.4 Define mutually exclusive typed and explicitly legacy command schemas for create, update, duplicate, and preview operations.
- [x] 1.5 Define stable compile-issue locations that include definition-local ids for path, entries, JSON nodes, raw bindings, and agent inputs.
- [x] 1.6 Add schema tests for mixed contracts, duplicate ids, unresolved references, malformed recursive JSON nodes, and payload limits.

## 2. Compatibility Projection and Legacy Conversion

- [x] 2.1 Implement a typed-to-legacy projection result that distinguishes lossless output from non-projectable semantics without approximating values.
- [x] 2.2 Detect literal placeholder-shaped text, repeated names, typed JSON shapes, and raw bindings that cannot be projected losslessly.
- [x] 2.3 Make typed rows authoritative in every read path and prevent legacy fields from repairing, overriding, or downgrading them.
- [x] 2.4 Restrict legacy analysis to rows or explicit compatibility commands with no typed definition.
- [x] 2.5 Return unambiguous typed conversion drafts and stable blocking diagnostics for legacy-only tools.
- [x] 2.6 Add round-trip and fail-closed tests for lossless projections, fixed brace text, repeated entries, and ambiguous legacy names.

## 3. Typed Tool Persistence Service

- [x] 3.1 Add owner-scoped service inputs that accept a canonical `requestDefinition` for tool create, update, duplicate, and preview.
- [x] 3.2 Validate referenced server-value ids against the selected server before compilation without exposing cross-owner existence.
- [x] 3.3 Compile the submitted definition with candidate common entries and auth configuration before any tool write.
- [x] 3.4 Persist the definition, plan, status, issues, annotations, availability, and lossless compatibility fields atomically.
- [x] 3.5 Allow invalid typed drafts only in a disabled state and reject any request that attempts to enable a definition with compile errors.
- [x] 3.6 Reject legacy-only updates to an existing typed tool while preserving the existing row and compiled plan.
- [x] 3.7 Implement duplicate id regeneration for all definition-local nodes and rewrite internal agent-input/raw-binding references.
- [x] 3.8 Add service tests for create, partial update, duplicate, preview parity, rollback on failure, and tool-name conflicts.

## 4. Typed Common Request Values

- [x] 4.1 Add shared typed commands for reading and updating ordered common header/query entries by stable entry and server-value ids.
- [x] 4.2 Reject agent-input bindings, duplicate effective keys, auth-protected keys, forbidden headers, and cross-server value references.
- [x] 4.3 Compile every affected enabled tool against candidate common entries before starting persistence writes.
- [x] 4.4 Commit common entries and all refreshed compiled plans in one transaction or return per-tool diagnostics with no changes.
- [x] 4.5 Generate legacy default maps only for losslessly projectable common entries and block legacy-only edits for non-projectable servers.
- [x] 4.6 Add tests for rename stability, multi-tool invalidation, auth conflicts, atomic rollback, and the 50-tool bound.

## 5. tRPC Authoring Boundary

- [x] 5.1 Expose typed create, update, duplicate, preview, and common-entry schemas through thin protected tRPC procedures.
- [x] 5.2 Return canonical request definitions and structured compile issues in Studio list/detail responses without exposing secret values.
- [x] 5.3 Add an explicit legacy compatibility procedure or internal adapter according to the selected rollout policy.
- [x] 5.4 Reject payloads that mix typed and legacy fields before calling services.
- [x] 5.5 Add tRPC contract tests for typed success, invalid issue paths, mixed input rejection, ownership, and secret-safe responses.

## 6. Frontend Typed Domain Model

- [x] 6.1 Replace name-based `ValueOrigin` and `PathPart` state with discriminated typed bindings carrying stable local and referenced ids.
- [x] 6.2 Add a centralized client id factory and preserve ids across edits, reorder operations, validation rerenders, and reopen.
- [x] 6.3 Implement definition-to-form and form-to-definition adapters that preserve ordered entries, primitive JSON types, constraints, and annotations.
- [x] 6.4 Implement duplicate cloning that regenerates local ids while preserving external server-value references.
- [x] 6.5 Model raw bodies as text plus an explicit binding registry and insert only declared binding-id tokens.
- [x] 6.6 Remove legacy template compilation/inference from typed form initialization and submit paths.
- [x] 6.7 Add unit tests for exact round trips, fixed braces, boolean/null JSON, shared agent inputs, reorder identity, and duplicate rewriting.

## 7. Studio Tool and Settings Experience

- [x] 7.1 Update the tool form to submit the canonical typed definition for create, edit, duplicate, and preview.
- [x] 7.2 Load typed tools directly and render a backend conversion draft or blocking diagnostics for legacy-only tools.
- [x] 7.3 Update origin controls to distinguish Server configuration from Server secret while retaining the referenced server-value id.
- [x] 7.4 Edit shared agent-input metadata once per registry entry and reflect changes in every bound request location.
- [x] 7.5 Attach compiler diagnostics to stable row/node ids and keep them attached when entries are reordered.
- [x] 7.6 Update the effective-request preview to compile the unsaved typed definition without persistence.
- [x] 7.7 Update Settings common-value rows to read and write typed entries and display affected-tool failures atomically.
- [x] 7.8 Add en/es copy parity for typed-origin labels, migration diagnostics, non-projectable compatibility, and common-entry failures.
- [x] 7.9 Add component tests for save/reopen fidelity, rename stability, legacy conversion, secret redaction, preview parity, and settings rollback.

## 8. Platform MCP Typed Authoring

- [x] 8.1 Replace Platform create/update tool arguments with the shared discriminated request-definition schema and concise agent-facing descriptions.
- [x] 8.2 Add Platform preview and duplicate operations that call the same typed services as tRPC.
- [x] 8.3 Require author scope for typed writes and secret-reference scope before resolving any secret server-value id.
- [x] 8.4 Return generic denial before secret lookup when scope is missing and not-found semantics for cross-owner references.
- [x] 8.5 Return canonical definitions and id-addressable compile issues without compatibility fields or resolved server values.
- [x] 8.6 Keep curl import on its existing sanitized typed-draft path and verify it cannot enter the legacy authoring adapter.
- [x] 8.7 Add Platform MCP tests for schema usability, tRPC validation parity, scope combinations, cross-owner ids, mixed inputs, and secret non-disclosure.

## 9. Migration, Observability, and Verification

- [x] 9.1 Backfill remaining unambiguous legacy tools and common entries idempotently while leaving ambiguous records disabled for owner resolution.
- [x] 9.2 Emit telemetry for legacy compatibility writes, conversion outcomes, non-projectable definitions, and typed compiler failures without request values.
- [x] 9.3 Add integration tests from Studio and Platform authoring through persistence, reload, MCP schema generation, and execution.
- [x] 9.4 Add regression tests proving server-value creation or rename cannot reclassify fixed or agent bindings.
- [x] 9.5 Document the typed authoring contract, explicit compatibility path, rollout order, and rollback restrictions for maintainers.
- [x] 9.6 Run generated migration checks if applicable, focused tests, `bun typecheck`, `bun lint`, the full test suite, and final formatting.
