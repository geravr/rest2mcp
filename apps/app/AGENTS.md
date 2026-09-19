# AGENTS.md

Local guidance for frontend work in `apps/app`. Read [../../AGENTS.md](../../AGENTS.md) first for monorepo-wide rules.

## Scope

- Applies to React 19 pages/routes, feature components, shared UI primitives, hooks, tRPC client usage, and Vite/Vitest setup under `apps/app`.
- Source of truth is live code in `apps/app`, especially [index.tsx](index.tsx), [lib/trpc.ts](lib/trpc.ts), [routes/](routes), [components/](components), [packages/ui/](../../packages/ui), and [vite.config.ts](vite.config.ts).

## Visual Direction and Aesthetics

- **Minimal & Truthful UI**: The starter template should be sparse and extensible, not populated with fake data. Do not add buttons, metrics, activity feeds, or marketing copy unless backed by real behavior.
- **Real-World States**: Design interfaces to account for loading (see Async Loading Feedback), empty states, error boundaries, disabled inputs, and success messaging. Do not rely on static mockups.
- **Iconography**: Use Lucide React for consistent iconography. Avoid using emojis as UI icons.

## Current Rules

- **Language Policy**: Code identifiers, comments, and API/log error identifiers stay in English. User-visible SPA copy lives in `i18n` locale modules (`en` and `es`); new strings must be added for every supported locale in the same change. Map API `appCode` values to localized strings via `resolveErrorMessage()`; do not show raw English server messages in toasts or error boundaries.
- **Layering**: Follow **Route → Component → Hook**:
  1. **`routes/`**: URL parameters, route guards, layouts, and page routing.
  2. **`components/`**: Presentation-focused, reusable UI.
  3. **`hooks/`**: Data queries, mutations, cache invalidations, and state hooks.
- **State Management**: Server state belongs in tRPC and TanStack Query. Client UI state (e.g. locale) uses Zustand from live modules such as `i18n/use-translations.ts` — do not invent a `stores/` folder unless one exists.
- **tRPC Type Safety**: Leverage inferred router types from the tRPC client using helper types (e.g. `RouterOutputs`). Avoid duplicate hand-written payload/response declarations.
- **UI Component Reuse**: Rely on the shared workspace library `@repo/ui` (`packages/ui/components`) for basic UI primitives (e.g. `button`, `input`, `dialog`, `badge`, `tabs`). Only introduce local app-specific layout wrappers or complex feature composites under `apps/app/components`.
- **shadcn/ui Token Usage**: Favor semantic theme tokens (`bg-background`, `text-foreground`, `border-border`, etc.) and `@repo/ui` components for standard layouts. Keep raw custom Tailwind utility styles to a minimum.
- **Form Patterns**: Form flows should utilize `react-hook-form` coupled with Zod resolvers. Always provide explicit `defaultValues` inside `useForm`.
- **Lucide Icons**: Use `lucide-react` for icons.
- **List screens**: Collection pages paginate with the `@repo/core` contract. Persist `page`, `pageSize`, `q`, and filters in TanStack Router `validateSearch`; omit defaults (`page=1`, `pageSize=10`, empty `q`, unset “all” filters). Do not filter the current page’s `items` in the client to produce the visible set. Use `@repo/ui` `Pagination` and `Select` for page navigation and page size. Exceptions: singletons, aggregates, and explicitly tiny bounded lists. A lone `limit` is not pagination.

## Server Draft vs Published State

- The server detail view must distinguish draft, unpublished-changes, published-revision, paused, and publication-blocked states. Server edits save to the draft; mutation feedback must say the change was saved to the draft, never that it is already live.
- Publishing is an explicit review flow that presents readiness, agent-contract changes, destructive warnings, redacted configuration changes, and the candidate fingerprint. Restoring a historical revision writes a new draft; it never moves the live pointer directly.
- The playground mode is explicit (`published` or `draft`) and shown prominently. Published mode matches the active gateway revision and feeds production health; draft mode is owner-only testing and marks its results as draft.

## Existing Patterns Worth Preserving

