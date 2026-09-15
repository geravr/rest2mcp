## Context

The template engine already models three origins as `{{placeholder}}` strings: a fixed literal, a server variable, or an agent param (declared in `params[]`). Curl import already asks the owner to mark each value as literal / variable / param. The manual tool form does not. It is a long dialog of free-text fields plus a trailing Params list that infers leftovers from `{{syntax}}`. Autocomplete exists only on key-value values after typing `{{`. Variables can be created and deleted from Settings; `mcp.updateVariable` exists but the SPA has no edit hook, and delete is a one-click trash icon.

This change is SPA-first. Storage, resolution, and curl import stay. The GUI must feel like building a request, not writing a template language.

## Goals / Non-Goals

**Goals:**

- The owner chooses origin (Fixed / Variable / Agent) on the field they are editing.
- Agent explanation lives on that field. No second Params table for structured request parts.
- Variables are pickable by name; typing `{{` is not required.
- Path is readable as text + tokens.
- The tool dialog is a compact request builder.
- Variables can be edited (including rotating secrets) and deleted only after confirm.
- Existing saved tools open without a data migration.

**Non-Goals:**

- Renaming variables or rewriting references.
- Nested JSON tree editor.
- Changing execution, escaping, or the tRPC tool payload shape (`pathTemplate`, maps, `body`, `params`).
- Type-to-confirm variable delete.
- Agent origin on server defaults.
- Curl-import or platform-MCP redesign.

## Decisions

### 1. Origins are a UI model compiled to the existing template contract

Draft type (conceptual):

```
Fixed    { origin: "fixed"; value: string }
Variable { origin: "variable"; name: string; prefix: string }
Agent    { origin: "agent"; name: string; description?: string; type; required }
```

Compile:

| Origin   | Stored value                                      |
| -------- | ------------------------------------------------- |
| Fixed    | `value` as typed                                  |
| Variable | `prefix + "{{" + name + "}}"`                     |
| Agent    | `"{{" + name + "}}"` plus a `params[]` entry      |

`params[]` is the union of every Agent token in path, query, headers, and body. Save still calls `createTool` / `updateTool` with the current payload. Runtime is unchanged.

**Alternatives considered:** persist origin on the server — rejected; it duplicates `{{ }}` + params and forces a migration. A fourth “template” origin — rejected; it reintroduces syntax as a first-class mode.

### 2. Variable prefix, not a special Authorization widget

Variable rows have an optional prefix so `Bearer {{api_token}}` stays one row. Auth headers keep the existing `MCP_PLAINTEXT_SECRET` rule: Fixed origin on auth-ish names is rejected at save; Variable (and Agent) remain valid.

**Alternatives considered:** Authorization-only scheme select — rejected; prefixes appear on other headers (`Token`, `Basic`). Exclusive Variable with no prefix — rejected; owners would fall back to raw strings.

### 3. Infer origin when a saved tool (or defaults) opens

Shared `inferOrigin(value, variableNames)`:

1. Exact `{{name}}` and `name` is a variable → Variable, empty prefix.
2. `prefix{{name}}` with no other placeholders and `name` is a variable → Variable + prefix.
3. Exact `{{name}}` and `name` is not a variable → Agent (reuse existing param metadata when present).
4. Otherwise → Fixed (including mixed leftover syntax). Those strings stay editable as Fixed so we never drop data. Advanced body (below) is the escape hatch for mixed JSON.

Path splits on `{{name}}` into text parts and tokens, then each token uses the same rules.

### 4. Path is an ordered list of text parts and tokens

The path control is not a single raw `{{ }}` input. It is static segments plus insertable tokens. “Insert” asks origin (Variable picker or Agent name + explanation). Compile concatenates. This is the primary path UX; owners should not need to memorize placeholder syntax to put an id in a URL.

**Alternatives considered:** keep a plain input and only add autocomplete — cheaper, but still hides origin. OpenAPI `{id}` syntax — rejected; the engine is `{{name}}` and two syntaxes would confuse.

### 5. Body: structured rows by default, Advanced when the JSON is not flat

| `bodyType` | Editor |
| ---------- | ------ |
| `none`     | Empty |
| `form`     | Same source rows as query |
| `json`     | If the stored body is a flat JSON object (no nested object/array), source rows. Otherwise Advanced textarea |
| `raw`      | Advanced textarea |

Structured JSON compile (user-first, few controls):

- Fixed: if the trimmed value parses as a JSON number, `true`, `false`, or `null`, insert it raw; otherwise a JSON string.
- Variable: JSON string `"{{name}}"` (prefix, if any, is inside the string).
- Agent `string`: `"{{name}}"`. Agent `number` / `boolean` / `json`: bare `{{name}}` so the engine can inject typed values.

Advanced textarea: `TemplateValueInput` equivalent for multiline (autocomplete after `{{` plus an insert-variable control). Placeholders found there that are not variables become Agent leftovers listed **under that textarea** (name, description, type, required) — the only remaining “params” UI, and only when Advanced actually has agent holes.

**Alternatives considered:** always a JSON textarea — rejected; it is where origin is hardest to choose. A full tree editor — rejected; too much studio for the common flat body.

### 6. Tool dialog is a request builder, not a nine-block scroll

Layout:

