## Context

The current system stores request templates and agent parameter metadata separately. The SPA reconstructs Fixed, Variable, and Agent origins by inspecting `{{name}}` strings against the server's current variable names, while runtime resolution gives agent arguments precedence over server variables. That representation loses provenance, permits namespace collisions, and makes a tool's meaning change when server variables change.

The hosted MCP gateway, playground, and Platform MCP share an executor, but they expose different validation limits and result semantics. Outbound requests currently have strong baseline SSRF checks, secret encryption, mutation opt-in, and response caps, yet redirects, deadlines, rate limits, logging, and MCP error/result contracts need hardening. Curl import currently combines parsing with server-wide auth and variable mutations even though a pasted curl normally represents one documented endpoint.

This change crosses the SPA, tRPC, Platform MCP, gateway, executor, database schema, and migration path. Existing tools must remain inspectable and must never be silently reinterpreted.

## Goals / Non-Goals

**Goals:**

- Persist the source and type of every request value without reconstructing intent from placeholder text.
- Compile and validate tools before they can be enabled or advertised.
- Make curl import create only a sanitized draft tool and never mutate server-wide state.
- Give MCP clients deterministic schemas, annotations, structured results, and actionable tool errors.
- Enforce transport, SSRF, redirect, timeout, payload, rate, and concurrency boundaries.
- Keep credentials write-only, prevent agent/server-value collisions, and make auth ownership explicit.
- Ensure audit logging cannot change the result of a completed upstream operation.
- Reuse one domain-validation contract from tRPC and Platform MCP.

**Non-Goals:**

- OAuth authorization-code, client-credentials, or refresh-token flows.
- OpenAPI import, arbitrary curl compatibility, multipart authoring, or binary uploads.
- Stateful MCP sessions or a complete server revision/publish system.
- Precise per-upstream response schemas; this change provides a stable result envelope.
- A distributed rate-limit service. The initial implementation targets the current single-process VPS deployment.

## Decisions

### 1. Store a versioned request definition with explicit bindings

Add a versioned `requestDefinition` to each tool. Request paths, query entries, headers, form fields, and JSON nodes will use explicit bindings:

- `literal`: immutable text or typed JSON that is never scanned for placeholders.
- `serverValue`: stable reference to a server value id plus an optional prefix/suffix transform.
- `agentInput`: stable reference to one declared input id.

Agent inputs will carry JSON-Schema-compatible metadata, including name, description, required, type, constraints, examples, and `sensitive`. Server values will distinguish `config` from `secret` and record ownership (`manual` or `auth`). Names remain unique for usability, but runtime resolution uses ids and never applies args-first fallback.

The compiled request plan will be the runtime source of truth. Raw/advanced bodies remain an escape hatch but must declare namespaced references and pass the same compiler.

Alternative considered: retain `{{name}}` strings and add more validation. Rejected because validation cannot reliably recover provenance, literal braces, or rename-safe references.

### 2. Introduce a single compiler and shared domain schemas

A backend compiler will validate and compile the request definition before a tool can be enabled. It will reject unresolved references, duplicate keys/names, conflicting input metadata, invalid header names, forbidden transport headers, invalid JSON, GET/HEAD bodies, secret placement in URL fields without explicit acknowledgement, auth-key overrides, unsupported optional bindings, path escape, and invalid mutation metadata.

Zod command schemas and domain validation will live in one API module and be consumed by tRPC, Platform MCP, Studio services, and tests. Routers remain thin.

Alternative considered: duplicate stricter schemas in each transport. Rejected because the existing tRPC/Platform divergence demonstrates that duplicated limits drift.

### 3. Treat curl as an endpoint draft importer

Preview will parse raw curl without persistence, reject unsupported or ambiguous flags, require the target origin and base-path boundary to match the selected server, preserve repeated query entries, and return a sanitized normalized draft. Credential headers, cookies, proxy credentials, and unsafe transport headers will be excluded. The response may report credential kind and header name but never the value.

Confirmation will submit the sanitized draft plus location-aware markings (`location`, key/JSON path, occurrence id), not use value-only global replacement. The transaction will create one disabled draft tool and no other row. It will never create/update variables, auth, secrets, or defaults. A missing or conflicting auth setup becomes a blocking validation issue the owner resolves separately.

Platform MCP curl import will reject curl containing credentials and will follow the same no-side-effect rule. Secret-bearing curl/auth workflows remain available only through human Studio forms.

Alternative considered: ask for confirmation before promoting detected credentials to auth. Rejected because an endpoint example is insufficient evidence for a server-wide configuration change.

### 4. Model authentication separately and protect owned keys

Store an explicit server auth configuration referencing auth-owned secret value ids and the header/query keys it injects. The executor applies auth after ordinary defaults/tool entries, and compiled tools cannot override protected keys. Custom auth may own multiple bindings. Changing or clearing auth only rotates/deletes auth-owned values; it never reuses or deletes manual server values based on naming heuristics.

Secret values remain write-only. Query authentication remains supported but requires an explicit exposure warning. Paste normalization only strips a `Name: value` prefix when the name matches the selected field; colons inside the credential are preserved.

### 5. Harden outbound execution as one bounded operation

Each invocation receives one deadline covering DNS checks, redirects, response headers, and body consumption. Responses are read by bytes to a configured cap; text is decoded only for text/JSON content. Binary content returns metadata rather than corrupted UTF-8.

