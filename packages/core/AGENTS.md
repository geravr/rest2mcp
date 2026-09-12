# AGENTS.md

Local guidance for the shared core package in `packages/core/`. Read [../../AGENTS.md](../../AGENTS.md) first for monorepo-wide rules.

## Scope

- Applies to type guards, application error codes, offset pagination, and telemetry helpers under `packages/core/`.
- Source of truth is live code in `packages/core/`, especially [index.ts](index.ts), [src/guards.ts](src/guards.ts), [src/error-codes.ts](src/error-codes.ts), [src/pagination.ts](src/pagination.ts), and [src/telemetry.ts](src/telemetry.ts).

## What Belongs in Core

- **Type guards**: Pure runtime guards such as `isRecord` / `isStrictRecord`.
- **Application error codes**: Stable `APP_ERROR_CODES` / `AppErrorCode` catalog for API failures and client i18n mapping (`src/error-codes.ts`).
- **Pagination**: Offset pagination types, schemas, and defaults (`page`, `pageSize`, `{ items, page, pageSize, total }`) in `src/pagination.ts`.
- **Telemetry helpers**: Consent-aware PostHog capture utilities, sanitization helpers, and observability Zod schemas for the browser.
- **Shared Zod schemas**: Only when they are truly reused across API and frontend and have no runtime/env coupling.

## What Does NOT Belong in Core

- Domain entity types such as `User`, `Organization`, or `Session` (those live beside Better Auth / `db` / API routers unless extracted intentionally).
- React components or hooks (belong in `packages/ui` or `apps/app`).
- Database schemas or migrations (belong in `db/`).
- API routers or services (belong in `apps/api`).
- Utilities that depend on environment variables or Node.js/Bun runtime APIs.

## Conventions

- Export everything from `packages/core/index.ts` for app-level imports.
- Use Zod for validators; export both the schema and the inferred TypeScript type.
- Keep the package dependency-free except for `zod` (already present).
- Do not add React, Node.js, or Bun-specific dependencies.

## Anti-patterns

- Claiming or adding User/Organization/Session exports unless they actually exist in the package.
- Adding React components or hooks to core.
- Adding database schemas or Drizzle tables to core.
- Importing environment variables or runtime-specific APIs.
- Creating circular dependencies between core and app workspaces.

## Review Priorities

- Verify that new exports are truly shared across multiple workspaces.
- Ensure no React, Node.js, or Bun dependencies are introduced.
- Check that validators export both the Zod schema and the inferred type.
- Confirm that the package remains dependency-free except for `zod`.

## Commands

See the [root README](../../README.md) for the canonical command reference.

From inside `packages/core/`:

```bash
bun typecheck            # Typecheck the package
```
