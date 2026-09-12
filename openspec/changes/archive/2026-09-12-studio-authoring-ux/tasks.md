# Tasks: studio-authoring-ux

## 1. Backend: lifecycle and support endpoints

- [x] 1.1 Add `deleteServer` to `mcp-studio-service.ts`: owner-scoped, single transaction removing that server's call logs, tools, variables, agent tokens, then the server
- [x] 1.2 Add `deleteTool` (owner-scoped, logs survive with null `toolId`) and enforce name uniqueness on `updateTool` rename
- [x] 1.3 Add `parseCurlPreview` (dry-run over `parseCurlCommand`, returns parsed shape + markable literal values, no writes)
- [x] 1.4 Add `testConnection` (GET to `baseUrl` through the SSRF guard and allowlist, renders default headers/query with secret variables, 5 s timeout, returns `{ ok, httpStatus, durationMs, appCode? }`, no call log)
- [x] 1.5 Enrich `attachTrafficLight` fan-out with enabled tool count and `lastCallAt`
- [x] 1.6 Extend `createToolFromCurl` with value markings (substitute occurrences, declare params, create/update variables) and report captures
- [x] 1.7 Wire tRPC procedures (`deleteServer`, `deleteTool`, `parseCurlPreview`, `testConnection`) and platform MCP `delete_server` / `delete_tool`
- [x] 1.8 Service and router tests for all of the above, including ownership negatives and the preview-writes-nothing contract

## 2. Shared UI primitives

- [x] 2.1 Key-value editor component for template maps (rows, add/remove, `{{}}` variable autocomplete) in `components/servers/`
- [x] 2.2 Params editor component: live `{{placeholder}}` detection across path/query/headers/body, per-param description/required/type, inline save warnings
- [x] 2.3 `ServerFavicon` component (domain favicon with initials-tile fallback) and CSP `img-src` allowance
- [x] 2.4 Replace native `<select>` elements in servers screens with the shared Select component

## 3. Server list and creation

- [x] 3.1 Rebuild `servers/index.tsx` as a paginated card grid: favicon, name, baseUrl, traffic light, status, tool count, last activity, quick actions (copy MCP URL, pause/resume)
- [x] 3.2 Extend the create dialog: description field, inline connectivity test with reachable/auth-failing/unreachable phrasing, post-create next step to add the first tool
- [x] 3.3 Card grid skeleton matching the loading decision tree; empty state unchanged in spirit (neutral, no fake data)

## 4. Server detail management

- [x] 4.1 Edit server dialog (name, description, baseUrl) from the detail header, with favicon
- [x] 4.2 Delete server with type-to-confirm dialog; navigates to the list on success
- [x] 4.3 Replace default headers/query JSON textareas in the connection tab with the key-value editor

## 5. Tool authoring

- [x] 5.1 Rebuild the create form: method select, path with placeholder chips, params editor, key-value editors for query/headers, body editor with `bodyType`, visible `allowMutation`/`enabled` toggles with explanation copy
- [x] 5.2 Add edit tool (same form, prefilled) and delete tool (confirm dialog) to the tools table; duplicate via prefilled create form
- [x] 5.3 Surface save-time warnings (placeholder without param, param without placeholder) inline

## 6. Interactive curl import

- [x] 6.1 Two-phase flow: paste → `parseCurlPreview` → rendered request preview with each literal value highlighted
- [x] 6.2 Marking UI per value: agent param / variable (with secret flag) / leave literal; auth value pre-marked as secret variable
- [x] 6.3 Confirm creates the tool with markings and shows the capture report (variables created, params declared)

## 7. Playground

- [x] 7.1 Replace the raw JSON textarea with per-param fields by type (string input, number input, boolean switch, json textarea with validation), required markers
- [x] 7.2 Result view links to the persisted call-log entry for the invoke

## 8. i18n and polish

- [x] 8.1 Add all new copy to en/es locale modules with parity (cards, dialogs, import flow, playground, warnings, confirmations)
- [x] 8.2 Map any new error paths through `resolveErrorMessage`

## 9. Verification

- [x] 9.1 Component tests for params editor, key-value editor, and curl marking flow; route-level tests for delete confirmations
- [x] 9.2 `bun typecheck`, `bun lint`, `bun test` green across api, app, core
- [x] 9.3 `bunx prettier --write .`
- [x] 9.4 `openspec validate studio-authoring-ux --strict`
