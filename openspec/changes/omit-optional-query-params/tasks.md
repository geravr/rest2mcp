## 1. Error details

- [ ] 1.1 Add optional `details` on `AppError` / `appError` and forward it through tRPC `errorFormatter` as `data.details`
- [ ] 1.2 Throw `MCP_TEMPLATE_UNRESOLVED` with `details.placeholder` set to the missing name
- [ ] 1.3 Tests: formatter exposes `placeholder`; unresolved error includes the name

## 2. Query-map omission

- [ ] 2.1 Add a query-map renderer that omits a key when the value is exactly `{{name}}`, `name` is a `required: false` param, and neither args nor variables provide it
- [ ] 2.2 Wire it into `buildRequest` for the merged server default query + tool query; leave path, headers, and body on strict `renderTemplate`
- [ ] 2.3 Template/unit tests: omit optional `phone`/`limit`; keep variable-backed `region`; fail required `email`; fail prefixed `id:{{id}}`; fail optional path `{{contactId}}`

## 3. Executor coverage

- [ ] 3.1 Executor test matching GHL lookup: only `email` arg, optional `phone`/`limit`/`nextcursor` omitted, `locationId` and `Authorization` still rendered, fetch called
- [ ] 3.2 Executor test: missing required query param still `MCP_TEMPLATE_UNRESOLVED` with no fetch

## 4. SPA error copy

- [ ] 4.1 Interpolate `{name}` from `data.details.placeholder` in `resolveErrorMessage` for `MCP_TEMPLATE_UNRESOLVED`
- [ ] 4.2 en/es catalog strings include `{name}`; tests cover Spanish and English interpolation

## 5. Verification

- [ ] 5.1 `bun typecheck`, `bun lint`, focused api + app tests, then `bunx prettier --write .`
- [ ] 5.2 `openspec validate omit-optional-query-params --strict`
