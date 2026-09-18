## Why

Platform MCP tokens currently default to broad account-wide authority, combine authoring with invocation and secret-reference privileges, and rely primarily on tool registration for authorization. A leaked token or mistaken agent action can therefore affect every server, invoke mutating upstream operations, inspect operational data, or exploit scope combinations with a larger blast radius than the user likely intended.

## What Changes

- Replace the singleton Platform token with multiple named personal access tokens (PATs) that can be listed, individually revoked, and atomically rotated without disrupting unrelated agents.
- Make least privilege the default: new tokens start read-only, use shorter expirations, and require explicit selection and confirmation for high-risk capabilities.
- Refine scopes to separate metadata reads, observability, draft authoring, publishing runtime-effective changes, read-only invocation, mutating invocation, secret references, and destructive Studio operations.
- Add immutable resource boundaries so a token is either account-wide or restricted to an explicit set of owned servers; restricted tokens cannot create servers or escape their allowlist.
- Centralize authorization policy for both tool discovery and call-time enforcement, validate stored scopes fail-closed, reject invalid scope combinations, and authorize before resource lookup to avoid existence or secret-type oracles.
- Return scope-aware projections: ordinary read access never exposes secret ids, secret-backed authoring bindings, raw credentials, sensitive call-log content, or misleading placeholder values.
- Harden the HTTP boundary by authenticating before reading request bodies, applying control-plane rate/concurrency limits, returning standards-aligned Bearer challenges, and auditing sensitive grants, denials, rotations, and high-risk calls.
- **BREAKING**: revoke existing Platform tokens during migration because their scope semantics and policy version are ambiguous; server-scoped gateway tokens remain valid.

Non-goals: implementing a full OAuth 2.1 authorization server or MCP client-registration flow, allowing agents to create or rotate plaintext secrets, changing product gateway authorization, or adding IP-based access policies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `platform-mcp`: Replace broad singleton tokens with versioned, least-privilege, resource-bound PATs and defense-in-depth authorization for every Platform tool.
- `mcp-observability`: Add secret-safe Platform security events and owner-facing token activity needed to detect misuse and explain denials.

## Impact

- Platform MCP Hono boundary, centralized tool registry/policy evaluation, Studio services, tRPC token-management procedures, rate limiting, and stable error contracts.
- Drizzle token storage, normalized scope/server grants, security-event retention, migrations, and legacy-token revocation.
- Settings UX and en/es copy for token inventory, presets, server selection, risk warnings, rotation, revocation, and recent activity.
- Platform MCP tests for scope composition, cross-server isolation, secret non-disclosure, transport hardening, rate limits, and revocation.
- This supersedes the single-active-Platform-token assumption in `make-studio-writes-atomic`; its token uniqueness and replacement tasks must be reconciled before either change is applied.
