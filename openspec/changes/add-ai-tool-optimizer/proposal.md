## Why

Creating high-quality MCP tools from imported or manually authored REST endpoints still requires repetitive judgment about agent-facing names, descriptions, inputs, and request construction. With the AI provider foundation available, rest2mcp can offer bounded assistance while preserving human approval, canonical validation, and the draft/publish boundary.

## What Changes

- Add AI optimization for one tool, selected tools, all eligible draft tools, or selected OpenAPI import candidates.
- Require a verified `structured-text-v1` model; otherwise all optimization controls remain disabled with a Settings call to action.
- Present a preflight authorization summary before sending data, including provider/model, scope, disclosed data categories, mutable fields, token/cost estimate when available, and explicit confirmation.
- Persist durable optimization runs and per-tool recommendations so large scans expose progress, partial failures, cancellation, and restart-safe results.
- Send only sanitized endpoint structure and documentation to a tool-free Mastra workflow; exclude credentials, secret identities, values, base URLs, allowed hosts, and raw OpenAPI documents.
- Classify recommendations as safe metadata patches, guarded request-shaping patches, or advisory-only findings. Paths, HTTP methods, authentication, secrets, hosts, mutation permission, enablement, and publication SHALL NOT be AI-applicable fields.
- Show a before/after comparator and run summary before any mutation; let the owner select recommendations to apply or reject.
- Validate selected patches through the canonical definition schemas, compiler, security policy, and effective request preview, then apply them atomically to the mutable draft with stale-revision protection.
- Keep imported candidates fingerprint-bound and apply approved recommendations only as part of normal atomic import confirmation.
- Retain secret-safe provenance, model/run metadata, normalized usage, and bounded recommendation history.
- Non-goals: automatic publication, live upstream execution, autonomous retries with broader authority, changing immutable upstream identity/security fields, agent memory, RAG, or unattended recurring optimization.

## Capabilities

### New Capabilities

- `ai-tool-optimization`: Authorization, durable analysis runs, recommendation policy, comparison, validation, application, audit, and retention.

### Modified Capabilities

- `mcp-studio`: Add optimization controls and review/apply flows for one, selected, or all eligible draft tools.
- `openapi-import`: Add optional optimization of selected import candidates without bypassing deterministic mapping, diagnostics, fingerprints, capacity, or atomic confirmation.

## Impact

- Adds optimization run/item schemas, a generated migration, and a bounded PostgreSQL-backed worker lifecycle.
- Adds Mastra workflow prompts and strict structured-output contracts on top of `ai-model-runtime`.
- Adds authenticated tRPC services for preflight, start, status, cancel, review, and atomic draft application.
- Extends Studio and OpenAPI import UI, hooks, dialogs, comparison views, progress states, and English/Spanish copy.
- Adds canonical patch-policy, compiler, concurrency, prompt-injection, data-disclosure, retention, and end-to-end regression coverage.
