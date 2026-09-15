## ADDED Requirements

### Requirement: Auth recipe maps to a secret variable and server defaults

The system SHALL apply an authentication recipe (`none`, `bearer`, `header`, `query`, `basic`) by writing at most one secret variable plus the matching `defaultHeaders` or `defaultQuery` template in a single transaction. Bearer SHALL store secret `api_token` and `Authorization: Bearer {{api_token}}`. Header SHALL store a secret named from the header (fallback `api_key`) and `{headerName}: {{name}}`. Query SHALL store a secret named from the param (fallback `api_key`) and that key on `defaultQuery`. Basic SHALL Base64-encode `username:password` into secret `basic_auth` and set `Authorization: Basic {{basic_auth}}`. Recipe values SHALL always be `isSecret: true`. Reads SHALL NOT return recipe plaintext. Applying a new recipe SHALL replace the previous recipe’s default key and SHALL delete the previous recipe variable only when no remaining template references it. `none` SHALL only remove that mapping.

#### Scenario: Apply bearer

- **WHEN** the owner applies `{ type: "bearer", token: "sk_live_123" }` on a server with no auth
- **THEN** a secret variable `api_token` is stored encrypted and default headers include `Authorization: Bearer {{api_token}}`

#### Scenario: Apply none clears bearer

- **WHEN** a server has Bearer mapping and the owner applies `{ type: "none" }`
- **THEN** the Authorization default is gone and `api_token` is removed if unreferenced

#### Scenario: Empty token rejected

- **WHEN** the owner applies Bearer with an empty token
- **THEN** the system rejects the request and writes no variable

#### Scenario: Leading Bearer prefix stripped

- **WHEN** the owner applies Bearer with token `Bearer sk_live_123`
- **THEN** the stored secret decrypts to `sk_live_123` and the default header is `Authorization: Bearer {{api_token}}`

## MODIFIED Requirements

### Requirement: Plaintext secrets are rejected in auth positions

Auth-ish header names (Authorization, proxy-authorization, api-key variants, and names containing `token` or `secret`) SHALL reject literal values at save time with `MCP_PLAINTEXT_SECRET`, pointing the owner to secret variables. Templated values referencing variables SHALL be accepted. No header SHALL be silently dropped at execution.

#### Scenario: Literal bearer rejected

- **WHEN** the owner saves a header `Authorization: Bearer sk_live_123` as a literal
- **THEN** the system rejects with `MCP_PLAINTEXT_SECRET`

#### Scenario: Templated bearer accepted

- **WHEN** the owner saves a header `Authorization: Bearer {{api_token}}` with secret variable `api_token` defined
- **THEN** the header is stored and renders at execution

#### Scenario: Access-token header literal rejected

- **WHEN** the owner saves a header `X-Shopify-Access-Token: shpat_123` as a literal
- **THEN** the system rejects with `MCP_PLAINTEXT_SECRET`
