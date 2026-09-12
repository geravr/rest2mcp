# TanStack Queries (owned-key modules)

This folder holds TanStack Query modules for **non-tRPC** server state: Better Auth session and public-auth REST endpoints.

## Do not copy this pattern for tRPC

tRPC procedures in the SPA use `api.<procedure>.queryOptions()` / `mutationOptions()` from `@/lib/trpc`. Invalidate tRPC cache entries with `api.<procedure>.pathFilter()`. Handmade keys like `["user", "me"]` or `["admin", "users"]` must not be used alongside `trpcClient` for the same procedure — that breaks prefix matching against tRPC v11 query keys.

See `apps/app/AGENTS.md` (TanStack Query Conventions) for the full split.

## Current modules

### `session.ts`

Better Auth session (`sessionQueryKey`). Used for auth guards, sign-in/out, and `setQueryData` when profile fields change in the session cookie view.

### `public-auth.ts`

Public registration status and invite validation over REST (`public-auth` query keys). Used on login/signup before a session exists.

### `user.ts`

Thin wrapper around `api.user.me.queryOptions()` for profile/security settings. The query key and invalidation live on the tRPC proxy, not in this module.

## Owned-key module shape

Each owned-key module typically exports:

1. A stable query key constant (or small factory)
2. A `queryOptions` factory
3. Hooks (`useQuery` / `useSuspenseQuery`)
4. Optional prefetch / invalidation helpers that use the exported key

Example (session-style REST, not tRPC):

```typescript
export const sessionQueryKey = ["auth", "session"] as const;

export function sessionQueryOptions() {
  return queryOptions({
    queryKey: sessionQueryKey,
    queryFn: fetchSession,
  });
}

export function useSessionQuery() {
  return useQuery(sessionQueryOptions());
}
```
