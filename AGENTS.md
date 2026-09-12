# AGENTS.md

Guidance for AI coding agents working in the **Charro Stack** monorepo. This root file is the portable monorepo layer. Domain-specific rules can live in local `AGENTS.md` files under each workspace.

## Project Snapshot

- **Charro Stack** is Charro Digital's internal Bun-based monorepo template for building modern, type-safe SaaS applications.
- **Two-layer identity:** The **template layer** (LICENSE, maintainer README, studio authorship) stays fixed. The **demo product layer** (`APP_NAME`, manifests, i18n product name, email fallbacks) is renamable via `bun rename` when cloning for a new product.
- Workspaces:
  - [apps/api](apps/api) — Hono + tRPC backend, Better Auth, Drizzle, direct PostgreSQL access.
  - [apps/app](apps/app) — React 19 SPA built with Vite, TanStack Router, and TanStack Query.
  - [apps/web](apps/web) — Astro 5 marketing site built to static assets, with React 19 and Tailwind CSS v4.
  - [apps/email](apps/email) — React Email templates used by the API.
  - [db](db) — Database configuration, Drizzle schema, migrations, and seed scripts.
  - [packages/core](packages/core) — Type guards, `APP_ERROR_CODES`, offset pagination, and telemetry helpers.
  - [packages/ui](packages/ui) — Shared UI primitives and components (shadcn/ui + Radix UI + class-variance-authority + Tailwind CSS v4).
- Current stack: Bun runtime, Hono, tRPC v11, Better Auth (with Email OTP plugin), Drizzle ORM, PostgreSQL.
- Current frontend/marketing stack: React 19, Astro 5, Vite 7, TypeScript, Tailwind CSS v4, shadcn/ui (Radix UI + class-variance-authority), TanStack Router, TanStack Query, Zustand, React Hook Form, Zod.

## Documentation Contract

This repository maintains a clear separation between agent-facing contracts and human-facing onboarding:

- **`AGENTS.md`** files contain agent contracts: invariants, layering rules, anti-patterns, review priorities, security/tenant rules, and workflow guidance. These are portable across editors (Cursor, Copilot, Claude, Windsurf).
- **`README.md`** files contain human onboarding: what the workspace is, how to run it, and a short usage example.

**Content routing rule:** Place behavioral rules, invariants, and anti-patterns in `AGENTS.md`. Place setup steps, workspace descriptions, and usage examples in `README.md`. If you find agent contracts in a `README.md` or onboarding prose in an `AGENTS.md`, move the content to the file matching its audience.

## AGENTS.md Hierarchy

- **Root `AGENTS.md`** (this file): Monorepo-wide rules, cross-cutting invariants, and the documentation contract.
- **Local `AGENTS.md` files**: Each workspace declared in `package.json` `workspaces` must have a local `AGENTS.md` that links to this root file and adds workspace-specific rules. Each local file must be sufficient to work safely in that workspace when opened standalone.
- **Required coverage**: `apps/api`, `apps/app`, `apps/web`, `apps/email`, `db`, `packages/core`, `packages/ui`, `packages/typescript-config`, and `scripts` must each have a local `AGENTS.md` or a documented exemption in this root file.
- **New workspaces**: When adding a new workspace to `package.json` `workspaces`, create a local `AGENTS.md` for it as part of the same change, or record it as a documented exemption here.

## Command Reference

**Single source of truth:** `package.json` scripts are the authoritative source for runnable commands. The root `README.md` presents the canonical command reference. Sub-path documents link to it rather than duplicating full command lists to prevent drift.

**Rule:** When a workspace document needs to mention how to run tasks, it links to the canonical command reference instead of copying the full command list. Before documenting a command, verify it exists in `package.json` or the relevant workspace `package.json`.

## OpenSpec Spec-Driven Workflow

This repository uses the OpenSpec spec-driven workflow for non-trivial changes. Before implementing features, bug fixes, or refactors:

1. **Propose**: Use `/opsx:propose` to create a change proposal with design, specs, and tasks.
2. **Apply**: Use `/opsx:apply` to implement tasks from the change.
3. **Quality gate**: `/opsx:apply` invokes `/opsx:quality-gate` when tasks hit 0 or the user asks to close a slice. It can also be run directly.
4. **Archive**: Use `/opsx:archive` after the quality gate finishes or is skipped.

**When to use:** Any change that touches multiple files, introduces new capabilities, or modifies behavior should go through the spec-driven workflow. Small, isolated fixes (typos, config tweaks) can skip it.

**Artifacts live in:** `openspec/changes/<change-name>/` with `proposal.md`, `design.md`, `specs/`, and `tasks.md`. The `openspec/specs/` directory holds the main capability specs.

## Commands

Prefer Bun commands from the repo root because the workspace has `bun.lock` and root scripts delegate to workspaces. This is the common-dev subset. Workspace-specific and environment-specific scripts live in the [root README](README.md) command reference.

```bash
bun install              # Install dependencies
bun dev                  # Runs web (marketing), app (SPA), and api (Hono/tRPC) dev servers in parallel
bun build                # Builds all apps and packages
bun lint                 # Lints the entire codebase using ESLint
bun typecheck            # Typechecks the entire workspace (tsc --build)
bun test                 # Runs all workspace tests via Vitest
bun test:run             # Runs all workspace tests once
bun db:generate          # Generates database schema migrations (Drizzle)
bun db:migrate           # Runs database migrations (Drizzle)
bun db:seed              # Populates database with seed data
bun db:studio            # Launches Drizzle Studio
```

## Global Invariants

