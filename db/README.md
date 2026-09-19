# Database Layer

Drizzle ORM schema and migration workspace for PostgreSQL.

## Running

```bash
bun db:generate       # Generate migrations
bun db:migrate        # Apply migrations
bun db:studio         # Launch Drizzle Studio
bun db:seed           # Run seed scripts
```

See the [root README](../README.md) for the full command reference.

## Notes

- `DATABASE_URL` is loaded from the repo root env files.
- Migrations run directly against PostgreSQL.
- Schemas live under `db/schema/` and are re-exported from `@repo/db`.
- **Breaking schema resets:** If your local database already applied an older multi-file migration chain (for example pre–single-user baseline migrations), do not attempt an in-place upgrade. Drop the local database/volume, then run `bun db:migrate` against a clean database.
- **Platform PAT cutover:** The normalized Platform grant migration deletes existing Platform PAT rows (server gateway tokens are untouched). Seeds never create Platform PATs or persist a raw credential; create a least-privilege token from Settings after migrating. To reset local development, drop the local database/volume, run `bun db:migrate`, then `bun db:seed`.

## Seeds

`bun db:seed` is development-only and idempotent; the script refuses to run against `ENVIRONMENT=production` unless `ALLOW_PROD_SEED=true` is set. It runs:

- `db/seeds/users.ts` — test user accounts.
- `db/seeds/mcp.ts` — canonical MCP fixtures as **unpublished drafts** (`published_revision_id` null, `draft_revision` 1, `status` "draft"). No secret material is seeded.

Because a published pointer is created only by explicit publication, the seeded MCP servers expose no agent tools until the owner runs the normal Studio review/publish flow. From Studio: open the server, review the publish preview (readiness, contract changes, warnings), and publish revision 1. There is no automatic publication or backfill on seed or migration.

## Resetting development data

Application records are disposable while the repository is `PRE_PRODUCTION`. To reset:

```bash
# Drop the local Postgres volume/database, then:
bun db:migrate
bun db:seed
```

Revision rows are immutable and are never updated; retention cleanup may delete superseded revisions while always preserving the active revision. Call-log rows keep denormalized revision attribution after cleanup.
