## ADDED Requirements

### Requirement: Studio tool fields choose a value origin

The SPA tool authoring form SHALL let the owner set each structured request value (query row, header row, form-body row, and each field of a flat JSON body) to exactly one origin: Fixed, Variable, or Agent. Fixed SHALL show a literal input. Variable SHALL show a picker of that server’s variables and an optional prefix. Agent SHALL show a param name, a description for the agent, a type, and a required flag on or directly under that row. The SPA SHALL compile origins to the existing template contract (`{{name}}` in the stored maps/body and matching `params` entries) and SHALL NOT require the owner to type `{{` as the primary way to attach a variable or agent param.

#### Scenario: Query row marked Agent

- **WHEN** the owner adds query key `locationId`, sets origin to Agent, names the param `location_id`, and enters a description
- **THEN** save stores query `{ "locationId": "{{location_id}}" }` and a param `location_id` with that description

#### Scenario: Header row marked Variable with prefix

- **WHEN** the owner adds header `Authorization`, sets origin to Variable, chooses `api_token`, and sets prefix to `Bearer `
- **THEN** save stores header `{ "Authorization": "Bearer {{api_token}}" }` and does not declare a param named `api_token`

#### Scenario: Fixed query value has no placeholder

- **WHEN** the owner adds query key `limit` with origin Fixed and value `50`
- **THEN** save stores `{ "limit": "50" }` and does not declare a param named `limit`

### Requirement: Studio path is text plus insertable tokens

The SPA tool authoring form SHALL present the path as static text plus insertable tokens. Each token SHALL use origin Variable or Agent (and Agent tokens SHALL collect the agent description inline). Compile SHALL concatenate text and `{{name}}` tokens into `pathTemplate`.

#### Scenario: Path token for an agent id

- **WHEN** the owner sets path text `/contacts/` and inserts an Agent token named `contactId` with a description
- **THEN** save stores `pathTemplate` `/contacts/{{contactId}}` and param `contactId` with that description

#### Scenario: Path token for a variable

- **WHEN** the owner inserts a Variable token `api_version` after `/`
- **THEN** save stores `pathTemplate` `/{{api_version}}` and does not declare a param named `api_version`

### Requirement: Studio tool dialog is a request builder

The create/edit/duplicate tool dialog SHALL show identity (name, description), method and path together, then inner tabs for Query, Headers, and Body. It SHALL NOT show a standalone Params list for values already represented as Agent origins on those parts. Body type `form` SHALL use the same origin rows as query. Body type `json` SHALL use origin rows when the stored body is a flat JSON object, and an Advanced textarea otherwise. Body type `raw` SHALL use Advanced. Advanced SHALL offer variable insert/autocomplete and SHALL list Agent leftovers only for placeholders in that textarea that are not server variables.

#### Scenario: Structured fields do not repeat in a Params list

- **WHEN** the owner sets one Agent query row and no Advanced body placeholders
- **THEN** the dialog does not render a separate Params section listing that query param

#### Scenario: Nested JSON stays Advanced

- **WHEN** the owner edits a tool whose JSON body is a nested object
- **THEN** the Body tab shows the Advanced textarea, not origin rows

### Requirement: Studio infers origins when opening a saved tool

When the owner opens the edit (or duplicate) tool dialog, the SPA SHALL infer origins from stored templates and the server’s variable names: exact or prefixed `{{variable}}` → Variable; exact `{{name}}` that is not a variable → Agent (reusing stored param metadata); any other string → Fixed. Path SHALL be split on `{{name}}` into text and tokens using the same rules.

#### Scenario: Prefixed bearer infers Variable

- **WHEN** the stored header is `Authorization: Bearer {{api_token}}` and `api_token` is a server variable
- **THEN** the Headers tab shows origin Variable, prefix `Bearer `, and variable `api_token`

#### Scenario: Unknown placeholder infers Agent

- **WHEN** the stored query is `{ "q": "{{search}}" }`, `search` is not a variable, and param `search` has a description
- **THEN** the Query tab shows origin Agent with that description

### Requirement: Studio can edit a server variable

The Settings variables list SHALL offer an edit action that opens a dialog. The name SHALL be read-only. The owner SHALL be able to replace the value and change `isSecret`. Secret values SHALL NOT be shown. Rotating a secret or turning a secret into a non-secret SHALL require a newly entered value. Turning a non-secret into a secret MAY reuse the visible current value.

#### Scenario: Rotate secret

- **WHEN** the owner edits secret `api_token`, enters a new value, and saves
- **THEN** the list still shows the secret badge and no plaintext value

#### Scenario: Secret value stays hidden

- **WHEN** the owner opens the edit dialog for a secret variable
- **THEN** the value field is empty and the previous secret is not displayed

### Requirement: Studio confirms variable deletion

The Settings variables list SHALL NOT delete on a single click. The SPA SHALL open a confirm dialog (cancel and destructive confirm). When any loaded tool template or server default contains `{{name}}` for that variable, the dialog SHALL warn that those templates will keep the placeholder.

#### Scenario: Cancel leaves the variable

- **WHEN** the owner clicks delete on `api_token` and cancels the dialog
- **THEN** the variable remains and no delete request is sent

#### Scenario: Referenced variable warns

- **WHEN** a loaded tool header contains `{{api_token}}` and the owner opens delete for `api_token`
- **THEN** the dialog text states that existing templates still reference it

### Requirement: Server defaults use Fixed or Variable origins

The Settings default headers and default query editors SHALL use the same origin-row model as tools, limited to Fixed and Variable (no Agent). Variable rows SHALL include the optional prefix and variable picker.

#### Scenario: Default header from a variable

- **WHEN** the owner sets default header `Version` to origin Variable `api_version`
- **THEN** save stores `{ "Version": "{{api_version}}" }`
