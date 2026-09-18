## Why

Playground and agents already omit empty optional arguments, but execution still interpolates every `{{placeholder}}` in the stored query map. A lookup tool with mutually exclusive optional query keys (`email` / `phone` / `limit` / `nextCursor`) therefore fails with `MCP_TEMPLATE_UNRESOLVED` before any upstream call — even when auth, variables, and the one filled argument are correct. Optional REST query params cannot be expressed today.

## What Changes

- At execution, omit a **query** key (tool query or server `defaultQuery`) when its stored value is exactly `{{name}}`, `name` is a declared tool param with `required: false`, and neither an argument nor a server variable provides it.
- Path, headers, and body stay strict: unresolved placeholders there still fail with `MCP_TEMPLATE_UNRESOLVED` and no upstream request.
- Prefixed or mixed values (`Bearer {{token}}`, `prefix{{id}}`) still fail if unresolved — only a sole exact placeholder is eligible to omit.
- Required params, unknown placeholders, and missing variables still fail.
- User-facing `MCP_TEMPLATE_UNRESOLVED` copy SHALL name the unresolved placeholder so this class of bug is diagnosable.
- **Non-goals:** omitting optional JSON/form body fields; omitting headers; mustache sections; changing curl-import marking defaults; GHL `Version` header values.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `mcp-templates`: query-map rendering MAY drop an optional exact-placeholder key instead of failing; unresolved errors identify the placeholder name.
- `mcp-studio`: SPA error copy for `MCP_TEMPLATE_UNRESOLVED` includes the placeholder name (en/es parity).

## Impact

- `apps/api/lib/mcp-template.ts` and `apps/api/services/mcp-executor-service.ts` (merged query render).
- Executor / template tests; playground keeps omitting empty optional args (now the correct contract).
- `packages/core` error payload if a `details.name` (or equivalent) is needed; `apps/app` `resolveErrorMessage` + en/es `errors.ts`.
- Gateway, playground, and platform MCP all share `executeMappedTool`, so they pick this up together.
- No schema or auth-recipe changes.
