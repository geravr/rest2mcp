## MODIFIED Requirements

### Requirement: Placeholders resolve args-first with context-aware escaping

At execution, each `{{placeholder}}` SHALL resolve from the agent argument of that name first, then from a server variable of that name. When rendering a query map (server default query merged with the tool query, tool wins on key conflict), if a value is exactly `{{name}}`, `name` is a declared tool param with `required` false, and neither an argument nor a variable provides it, the system SHALL omit that query key and SHALL NOT fail the call for that key. Path, header, and body placeholders, query values that are not an exact sole placeholder, required params, and placeholders with no matching optional param SHALL still fail with `MCP_TEMPLATE_UNRESOLVED` when unresolved, and no upstream request SHALL be made. The failure SHALL identify the unresolved placeholder name. Escaping SHALL match context: URL-encoding in path and query, CRLF-stripped raw in headers, JSON string escaping for quoted placeholders in JSON bodies, raw JSON values for bare placeholders in JSON bodies, and URL-encoding in form bodies.

#### Scenario: Argument wins over variable

- **WHEN** a server variable `limit` = `10` exists and the agent passes argument `limit` = `50`
- **THEN** the upstream request uses `50`

#### Scenario: Unresolved placeholder

- **WHEN** a template references `{{missing}}` and neither an argument nor a variable provides it
- **THEN** the call fails with `MCP_TEMPLATE_UNRESOLVED` identifying `missing` and upstream is not contacted

#### Scenario: Path value is URL-encoded

- **WHEN** the agent passes `contactId` = `a/b c` for path `/contacts/{{contactId}}`
- **THEN** the upstream path contains `a%2Fb%20c`

#### Scenario: Bare JSON placeholder injects raw value

- **WHEN** a JSON body template contains `"address": {{address}}` and the agent passes an object for `address`
- **THEN** the upstream body embeds the object as JSON, not a string

#### Scenario: Optional exact query key is omitted

- **WHEN** a tool query is `{ "email": "{{email}}", "phone": "{{phone}}", "limit": "{{limit}}" }`, params `email`, `phone`, and `limit` are all `required: false`, and the caller passes only `{ "email": "a@b.com" }`
- **THEN** the upstream query includes `email=a%40b.com` and does not include `phone` or `limit`

#### Scenario: Optional query still uses a variable when present

- **WHEN** query `{ "region": "{{region}}" }` has param `region` with `required: false`, no argument `region` is passed, and a server variable `region` = `us` exists
- **THEN** the upstream query includes `region=us`

#### Scenario: Required query placeholder still fails

- **WHEN** query `{ "email": "{{email}}" }` has param `email` with `required: true` and no argument or variable provides `email`
- **THEN** the call fails with `MCP_TEMPLATE_UNRESOLVED` identifying `email` and upstream is not contacted

#### Scenario: Prefixed query value is not omitted

- **WHEN** query `{ "q": "id:{{id}}" }` has param `id` with `required: false` and no argument or variable provides `id`
- **THEN** the call fails with `MCP_TEMPLATE_UNRESOLVED` identifying `id` and upstream is not contacted

#### Scenario: Unresolved path placeholder is not omitted

- **WHEN** the path is `/contacts/{{contactId}}`, param `contactId` is `required: false`, and no argument or variable provides `contactId`
- **THEN** the call fails with `MCP_TEMPLATE_UNRESOLVED` identifying `contactId` and upstream is not contacted
