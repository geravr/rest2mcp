## 1. Dependency and Policy Decisions

- [ ] 1.1 Confirm `persist-typed-request-bindings` is complete and consume its final shared request-definition and compile-issue types without copying them.
- [ ] 1.2 Choose the grace period for generated legacy descriptions and document when owner review becomes mandatory.
- [ ] 1.3 Decide whether contract fingerprints remain `_meta`-only or also appear in Studio and support-oriented call-log metadata.
- [ ] 1.4 Define the namespaced contract metadata key, contract version 1 compatibility policy, and canonical JSON rules.
- [ ] 1.5 Inventory every product and Platform tool plus its current title, descriptions, input/output schema, annotations, and result shape.

## 2. Contract and Persistence Model

- [ ] 2.1 Define shared types and strict schemas for compiled tool contracts, readiness issues, fingerprints, and generated-copy provenance.
- [ ] 2.2 Add optional product-tool title and any required provenance/readiness fields to the Drizzle schema.
- [ ] 2.3 Generate and inspect the Drizzle migration without manually editing generated SQL.
- [ ] 2.4 Implement deterministic humanized-title and description backfill for incomplete existing enabled tools.
- [ ] 2.5 Verify the migration preserves tool availability, typed request definitions, compiled plans, and secret-free metadata.
- [ ] 2.6 Add migration tests for complete tools, incomplete enabled tools, disabled drafts, reruns, and rollback-compatible nullable fields.

## 3. Input Schema and Contract Compiler

- [ ] 3.1 Build a normalized agent-input schema representation shared by advertised JSON Schema and runtime validation.
- [ ] 3.2 Preserve required state, type, bounds, valid pattern, enum, examples, and supported string formats in the normalized schema.
- [ ] 3.3 Add `writeOnly` and namespaced sensitivity metadata while removing sensitive examples/defaults and all resolved values.
- [ ] 3.4 Enforce closed root objects and exact `{}` semantics for zero-input tools.
- [ ] 3.5 Reject invalid patterns, unsupported formats, contradictory bounds, incompatible enums, duplicate public names, and missing input descriptions.
- [ ] 3.6 Enforce annotation invariants for read methods, mutating methods, DELETE defaults, explicit idempotence, and open-world REST access.
- [ ] 3.7 Compile title, description, schemas, annotations, version metadata, and deterministic fingerprint into one immutable contract.
- [ ] 3.8 Add compiler tests for ordering noise, description changes, secret rotation, format handling, sensitivity, and annotation contradictions.

## 4. Structured Result and Error Normalization

- [ ] 4.1 Extend the execution envelope with the additive structured error categories, stable code, safe message, retryability, delay, indeterminate flag, and issues.
- [ ] 4.2 Preserve legacy flat error fields throughout contract version 1 and add compatibility tests for existing consumers.
- [ ] 4.3 Implement central retry classification that defaults to non-retryable and accounts for idempotence and determinate upstream outcomes.
- [ ] 4.4 Map validation, policy, auth, not-found, conflict, rate-limit, upstream, timeout, network, and internal failures to stable categories.
- [ ] 4.5 Normalize Zod issues into path/id diagnostics without echoing received sensitive values.
- [ ] 4.6 Build one success/error result helper that emits compatibility text and matching `structuredContent`.
- [ ] 4.7 Validate outgoing structured content and fall back to a minimal schema-valid internal error with telemetry on normalization defects.
- [ ] 4.8 Add tests for upstream 401/429/500, invalid arguments, rate limiting, timeout before send, timeout after mutation send, and unexpected exceptions.

## 5. Product MCP Gateway Integration

- [ ] 5.1 Replace per-request description/schema assembly with the shared compiled product-tool contract.
- [ ] 5.2 Register top-level title, outcome-oriented description, input/output schemas, annotations, and namespaced metadata with the MCP SDK.
- [ ] 5.3 Use the normalized input validator so runtime acceptance exactly matches the advertised schema.
- [ ] 5.4 Return the shared structured envelope for argument, policy, rate-limit, executor, and internal failures.
- [ ] 5.5 Keep enabled valid tools sorted deterministically and exclude contract-readiness failures before registration.
- [ ] 5.6 Add MCP SDK client tests proving `tools/list` and `tools/call` payloads match their schemas at the wire boundary.

