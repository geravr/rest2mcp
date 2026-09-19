## Why

Agents can discover and invoke the generated MCP tools, but contract quality is inconsistent: product tools rely on sparse descriptions and a generic envelope, some execution failures omit structured output, and Platform MCP tools lack the same schemas, annotations, and error semantics. This makes tool selection, argument repair, safe retries, and result interpretation less reliable than the underlying execution boundary.

## What Changes

- Define one agent-facing tool contract compiler for product and Platform MCP tools, including title, outcome-oriented description, closed input schema, output schema, annotations, and namespaced contract metadata.
- Require enabled product tools and exposed inputs to have agent-usable descriptions; validate contradictory or unsafe annotations before advertisement.
- Preserve input types, constraints, formats, enums, examples, required fields, and sensitivity metadata in the advertised JSON Schema.
- Replace duplicated flat execution-error fields with one structured error object containing stable category/code, safe message, retryability, retry delay, indeterminate-outcome state, and argument issue locations.
- Return the declared structured envelope for every tool completion, including invalid arguments, policy rejection, rate limiting, upstream non-2xx responses, timeouts, and unexpected failures.
- Give every Platform MCP tool explicit input/output contracts and safety annotations, and omit scope-hidden properties rather than returning misleading false values.
- Add a Studio contract-readiness check and exact MCP preview before a tool can be enabled.
- Add deterministic contract snapshots and agent-behavior fixtures for selection, argument correction, retry, and destructive-action decisions.
- **BREAKING**: require every enabled development tool to satisfy the complete contract immediately; remove generated legacy copy, old result shapes, compatibility flags, and fallback registration paths instead of backfilling or preserving them.

**Non-goals:** changing typed request-binding persistence, upstream transport policy, authentication/secret storage, curl import behavior, exact per-API response modeling, or adding LLM-dependent production validation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-gateway`: Advertised tools and all call results use complete, internally consistent, agent-actionable contracts.
- `mcp-studio`: Owners can validate and preview the exact agent-visible contract, and incomplete contracts cannot be enabled.
- `platform-mcp`: Control-plane tools expose the same schema, annotation, structured-result, and error quality as product tools.

## Impact

This affects MCP registration helpers, request-definition input metadata, execution/result normalization, Platform MCP registration, Studio tool authoring and previews, localized validation copy, persisted tool metadata, and protocol tests. A generated Drizzle migration may add required contract metadata and remove superseded fields. Development records may be reset or left disabled until they satisfy the new contract; no runtime compatibility layer remains.
