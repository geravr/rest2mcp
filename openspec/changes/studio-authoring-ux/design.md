# Design: studio-authoring-ux

## Context

`studio-template-engine` (archived) gave the studio its expressive core: server variables with secrecy, request templates, declared params, derived gateway input schemas, and curl capture. The GUI did not follow. Current state, verified in code:

- `tools-tab.tsx` is still the layer-1 form (name/method/path/description) plus a fire-and-forget curl textarea; no params UI, no edit, no delete. Mutating tools are still born disabled with no explanation.
- `playground-tab.tsx` asks for a raw JSON args blob.
- `servers/index.tsx` is a three-column table; the create dialog is name + baseUrl with no description, no connectivity check, no next step.
- `connection-tab.tsx` has the variables manager, but default headers/query are raw JSON textareas.
- Backend lacks `deleteServer`/`deleteTool`; call-log FKs already use `onDelete: set null`.

The user-facing bar for this change: authoring a tool must feel like marking up a request, not filling a schema. More capability must not mean more visible complexity — the form grows only where the request actually has parts.

## Goals / Non-Goals

**Goals:**

- The 30-second path: paste curl → see the parsed request → mark values as param/variable/literal → test → done.
- Full tool lifecycle in the GUI: create, edit, duplicate, delete, with params and templates visible and editable.
- Server lifecycle: create with guidance and optional connectivity test, edit, delete with explicit confirmation.
- Server list that reads as a portfolio of APIs (logo, health, size, activity), not a database grid.
- Playground driven by declared params.

**Non-Goals:**

- Template engine semantics, response projection, multipart/binary, OpenAPI import, recipes/marketplace, connector, icon upload, traffic-light derivation changes.

## Decisions

### 1. Curl import becomes two-phase: dry-run parse, then create with markings

New `parseCurlPreview` procedure: parses the curl and returns the would-be tool (method, path template, query/header/body templates, detected auth suggestion) **without writing**. The SPA renders the request with each literal value highlighted; the user marks values as agent param, variable (secret flag), or leaves them literal. Create then sends the template plus `markings`: `{ value, as: "param" | "variable", name, isSecret? }[]`. The service substitutes marked values with `{{name}}` placeholders, creates params/variables accordingly, and reports captures.

Rationale: one parse implementation (`mcp-curl.ts`) serves both phases; the preview is pure and testable; the user sees exactly what will be stored before anything persists. The alternative (create-then-edit) forces the user to hunt statics inside an edit form — the silent-replay problem again.

### 2. Params are edited where placeholders appear

The tool form detects `{{placeholders}}` live across path/query/headers/body and lists them as param rows (name fixed by placeholder; description, required, type editable). Server variables are offered as autocomplete in value fields and are excluded from the params list. Save surfaces the engine's warnings inline next to the offending field.

Rationale: the placeholder is the source of truth; the editor annotates it. This avoids the classic drift between a params table and a separate template field, and it keeps simple tools (no placeholders) at zero extra UI.

### 3. Delete semantics: explicit, cascading, confirmed

`deleteServer` runs in a transaction: delete that server's call logs, tools, variables, agent tokens, then the server. Call logs are per-server operational data; orphaning them (FK `set null`) would strand invisible rows. `deleteTool` removes the tool; its historical logs survive with `toolId` null. The SPA confirms server deletion by typing the server name; tool deletion uses a confirm dialog. Both are owner-scoped and return not-found for foreign ids.

### 4. Connectivity test renders defaults, writes nothing

`testConnection` issues a GET to `baseUrl` through the same SSRF guard and allowlist, with server default headers/query rendered (secret variables included), a 5 s timeout, and returns `{ ok, httpStatus, durationMs, appCode? }`. A 401 still proves reachability; the UI phrases it as "reachable — auth failing" versus "unreachable". It is not a tool call: no call-log row.

Rationale: creating a server blind was a layer-1 cliff; testing with the real defaults catches DNS, TLS, allowlist, and auth mistakes at creation time.

### 5. Server identity: favicon, not upload

Cards and the detail header show the base-URL domain favicon (Google `s2/favicons` client-side, `sz=128`) with a initials tile fallback when the fetch fails. No storage, no upload flow, works for any public API.

Rationale: upload-to-S3 is real machinery (multipart, ACL, resizing) for decoration; the domain already is the brand for APIs. Upload can come later with recipes if a public directory needs canonical logos.

### 6. List enrichment lives in `attachTrafficLight`'s fan-out

`listServers` already fans out per-server queries; add tool count and `lastCallAt` there (same Promise.all, no N+1 beyond the existing pattern). Cards stay paginated per the repo's list invariant.

### 7. Key-value editor replaces JSON textareas

One shared component edits `Record<string, string>` template maps (rows: key, value, remove; add row). Used for tool query/headers and server default headers/query. Values accept `{{}}` with variable autocomplete. This removes the JSON-textarea editing of defaults introduced as a stopgap.

### 8. Platform MCP parity for deletes

`delete_server` and `delete_tool` join the platform MCP, delegating to the same service functions, so agent-built servers have the same lifecycle. No other platform changes.

## Risks / Trade-offs

- [Two-phase import adds a parse endpoint that could drift from create] → both phases share `parseCurlCommand` and the same substitution code path; contract tests assert preview == create for the no-markings case.
- [Marking by value is ambiguous when the same literal appears twice] → markings substitute all occurrences of the exact value in that curl; the preview shows every occurrence highlighted so the choice is explicit.
- [Favicon hotlink depends on a third party] → failure degrades to an initials tile; no functional loss. CSP `img-src` must allow the favicon origin.
- [Delete cascade is irreversible] → type-to-confirm on servers, confirm dialog on tools, and the operation is owner-scoped with not-found semantics.
- [Connectivity test could be abused as an SSRF probe] → it goes through the identical allowlist + DNS guard as execution and renders only the owner's own server config.
- [Params editor could reintroduce form sprawl] → params section renders only when placeholders exist; a static request stays a three-field form.

## Migration Plan

No schema migrations. Call-log FK behavior already supports tool deletion (`set null`); server deletion removes its logs explicitly inside the transaction. Rollout is code-only; rollback is a revert.

## Open Questions

- None blocking. Icon upload and response projection remain candidates for later changes, deliberately excluded here.
