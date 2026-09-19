# AGENTS.md

Local guidance for backend work in `apps/api`. Read [../../AGENTS.md](../../AGENTS.md) first for monorepo-wide rules.

## Scope

- Applies to Hono app setup, tRPC routers, Better Auth configuration, database queries (Drizzle), backend tests (Vitest), and upload/storage logic under `apps/api`.
- Source of truth is live code in `apps/api`, especially [index.ts](index.ts), [dev.ts](dev.ts), [serve.ts](serve.ts), [lib/app.ts](lib/app.ts), [lib/trpc.ts](lib/trpc.ts), [lib/context.ts](lib/context.ts), [lib/auth.ts](lib/auth.ts), [routers/](routers), and [services/](services).

## Architecture & Layering

Follows **Router/Handler → Service → Database/Infrastructure**:

1. **`routers/`**: Request validation, auth checks, tRPC procedures, and mapping HTTP requests to services.
2. **`services/`**: Business logic, orchestration, database writes, and third-party integrations.
3. **`lib/`**: Infrastructure setup (PostHog, Better Auth, Drizzle instance).

## Runtime and Entrypoints

- `dev.ts` — Starts Hono and tRPC server locally for development using Bun.
- `serve.ts` — Production entrypoint for VPS or Docker deployments.
- Always use the Bun runtime path and environment. No Redis, BullMQ queues, or WebSockets are utilized in this configuration.

## Database & Drizzle

- Drizzle clients are initialized in [lib/db.ts](lib/db.ts) using `postgres` and a direct connection pool.
- Both `db` and `dbDirect` are request-scoped handles in `dev.ts` and `serve.ts`. Currently, `dbDirect` is an alias pointing to the same database connection pool.
- Database schemas reside in the `@repo/db` workspace package under `db/schema/`.
- All database migrations are generated and applied via the Drizzle kit CLI from the root workspace:
  - `bun db:generate` to generate Drizzle migrations.
  - `bun db:migrate` to apply migrations.
- **Migration Hygiene**:
  - Never hand-write SQL migration files or manually patch a generated migration.
  - One in-progress feature should have at most one uncommitted migration. If schemas change again during development, delete the uncommitted migration and regenerate a single replacement.
  - Never rewrite a migration that has already been pushed or shared.
  - `db:push` is only for disposable local iteration and must never replace the migration workflow.

## Observability & Telemetry

- Server-side PostHog integration is centralized in [lib/posthog.ts](lib/posthog.ts) (`captureServerException`, etc.).
- Telemetry events must never include raw personal keys, token values, or customer secrets.

## tRPC and Hono Boundary

- **tRPC** (`/api/trpc/*`) is the authenticated JSON RPC for the SPA. Keep the tRPC adapter error protocol: do not put Hono auth middleware in front of `/api/trpc/*`.
- **Hono** owns Better Auth (`/api/auth/*`), pre-session public-auth wrappers, multipart upload, binary object download, and health. First-party Hono JSON errors use `{ code, message }` from `appJsonError`.
- Pre-session OTP wrappers stay on Hono; new product JSON stays on thin tRPC routers.
- Do not add Hono RPC / `hc` for new product JSON. New product mutations and queries go on tRPC routers.

## tRPC and Hono Routers

- [lib/app.ts](lib/app.ts) composes the Hono app, mounts `/api/trpc/*`, `/api/auth/*` handlers, and mounts custom endpoints like `/api/storage/upload` and `/api/storage/object`.
- **Thin Routers**: Routers and Hono endpoints must remain thin. Their job is request validation (Zod input schemas), authentication/authorization guards, and delegating actual business logic execution to the service layer.
- Hono handlers should follow the flow: validate input, delegate logic, send response.

## Service Layer Conventions

- Business logic, Drizzle queries, transactional blocks, and external integrations (e.g. Resend for emails in [lib/email.ts](lib/email.ts), AWS S3 for storage in [lib/storage.ts](lib/storage.ts)) must live in services under `services/` (such as `admin-service.ts`).
- Services, `lib/storage.ts`, and first-party Hono handlers throw `AppError` for request-facing failures. They must not throw `TRPCError` or import `@trpc/server`. tRPC procedure middleware and the Hono `errorHandler` translate `AppError` at the transport edge.

## MCP Server Write Aggregate

