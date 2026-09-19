## Context

The hosted product gateway already derives a closed Zod input schema from compiled agent inputs, advertises a generic output envelope, and exposes MCP behavior annotations. Its tool description can still fall back to `METHOD /path`, invalid regular expressions are silently ignored during gateway registration, and argument or unexpected failures use a text-only error helper even though the tool declares an output schema.

Platform MCP is less consistent. Its tools have short descriptions and input schemas, but most fields lack descriptions, output schemas and annotations are absent, and results use untyped JSON text. Scope-filtered data can also be represented as a false value instead of being omitted, which invites an agent to infer information it was not authorized to see.

The typed request-binding model is the canonical source for input definitions and stable ids. This change consumes that contract without preserving an older registration or result interpretation. It compiles persisted author intent into the exact MCP metadata and result semantics consumed by agents.

## Goals / Non-Goals

**Goals:**

- Make every advertised product and Platform tool self-describing enough for reliable selection and argument construction.
- Ensure advertised schemas exactly match runtime validation and returned structured content.
- Give agents stable, safe signals for argument repair, authentication escalation, waiting, retrying, and indeterminate mutations.
- Prevent contradictory safety annotations and incomplete new tools from being advertised.
- Let owners inspect the exact secret-safe MCP contract before enabling a product tool.
- Detect contract drift with deterministic protocol-level tests rather than LLM-dependent production logic.

**Non-Goals:**

- Modeling each upstream REST response with a custom output schema.
- Changing request-binding persistence, curl import, auth storage, SSRF, timeouts, or rate algorithms.
- Trusting annotations as authorization controls; server-side mutation and scope checks remain authoritative.
- Adding an LLM call to author, lint, or approve contracts in production.
- Adding asynchronous MCP task execution.

## Decisions

### 1. Compile one immutable agent-visible contract

A shared contract compiler will produce the registration config used by both MCP surfaces:

- stable MCP name;
- human-facing title;
- outcome-oriented description;
- closed input schema;
- stable output-envelope schema;
- `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`;
- namespaced `_meta` containing `contractVersion: 1` and a fingerprint.

The fingerprint is a hash of canonical JSON containing only agent-visible contract fields. Runtime state, secret ids/values, compiled URLs, timestamps, and database ids are excluded. Lists remain sorted by tool name, so unchanged data produces byte-stable contracts.

Product contracts are derived from the stored typed definition and tool metadata. Platform contracts are declared in a central registry rather than ad hoc at each `registerTool` call. Registration consumes only compiled contracts; it does not rebuild schema semantics independently.

Alternative considered: improve descriptions inline in each MCP route. Rejected because Platform and product behavior would continue drifting and snapshots would not exercise one source of truth.

### 2. Require explicit semantic copy for new enabled product tools

Product tools gain an optional persisted `title`. New or edited tools may remain disabled with incomplete contract copy, but enabling requires a nonblank title, nonblank outcome-oriented description, and a description for every exposed agent input. Length, control-character, and duplication checks are deterministic; the product does not claim to judge prose quality.

Every enabled tool must satisfy these requirements immediately. Development tools with incomplete title, tool description, or input descriptions are disabled by the schema/data migration or removed when development data is reset; the system does not invent generated copy or retain provenance for placeholders that should never reach production. Seeds and fixtures are updated to contain explicit authored metadata.

Alternative considered: generate temporary copy and keep incomplete tools callable. Rejected because the product is pre-production and generated prose would create a second readiness state, weaker agent contracts, and permanent cleanup work.

### 3. Generate JSON Schema once and validate with the same semantics

The compiler maps each agent input to one JSON Schema property, preserving description, required state, string/number bounds, pattern, enum, examples, and the supported format allowlist (`date`, `date-time`, `email`, `uri`, and `uuid`). The root schema is an object with `additionalProperties: false`; a zero-input tool accepts only `{}`.

Invalid patterns, incompatible enum values, unsupported formats, or contradictory bounds are compile errors, never silently dropped. Sensitive inputs add standard `writeOnly: true` plus namespaced sensitivity metadata but never include a value. The runtime validator is built from the compiled schema or the same normalized intermediate representation, eliminating a second interpretation.

Alternative considered: keep generating a Zod shape separately from advertised JSON Schema. Rejected because metadata or constraints can be lost in either conversion and drift is difficult to observe.

### 4. Enforce safe annotation invariants

Annotations are hints for clients, not access controls. The compiler nevertheless prevents misleading combinations:

- GET and HEAD are read-only, non-destructive, and idempotent.
- Mutating methods are never read-only.
- DELETE defaults to destructive; other mutating tools require an explicit destructive choice.
- Idempotence for POST, PATCH, PUT, and DELETE is explicit rather than inferred from HTTP semantics.
- Product tools that contact upstream REST APIs have `openWorldHint: true`.

Studio explains these fields in behavioral language. Platform annotations are declared per control-plane operation: list/get operations are read-only, create/update operations are non-read-only, and deletions are destructive with server-enforced confirmation.

Alternative considered: infer every hint from HTTP method. Rejected because real REST endpoints do not always honor textbook method semantics.

### 5. Replace duplicated errors with one structured envelope

Successful calls retain the canonical top-level execution fields: `ok`, `status`, `contentType`, `data` or `body`, safe `headers`, and `truncated`. Failures use one nested error shape:

