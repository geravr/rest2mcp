## ADDED Requirements

### Requirement: Owner chooses authentication when creating a server

The create-server dialog SHALL ask which authentication to use: None, Bearer token, API key header, API key query, or Basic. Only the fields required by the selected type SHALL be visible. Bearer SHALL collect a token. Header SHALL collect a header name (default `X-API-Key`) and a value. Query SHALL collect a query parameter name (default `api_key`) and a value. Basic SHALL collect a username and a password. The owner SHALL NOT choose `isSecret`, SHALL NOT name the backing variable, and SHALL NOT type `{{placeholders}}`. Empty credentials for a non-None type SHALL be rejected. The create request SHALL persist the server and the mapped secret in one transaction.

#### Scenario: Bearer on create

- **WHEN** the owner creates a server with type Bearer and token `sk_live_123`
- **THEN** the server exists with a secret variable used from a default `Authorization` header, and later reads do not include `sk_live_123`

#### Scenario: None on create

- **WHEN** the owner creates a server with type None
- **THEN** the server has no auth secret variable and no auth default header or query from this flow

#### Scenario: Header fields appear only for that type

- **WHEN** the owner selects API key header
- **THEN** the dialog shows header name and value inputs and does not show Basic username/password

### Requirement: Studio Settings expose the same authentication recipe

The Settings tab SHALL show an Auth card that infers the current scheme from server defaults and variables (None, Bearer, Header, Query, Basic, or Custom). For a typed scheme the card SHALL use the same fields as create and save through `setServerAuth`. Custom SHALL leave the existing default-header and default-query editors as the way to change those values. Saving a typed scheme SHALL replace only the previous auth mapping keys and SHALL delete the previous auth variable only when no remaining template references it.

#### Scenario: Inferred bearer

- **WHEN** defaults contain `Authorization: Bearer {{api_token}}` and `api_token` is a secret variable
- **THEN** the Auth card shows type Bearer and does not display the stored token

#### Scenario: Custom fallback

- **WHEN** defaults contain both `Authorization: Bearer {{api_token}}` and `X-Partner-Key: {{partner}}`
- **THEN** the Auth card shows Custom and does not overwrite the extra header when left unchanged

#### Scenario: Switch to None removes mapping

- **WHEN** the owner saves type None on a server that had Bearer
- **THEN** the Authorization default is removed and `api_token` is deleted if nothing else references it

### Requirement: Connection test runs only when the owner asks

The SPA SHALL NOT probe connectivity as a side effect of creating a server. Create success and the Settings Auth card SHALL offer an explicit Test connection control that calls the existing probe.

#### Scenario: Create does not auto-test

- **WHEN** the owner successfully creates a server
- **THEN** no connectivity probe runs until they click Test connection

#### Scenario: Settings test uses current auth

- **WHEN** the owner has saved Bearer auth and clicks Test connection
- **THEN** the probe sends the rendered default Authorization header

### Requirement: Studio playground shows upstream HTTP results

When playground invoke returns an executor result (including non-2xx `httpStatus`), the SPA SHALL render the HTTP status and capped body and SHALL link to the call log when `callLogId` is present. It SHALL NOT treat that result as a generic product error toast. A new submit SHALL clear the previous result panel. Tools that cannot run (disabled, mutation not allowed, server paused) SHALL stay selectable with invoke disabled and an explanation.

#### Scenario: 401 is visible in the panel

- **WHEN** invoke returns `httpStatus` 401 and a JSON body
- **THEN** the playground shows status 401 and that body, and a toast does not claim a generic upstream product failure

#### Scenario: Disabled tool explains itself

- **WHEN** the owner selects a tool with `enabled` false
- **THEN** invoke is disabled and the copy states the tool is disabled

## MODIFIED Requirements

### Requirement: Owner can add a tool from curl

The system SHALL parse a curl command into method, URL, headers, and body and create a tool whose request template carries those values (query params become query template entries, non-auth headers become header entries, body becomes a typed body template). Create MAY include value markings (`{ value, as: "param" | "variable", name, isSecret? }`); each marking SHALL replace every occurrence of that exact value in the templates with a `{{name}}` placeholder, declare a param, or create/update a variable (encrypted when marked secret). When an auth header is detected and not marked, and the server has no existing auth default, the system SHALL create or update a secret variable with that value plus the matching server default header. When the server already has an auth-ish default header or credential default query, the import SHALL NOT overwrite that default or rotate the existing secret; the tool SHALL still be created without embedding the curl secret. Marking a detected credential as an agent param SHALL NOT write that param into server default headers. The response SHALL report what was captured or that existing server auth was kept. The literal secret SHALL NOT be stored on the tool.

#### Scenario: Curl captures credential as variable

- **WHEN** the owner imports `curl -H 'Authorization: Bearer secret' https://api.example.com/v1/items` on a server with no auth defaults
- **THEN** the system creates a GET tool for `/v1/items`, stores `secret` as an encrypted secret variable, adds default header `Authorization: Bearer {{...}}`, and the tool itself contains no secret

#### Scenario: Existing server auth is kept

- **WHEN** the server already has `Authorization: Bearer {{api_token}}` and the owner imports a curl with a different Bearer value
- **THEN** `api_token` is not rotated, the Authorization default is unchanged, the new tool contains no secret, and the response reports that existing server auth was kept

#### Scenario: Marked value becomes a param

- **WHEN** the owner imports a curl with `?locationId=loc_9` and marks `loc_9` as param `location_id`
- **THEN** the tool query template is `{ "locationId": "{{location_id}}" }` and the tool declares param `location_id`

#### Scenario: Invalid curl

- **WHEN** the owner submits a string that is not a parseable curl command
- **THEN** the system rejects the request with `MCP_CURL_INVALID`
