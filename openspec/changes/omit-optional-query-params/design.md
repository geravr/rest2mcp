## Context

Request templates interpolate `{{placeholder}}` from args, then server variables. Any miss throws `MCP_TEMPLATE_UNRESOLVED` before fetch. That is correct for path segments and credentials. It is wrong for optional REST query keys: a GHL-style lookup stores `email`, `phone`, `limit`, and `nextCursor` as Agent params with `required: false`, the playground (and agents) omit empty args, and the first missing key (`limit`) aborts the call. Auth and `location_id` already resolve. The stored tool `get_contacts_lookup` on GHL Charro is the reproducing case.

`buildRequest` merges `server.defaultQuery` with `tool.requestTemplate.query` and renders every value through `renderTemplate(..., "query", scope)`. Tool `params[].required` is unused at execution.

## Goals / Non-Goals

**Goals:**

- Omit a query key when its value is exactly `{{name}}`, `name` is a declared param with `required: false`, and neither an arg nor a variable provides it.
- Keep fail-closed everywhere else (path, headers, body, prefixed values, required params, unknown names).
- Name the placeholder in user-facing `MCP_TEMPLATE_UNRESOLVED` copy (en/es).
- Same behavior for playground, gateway, and platform MCP via `executeMappedTool`.

**Non-Goals:**

- Omitting header or body fields.
- Mustache sections or conditional path segments.
- Changing curl-import marking defaults or authoring warnings.
- Empty-string args (they still render as empty query values).
- `testConnection` (no tool params; defaults stay strict).

## Decisions

### 1. Omit at query-map render, not inside `resolvePlaceholder`

Add a query-map helper (used by `buildRequest`) that, for each merged query entry:

1. If the value matches `^\{\{([A-Za-z][A-Za-z0-9_]*)\}\}$`, look up that name.
2. If args have a non-null value, or a server variable exists, render as today.
3. Else if `tool.params` has that name with `required === false`, skip the key.
4. Else throw `MCP_TEMPLATE_UNRESOLVED` as today.

`renderTemplate` stays strict. Path, headers, and body keep calling it.

**Alternatives considered:** sentinel from `resolvePlaceholder` — leaks query policy into every context. Catch-and-omit in `buildRequest` — hides which failures are omittable. Client-side omission only — agents would still fail.

### 2. Eligibility is param metadata, not “any missing query placeholder”

Unknown `{{foo}}` in query still fails. A required param still fails. A variable-backed default (`locationId={{location_id}}`) still fails if the variable is gone. Optional is an explicit owner/agent contract.

**Alternatives considered:** omit any unresolved exact query placeholder — too loose; typos would silently drop keys.

### 3. Exact placeholder only

`Bearer {{api_token}}`, `prefix{{id}}`, and multi-placeholder values are never omitted. Dropping them would send a broken remainder or hide a missing secret.

### 4. Error details carry the placeholder name

`AppError` gains optional `details: { placeholder: string }` (English `message` already includes the name). tRPC `errorFormatter` forwards `details`. SPA `resolveErrorMessage` interpolates `{name}` in the localized catalog string. Gateway JSON can keep `{ code, message }`; the English message already names the placeholder for agents.

**Alternatives considered:** parse the English message in the SPA — fragile. New `appCode` per placeholder — useless.

## Risks / Trade-offs

- **[Risk]** An API that requires a query key to be present even when empty → Mitigation: empty string still sends the key; only absent args omit. Owners who need a blank can pass `""`.
- **[Risk]** `required: false` on a param that is also in the path → Mitigation: path stays strict; the call still fails with the path placeholder named.
- **[Risk]** Query key `nextCursor` vs param `nextcursor` → Mitigation: omit keys off the placeholder name inside the value, not the map key. Existing naming mismatch still works as long as args use the param name.

## Migration Plan

No schema or data migration. Existing optional query tools start working. Rollback is a code revert (fail-closed again).

## Open Questions

None. Header omission can be a follow-up if a real API needs it.
