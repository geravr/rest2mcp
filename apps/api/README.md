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