## 6. Platform MCP Contract Registry

- [ ] 6.1 Create a centralized registry entry for every Platform tool with title, purpose, described inputs, output data schema, annotations, and required scopes.
- [ ] 6.2 Generate Platform tool fingerprints after scope filtering and keep registration order deterministic.
- [ ] 6.3 Replace ad hoc `jsonToolResult` and `jsonToolError` paths with the shared structured result normalizer.
- [ ] 6.4 Define explicit paginated, resource, mutation-acknowledgement, connection-snippet, and nested test-tool output schemas.
- [ ] 6.5 Omit secret-existence fields from both schemas and results when `secret-reference` scope is absent.
- [ ] 6.6 Verify destructive annotations and descriptions supplement but never replace confirmation and scope enforcement.
- [ ] 6.7 Add Platform MCP tests for every scope set, contract completeness, structured failures, hidden properties, and schema-valid successes.

## 7. Studio Contract Readiness and Preview

- [ ] 7.1 Add title and explicit agent-facing description controls to create/edit/duplicate flows with en/es copy parity.
- [ ] 7.2 Add input-description and supported-format controls backed by the typed agent-input registry.
- [ ] 7.3 Add behavioral annotation controls that explain read-only, destructive, idempotent, and open-world effects in plain language.
- [ ] 7.4 Expose a backend readiness procedure using the same contract compiler and stable issue locations as gateway registration.
- [ ] 7.5 Allow incomplete disabled drafts while blocking enable for contract errors in the save transaction.
- [ ] 7.6 Surface generated migration copy as warnings and require explicit replacement on later re-enable/edit workflows.
- [ ] 7.7 Build an exact agent-contract preview for name, title, description, input/output schemas, annotations, version, and fingerprint.
- [ ] 7.8 Redact secret bindings, sensitive examples, internal ids, and credential-bearing resolved data from preview.
- [ ] 7.9 Add component tests for readiness gating, disabled drafts, generated-copy warnings, annotation conflicts, preview parity, and write-free failures.

## 8. Contract Snapshots and Agent Decision Fixtures

- [ ] 8.1 Add normalized wire snapshots for read-only, destructive, constrained-input, sensitive-input, and zero-input product tools.
- [ ] 8.2 Add normalized wire snapshots for every Platform MCP tool grouped by effective scope set.
- [ ] 8.3 Add call-result fixtures for success, bad arguments, auth failure, throttling, upstream error, timeout, and indeterminate mutation.
- [ ] 8.4 Add deterministic assertions that similar tools contain enough distinct purpose and input information for selection.
- [ ] 8.5 Add deterministic assertions that argument issues identify corrective fields without exposing submitted sensitive values.
- [ ] 8.6 Add deterministic assertions that retry metadata permits waiting after throttling and prevents blind mutation retry.
- [ ] 8.7 Verify fingerprints stay stable under database ordering/timestamp changes and change for every agent-visible contract edit.

## 9. Rollout, Documentation, and Verification

- [ ] 9.1 Add a compatibility flag for switching product and Platform registration/result normalization independently during rollout.
- [ ] 9.2 Emit telemetry for readiness failures, schema-invalid internal results, generated-copy usage, and contract-version/fingerprint counts without sensitive values.
- [ ] 9.3 Update maintainer documentation for contract versioning, error categories, retry semantics, metadata namespace, and rollback.
- [ ] 9.4 Update owner-facing en/es guidance for titles, descriptions, annotations, sensitive inputs, and agent-visible previews.
- [ ] 9.5 Run migration checks, focused protocol/component tests, `bun typecheck`, `bun lint`, the full test suite, and final formatting.
- [ ] 9.6 Validate actual MCP SDK client payloads after build and confirm no generated contract includes secrets, internal ids, or nondeterministic fields.
