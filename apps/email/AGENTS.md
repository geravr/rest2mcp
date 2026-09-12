# AGENTS.md

Local guidance for the email templates workspace in `apps/email/`. Read [../../AGENTS.md](../../AGENTS.md) first for monorepo-wide rules.

## Scope

- Applies to React Email templates, components, rendering utilities, and locale catalogs under `apps/email/`.
- Source of truth is live code in `apps/email/`, especially [templates/](templates), [i18n/](i18n), [components/](components), and [utils/](utils).

## Template Conventions

- Templates live in `templates/` and are React components that render to HTML.
- Each template should be exported from `apps/email/index.ts`.
- Use `@react-email/components` for email-specific primitives (e.g., `Html`, `Body`, `Container`, `Section`, `Text`, `Button`).
- Templates must be responsive and render correctly in major email clients (Gmail, Outlook, Apple Mail).

## Rendering Contract

- Use `renderEmailToHtml()` from `utils/render.ts` to convert templates to HTML strings.
- The API workspace (`apps/api`) imports templates and calls `renderEmailToHtml()` before sending via Resend.
- Do not send raw React components; always render to HTML first.

## Language Policy

- User-facing email copy lives in `i18n/locales/{en,es}.ts` and is passed to templates as a `copy` prop.
- New strings must be added for every supported locale in the same change.
- Do not hardcode English or Spanish strings inside template components.
- API send sites resolve locale from the `saas-lang` cookie when available; default to `en`.

## Preview and Development

- Preview files live in `emails/` and are used by the React Email dev server.
- Run `bun email:dev` to start the preview server at `http://localhost:3001`.
- Provide preview files for both locales where practical (`*-es.tsx` suffix).
- Preview files are not exported or used in production.

## Anti-patterns

- Hardcoding user-specific data in templates; pass it as props instead.
- Hardcoding copy strings in templates instead of using `copy` props from `getEmailCopy()`.
- Using complex layouts that break in Outlook or Gmail.
- Sending raw React components without rendering to HTML.
- Adding business logic to templates; keep them presentational.
- Importing templates directly in the API; use the `@repo/email` package export.

## Review Priorities

- Verify that templates render correctly in the preview server for both locales.
- Ensure templates are responsive and work in major email clients.
- Check that user-specific data is passed as props, not hardcoded.
- Confirm that templates are exported from `apps/email/index.ts`.
- Validate that the rendering contract is followed (HTML output, not raw components).

## Commands

See the [root README](../../README.md) for the canonical command reference.

From inside `apps/email/`:

```bash
bun dev                  # Start email preview server
bun build                # Build email templates
bun export               # Export static email templates
bun typecheck            # Typecheck email code
```
