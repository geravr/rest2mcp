# Core Package

Shared type guards, application error codes, offset pagination types/schemas, and telemetry helpers used across the monorepo.

## What lives here

- **Type guards** — Pure runtime guards such as `isRecord` / `isStrictRecord`.
- **Application error codes** — Stable `APP_ERROR_CODES` / `AppErrorCode` catalog for API failures and client i18n mapping.
- **Pagination** — Offset pagination types, schemas, and defaults (`page`, `pageSize`, `{ items, page, pageSize, total }`).
- **Telemetry helpers** — Consent-aware PostHog capture utilities for the browser.