```text
error.category       invalid_arguments | policy | auth | not_found |
                     conflict | rate_limit | upstream | timeout |
                     network | internal
error.code           stable APP_ERROR_CODE
error.message        safe, concise explanation
error.retryable      explicit boolean
error.retryAfterSeconds? 
error.indeterminate? 
error.issues?        [{ path, id?, code, message }]
```

Superseded flat `appCode`, `phase`, `retryAfterSeconds`, and `indeterminate` result fields are removed rather than dual-written. Every completed tool call returns `structuredContent` matching the declared envelope, including argument validation, policy rejection, rate limits, caught `AppError`, and unexpected failures. MCP `content` text remains a concise serialization of the same safe envelope for protocol interoperability; it is not a second internal result contract.

Retryability is computed centrally. Invalid input, policy, auth, not-found, and conflict errors are non-retryable without a changed request or owner action. Rate limits are retryable with delay. Upstream 429 and known-safe transient read/idempotent failures may be retryable. An indeterminate mutation is never marked safe to retry automatically.

Alternative considered: throw protocol errors for validation and operational failures. Rejected because agents need the same machine-readable correction contract across clients and failure phases.

### 6. Validate structured output before returning it

One result normalizer constructs all product and Platform success/error envelopes and validates `structuredContent` against the advertised output schema. If an internal path produces an invalid envelope, the server emits a minimal valid internal-error envelope and telemetry rather than returning schema-invalid content. Error normalization redacts secrets and sensitive arguments before constructing text or structured content.

Platform successes wrap returned data in the same base envelope, while `test_tool` preserves the nested upstream execution envelope. Pagination shapes are explicit. Properties hidden by scope are omitted, not set to false or null.

Alternative considered: allow Platform tools to retain arbitrary text JSON. Rejected because agents cannot reliably distinguish successful data, denial, and corrective errors.

### 7. Add contract readiness and exact preview to Studio

Studio displays two related views:

- readiness diagnostics attached to title, description, input metadata, annotations, and schema constraints;
- the exact secret-safe `tools/list` item that the gateway will advertise, including output schema and contract metadata.

Preview is compiled by the backend from the unsaved typed definition and performs no writes. It never contains server-value contents, credentials, resolved URLs with secrets, or sensitive examples. Enabling uses the same readiness result inside the save transaction.

Alternative considered: preview a frontend reconstruction. Rejected because SDK serialization, compiler defaults, and backend redaction are part of the real contract.

### 8. Test contracts as protocol artifacts and decisions

Tests use the installed MCP SDK client to capture normalized `tools/list` and `tools/call` payloads. Golden fixtures cover a read tool, destructive tool, constrained-input tool, zero-input tool, success, invalid arguments, rate limit, upstream 401/429/500, timeout, and indeterminate mutation.

Deterministic decision fixtures assert that the contract contains the facts needed to choose between similarly named tools, correct bad arguments, avoid blind mutation retry, and wait after throttling. They validate fields and outcomes; they do not call an LLM or assert natural-language model behavior.

## Risks / Trade-offs

- **[Stricter readiness blocks new tools]** Missing descriptions may feel like friction. → Allow incomplete disabled drafts and provide generated starting copy, field-level guidance, and exact preview.
- **[Development tools become disabled after the clean cutover]** Some local fixtures may no longer be callable. → Update canonical seeds/fixtures and require explicit authored metadata rather than shipping generated copy.
- **[Schema metadata may be dropped by SDK conversion]** A correct internal model could still produce incomplete wire JSON. → Snapshot actual SDK client payloads, not only compiler objects.
- **[Fingerprint churn breaks caches]** Nondeterministic ordering or irrelevant metadata could change hashes. → Canonicalize only agent-visible fields and test stability under database/order noise.
- **[Retry hints can cause duplicate mutations]** Overly broad transient classification is dangerous. → Default to non-retryable and require known idempotence plus a determinate outcome for automatic retryability.
- **[Detailed issues can leak values]** Validation diagnostics may echo sensitive input. → Return paths, expected constraints, and codes without received values for sensitive fields.
- **[Typed-binding cleanup may change shared types]** Implementing against a moving authoring schema can create rework. → Consume the canonical typed definitions directly and coordinate removal of legacy request fields without copying transitional types.

## Migration Plan

1. Reconcile the implementation with the canonical typed request-definition schemas and delete any contract adapters that depend on legacy request fields.
2. Add the contract compiler, envelope/error schemas, normalizer, and wire-level snapshots as the only registration/result path.
3. Add required tool title/readiness metadata through a generated Drizzle migration; disable incomplete development rows or reset/reseed the development database instead of backfilling copy.
4. Switch product and Platform registration atomically to the shared compiler and remove the prior description/schema assembly and result helpers in the same change.
5. Add Studio readiness diagnostics and exact contract preview, enforcing readiness for every enabled tool.
6. Remove superseded flat error fields, unused types, compatibility tests, flags, metrics, and documentation.
7. Verify a database created from migrations plus seeds exposes only the new contracts and results.

If the change must be reverted during development, revert the code and generated unshared migration together or reset the development database. No legacy runtime path is retained for rollback.

## Open Questions

- Should contract fingerprints be returned only in `_meta`, or also shown in Studio and call logs for support diagnostics?
