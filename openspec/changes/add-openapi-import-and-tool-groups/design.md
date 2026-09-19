## Context

Studio currently creates one canonical typed tool manually or from one curl command. The Tools surface is a flat paginated list, tools have no owner-facing organization metadata, and the draft aggregate permits at most 50 tools. Runtime discovery reads one immutable published revision and exposes a flat MCP tool list.

OpenAPI import introduces three distinct concerns: untrusted document ingestion, deterministic conversion of multiple operations into the existing typed request-definition model, and one atomic aggregate write. Tool groups introduce a fourth concern: useful Studio organization that must remain invisible to publication and runtime behavior. This change targets the canonical-only state established by `remove-preproduction-mcp-legacy-paths`; it does not add another authoring representation.

## Goals / Non-Goals

**Goals:**

- Preview OpenAPI 3.0/3.1 JSON from file content, pasted content, or a public URL without writes.
- Convert only semantics that the canonical request definition can represent faithfully and report structured diagnostics for the rest.
- Let the owner select, rename, and group operations before one atomic disabled-draft import.
- Add bounded, owner-scoped groups for Studio navigation and maintenance without changing MCP behavior.
- Preserve secret isolation, SSRF defenses, aggregate concurrency, draft/publication separation, and future-safe OpenAPI provenance.

**Non-Goals:**

- YAML, Swagger/OpenAPI 2.0, OpenAPI 3.2, external references, callbacks, webhooks, or automatic document synchronization.
- Silent coercion of unsupported serialization, polymorphism, uploads, cookies, or HTTP methods.
- Importing credential values or changing authentication, common entries, or server values.
- Runtime namespaces, group-scoped tokens/endpoints, group-based discovery, or Platform MCP group/OpenAPI authoring.
- Replacing the canonical tool editor or increasing existing tool/request-definition limits.

## Decisions

### 1. Groups are a bounded Studio projection, not publishable configuration

Add `mcp_tool_group` with an owner server id, display name, normalized name, and timestamps. Add nullable `groupId` to `mcp_tool` with database and service enforcement that the group and tool belong to the same server. A server supports at most 50 groups, making the ordered group-and-count query an explicitly tiny bounded list. Names are unique per server after normalization.

Group create, rename, delete, and assignment commands use `withOwnedServerWrite` and optimistic `expectedRevision`, but use `draftMutation: false`. Deleting a group sets member `groupId` values to null. There is no group enabled state, cascade tool deletion, auth policy, or configuration inheritance.

This is preferred over tags or many-to-many membership because the requested use case is one navigation location per tool. OpenAPI's complete tag list is retained as provenance, while its first tag can suggest the single Studio group.

### 2. Group membership is excluded from publication and runtime

`groupId` is not copied into revision tool rows, candidate fingerprints, contract fingerprints, diffs, gateway snapshots, registration metadata, templates, or call logs. Publication must therefore remain clean after a group-only change. Revision restoration snapshots current assignments by stable draft tool id before rebuilding tool rows, then reapplies assignments only to restored ids that still have a valid group; resurrected or unmatched tools remain ungrouped.

This is preferred over snapshotting groups because organization should survive a runtime rollback rather than be rolled back with executable behavior.

### 3. Studio filters one flat paginated tool list by group

The Tools surface adds `All`, `Ungrouped`, and one filter per group with counts. The existing paginated table remains the only tool list, and its list and count queries receive the same optional group predicate. Owners can create/rename/delete groups, move one or several selected tools, and choose an optional group in manual, curl, and OpenAPI creation. Opening an import from a filtered group preselects it but never locks the choice.

This is preferred over expandable per-group tables because independent pagination inside groups would be ambiguous and duplicate rows when filters change.

### 4. All OpenAPI sources converge on one strict document pipeline

The SPA reads a selected UTF-8 JSON file locally and submits its text; pasted JSON uses the same content input. URL input is fetched by the API. Both forms feed a pure pipeline:

```text
source -> bounded bytes -> strict JSON -> version validation
       -> local JSON Pointer resolution -> operation inventory
       -> canonical mapping -> compile preview -> import candidate
```

The pipeline never stores the raw document. It computes a deterministic fingerprint from canonicalized parsed JSON. Preview returns document metadata, compatible operations, suggested names/groups, sanitized security requirements, and per-operation issues.

**Dependency decision (task 1.2):** no OpenAPI parser or JSON Reference library is added. The minimal maintained dependency set is the empty set, because every maintained resolver either fetches external `$ref` targets on its own (which decision 6 forbids outright) or expands references without the byte, hop, depth, resolution, and operation bounds this change requires. The parser, the bounded local JSON Pointer resolver, and the operation inventory are therefore implemented in-repo over `JSON.parse` and the existing `canonicalContractJson` fingerprint helper, which keeps the pipeline deterministic, side-effect-free, and auditable, and adds no supply-chain surface to the API workspace.

### 5. Preview and confirmation are bound without server-side staging

Preview is write-free. Confirmation resubmits the document source, the preview fingerprint, selected operation keys, optional name overrides, group strategy, and `expectedRevision`. File/paste content is resent by the client; URL confirmation refetches the URL. A changed URL document fails fingerprint comparison and requires a new preview.

Fetching and parsing occur before the aggregate lock. Under the lock, the service verifies the expected revision, revalidates capacity/names/group ownership, compiles selected definitions against the locked canonical server configuration, and inserts all rows in one transaction. This avoids ephemeral caches while preventing a preview of one document from approving another.

