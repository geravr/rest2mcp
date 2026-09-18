## Context

The backend already defines a versioned `McpRequestDefinition`, stores `requestDefinition` and `compiledPlan`, and prefers compiled plans during execution. Curl import also produces a typed definition. The normal Studio tool form, common-value settings, tRPC mutations, and Platform MCP authoring still use `pathTemplate`, `requestTemplate`, and `params`, however. The frontend converts its origin controls to `{{name}}` strings, and the service immediately runs legacy analysis to recover the source and create the typed definition.

That round trip is lossy. A server-value binding is reduced from a stable id to a mutable name; a fixed string that resembles a placeholder can be reclassified; duplicate ordered entries collapse into records; and agent metadata is joined by public name. The stored typed definition is therefore only a derived cache for ordinary authoring, not the canonical owner intent promised by the current domain model.

This change spans the React request builder, shared tRPC/Platform command schemas, Studio services, compiler integration, and compatibility adapters. Existing legacy rows and clients must remain inspectable during migration, but all successful new writes must become typed.

## Goals / Non-Goals

**Goals:**

- Preserve every selected value origin and reference by stable id from editor state through persistence and reload.
- Use one versioned authoring command and compiler path for Studio and Platform MCP.
- Persist typed definitions and compiled plans atomically, with location-aware validation issues.
- Use typed common headers/query entries as the canonical server-wide request values.
- Confine legacy inference to rows or callers that actually lack a typed definition.
- Keep compatibility projections available without allowing them to reinterpret typed records.

**Non-Goals:**

- Changing gateway transport, result envelopes, rate limits, or outbound policy.
- Changing curl parsing or its prohibition on server-wide auth/secret mutation.
- Redesigning authentication recipes or secret storage.
- Removing legacy columns or legacy read support.
- Adding multipart/binary authoring or an arbitrary expression language.

## Decisions

### 1. The versioned request definition is the canonical write contract

Create/update/duplicate/preview commands will accept a `requestDefinition` validated by the shared Zod schema. It contains ordered path segments, query/header/form entries, typed JSON nodes or raw-body binding tokens, one agent-input registry, and behavior annotations. A binding is exactly one of `literal`, `serverValue`, or `agentInput`.

The service will reject payloads that combine `requestDefinition` with legacy template fields. Existing legacy-only commands remain available behind an explicit compatibility adapter during rollout, but the SPA and Platform MCP will stop using them. A persisted row with `requestDefinition` always treats that field as authoritative; legacy columns can never override or repair it.

Alternative considered: continue accepting legacy strings and improve inference. Rejected because no inference rule can distinguish literal placeholder-shaped text or retain stable ids after a rename.

### 2. Definition-local ids are stable across edits

Path segments, named entries, JSON fields, raw bindings, and agent inputs use opaque ids unique within one definition. The client creates ids for new nodes and preserves them while editing. Moving or renaming a row does not replace its id. Duplicating a tool regenerates all definition-local ids and rewrites internal references, while preserving referenced server-value ids.

The backend validates uniqueness and referential integrity and never derives identity from array index, display name, or value. Server-value ids are database identities and must belong to the selected server. Agent public names remain unique because they form the MCP schema, but references use agent-input ids.

Alternative considered: use names as ids. Rejected because a rename would become a delete/recreate operation and collisions would continue to change meaning.

### 3. Studio state mirrors the domain model

The frontend request builder will use discriminated origin objects containing ids rather than `origin: variable` plus a name. It will distinguish server configuration and server secret in presentation while serializing both as a `serverValue` binding. Fixed values retain their native primitive type for structured JSON.

Typed tools initialize the form directly from `requestDefinition`; `value-origin` inference helpers are never called. A legacy tool is opened through a backend compatibility analysis result that is either an unambiguous typed draft or a list of blocking issues. Saving that draft permanently converts the tool to typed persistence.

Advanced raw bodies remain text plus an explicit binding registry. Only `{{<declared-binding-id>}}` tokens are replaced; all other brace text is literal. Structured JSON uses recursive typed nodes and never string substitution.

Alternative considered: keep the current frontend shape and only change the network adapter. Rejected because name-based editor state would still lose identity before submission.

### 4. Compilation and persistence are one service operation

The service will parse the definition, load the server's value catalog/common entries/auth configuration, verify ownership, and compile the effective plan before writing. A valid definition, compiled plan, compile status/issues, annotations, enabled state, and compatibility projection are persisted in one transaction. Invalid drafts may be stored only disabled with their typed definition and issues; an enabled write with any error is rejected.

