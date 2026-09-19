## 1. Dependency and Policy Decisions

- [x] 1.1 Confirm `persist-typed-request-bindings` is complete and consume its final shared request-definition and compile-issue types without copying them.
- [x] 1.2 Define the clean pre-production data policy for incomplete tools: disable them in migration or reset/reseed development data, with no generated copy.
- [x] 1.3 Decide whether contract fingerprints remain `_meta`-only or also appear in Studio and support-oriented call-log metadata.
- [x] 1.4 Define the namespaced contract metadata key, clean contract version 1 boundary, and canonical JSON rules without legacy result fields.
- [x] 1.5 Inventory every product and Platform tool plus its current title, descriptions, input/output schema, annotations, and result shape.

## 2. Contract and Persistence Model

- [x] 2.1 Define shared types and strict schemas for compiled tool contracts, readiness issues, and fingerprints without generated-copy provenance.
- [x] 2.2 Add optional product-tool title and any required provenance/readiness fields to the Drizzle schema.
- [x] 2.3 Generate and inspect the Drizzle migration without manually editing generated SQL.
- [x] 2.4 Make required contract metadata authoritative for enabled tools and disable incomplete development rows or document the reset/reseed path.
- [x] 2.5 Remove obsolete persisted contract/result metadata and verify typed definitions, compiled plans, and secret-free metadata remain canonical.
- [x] 2.6 Add migration tests for complete tools, incomplete rows becoming unavailable, disabled drafts, clean database creation, and reseeding.

## 3. Input Schema and Contract Compiler

- [x] 3.1 Build a normalized agent-input schema representation shared by advertised JSON Schema and runtime validation.
- [x] 3.2 Preserve required state, type, bounds, valid pattern, enum, examples, and supported string formats in the normalized schema.
- [x] 3.3 Add `writeOnly` and namespaced sensitivity metadata while removing sensitive examples/defaults and all resolved values.
- [x] 3.4 Enforce closed root objects and exact `{}` semantics for zero-input tools.
- [x] 3.5 Reject invalid patterns, unsupported formats, contradictory bounds, incompatible enums, duplicate public names, and missing input descriptions.
- [x] 3.6 Enforce annotation invariants for read methods, mutating methods, DELETE defaults, explicit idempotence, and open-world REST access.
- [x] 3.7 Compile title, description, schemas, annotations, version metadata, and deterministic fingerprint into one immutable contract.
- [x] 3.8 Add compiler tests for ordering noise, description changes, secret rotation, format handling, sensitivity, and annotation contradictions.

## 4. Structured Result and Error Normalization

- [x] 4.1 Replace the execution error shape with structured categories, stable code, safe message, retryability, delay, indeterminate flag, and issues.
- [x] 4.2 Remove legacy flat error fields, their shared types, serializers, fixtures, and assertions from every product and Platform path.
- [x] 4.3 Implement central retry classification that defaults to non-retryable and accounts for idempotence and determinate upstream outcomes.
- [x] 4.4 Map validation, policy, auth, not-found, conflict, rate-limit, upstream, timeout, network, and internal failures to stable categories.
- [x] 4.5 Normalize Zod issues into path/id diagnostics without echoing received sensitive values.
- [x] 4.6 Build one success/error result helper that emits MCP `content` text and matching `structuredContent` from the same safe envelope.
- [x] 4.7 Validate outgoing structured content and fall back to a minimal schema-valid internal error with telemetry on normalization defects.
- [x] 4.8 Add tests for upstream 401/429/500, invalid arguments, rate limiting, timeout before send, timeout after mutation send, and unexpected exceptions.

## 5. Product MCP Gateway Integration

- [x] 5.1 Replace per-request description/schema assembly with the shared compiled product-tool contract.
- [x] 5.2 Register top-level title, outcome-oriented description, input/output schemas, annotations, and namespaced metadata with the MCP SDK.
- [x] 5.3 Use the normalized input validator so runtime acceptance exactly matches the advertised schema.
- [x] 5.4 Return the shared structured envelope for argument, policy, rate-limit, executor, and internal failures.
- [x] 5.5 Keep enabled valid tools sorted deterministically and exclude contract-readiness failures before registration.
- [x] 5.6 Add MCP SDK client tests proving `tools/list` and `tools/call` payloads match their schemas at the wire boundary.

