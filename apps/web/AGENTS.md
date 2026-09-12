# AGENTS.md

Local guidance for the Astro marketing site in `apps/web`. Read [../../AGENTS.md](../../AGENTS.md) first for monorepo-wide rules.

## Scope

- Applies to Astro pages, React islands, i18n translations, global styles, and static asset management under `apps/web`.
- Source of truth is live code in `apps/web`, especially [pages/](pages), [components/home/](components/home), [i18n/](i18n), [styles/](styles), and [astro.config.mjs](astro.config.mjs).

## Astro Conventions

- Prefer `.astro` for static page composition.
- Use React islands only when interactivity justifies them.
- Keep page files focused on composition; move reusable sections to `components/home/`.

## i18n Rules

- All user-visible copy lives in `i18n/locales/en.ts` and `i18n/locales/es.ts`.
- Section components receive translated labels via props.
- New strings must be added for every supported locale in the same change.

## Build Model

- `astro.config.mjs` builds static output into `dist/`. Deployment is handled by whatever web server or CDN serves the static files.

## Styling and Motion

- Use Tailwind CSS v4 plus the shared globals in `styles/`.
- Motion should support storytelling and product clarity, not decoration.
- Respect `prefers-reduced-motion`.

## Anti-patterns

- Adding dynamic data fetching to pages that should remain static.
- Duplicating translation strings across locales instead of updating all locale files together.
- Using inline styles instead of Tailwind utilities or the shared `styles/` globals.

## Review Priorities

- Verify i18n completeness: every new string appears in all supported locales.
- Ensure static output remains static (no accidental server-side rendering).
- Check that motion respects `prefers-reduced-motion` and does not degrade accessibility.

## Commands

See the [root README](../../README.md) for the canonical command reference.

From inside `apps/web`:

```bash
bun dev                  # Dev server
bun build                # Build static site
bun check                # Typecheck Astro code
```
