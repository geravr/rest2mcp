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