### 6. URL retrieval has a dedicated SSRF-safe policy

Document URLs require public HTTPS without userinfo. Fetching uses DNS/IP blocking equivalent to upstream execution, a 10-second deadline, at most three same-origin redirects, safe re-resolution on every hop, and a 5 MiB post-decompression limit. It sends no owner credentials, cookies, server authentication, or arbitrary request headers. External `$ref` values are rejected and never trigger additional network requests.

The documentation host is not required to be in the MCP server's runtime `allowedHosts`, because specifications commonly live on a documentation or CDN origin. This separate fetch policy is preferred over widening runtime host access.

### 7. Mapping is conservative and deterministic

Supported methods remain GET, HEAD, POST, PUT, PATCH, and DELETE. `operationId` supplies the suggested MCP name; otherwise the importer derives one from method and path. Normalization and every collision are shown in preview, and confirmation is blocked until selected names are unique against one another and existing tools.

Summary maps to title, description maps to description, path/query/header parameters map to agent inputs and typed bindings, and supported JSON/form/raw request bodies map to the canonical body graph. Requiredness, primitive constraints, formats, enum values, omission semantics, and compiler-derived behavior annotations are preserved when representable. Imported tools always have `enabled=false`; mutating operations also retain `allowMutation=false`.

The effective OpenAPI server at operation/path/root precedence must resolve compatibly with the selected MCP server origin and base path. Security schemes are returned only as secret-safe configuration requirements. Deprecated operations and lossy-but-reviewable metadata produce warnings. Unsupported methods, external/cyclic references, cookies, multipart/file bodies, unsupported parameter serialization, ambiguous server variables, or schema constructs that cannot be represented faithfully block only the affected operation.

### 8. Group selection has explicit precedence

OpenAPI confirmation supports exactly one strategy: ungrouped, one existing/new group for every selected operation, or first-tag mapping. An explicitly chosen common group overrides OpenAPI tags. First-tag mapping reuses normalized existing groups and atomically creates missing groups within the group cap. Operations without a tag remain ungrouped. Curl confirmation accepts one optional existing `groupId`; manual create/edit uses the same membership validation.

### 9. Provenance is typed, secret-safe, and restorable

Extend tool source with `openapi` and persist versioned OpenAPI source metadata containing a generated batch id, stable operation key (`operationId` when present plus method/path identity), document fingerprint, generated-definition hash, original tags, OpenAPI version, and a sanitized source label. URL labels remove query, fragment, and userinfo; raw documents, examples, credentials, and full source URLs are not persisted.

Revision tool rows snapshot this provenance for faithful restore, but provenance is excluded from contract/runtime fingerprints. This enables a later explicit reconciliation feature to distinguish unchanged, changed, locally diverged, and removed operations without implementing synchronization now.

### 10. Errors and telemetry remain structured and secret-safe

Add stable application codes for invalid/unsupported OpenAPI documents, changed preview fingerprints, unsafe fetches, operation/name conflicts, and group conflicts/capacity. SPA copy has English/Spanish parity. Telemetry records source kind, version, operation/issue counts, duration, and stable issue codes only; it never records document bodies, URLs with queries, schemas, examples, parameter values, or credentials.

## Risks / Trade-offs

- **[Large or hostile documents]** Parsing or reference expansion could exhaust resources. → Enforce byte, node/depth, operation, and local-reference limits before conversion; reject cycles and fetch no external references.
- **[OpenAPI expressiveness exceeds the request model]** Silent approximation could create incorrect calls. → Use an explicit support matrix and block each operation whose semantics cannot be represented faithfully.
- **[URL changes between preview and confirmation]** The imported candidate could differ from what the owner reviewed. → Recompute and compare the canonical document fingerprint before any write.
- **[Long aggregate lock]** Compiling up to 50 tools can delay concurrent edits. → Parse/map before locking, cap selection, and keep only ownership/capacity validation, canonical compilation, and inserts inside the transaction.
- **[Restore drops Studio metadata]** Current restore deletes and reinserts tool rows. → Preserve group assignments by stable id and snapshot/restore source provenance explicitly.
- **[Tag-derived group clutter]** Specs may contain many or inconsistent tags. → Preview exact group creations, enforce the group cap, use only the first tag, and require confirmation.
- **[Dependency overlap]** The legacy-removal change modifies the same authoring contracts. → Apply and archive `remove-preproduction-mcp-legacy-paths` first, then rebase this change onto canonical-only schemas.

## Migration Plan

1. Complete the canonical legacy-removal change and reset/reseed disposable development data as it requires.
2. Add the group/provenance schema and generate one Drizzle migration; existing tools default to ungrouped with their current source retained.
3. Ship group commands, filtered reads, restore preservation, and tests before exposing group controls.
4. Add the bounded OpenAPI parser/mapper and URL fetch policy with fixture and security tests.
5. Add preview/confirm services and transport schemas, then the Studio wizard and optional group selectors.
6. Verify publication fingerprints, gateway discovery, execution snapshots, and Platform MCP outputs are byte-for-byte unaffected by group-only changes.
7. Run typecheck, lint, focused/full tests, formatting, and the OpenSpec quality gate.

Rollback before release restores the prior source and matching development database state. No runtime compatibility or data backfill path is added while the product remains pre-production.

## Open Questions

None. The agreed scope resolves group semantics, supported source formats, runtime isolation, and synchronization boundaries.
