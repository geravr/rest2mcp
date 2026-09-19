## 1. Canonical Baseline and Contracts

- [ ] 1.1 Complete and archive `remove-preproduction-mcp-legacy-paths`, rebase this change onto its canonical-only tool schema, and resolve overlapping Studio/spec edits before implementation.
- [ ] 1.2 Review current OpenAPI 3.0/3.1 parser and JSON Reference library documentation through Context7, select the minimal maintained dependencies, and pin them in the API workspace.
- [ ] 1.3 Define shared OpenAPI byte/timeout/redirect/operation limits, group limits, strict source/group strategy schemas, preview/confirm result types, and versioned secret-safe provenance types.
- [ ] 1.4 Add stable application error codes and structured issue codes for group conflicts/capacity, OpenAPI document/version/support failures, unsafe retrieval, name/capacity conflicts, and stale document fingerprints.

## 2. Group and Provenance Persistence

- [ ] 2.1 Add the `mcp_tool_group` Drizzle schema with prefixed ids, normalized per-server uniqueness, timestamps, bounded-name constraints, and owner-server relations.
- [ ] 2.2 Add nullable same-server-safe tool group membership, extend tool source with `openapi`, and add validated versioned source provenance to mutable and revision tool rows.
- [ ] 2.3 Update database relations, exports, seed factories, and MCP fixtures for ungrouped manual/curl tools plus representative grouped/OpenAPI tools without secret material.
- [ ] 2.4 Generate one Drizzle migration for the group, membership, source, and provenance schema changes; inspect the generated SQL and snapshot without hand-editing them.
- [ ] 2.5 Add schema tests for normalized uniqueness, cross-server membership rejection, delete-to-ungroup behavior, and provenance round trips.

## 3. Tool Group Domain Services

- [ ] 3.1 Implement owner-scoped bounded group listing with deterministic ordering and per-group tool counts.
- [ ] 3.2 Implement atomic group create and rename commands with `expectedRevision`, normalized conflicts, capacity enforcement, and `draftMutation: false`.
- [ ] 3.3 Implement atomic group deletion that ungroups member tools without deleting, recompiling, disabling, or renaming them.
- [ ] 3.4 Implement single and bulk tool assignment commands that validate same-server ownership and change no publishable tool field.
- [ ] 3.5 Extend the paginated tool query with `all`, `ungrouped`, and group-id filters using the same predicate for rows and total count.
- [ ] 3.6 Add strict Studio tRPC schemas and thin router procedures for group lifecycle, assignment, bounded listing, and filtered tools.
- [ ] 3.7 Add service/router tests for ownership nondisclosure, revision conflicts, normalized-name conflicts, capacity concurrency, delete preservation, assignment, and pagination parity.

## 4. Publication and Platform Isolation

- [ ] 4.1 Exclude group ids/names from publication candidates, diffs, candidate and contract fingerprints, revision rows, templates, execution snapshots, registration metadata, and call logs.
- [ ] 4.2 Update revision restoration to preserve current valid group assignments by stable tool id while leaving resurrected or unmatched tools ungrouped.
- [ ] 4.3 Snapshot and restore secret-safe OpenAPI provenance without including it in runtime contracts or contract fingerprints.
- [ ] 4.4 Add regression tests proving group-only mutations leave `draftRevision`, publish preview, active discovery, execution snapshots, and immutable revision content unchanged.
- [ ] 4.5 Add Platform MCP contract and integration tests proving group metadata is neither accepted nor returned and Platform-created tools remain ungrouped.

## 5. OpenAPI Document Core

- [ ] 5.1 Implement strict bounded JSON parsing, OpenAPI 3.0/3.1 version validation, canonical JSON fingerprinting, and document metadata extraction.
- [ ] 5.2 Implement bounded internal JSON Pointer resolution with cycle detection and explicit rejection of every external reference form.
- [ ] 5.3 Build the deterministic operation inventory with effective path/operation parameters, server precedence, stable operation keys, deprecation state, tags, and sanitized security requirements.
- [ ] 5.4 Implement selected-server origin/base-path compatibility checks, including server variables and per-operation blocking diagnostics.
- [ ] 5.5 Implement deterministic MCP-safe name/title/description suggestions and detect collisions among candidates and existing tools without silently suffixing names.
- [ ] 5.6 Add fixture-driven parser/inventory tests for 3.0 and 3.1 documents, malformed/version failures, local/external/cyclic references, server precedence, tags, security, and operation limits.

## 6. OpenAPI-to-Canonical Mapping

- [ ] 6.1 Map supported path, query, and header parameters into stable typed path segments, named entries, shared agent inputs, requiredness, and omission behavior.
- [ ] 6.2 Map supported primitive constraints, enums, formats, and examples while stripping sensitive or credential-like example/default material.
- [ ] 6.3 Map supported JSON, form-urlencoded, and raw request bodies into canonical body definitions within existing depth/node/input limits.
- [ ] 6.4 Derive safe behavior annotations through the canonical compiler and force every imported candidate to disabled with mutation permission off.
- [ ] 6.5 Emit stable per-operation blockers for unsupported methods, cookies, multipart/files, unsupported serialization, schema composition, ambiguity, and unrepresentable request shapes; emit warnings for deprecated or safely ignored metadata.
- [ ] 6.6 Add mapping/compiler tests for valid reads and mutations, optional values, nested JSON, request media types, constraints, all blocker categories, and isolation between valid and invalid operations.