Redirects are same-origin by default. HTTPS-to-HTTP downgrade and port changes are rejected, 307/308 preserve method/body, and credentials are never forwarded to a changed origin. The final normalized path must remain beneath the server base-path boundary. DNS/IP validation will be centralized behind an outbound policy interface so a pinned resolver or egress proxy can replace the current lookup/fetch split later.

Per-token token buckets, per-server concurrency semaphores, request-size limits, and stricter mutation limits will protect both MCP endpoints. Present invalid `Origin` headers return 403; absent Origin remains valid for non-browser MCP clients.

### 6. Return MCP-native results and errors

Successful upstream responses return text content for compatibility and `structuredContent` using a stable envelope: `ok`, `status`, `contentType`, parsed `data` or text `body`, a safe header allowlist, and truncation metadata. The gateway declares the matching `outputSchema`.

Upstream 4xx/5xx responses return `isError: true` with status, normalized code, safe body details, and retry metadata. Network, timeout, validation, and policy failures remain tool execution errors with stable `appCode` values. Tool annotations are derived from method and explicit author metadata (`readOnly`, `destructive`, `idempotent`, `openWorld`). Enabled valid tools are sorted by name; paused servers advertise no callable tools.

Alternative considered: keep all HTTP responses as successful tool results. Rejected because agents need MCP error signaling to self-correct and avoid treating 401/429/500 as completed work.

### 7. Make observability best-effort and privacy-aware

Execution produces the caller result independently from audit persistence. Logs are submitted to a bounded in-process queue; enqueue or database failure emits telemetry but never changes an upstream result. Mutation results include an indeterminate-outcome error only when the upstream completion itself is unknown, not when logging fails.

Request/response body logging defaults to metadata plus redacted previews. Secret bindings and inputs marked `sensitive` are always redacted. Logs have a configurable retention period and account/server deletion removes their rows explicitly. Caps are byte-based.

### 8. Scope Platform MCP authority

Platform tokens receive explicit scopes for read, author, invoke, secrets-reference, and destructive operations, plus expiry and per-token limits. Existing platform tokens will be revoked during migration and must be recreated with scopes. Destructive tools require the destructive scope and a confirmation value such as the current server/tool name. Platform tools cannot accept new plaintext secret values; they can only reference already configured secret ids.

## Risks / Trade-offs

- **[Migration ambiguity]** Some legacy placeholders can represent either agent inputs or variables. → Backfill only unambiguous tools; mark ambiguous tools invalid and disabled with actionable Studio diagnostics.
- **[Breaking agent behavior]** Non-2xx calls become MCP errors and schemas become stricter. → Surface the behavior in connection UI, preserve stable error bodies, and add compatibility tests.
- **[Rollback complexity]** New definitions cannot be understood by old code. → Dual-write a compiled legacy template during the transition and retain legacy columns until a later cleanup change.
- **[Rate limits are process-local]** Multiple replicas would not share counters. → Document the single-process assumption and keep the limiter behind an interface for a later distributed backend.
- **[Best-effort logs can be dropped]** A crash may lose queued audit rows. → Bound the queue, drain on shutdown, expose drop telemetry, and prioritize operation correctness over misleading retries.
- **[Reduced curl convenience]** Users must configure auth separately. → Show a precise import report and direct CTA to the Auth card without carrying credential values forward.
- **[Generic output envelope]** Dynamic REST payloads cannot have exact schemas. → Type the envelope and parsed-vs-text branches now; leave user-authored response projections for a later change.

## Migration Plan

1. Add nullable versioned request-definition, auth ownership/configuration, tool behavior metadata, server-value kind/owner, token scope, and log-policy fields through Drizzle schema and generated migrations.
2. Deploy readers that prefer the new definition but can compile legacy templates in compatibility mode. Keep all existing tools callable during this stage.
3. Backfill unambiguous legacy tools and auth mappings. Produce validation diagnostics for ambiguous bindings, collisions, invalid JSON/headers, or unsafe paths; disable only affected tools instead of guessing.
4. Switch Studio writes and curl import to the new definitions while dual-writing a legacy compiled template for rollback.
5. Switch gateway/executor to compiled plans, structured results, hardened transport, limits, and best-effort logging.
6. Revoke existing platform tokens and require scoped replacements. Keep server-scoped tokens valid.
7. After verification and owner remediation, stop compatibility inference. Legacy columns remain until a separate cleanup change.

Rollback restores the compatibility reader and old gateway result adapter. Because legacy compiled templates are dual-written, newly authored tools remain readable; newly introduced metadata is left unused rather than dropped.

## Open Questions

Resolved for the initial ship (see `apps/api/lib/mcp-policy.ts`):

- Call-log retention: **14 days**.
- Safe response headers: `content-type`, `location`, `link`, `etag`, `retry-after`, plus `cache-control`, `vary`, `x-request-id`, and common `x-ratelimit-*` headers.
- Query-secret placement: **acknowledge** — allowed only with explicit exposure acknowledgement on auth configuration.
- Initial limits (single-process): 60 req capacity / 1 per second refill per token; 20 mutation capacity / ~0.33 per second; 10 concurrent upstream calls per server; 256 KiB gateway request size; 15s full-request deadline.
