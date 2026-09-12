# Marketing Site

Astro marketing site that builds to static files.

## Commands

```bash
bun web:dev
bun web:build
```

See the [root README](../../README.md) for the full command reference.

## Project Structure

- `pages/` — Astro file-based routes.
- `pages/es/` — Spanish locale routes.
- `Layout.astro` — shared page shell.
- `components/home/` — landing page sections and home-specific content.
- `i18n/` — translation catalogs and helper types.
- `styles/` — global CSS for the marketing site.
- `public/` — static assets.

## Notes

- Output is static and can be served by any web server or CDN.
- Localization is implemented with Astro routes under `/` and `/es/`.
