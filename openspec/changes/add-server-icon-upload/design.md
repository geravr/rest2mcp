# Design: add-server-icon-upload

## Context

`ServerFavicon` today loads `https://www.google.com/s2/favicons?domain=…&sz=128`. When a domain has no real favicon, Google returns a generic 16×16 globe that loads successfully, so `onError` never runs and the text-initials fallback is invisible in practice (confirmed on `services.leadconnectorhq.com`).

Profile avatars already solve upload + fallback: S3 via `/api/storage/upload`, persisted URL on the user row, DiceBear `lorelei-neutral` generated client-side in `getAvatarSrc()`.

This change applies the same storage pattern to MCP servers and replaces automatic favicon lookup with DiceBear **rings** seeded by `server.id`.

## Goals / Non-Goals

**Goals:**

- Optional per-server `iconImage` stored on `mcp_server`.
- Settings-tab upload/remove UX mirroring profile avatar constraints (JPG/PNG/WebP, 5 MB client-side).
- Consistent icon rendering on server list, detail header, and edit dialog.
- Deterministic rings fallback without third-party favicon services.

**Non-Goals:**

- Icon upload during server creation wizard.
- Server-side favicon fetching or SSRF probes for `/favicon.ico`.
- Detecting Google's generic globe heuristically.
- Public icon URLs without session (keep storage ACL as-is).
- Platform MCP tool changes.

## Decisions

### 1. Data model: nullable `iconImage` text column

Add `iconImage` to `mcp_server`, same semantics as `user.image` (storage `accessUrl` or null).

**Alternatives considered:** separate `iconKey` only — rejected because the app already stores full access URLs for avatars and tRPC validates with `z.url()`.

### 2. Icon resolution chain (SPA only)

```
iconImage set? → show uploaded image
else           → DiceBear rings data URI (seed = server.id)
```

Remove Google s2 and text-initials fallback entirely for v1.

**Alternatives considered:**

- Keep Google s2 before rings — rejected because generic globe breaks UX and triggered this change.
- Seed rings by hostname — rejected because icon should stay stable when `baseUrl` changes.

### 3. Upload flow reuses existing storage endpoint

Upload with `directory: "server-icons"`, then `updateServer({ iconImage: accessUrl })`. No new Hono routes.

Validate on update that the URL belongs to the caller's storage scope (prefix `users/{userId}/`), matching profile patterns.

### 4. UI placement: Settings tab only

Icon management lives in `ServerSettingsTab` with preview, upload, and remove actions. List/detail/edit consume the shared `ServerIcon` component.

**Alternatives considered:** edit dialog upload — deferred to avoid duplicated controls.

### 5. Helper module: `getServerIconSrc()` in `apps/app/lib/`

Mirror `avatar.ts`: import `@dicebear/styles/rings.json`, cache data URIs by server id, export pure function for tests.

Rename `ServerFavicon` → `ServerIcon` (or keep filename and change behavior — prefer rename for clarity).

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Domains with real favicons no longer show automatically | Acceptable trade-off for v1; owners can upload or we can add opt-in domain favicon later |
| S3 not configured blocks upload | Show localized error; rings fallback still works |
| Orphaned S3 objects after icon replace | Same as avatars today; no GC in scope |
| `iconImage` URL validation gaps | Reject URLs outside caller's `users/{id}/` prefix on update |

## Migration Plan

1. Add Drizzle column + `bun db:generate` / `bun db:migrate`.
2. Deploy API + SPA together (new field nullable; old clients ignore it).
3. Rollback: column can remain unused; revert SPA to prior component if needed.

## Open Questions

- None blocking v1. Future: optional "use domain favicon" toggle if owners want automatic branding back without uploads.
