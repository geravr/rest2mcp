## Why

The current MCP authoring and execution path can lose the owner's value-source intent, publish tools that cannot execute, misreport upstream failures as successful MCP results, and let curl imports mutate server authentication or secrets. Hardening this boundary now is necessary to keep hosted MCPs predictable for AI agents and safe for credentials, mutating REST calls, and internet-facing traffic.

## What Changes

- Persist and validate an unambiguous source for every request value: literal, server configuration, server secret, or agent input. Fixed values will never be reinterpreted as templates, and agent inputs will not share a namespace with server values.
- Add a publish-time tool compiler that blocks unresolved bindings, duplicate or conflicting inputs, invalid JSON/header/path definitions, unsupported optional placements, auth overrides, and path traversal.
- Make curl import endpoint-scoped and side-effect free outside the new draft tool. It will never create, rotate, delete, or overwrite authentication, variables, secrets, or server defaults; detected credentials will be excluded and reported as configuration requirements.
- Harden outbound execution with strict redirect-origin rules, full-request deadlines, bounded byte reads, safer response handling, invocation rate/concurrency limits, and best-effort logging that cannot turn a completed upstream mutation into an agent-visible failure.
- Validate MCP `Origin` headers, apply shared payload/domain schemas to tRPC and Platform MCP, and add confirmation/scoping safeguards to destructive platform operations.
- Return non-2xx upstream responses as MCP tool errors and expose structured, typed results with useful safe metadata, output schemas, and behavioral annotations.
- Strengthen secret handling, auth ownership, protected credential keys, redaction, and log retention so sensitive inputs and responses are not retained or exposed accidentally.
- Make server/tool availability deterministic: paused or invalid tools are not advertised, tool ordering is stable, and runtime behavior matches the Studio's enabled/mutation controls.
- **BREAKING**: Existing curl import credential capture, args-first variable overrides, successful MCP results for upstream 4xx/5xx, and ambiguous `{{name}}` source inference will be replaced by the safer contracts above. Existing stored templates will require migration or compatibility compilation.

Non-goals: adding OAuth flows, importing OpenAPI documents, supporting every curl flag, adding multipart/binary request authoring, or introducing full server revision publishing in this change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mcp-studio`: Tool authoring, safe curl import, auth ownership, server values, validation, and mutation controls.
- `mcp-templates`: Typed bindings, namespace isolation, optional-value semantics, JSON rendering, and path confinement.
- `mcp-gateway`: Transport security, rate limits, deterministic advertisement, structured results, annotations, and upstream error mapping.
- `mcp-observability`: Non-blocking audit logging, sensitive-data controls, byte caps, and retention.
- `platform-mcp`: Shared validation, token/operation safeguards, destructive confirmations, and removal of secret-bearing agent workflows.

## Impact

This affects the Studio SPA request builder and curl preview, tRPC MCP router, Platform MCP, hosted MCP gateway, template compiler, executor, SSRF/redirect handling, auth recipes, tokens, call logs, Drizzle schemas/migrations, localized copy, and focused API/SPA tests. Existing tool templates and variable references need a backward-compatible migration plan before legacy inference can be removed.