- Every mutation of an existing MCP server runs through `withOwnedServerWrite` in [services/mcp-server-command.ts](services/mcp-server-command.ts). It owns the transaction, locks the owned server row with `SELECT ... FOR UPDATE`, compares `expectedRevision`, and increments `configRevision` exactly once per committed command.
- Command callbacks receive only the transaction handle (`tx`). They must never fall back to the global database client.
- Lock order is `user/account -> server -> child rows`; never acquire these in reverse. Platform PAT writes lock the user row first.
- Stale revisions surface as `MCP_WRITE_CONFLICT` with the current revision and no writes. Known fully-rolled-back transient database failures are retried with a bounded budget and, when exhausted, surface as retryable `MCP_TRANSIENT_WRITE_FAILURE`.
- No external I/O (network calls, telemetry export, object deletion) may run while the server lock is held. Buffer it through `ctx.onCommit`, which runs only after commit and never fails the command.
- Custom mutating SQL tables bypassed by direct `db.update(mcpServer)` writes are forbidden; add a command instead.

## MCP Runtime Snapshots

- Gateway tool listing and invocation preparation read from one immutable `loadExecutionSnapshot` (`REPEATABLE READ`, read-only) in [services/mcp-executor-service.ts](services/mcp-executor-service.ts). A runtime request must never combine server, plans, auth, or values from different committed revisions.
- The snapshot transaction ends before any upstream HTTP begins. `executeMappedTool` accepts a preloaded snapshot for this reason; do not re-open database reads inside the request path.
- Object storage is a non-transactional boundary: uploads stage an `mcp_storage_asset` as `staging`, then `ready`, and the server attach command claims it in the same commit as `configRevision`. Replaced/abandoned assets become `delete_pending` and are cleaned by the bounded reconciler.
- Run `bun mcp:reconcile-assets --dry-run` to inspect pending cleanup; `bun mcp:reconcile-assets` performs it. Failed deletions stay pending and are safe to retry.

- **Single-User Accounts**: Product accounts are single-user. Do not register the Better Auth `organization` plugin, mount an `organization` tRPC router, or reintroduce org tables / `activeOrganizationId`.
- Platform invitations (`platform_invitation`) and super-admin flows remain. Do not conflate them with product workspaces.
- Multi-write business operations must use transactions (`ctx.db.transaction`) to preserve atomic flows.
- **Language Policy**: Code identifiers, comments, and logs stay in English. User-facing failures expose stable `appCode` values from `@repo/core`; clients map codes to localized copy. English `message` fields remain for logs only.
- **Storage**: Object keys are always under `users/{userId}/…`. `canAccessStorageObject` must deny `workspaces/` keys.
- **List pagination**: Collection procedures return the `@repo/core` envelope (`items`, `page`, `pageSize`, `total`) via `paginate()` in [lib/paginate.ts](lib/paginate.ts). Each service owns `where` / `orderBy` and applies the same predicate to list and `COUNT`. Escape LIKE metacharacters in `q`. Do not return a bare array. A lone `limit` is not pagination. Exceptions: singletons, aggregates, and explicitly tiny bounded lists.

## Environment

- Environment variables are validated on startup using Zod in [lib/env.ts](lib/env.ts).
- Schema fields: `ENVIRONMENT`, `APP_NAME`, `APP_ORIGIN`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `RESEND_EMAIL_FROM`. Optional: PostHog (`POSTHOG_*`), S3 (`STORAGE_S3_*`), `SUPER_ADMIN_EMAIL`. `API_ORIGIN` is consumed by the SPA proxy / marketing templates, not by [lib/env.ts](lib/env.ts).
- Non-Zod process env used by this package: `PORT` (listen), `AUTO_MIGRATE` (Docker entrypoint only).
- Shared template: root [`.env.example`](../../.env.example). Do not treat removed ghost keys as required config.

## Anti-patterns

- Embedding complex business logic or multi-step database orchestration directly inside routers or Hono handlers.
- Throwing a raw `Error` or `TRPCError` instead of `AppError` for request-facing failures.
- Leaking database details or raw SQL errors to the API clients.
- Telemetry captures containing raw prompts, credentials, or personal keys.
- Bypassing type safety (avoid `any`, `@ts-ignore`, etc.) unless there is a documented technical reason.
- Reintroducing Better Auth organizations, product workspaces, or org-scoped storage prefixes.

## Review Priorities

- Catch authorization guard bypasses and data mutations without session validation.
- Catch missing transactional boundaries on multi-write services.
- Ensure proper error-handling (`AppError` + catalog `appCode`) and input schema validation (Zod).
- Confirm storage object reads stay ACL-checked and deny `workspaces/` keys.

## Commands

See the [root README](../../README.md) for the canonical command reference.

From inside `apps/api`:

```bash
bun dev                  # Dev server
bun build                # Build API
bun test                 # Run Vitest tests
bun typecheck            # Typecheck API code
```
