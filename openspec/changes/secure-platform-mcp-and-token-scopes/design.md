## Context

`/api/platform-mcp` is an owner-level control plane authenticated by a manually copied Bearer token. The token currently stores a JSON array of five scopes, defaults to `read + author + invoke + secret_reference`, applies to every server owned by the account, and is the only active Platform token. Tools are conditionally registered from those scopes, but the service layer receives only `userId`; there is no durable resource grant or defense-in-depth principal at the command boundary.

The existing scope groups have unsafe composition. `read` includes operational call logs, `author` can change enabled tools, and `invoke` can execute both GET and mutating HTTP methods. A default token can therefore author a runtime-effective tool, reference an existing secret, and invoke the result. Stored scopes are cast rather than validated during authentication, control-plane operations are not rate-limited consistently, and ordinary read results can expose typed definitions containing server-value ids even when secret metadata is hidden.

The MCP 2026-07-28 authorization model is OAuth-based and expects resource-server discovery, audience restriction, and standards-compliant challenges. This repository uses MCP SDK v1 and has no authorization server. This change defines an explicit personal-access-token (PAT) authentication mode without presenting it as full MCP OAuth conformance. The policy model is designed so a future OAuth access-token validator can produce the same internal principal.

## Goals / Non-Goals

**Goals:**

- Default every new Platform credential to the minimum useful privilege and a bounded lifetime.
- Bound a leaked token by operation, server set, lifetime, rate, and independent revocation.
- Use one fail-closed policy evaluator for tool discovery, transport preflight, handlers, and service commands.
- Prevent secret ids, hidden resource existence, and sensitive operational data from leaking through projections or differing errors.
- Separate draft authoring from runtime publication and read-only invocation from mutating invocation.
- Give owners clear token inventory, activity, and security events without storing bearer material.

**Non-Goals:**

- Implementing an OAuth 2.1 authorization server, DCR/CIMD, refresh tokens, or OAuth consent screens.
- Changing server-scoped `/mcp/{serverId}` tokens or product gateway authorization.
- Allowing Platform agents to create, rotate, reveal, or receive plaintext secrets.
- IP allowlists, device attestation, or organization/workspace tenancy.
- Treating a resource name confirmation as a substitute for the required high-risk scope.

## Decisions

### 1. Replace the singleton token with immutable, versioned PAT grants

An account may have up to ten active named Platform PATs. Token creation no longer revokes unrelated tokens. A PAT has an immutable `policyVersion`, expiration, resource mode, normalized scope rows, and optional normalized server grants. The existing token row retains only identity and lifecycle metadata; a unique hash constraint remains the credential lookup key. Raw tokens are generated with existing cryptographic randomness, returned once, never persisted, and never written to logs or command receipts.

The resource modes are:

- `selected`: access only to an immutable non-empty set of owned server ids. This is the recommended default. It cannot create servers.
- `account`: access to present and future owned servers. It may create a draft server when the PAT also has `author`. Account-wide high-risk grants require step-up confirmation.

Scopes and server grants cannot be edited in place. The owner rotates a PAT to a newly issued successor; inserting the successor, copying or replacing grants, recording the security event, and revoking the selected predecessor happen in one transaction. Revocation targets one PAT. Token limits, active-name uniqueness, rotation, and revocation use a user-row lock, not a singleton active-token index.

Alternatives considered:

- Keeping one account-wide token makes rotation simple but prevents per-agent least privilege and forces downtime or privilege sharing.
- Mutable grants create authorization races and make audit history ambiguous. Immutable grants plus rotation provide a stable principal for every request.
- Embedding grants in JSON is easy to serialize but makes referential integrity and fail-closed validation weaker. Normalized rows are the only authoritative grant storage; the migration removes the superseded Platform scope JSON and no runtime path reads it.

### 2. Use a composable scope model with explicit dependencies

The canonical scopes are:

