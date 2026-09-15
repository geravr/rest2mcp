## 1. Variable update API

- [x] 1.1 Extend `mcp.updateVariable` input with optional `isSecret` and the secret/clear-secrecy validation from the templates spec
- [x] 1.2 Service + router tests: rotate secret (write-only), reject secret → non-secret without value, encrypt when flipping a plaintext variable to secret

## 2. Origin model

- [x] 2.1 Add `value-origin.ts` with infer, compile, path split/join, and flat-JSON detection
- [x] 2.2 Unit tests for prefixed Variable, exact Agent, Fixed leftovers, path tokens, and structured JSON compile (string vs raw literal vs bare agent)

## 3. Shared authoring controls

- [x] 3.1 Add a searchable variable picker (Popover + filter, or Select if that stays simpler) and generalize `TemplateValueInput` to Input and Textarea with an insert control
- [x] 3.2 Build `source-row-editor` (key, origin, Fixed/Variable/Agent controls, optional prefix, agent description/type/required)
- [x] 3.3 Build `path-parts-editor` (static segments + insert Variable/Agent tokens)
- [x] 3.4 Component tests for source rows, path parts, and insert/autocomplete on the Advanced textarea

## 4. Tool request-builder dialog

- [x] 4.1 Rebuild `tool-form-dialog` layout: name, description, method + path parts, inner Query/Headers/Body tabs, mutation/enabled; drop the standalone Params list for structured fields
- [x] 4.2 Wire Body: form rows, flat JSON rows, Advanced textarea with leftover Agent fields only when needed
- [x] 4.3 Infer origins on edit/duplicate from stored templates + `variableNames`; compile back to `pathTemplate`, maps, body, and `params` on save
- [x] 4.4 Dialog tests: Agent query compile, Variable header with prefix, inferred bearer, no Params section when unused, nested JSON stays Advanced

## 5. Settings variables and defaults

- [x] 5.1 Add `useUpdateMcpVariable` and `EditVariableDialog` (read-only name, write-only secrets, `isSecret` toggle)
- [x] 5.2 Add `DeleteVariableDialog` (cancel / confirm) with a best-effort `{{name}}` warning from loaded tools + defaults
- [x] 5.3 Switch Settings default headers/query to origin rows (Fixed | Variable only)
- [x] 5.4 Settings tests: edit rotate, hidden secret, delete cancel, referenced-variable warning, default Variable compile

## 6. Copy and verification

- [x] 6.1 Add en/es strings for origins, prefix, path insert, Advanced body, variable edit/delete, and fix path placeholder copy to `{{name}}`
- [x] 6.2 `bun typecheck`, `bun lint`, focused tests for api + app, then `bunx prettier --write .`
- [x] 6.3 `openspec validate simplify-studio-authoring --strict`
