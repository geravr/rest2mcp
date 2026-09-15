## Why

The studio already stores three value origins (fixed, server variable, agent param) as `{{placeholders}}`, but the GUI hides that choice. Owners type syntax, remember names, and describe agent params in a separate block. Variables can be created and deleted instantly, but not edited. Authoring feels like a template language, not a request builder.

## What Changes

- **Value origin on every structured field.** Query, headers, form body, and flat JSON body rows choose Fixed, Variable, or Agent. Agent rows collect the explanation (and type/required) inline. Owners do not type `{{name}}` as the primary path.
- **Variable mode includes an optional prefix** so `Bearer {{api_token}}` stays one row (no fourth “template” mode).
- **Path is static text plus insertable tokens** (Fixed / Variable / Agent), not a raw `{{ }}` string.
- **Tool dialog becomes a request builder:** name, description, method + path on top; inner tabs for Query, Headers, and Body; mutation/enabled at the bottom. No standalone Params list for structured fields. Nested or raw body keeps an Advanced textarea with variable insert.
- **Opening an existing tool infers origin** from stored templates (known variable name → Variable, other `{{name}}` → Agent, else Fixed). Save still writes the current template + params contract.
- **Settings variables: edit and confirm delete.** Edit rotates the value (secrets stay write-only) and can change `isSecret`. Delete uses a confirm dialog and warns when tools or defaults still reference the name. Server defaults use Fixed or Variable only (no Agent).
- **Curl import stays.** Markings already match this model; created tools open in the new form.

**Non-goals:** renaming variables or rewriting `{{old}}` → `{{new}}`; nested JSON tree editor; changing tRPC/storage/resolution; type-to-confirm deletes; Agent origin on server defaults; curl-import redesign; platform MCP tool changes.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `mcp-studio`: SPA tool authoring uses explicit value origins and a request-builder dialog; studio exposes variable edit and confirmed delete with reference warning.
- `mcp-templates`: no runtime or storage change; studio-facing variable update/delete behavior is specified so the existing API is actually reachable from the GUI.

## Impact

- **apps/app:** rebuild `tool-form-dialog`, `key-value-editor`, `params-editor`; Settings variable list (edit dialog, delete confirm, defaults origins); `useUpdateMcpVariable`; en/es copy.
- **apps/api:** no new procedures expected (`mcp.updateVariable` already exists). Optional client-side reference scan; no schema migration.
- **packages/ui:** add a picker primitive (Popover or Select) if the existing Select is not enough for searchable variables.
- **db / packages/core / platform MCP:** unchanged.
