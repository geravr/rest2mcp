# Charro Stack

**Charro Stack** is Charro Digital's internal Bun-based monorepo template for building modern, type-safe SaaS applications. Clone it, run `bun rename` to set your product name, and replace the demo surfaces with your own product.

Maintained by [Charro Digital](https://charrodigital.com). Questions: [hola@charrodigital.com](mailto:hola@charrodigital.com).

> Historically derived from open-source starter work; heavily rewritten for Charro Digital's stack.

> **Development status: pre-production.** Internal contracts and disposable development data may change without backward compatibility until the repository owner explicitly declares production status. The authoritative lifecycle policy is in [AGENTS.md](AGENTS.md#product-lifecycle-status).

## Workspaces

- **`apps/api`** — Hono + tRPC backend, Better Auth, Drizzle, direct PostgreSQL access.
- **`apps/app`** — React 19 SPA built with Vite, TanStack Router, and TanStack Query.
- **`apps/web`** — Astro marketing site that builds to static assets.
- **`apps/email`** — React Email templates used by the API.
- **`db`** — Drizzle schema, migrations, and seed scripts.
- **`packages/core`** — Type guards, `APP_ERROR_CODES`, offset pagination, and telemetry helpers.
- **`packages/ui`** — Shared UI primitives (shadcn/ui + Radix UI + class-variance-authority + Tailwind CSS v4).

## Tech Stack

- **Runtime:** Bun >= `1.3.14`, TypeScript, ESM.
- **Frontend:** React 19, TanStack Router, TanStack Query, React Hook Form, Zustand, Tailwind CSS v4, shadcn/ui (Radix UI + class-variance-authority).
- **Backend:** Hono, tRPC 11, Better Auth.
- **Database:** PostgreSQL via Drizzle ORM.
- **Storage:** S3-compatible object storage.
- **Observability:** PostHog with consent-aware browser/server capture.
- **Email:** React Email templates with Resend integration.

## Commands

All commands can be run from the root of the repository:

```bash
# Installation
bun install

# Development
bun dev               # Runs web, app, and api in parallel

# Build & Verification
bun build             # Builds all apps and packages
bun lint              # Lints the entire codebase
bun typecheck         # Checks TypeScript compiler types
bun test              # Runs all tests via Vitest
bun test:run          # Runs all tests once via Vitest

# Database Tasks
bun db:generate       # Generates database schema migrations
bun db:migrate        # Runs database migrations
bun db:seed           # Populates the database with initial seed data
bun db:studio         # Launches Drizzle Studio

# Operations
bun mcp:reconcile-assets           # Deletes replaced/abandoned MCP icon assets
bun mcp:reconcile-assets --dry-run # Reports pending cleanup without deleting
```

## Local Development

### 1. Requirements

Ensure you have [Bun](https://bun.sh/) and Docker installed.

### 2. Environment Setup

Copy the example environment variables file at the root:

```bash
cp .env.example .env
```

Provide the necessary credentials (e.g. database host, auth secrets, Resend, optional PostHog/S3). Put personal overrides in `.env.local` (git-ignored); it overrides `.env`.

Do not reintroduce keys that were removed from `.env.example` (for example OpenAI, Google Analytics, GCP project, provider webhooks, or storage signed-URL TTL). Those are not live product configuration. Marketing `PUBLIC_APP_ORIGIN` / `PUBLIC_SPA_ORIGIN` also live in the root example (Astro loads them from the repo root).

### 3. Start PostgreSQL

Run the local PostgreSQL database using the included Docker Compose file:

```bash
docker compose up -d
```

_Note: The local PostgreSQL database host port is mapped to `5452` to prevent conflicts with other local Postgres instances._

### 4. Run Migrations & Seed

Run Drizzle migrations and seed the initial database tables:

```bash
bun db:migrate
bun db:seed
```

If your local database already applied an older migration chain (before the single-user baseline), drop the Postgres volume/database first, then migrate again. There is no in-place upgrade path for that history.

### 5. Launch the Apps

Start the development server for all workspaces:

```bash
bun dev
```

Default local URLs:

- **Marketing Site:** `http://localhost:4321`
- **React App SPA:** `http://localhost:5173`
- **Hono API Server:** `http://localhost:3456`

## Architecture & Layering

Agent contracts for backend and frontend layering live in workspace `AGENTS.md` files:

- Backend (`Router → Service → lib`): [apps/api/AGENTS.md](apps/api/AGENTS.md)
- Frontend (`Route → Component → Hook`): [apps/app/AGENTS.md](apps/app/AGENTS.md)
- Monorepo-wide invariants: [AGENTS.md](AGENTS.md)