1. Title (create / edit / duplicate).
2. Name + tool description (shown to the agent).
3. Method + path parts on one row.
4. Inner tabs: Query, Headers, Body — only the active part is on screen.
5. `allowMutation` / `enabled` as they are today.
6. Save / cancel.

Widen to `sm:max-w-3xl`. Drop the dialog subtitle that talks about placeholders. Drop the standalone Params section for structured fields.

Query/header/form rows:

```
[ key ] [ Fixed | Variable | Agent ] [ value | variable picker | agent explanation ]
```

Agent rows also expose type + required on the same row (or the line immediately under it). Switching to Agent pre-fills `name` from a slug of the key (`locationId` → `location_id` when it must match variable-like agent names; keep the existing param charset `[A-Za-z][A-Za-z0-9_]*` and let the owner edit the name if the slug is wrong).

Empty variable list: Variable origin is still available; the picker states there are no variables yet (Settings is where they are created). Do not invent an inline create-variable flow in this change.

**Alternatives considered:** three dialog-level tabs (Identity / Request / Agent) — rejected; they hide the agent explanation away from the field. Keep the current single scroll — rejected; Params at the bottom is the confusion we are removing.

### 7. Server defaults use the same rows without Agent

Settings default headers/query reuse the source-row editor with Fixed and Variable only. Agent is omitted: defaults apply to every call and are not agent arguments.

### 8. Variable edit and confirmed delete in Settings

**Edit** opens a dialog (not inline expand): name is read-only; `isSecret` can change; value follows write-only rules.

| Current     | Value field                         | Save |
| ----------- | ----------------------------------- | ---- |
| Not secret  | Prefills current value              | Value and/or `isSecret` |
| Secret      | Empty; “enter a new value to rotate” | Requires a new value to rotate, or to become non-secret |

Turning a non-secret into a secret MAY reuse the visible current value (re-encrypt). Turning a secret into a non-secret MUST supply a new value (the old secret is not shown).

Extend `mcp.updateVariable` with optional `isSecret`. Keep `value` required when the stored row is secret or when becoming non-secret; allow sending the current plaintext when only flipping a visible value to secret.

**Delete** uses the same confirm pattern as `DeleteToolDialog` (Cancel / destructive confirm). Before confirm, scan already-loaded tools (current tools list page) plus server defaults for `{{name}}`. If found, the copy warns that those templates will keep the placeholder and calls will fail until they are edited. No server-side cascade, no rewrite.

**Alternatives considered:** inline row edit — tighter, but secrets need a clear empty-rotate state that a dialog does better. Type-to-confirm — too heavy for a variable. Block delete while referenced — worse; owners must be able to remove a secret they rotated out of templates later.

### 9. Shared modules, no new backend resources

| Module | Role |
| ------ | ---- |
| `value-origin.ts` | Infer + compile + path split + flat-JSON detect (unit-tested) |
| `source-row-editor.tsx` | Key + origin + origin-specific controls |
| `path-parts-editor.tsx` | Text segments + tokens |
| `template-value-input.tsx` | Move/generalize current autocomplete; add textarea + insert control for Advanced |
| `edit-variable-dialog.tsx` / `delete-variable-dialog.tsx` | Settings |
| `useUpdateMcpVariable` | Thin mutation hook |

Picker: searchable list (filter input + options). Add `Popover` to `packages/ui` if needed; do not add a command palette unless Select + filter is visibly worse. Existing `Select` is acceptable for short variable lists.

Reference scan stays in the client. Tools are paginated; the warning is best-effort on the loaded page plus defaults. Copy must not claim a global “unused” proof.

### 10. Copy and loading

All new strings in `en` and `es`. Origin labels stay short (Fixed / Variable / Agent — localized). Path placeholder copy must use `{{name}}`, not `{id}`. Settings/tool first-load keeps the existing skeleton composites; mutations stay on the initiating control.

## Risks / Trade-offs

- [Infer maps a mixed string to Fixed and hides that it contains `{{ }}`] → Advanced body covers nested JSON; path split still extracts tokens; leftover `{{ }}` in a Fixed query value is visible as text and can be switched to Agent/Variable. Document in tests.
- [Structured JSON compile guesses number vs string] → only exact JSON literals (`10`, `true`, `null`) go raw; everything else is a string. Advanced remains available.
- [Paginated tools make delete-reference warnings incomplete] → warn from loaded tools + defaults; wording is “used in the tools you can see” / “default headers”, never “unused everywhere”.
- [Optional prefix + agent name slug can collide with an existing variable] → compile + existing save warnings still fire; Agent names that match a variable would resolve as the variable at runtime (args-first actually wins if the agent passes it). Slugify must not silently pick a variable name when the owner meant an agent param; if the slug matches a variable, keep the key-derived name and let the owner rename the param.
- [Dialog width and inner tabs add chrome] → only one request part is visible; overall fields on screen drop because Params is gone.

## Migration Plan

- No database migration and no backfill.
- Deploy SPA + the small `updateVariable` input extension together. Old clients that omit `isSecret` keep current rotate-value behavior.
- Rollback: revert the SPA and the optional input field; stored tools remain valid.

## Open Questions

None. Remaining product choices were closed in favor of owner simplicity (prefix, request-builder dialog, structured-then-Advanced body, confirm-not-block delete).