Preview invokes the same compiler with the unsaved typed definition and performs no writes. It returns issues keyed by stable location/id so the UI can attach them without parsing English messages.

Alternative considered: let the SPA compile and submit a plan. Rejected because server values, auth ownership, security validation, and the trusted compiled artifact belong on the backend.

### 5. Common request values use the same bindings

Server common headers and query entries will be read and written as ordered `McpCommonEntries`. Agent-input bindings are forbidden there. Updates recompile every affected enabled tool in the same transaction or reject the update with per-tool diagnostics; no enabled tool may retain a plan compiled from stale common values.

Legacy `defaultHeaders` and `defaultQuery` are generated only when every entry has a lossless legacy representation. A failed projection does not invalidate the typed common entries; it records a compatibility diagnostic and prevents legacy-only writers from editing that server.

Alternative considered: leave defaults name/template-based. Rejected because a tool could be typed while its inherited request remained ambiguous.

### 6. Compatibility projection is secondary and explicitly bounded

Typed definitions may be projected to legacy fields for diagnostics, exports, and staged rollback only when semantics are lossless. Literal placeholder-shaped text, repeated keys, typed JSON constructs, or other non-representable shapes are marked non-projectable rather than rewritten approximately. Legacy-only readers/writers must refuse such records instead of executing a different request.

The current legacy analyzer remains for rows where `requestDefinition` is null. Once an owner saves a converted definition, later reads never re-run inference even if server values change.

Alternative considered: restrict typed authoring to the legacy-representable subset. Rejected because that would preserve the ambiguity this change exists to remove.

### 7. Platform MCP uses the shared typed command with scope checks

Platform `create_tool`, `update_tool`, and preview operations expose the same request-definition schema, limits, and compiler as tRPC. A reference to a secret server value requires `secret-reference` scope before lookup; an unauthorized caller receives a generic denial that does not reveal whether the id exists. Configuration-value references require author scope and normal ownership checks.

Tool results return the stored typed definition and compile issues without resolved server values or secrets. Legacy placeholder authoring remains temporarily available only under an explicitly named compatibility operation and cannot be mixed into typed input.

Alternative considered: keep a simpler Platform-only template schema. Rejected because it would preserve behavioral drift and make AI-authored tools semantically different from Studio-authored tools.

## Risks / Trade-offs

- **[Recursive schemas are harder for clients]** Platform agents may struggle to construct nested JSON definitions. → Provide concise descriptions/examples and keep flat query/header/form cases simple; exact JSON schema generation and contract tests are required.
- **[Definition-local id churn]** Recreating ids on every render would make diagnostics and dirty-state checks unstable. → Centralize id creation and test edit, reorder, duplicate, and reopen flows.
- **[Common-value edits can invalidate many tools]** Atomic recompilation may make a settings save more expensive. → Enforce the existing 50-tool limit, compile in memory first, and write only after all enabled tools pass.
- **[Compatibility is not universal]** Some typed definitions cannot be represented safely in legacy columns. → Make projection status explicit and fail closed for legacy-only writers rather than approximating semantics.
- **[Two authoring contracts during rollout]** Accepting legacy and typed inputs can cause accidental downgrade. → Require mutually exclusive discriminants, emit telemetry for legacy writes, and remove legacy use from first-party clients before deprecation.
- **[Stale server-value references]** A value could be removed between validation and persistence. → Validate and write transactionally, and retain reference-aware deletion checks.

## Migration Plan

1. Add shared typed authoring schemas, compatibility-projection status if needed, and service methods while retaining legacy reads.
2. Add typed create/update/preview paths and tests; deploy them before switching clients.
3. Switch Studio common-value and tool editor state to stable ids and typed payloads, including direct typed reload and legacy conversion diagnostics.
4. Switch Platform MCP authoring schemas to the shared typed command and enforce secret-reference scope.
5. Backfill remaining unambiguous legacy rows. Leave ambiguous rows disabled until owner resolution.
6. Monitor legacy-write telemetry; after first-party legacy traffic reaches zero, reject implicit legacy writes and retain only the explicit compatibility path.

Rollback disables typed writers but keeps the typed-aware reader/compiler active. Compatibility fields are used only for definitions marked losslessly projectable; no rollback path is allowed to reinterpret a typed-only definition.

## Open Questions

- Should the explicit legacy compatibility operations remain internal-only or be available to older public clients for one release window?
- Does compatibility-projection status need a persisted column, or is a compile issue/status entry sufficient for the staged rollout?