| Scope | Authority |
| --- | --- |
| `read` | List granted servers, safe tool/connection metadata, and non-secret value metadata |
| `observe` | Read sanitized call logs and detailed operational health |
| `author` | Create draft servers when account-wide; create/edit disabled drafts and unused non-secret config |
| `publish` | Make runtime-effective changes, including enabling tools or modifying enabled tools/referenced config |
| `invoke` | Test enabled GET/HEAD tools only |
| `invoke_mutation` | Test enabled POST/PUT/PATCH/DELETE tools that already allow mutation |
| `secret_reference` | Discover and bind existing secret ids without resolving their values |
| `destructive` | Delete Studio servers, tools, and values after current-name confirmation |

Every token includes `read`. `observe`, `author`, `invoke`, and `destructive` require `read`; `publish` requires `author`; `invoke_mutation` requires `invoke`; and `secret_reference` requires `read`. Unknown scopes, duplicates, missing dependencies, the wrong policy version, or a mismatch between resource mode and server grants invalidate the PAT as a whole.

`author` alone cannot change effective runtime behavior. Create and curl-import operations produce disabled drafts; editing an enabled tool, enabling a tool, or changing a value referenced by an enabled plan requires `publish`. Method classification, not author-supplied annotations, decides whether invocation needs `invoke_mutation`. A tool whose compiled annotation is destructive additionally requires a confirmation matching its current name, but confirmation never grants authority.

Presets reduce unsafe combinations:

- Inspect: `read` (default).
- Build drafts: `read + author`.
- Operate read-only: `read + invoke`.
- Custom: explicit advanced selection with dependency visualization.

`publish`, `invoke_mutation`, `secret_reference`, `destructive`, and account-wide grants are high-risk. Creating or rotating a PAT with any high-risk property consumes a recent, short-lived, single-use step-up grant obtained through the existing authenticated email OTP channel. Low-risk PATs default to 30 days and are capped at 90; high-risk PATs default to 7 days and are capped at 30.

### 3. Build one Platform principal and one policy evaluator

Authentication returns a frozen `PlatformPrincipal` containing token id, user id, validated policy version/scopes, resource mode, allowed server ids, and expiration. The tool registry declares each tool's static required scopes, risk classification, resource-id extractor, and optional dynamic policy. The same evaluator:

1. filters `tools/list`;
2. preflights static scope requirements for `tools/call`;
3. wraps every registered handler;
4. passes the principal into Platform service commands for resource and dynamic checks.

Authorization occurs before resource lookup whenever possible. Selected-server predicates are included in database queries rather than filtering results afterward. A resource outside the grant returns the same not-found result as a nonexistent resource. Services must not trust `userId` alone for Platform calls, and direct registration without policy metadata is rejected by a registry test.

This extends the centralized contracts from `improve-agent-tool-contracts`; contract metadata and policy metadata share one registry rather than creating competing registries.

### 4. Separate safe projections from authoring definitions

`read` returns agent-visible tool contracts and safe operational metadata, not the stored authoring request definition. It omits undisclosed fields rather than returning false or null placeholders. `observe` gates call-log access.

An authoring-definition read is a separate author operation. If the stored definition contains secret bindings, `secret_reference` is required; without it the system returns a generic policy denial and does not return a partially editable definition. For submitted server-value ids, a PAT without `secret_reference` may use only ids already visible as non-secret config. Every unknown or non-visible id receives the same generic policy denial, so a caller cannot distinguish a secret id from a nonexistent or foreign id. With `secret_reference`, normal ownership and existence validation follows, but values and ciphertext are still never returned.

Platform `set_variable` remains limited to non-secret configuration. Sensitive-name heuristics are defense in depth, not the security boundary: compiler placement policy continues rejecting plaintext credentials in protected positions, while descriptions and UI state clearly state that Platform MCP is not a secret-entry channel.

### 5. Enforce authorization at the HTTP boundary and again in tools

The route checks Origin and declared content length, extracts and validates the PAT, and acquires an authenticated control-plane rate/concurrency slot before reading the request body. A bounded streaming reader aborts once the byte limit is crossed, including chunked requests. Invalid, expired, revoked, unknown-policy, and malformed-grant tokens all return the same HTTP 401 response with an RFC 6750 Bearer challenge. A statically under-scoped tool call returns HTTP 403 with `error="insufficient_scope"` and the required public scope names; dynamic resource denials remain generic structured tool errors.