- **File-Based Routing**: Routing is handled by TanStack Router. Physical files inside `apps/app/routes/` automatically define the route structure.
  - Main route files: `routes/__root.tsx`, `routes/(app)`, `routes/(admin)`, `routes/(auth)`.
  - The route tree is compiled into `apps/app/lib/routeTree.gen.ts`.
- **Toast Notifications**: Use `sonner` (`Toaster` config in `index.tsx`) for global toast notifications. Invalidate query caches on mutation success to refresh the UI automatically.
- **UI Library Modification**: If a shadcn/ui component is missing from available options, add it following the existing patterns in `packages/ui/`.
  - Do not overwrite custom tweaks in `packages/ui/components` without verifying the diff first.

## For New Frontend Code

- Prefer robust, type-safe layouts over ad-hoc styling hacks.
- Promote recurring visual or layout patterns into either `apps/app/components` or `packages/ui` rather than duplicating CSS/Tailwind classes.
- Ensure that mutations offer responsive UI feedback (e.g. optimistic updates, pending button states, toasts).
- Any behavioral change, form validation, route guard, or custom hook should ideally include or update corresponding unit/integration tests (`*.test.tsx`) using Vitest.

## TanStack Query Conventions

- TanStack Query owns server state. Component state should only hold UI concerns (dialog visibility, selected IDs, inline feedback, temporary drafts).
- Prefer deriving selected records from cached query data instead of copying entire server objects into local state.
- **tRPC procedures** use the `@trpc/tanstack-react-query` options proxy (`api.<procedure>.queryOptions()` / `mutationOptions()`). After a successful tRPC mutation, invalidate affected data with `queryClient.invalidateQueries(api.<procedure>.pathFilter())`. Do not invent parallel TanStack keys such as `["admin", "users"]` for tRPC procedures.
- When spreading `mutationOptions()`, compose `onSuccess` / `onError`: call any existing tRPC callback first, then invalidate or update cache. Optional `setQueryData` for tRPC MUST use `api.<procedure>.queryKey()`, never a handmade tuple.
- **Owned-key modules** in `lib/queries/` (Better Auth session, public-auth REST) keep module-owned query keys and helpers for prefetch/invalidation. Do not move those onto `api.*.pathFilter()`.
- Use `sonner` toasts for mutation feedback. Disable the initiating action while pending. Close dialogs only after success. Invalidate only affected query keys.
- Use optimistic updates only when the rollback path is straightforward. If rollback is ambiguous, prefer pending state plus targeted invalidation.

## Async Loading Feedback

Choose feedback by the kind of wait, not merely because a request is in flight:

1. **Unknown destination / auth gate** → `SessionLoadingScreen` or the route `pendingComponent`.
2. **User-initiated mutation** → spinner + disable on the initiating control; keep surrounding content visible.
3. **First load of a known-layout region** → a shared skeleton composite inside that region; keep page chrome (titles, tabs, filters) visible.
4. **Background refetch with cached data** → keep showing data (`isLoading && !data` or equivalent). Do not flash a skeleton or overlay over already-rendered content.

Shared composites live in `components/loading/`:

- `TableRowsSkeleton` — admin lists and nested session rows (`rows` defaults to 5).
- `StatValueSkeleton` — admin dashboard stat value slots.
- `SettingsFormSkeleton` — Settings tabs and `/admin/settings` (`cards`, `fields`).

Build them on `@repo/ui` `Skeleton`. Do not invent per-screen `Array.from` bar lists or empty loading-copy cards when a composite exists.

**Anti-patterns:**

- Do not use a full-region overlay with a centered spinner as the default query or mutation treatment.
- Do not use a page-level spinner for a known-layout first load.
- Do not replace already-rendered content with a skeleton on refetch.
- Do not skeletonize an in-progress mutation; pending stays on the control.

## Review Priorities

- Check data fetch/mutation cycles (query invalidations, optimistic states, error/loading fallbacks).
- Ensure TanStack Router routing guards and roles (`super_admin`) are properly checked.
- Validate that layouts look visually polished, responsive, and follow the design-system boundaries.

## Commands

See the [root README](../../README.md) for the canonical command reference.

From inside `apps/app`:

```bash
bun dev                  # Dev server
bun build                # Build production assets
bun test                 # Run Vitest tests
```
