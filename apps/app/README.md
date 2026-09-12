# React Application

Single-page application built with React 19, TanStack Router, TanStack Query, and shadcn/ui components from `@repo/ui`.

## Running

```bash
bun app:dev
```

See the [root README](../../README.md) for the full command reference.

## Notes

- The SPA builds to static assets with Vite.
- Product routes should be served with SPA fallback by your reverse proxy or static host.
- The route tree in `lib/routeTree.gen.ts` is generated.