## 7. Safe URL Retrieval

- [ ] 7.1 Implement a dedicated public-HTTPS OpenAPI fetcher that sends no credentials or caller headers and reuses blocked-address primitives without widening server `allowedHosts`.
- [ ] 7.2 Enforce DNS/IP checks on each hop, three same-origin redirects, no downgrade/userinfo, a 10-second total deadline, and a 5 MiB streamed post-decompression limit.
- [ ] 7.3 Sanitize URL source labels by removing query, fragment, and userinfo before returning or persisting provenance.
- [ ] 7.4 Add deterministic fetch tests for public success, private and metadata targets, DNS rebinding-safe validation, redirect policies, timeout, oversized/decompression responses, and credential/header absence.

## 8. OpenAPI Preview and Atomic Confirmation

- [ ] 8.1 Implement the owner-scoped write-free preview service for content and URL sources, including operation candidates, compiler issues, security requirements, group suggestions, capacity projections, and telemetry-safe summary fields.
- [ ] 8.2 Implement group strategy planning for ungrouped, one existing/new common group, and first-tag mapping with normalized reuse, group-cap checks, and explicit precedence.
- [ ] 8.3 Implement fingerprint-bound confirmation that refetches/resubmits and reparses the source before locking the server and rejects changed documents.
- [ ] 8.4 Implement one aggregate transaction that enforces `expectedRevision`, capacity, name uniqueness, group ownership/creation, canonical compilation, disabled tool insertion, provenance, and exactly one config/draft revision increment.
- [ ] 8.5 Add strict tRPC preview/confirm procedures and keep all parsing, mapping, network, transaction, and business logic in services.
- [ ] 8.6 Add unit and integration tests for no-write preview, stale fingerprints, concurrent edits, tool/group capacity, duplicate names, compile rollback, auth/common/secret immutability, and unchanged active publication behavior.

## 9. Manual and Curl Group Integration

- [ ] 9.1 Add Studio-specific optional group placement to manual tool creation/editing without adding group fields to shared Platform MCP authoring schemas.
- [ ] 9.2 Add optional existing `groupId` to curl confirmation, validate it inside the aggregate transaction, and preserve the exactly-one-disabled-tool and credential-isolation contracts.
- [ ] 9.3 Add manual/curl service, router, and atomicity tests for valid grouping, ungrouped defaults, foreign/stale groups, and unchanged authentication/server values.

## 10. Studio Group Experience

- [ ] 10.1 Add typed React Query hooks and cache invalidation for group listing/lifecycle, assignment, and group-filtered tool pagination.
- [ ] 10.2 Add the `All`, `Ungrouped`, and counted group filter UI while preserving one table, existing loading/error patterns, and page reset on filter changes.
- [ ] 10.3 Add compact group create/rename/delete controls with explicit delete-to-ungroup messaging and no implied runtime behavior.
- [ ] 10.4 Add single/bulk move controls and optional group selectors to manual and curl dialogs, preselecting but not locking the active filter group.
- [ ] 10.5 Add English/Spanish group copy and component tests for filtering, counts, CRUD, reassignment, pagination reset, import preselection, and destructive-dialog behavior.

## 11. Studio OpenAPI Import Experience

- [ ] 11.1 Add an OpenAPI import dialog with mutually exclusive file, pasted JSON, and URL source modes; read files locally and enforce client-side type/size guidance before preview.
- [ ] 11.2 Render searchable operation selection grouped by suggested tag with method/path/name, warnings, blockers, security requirements, and selection/capacity summaries.
- [ ] 11.3 Add inline unique-name editing and group strategy controls, including existing/new common group and previewed first-tag group creation.
- [ ] 11.4 Implement confirmation, conflict refresh, stale-document recovery, atomic success summary, and links to review the newly created disabled tools.
- [ ] 11.5 Add English/Spanish OpenAPI copy and component tests for all source modes, preview diagnostics, selection, name conflicts, group precedence, stale retries, and successful confirmation.

## 12. Cross-Cutting Verification and Quality Gate

- [ ] 12.1 Add telemetry tests proving OpenAPI events contain only source kind, version, bounded counts, durations, and stable issue codes—not document bodies, raw URLs, schemas, examples, parameter values, or credentials.
- [ ] 12.2 Run repository-wide residue checks confirming groups do not enter runtime/Platform contracts and OpenAPI import has no external-reference fetch or authentication mutation path.
- [ ] 12.3 Run `bun typecheck`, `bun lint`, focused API/app/database tests, and the full `bun test` suite from the repository root.
- [ ] 12.4 Run `bunx prettier --write .`, re-run affected verification, and validate `add-openapi-import-and-tool-groups` with strict OpenSpec validation.
- [ ] 12.5 Run `/opsx:quality-gate`, address all actionable findings for the selected review iterations, and leave the change ready for archive.
