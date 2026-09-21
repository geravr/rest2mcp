# API Server

Hono + tRPC backend running on Bun.

## Running

```bash
bun api:dev
```

See the [root README](../../README.md) for the full command reference.

## Notes

- `dev.ts` is the local development server.
- `serve.ts` is the Bun entrypoint for VPS or container deployments.
- PostgreSQL is accessed directly through `DATABASE_URL` using Drizzle ORM.

## Platform MCP authentication

`/api/platform-mcp` uses an explicit **personal access token (PAT)** mode, not
OAuth. Tokens are created and revoked from Settings with least-privilege
presets (Inspect, Build drafts, Operate read-only, or custom scopes). Each PAT
is resource-bound (a non-empty set of selected servers or the whole account)
and has a bounded expiration, so a leaked token is limited by operation,
server set, lifetime, and independent revocation. The endpoint does not publish
OAuth protected-resource metadata and does not advertise OAuth discovery.

See [docs/mcp-platform-authorization.md](docs/mcp-platform-authorization.md) for
the scope matrix and enforcement layers.

## AI providers

The API supports account-scoped AI provider connections for OpenAI, Anthropic,
xAI, Meta Model API, OpenRouter, OpenCode Zen, and OpenCode Go. Owners connect
a provider once per provider kind from the SPA's AI Settings tab under
Settings.

### Deployment setup

Before starting an API version that accepts AI connections, provide
`AI_CREDENTIAL_SECRET` (minimum 32 characters) in the environment. It is
dedicated key material for the AI credential envelope and must differ from
`BETTER_AUTH_SECRET` and `MCP_CREDENTIAL_SECRET`.

### How connections behave

- Submitted provider credentials are verified with a real authenticated
  provider call before anything is stored; invalid credentials are never
  persisted, and a failed rotation leaves the current connection untouched.
- Credentials are stored only as a versioned AES-256-GCM envelope bound to
  the owner, connection, and provider identity. They are never returned by
  any API, logged, or displayed again after submission.
- Provider requests go only to fixed HTTPS origins registered in code. Base
  URLs cannot be supplied from the browser.
- Model lists are discovered live from the provider's authenticated catalog
  (optionally enriched with public metadata from models.dev) — there is no
  shipped model allowlist. Catalog responses are bounded, cached briefly in
  memory per credential revision, and a failed refresh may serve a visibly
  stale cached snapshot when one exists for the same credential revision.
- OpenRouter and the OpenCode gateways resell third-party models. A gateway
  model becomes selectable only when its route and protocol can be resolved
  from current metadata; otherwise it is listed as unsupported. OpenCode Go
  inference also sends an `x-opencode-session` header, which that gateway
  requires.
- Selecting ("verifying") a model sends one small synthetic structured-output
  request to the provider through Mastra. The UI discloses this before the
  call: verification may incur a minimal provider charge. The selection is
  stored with a fingerprint over provider, credential revision, adapter
  version, model, route/protocol, and capability-profile version, and stops
  satisfying readiness when any of those change.
- Transient provider failures (rate limits, outages, timeouts) are reported
  as retryable and never erase a verified connection or selection.