## 6. Platform MCP Contract Registry

- [x] 6.1 Create a centralized registry entry for every Platform tool with title, purpose, described inputs, output data schema, annotations, and required scopes.
- [x] 6.2 Generate Platform tool fingerprints after scope filtering and keep registration order deterministic.
- [x] 6.3 Replace ad hoc `jsonToolResult` and `jsonToolError` paths with the shared structured result normalizer.
- [x] 6.4 Define explicit paginated, resource, mutation-acknowledgement, connection-snippet, and nested test-tool output schemas.
- [x] 6.5 Omit secret-existence fields from both schemas and results when `secret-reference` scope is absent.
- [x] 6.6 Verify destructive annotations and descriptions supplement but never replace confirmation and scope enforcement.
- [x] 6.7 Add Platform MCP tests for every scope set, contract completeness, structured failures, hidden properties, and schema-valid successes.

## 7. Studio Contract Readiness and Preview

- [x] 7.1 Add title and explicit agent-facing description controls to create/edit/duplicate flows with en/es copy parity.
- [x] 7.2 Add input-description and supported-format controls backed by the typed agent-input registry.
- [x] 7.3 Add behavioral annotation controls that explain read-only, destructive, idempotent, and open-world effects in plain language.
- [x] 7.4 Expose a backend readiness procedure using the same contract compiler and stable issue locations as gateway registration.
- [x] 7.5 Allow incomplete disabled drafts while blocking enable for contract errors in the save transaction.
- [x] 7.6 Ensure incomplete development tools remain disabled until the owner supplies explicit title, descriptions, and valid annotations.
- [x] 7.7 Build an exact agent-contract preview for name, title, description, input/output schemas, annotations, version, and fingerprint.
- [x] 7.8 Redact secret bindings, sensitive examples, internal ids, and credential-bearing resolved data from preview.
- [x] 7.9 Add component tests for readiness gating, disabled incomplete drafts, annotation conflicts, preview parity, and write-free failures.

## 8. Contract Snapshots and Agent Decision Fixtures

- [x] 8.1 Add normalized wire snapshots for read-only, destructive, constrained-input, sensitive-input, and zero-input product tools.
- [x] 8.2 Add normalized wire snapshots for every Platform MCP tool grouped by effective scope set.
- [x] 8.3 Add call-result fixtures for success, bad arguments, auth failure, throttling, upstream error, timeout, and indeterminate mutation.
- [x] 8.4 Add deterministic assertions that similar tools contain enough distinct purpose and input information for selection.
- [x] 8.5 Add deterministic assertions that argument issues identify corrective fields without exposing submitted sensitive values.
- [x] 8.6 Add deterministic assertions that retry metadata permits waiting after throttling and prevents blind mutation retry.
- [x] 8.7 Verify fingerprints stay stable under database ordering/timestamp changes and change for every agent-visible contract edit.

## 9. Rollout, Documentation, and Verification

- [x] 9.1 Switch product and Platform registration/result normalization atomically and add an architecture test that rejects imports of superseded helpers.
- [x] 9.2 Emit telemetry for readiness failures, schema-invalid internal results, and contract-version/fingerprint counts without sensitive values.
- [x] 9.3 Update maintainer documentation for contract versioning, error categories, retry semantics, metadata namespace, and the pre-production reset/revert procedure.
- [x] 9.4 Update owner-facing en/es guidance for titles, descriptions, annotations, sensitive inputs, and agent-visible previews.
- [x] 9.5 Run migration checks, focused protocol/component tests, `bun typecheck`, `bun lint`, the full test suite, and final formatting.
- [x] 9.6 Validate actual MCP SDK client payloads after build and confirm no generated contract includes secrets, internal ids, or nondeterministic fields.
- [x] 9.7 Search production source, schemas, tests, and documentation for removed flat error fields, generated-copy provenance, compatibility flags, or fallback registration paths and eliminate every remaining occurrence.