- **Single-User Accounts**: Product accounts are single-user. Do not reintroduce Better Auth organizations, product workspaces, `activeOrganizationId`, or org-scoped storage. Platform admin invites (`platform_invitation`) remain separate from product tenancy.
- **Language Policy**: Code identifiers, comments, and API/log error identifiers are strictly in English. User-visible SPA, marketing, and transactional email copy lives in supported locale modules (en/es) with parity required for new strings. API user-facing failures expose stable `appCode` values from `packages/core`; clients map codes to localized strings instead of showing raw English server messages.
- **tRPC Router Structure**: Router keys live under `apps/api/routers/` (such as `userRouter`, `adminRouter`). tRPC is the SPA JSON RPC; Hono owns Better Auth, pre-session, multipart, binary, and health. Do not add `hc` for new product JSON.
- **Authorization Procedures**: Use `publicProcedure`, `protectedProcedure`, and `superAdminProcedure` from [trpc.ts](apps/api/lib/trpc.ts) to guard routes.
- **Service errors**: Services throw `AppError` from [app-error.ts](apps/api/lib/app-error.ts). tRPC and Hono only translate at the edge.
- **Database Schema Integrity**: All changes to the database structure must be done through Drizzle ORM schemas in [db/schema/](db/schema/). Generate migrations with `bun db:generate` and apply with `bun db:migrate`. Do not make direct schema modifications manually or bypass migration tracking.
- **Storage/Upload Boundaries**: Keep upload and retrieval configurations clean and aligned with the S3 integration in [apps/api/lib/storage.ts](apps/api/lib/storage.ts) and the Hono routes mounted in [apps/api/lib/app.ts](apps/api/lib/app.ts). Object keys are user-prefix only (`users/{userId}/…`); deny `workspaces/`.
- **Default-paginate lists**: Collection endpoints and list screens paginate by default using the shared offset contract in `@repo/core` (`page`, `pageSize`, `{ items, page, pageSize, total }`). A lone `limit` without `page` / `pageSize` is not pagination. Allowed exceptions: singletons, aggregates, and explicitly tiny bounded lists.

## Source Of Truth

- Live code under `apps/api`, `apps/app`, `apps/web`, `db`, and packages beats any documentation when they conflict.
- The root `README.md` and inline JSDoc comments should be treated as high-priority references for layout and design patterns.

## Starter UI Philosophy

- The default SPA UI should be minimal, truthful, and free of fake metrics, fake activity, fake users, or aspirational marketing copy.
- Do not add buttons, links, or menu items unless the action is wired to implemented behavior.
- If a feature is not implemented, use a neutral empty state or omit the control entirely.
- Dashboard content, metrics, and workflows should be project-specific and backed by real data. The starter template provides a clean baseline, not demo theater.
- Prefer compact shadcn composition over decorative density. Remove filler copy instead of rewriting it.
- SPA loading feedback follows the decision tree in [apps/app/AGENTS.md](apps/app/AGENTS.md) (skeleton composites, control spinners, or the auth bootstrap screen). Do not invent overlays or text-only loading cards for known layouts.
- When in doubt, start sparse and extensible rather than populated and fake.
- The zinc UI is an anonymous scaffold, not product identity. Once a product exists, `/impeccable init` is the first identity step.

## New Code Direction

- Apply modern standards to new code, but do not refactor unrelated legacy code just to force a new pattern.
- When touching an existing area, prefer local modernization and cleanup even when it goes slightly beyond the minimum fix, as long as the refactor stays inside the touched slice and is validated.
- Prefer explicit, typed, reusable patterns over local ad hoc implementations.
- Prefer code that is self-explanatory through naming, structure, and small composable units rather than through comments.

## Review Priorities

- Reviews and self-reviews should prioritize behavior regressions and production bugs first.
- Security boundaries: authentication state, session validation, and data leaks.
- Validation correctness: use Zod schema validation for request payloads and service boundaries.
- Correctness, safety, clean architecture, clearer layering, and low duplication.
- Component reusability and visual consistency with packages/ui.

## Change Hygiene

- Do not edit generated or artifact folders such as `node_modules`, `dist`, `.astro`, `apps/app/dist`, `apps/web/.astro`, etc., unless explicitly directed.
- Keep changes scoped to the requested feature or fix.
- Do not add comments that simply narrate code or restate the obvious.
- If a comment is truly necessary to capture intent, invariants, business rules, external constraints, or non-obvious tradeoffs, keep it concise and write it strictly in English.
- Any change that modifies behavior should create or update tests at the appropriate level.
- Before closing any implementation task, run the verification commands: `bun typecheck`, `bun lint`, and tests for every touched area (`bun test`).
- Do not silence TypeScript or ESLint errors with `any`, unsafe casts, `@ts-ignore`, blanket non-null assertions, or rule disables unless there is a narrow, documented technical reason.
- Formatting is the last step. Apply formatting using `bunx prettier --write .` (or through editor integration).
- Prefer this verification sequence from the repo root: `bun typecheck`, `bun lint`, focused tests (e.g. `bun test`), and then `bunx prettier --write .`.

## MCP Tools

- **`context7`**: use it for any external library, framework, SDK, API, or CLI question, consult recent MCP Context7 documentation before implementation. Treat prior knowledge as potentially stale until checked.
- **`shadcn`**: use it when adding, discovering, or composing shadcn/ui components in `packages/ui`. Search registries, inspect item sources, fetch usage examples, and get the correct `bun ui:add` command before installing. Prefer existing `@repo/ui` exports over duplicating primitives; run `get_audit_checklist` after adding new UI.
