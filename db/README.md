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