Per-token budgets cover all Platform requests, with stricter buckets for writes and invocations. Existing per-server upstream concurrency and invocation budgets remain. Slots are released on every success/failure path and state is cleared naturally when a token is revoked or expires. In-memory counters remain acceptable for the documented single-process deployment; their limitation is retained explicitly.

PAT mode does not publish OAuth protected-resource metadata or claim automatic MCP authorization discovery. A separate change can add OAuth/client-credentials support and map validated OAuth claims into `PlatformPrincipal`.

### 6. Record durable, secret-safe security events

Add an owner-scoped Platform security-event table with event type, token id/prefix snapshot, optional allowed server id, outcome, safe scope names, timestamp, and bounded non-sensitive metadata. Record issuance, rotation, revocation, scope/resource denial, failed step-up, destructive Studio action, and mutating upstream invocation. Do not record raw tokens, request arguments/bodies, server-value ids, secret metadata, authorization headers, or ciphertext.

Owners can view a paginated recent event list in Settings; Platform PATs cannot read this ledger. Token inventory shows name, prefix, scopes, resource mode/count, created/last-used/expiry/revoked timestamps, and successor/predecessor metadata. Retain events for 90 days and delete them with the account. Security-event persistence for grant/revoke operations is transactional; runtime denial/audit failure is observable through safe telemetry but does not alter the already-determined authorization result.

## Risks / Trade-offs

- **[Development Platform connections stop working]** -> Delete disposable Platform PATs, update seeds, and require owners to create new least-privilege PATs; do not ship a legacy authentication path or migration notice.
- **[More scopes increase cognitive load]** -> Lead with three safe presets, hide custom composition behind an advanced control, show effective permissions and dependencies, and require explicit high-risk confirmation.
- **[Multiple tokens expand credential inventory]** -> Cap active PATs, require names and expirations, show last use, support individual revocation, and retain owner security events.
- **[Selected-server grants become stale after server deletion]** -> Cascade grant rows and keep the PAT valid for its remaining grants; a token with no remaining selected servers authenticates but sees no resources.
- **[Step-up OTP adds friction and delivery dependency]** -> Require it only for high-risk grants, use short-lived single-use grants, and never weaken the policy when email delivery fails.
- **[Policy checks drift from tool contracts]** -> Co-locate contract and authorization metadata, enforce complete registry coverage in tests, and pass principals to service commands for defense in depth.
- **[PAT mode is not full MCP OAuth]** -> Label it accurately, emit standards-aligned Bearer errors, avoid false discovery metadata, and keep the principal abstraction compatible with a future OAuth validator.
- **[Security-event storage contains behavioral metadata]** -> Minimize fields, apply retention, owner-scope every query, and prohibit arguments, bodies, secrets, and raw credentials.
- **[In-memory limits do not coordinate across replicas]** -> Keep the single-process deployment assumption explicit; require a shared limiter before horizontal scaling.

## Migration Plan

1. Reconcile `make-studio-writes-atomic` by removing its singleton-active-token uniqueness assumption and retaining user-locked per-token rotation/revocation atomicity.
2. Add normalized scope/server-grant tables, PAT policy/resource fields, hash and active-name constraints, step-up grants, and security events through one generated Drizzle migration.
3. Delete existing development Platform PATs and remove their legacy scope JSON/singleton fields and APIs in that migration; update seeds to create no raw credential automatically.
4. Implement the principal, registry policy metadata, safe projections, service-level resource checks, transport ordering, limits, and security events as the only Platform authorization path.
5. Update Settings atomically with multiple-token management, presets, selected-server grants, risk/TTL rules, step-up, individual rotation/revocation, and recent security events in en/es.
6. Remove old token serializers, singleton procedures, scope casts, UI state, tests, metrics, and documentation.
7. Verify empty-database migration/seed and reset-development-database flows, then test that no malformed or unknown-policy principal can fall back to removed storage.

If development rollback is required before the migration is shared, revert the code and regenerate/reset the database. Once shared, use a forward generated migration. Legacy Platform PAT authentication is never restored.

## Open Questions

- Should the subsequent standards-compliance change integrate an external OAuth authorization server or extend Better Auth with OAuth resource-server/authorization-server support? That decision requires a separate threat model and MCP SDK v2 migration plan.
