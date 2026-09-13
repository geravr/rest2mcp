## 1. Database

- [x] 1.1 Add nullable `iconImage` text column to `db/schema/mcp-server.ts`
- [x] 1.2 Run `bun db:generate` and apply migration with `bun db:migrate`

## 2. API

- [x] 2.1 Extend `updateServer` input with `iconImage: z.url().nullable().optional()` in `apps/api/routers/mcp.ts`
- [x] 2.2 Persist `iconImage` in `updateServer` service; validate URL is under `users/{userId}/` storage prefix
- [x] 2.3 Include `iconImage` in `listServers`, `getServer`, and `createServer` return shapes
- [x] 2.4 Add service/router tests for set, clear, and reject foreign storage URL

## 3. SPA icon resolver

- [x] 3.1 Add `getServerIconSrc()` in `apps/app/lib/server-icon.ts` using DiceBear rings (seed = server id) with data URI cache
- [x] 3.2 Add `server-icon.test.ts` covering custom image, rings fallback, and determinism
- [x] 3.3 Replace `ServerFavicon` with `ServerIcon` component; pass `serverId` and `iconImage`; remove Google s2 and initials fallback
- [x] 3.4 Update server list, detail header, and edit dialog to pass new props

## 4. Settings upload UX

- [x] 4.1 Add icon preview, upload, and remove controls to `ServerSettingsTab` (mirror profile avatar limits)
- [x] 4.2 Wire upload via `uploadFileToStorage({ directory: "server-icons" })` then `updateServer`
- [x] 4.3 Add en/es strings under `i18n/locales/*/servers.ts` (or settings subsection)

## 5. Verification

- [x] 5.1 Run `bun typecheck`, `bun lint`, and focused tests for touched workspaces
- [x] 5.2 Manually verify GHL Charro server shows rings fallback instead of Google globe
