## ADDED Requirements

### Requirement: Variable update can rotate value and secrecy

The system SHALL accept an owner update of an existing variable by `name` that replaces the stored value and MAY set `isSecret`. Secret values SHALL remain write-only in the response (`name`, `isSecret`, `hasValue` only). Turning a secret variable into a non-secret SHALL require a new value in the same request. Turning a non-secret variable into a secret MAY encrypt the submitted value (including the previously readable value). A secret variable SHALL NOT accept an update that omits `value` while requesting `isSecret: false`.

#### Scenario: Rotate secret keeps write-only response

- **WHEN** the owner updates secret `api_token` with a new value
- **THEN** the stored ciphertext changes and the response does not include the new value

#### Scenario: Clear secrecy without a value is rejected

- **WHEN** the owner updates secret `api_token` with `isSecret: false` and no value
- **THEN** the system rejects the request and the variable remains secret

### Requirement: Deleting a variable does not rewrite templates

When the owner deletes a variable, the system SHALL remove only that variable row. Tool path/query/header/body templates and server default headers/query that contain `{{name}}` SHALL stay unchanged. Later execution SHALL resolve those placeholders per the existing args-then-variables rule (unresolved → `MCP_TEMPLATE_UNRESOLVED`).

#### Scenario: Tool template still mentions deleted name

- **WHEN** a tool header is `Authorization: Bearer {{api_token}}` and the owner deletes variable `api_token`
- **THEN** the tool row still stores `Bearer {{api_token}}`

#### Scenario: Call fails after deleting a referenced variable

- **WHEN** the owner deletes `api_token` and an agent invokes a tool whose template still references `{{api_token}}` with no argument of that name
- **THEN** the call fails with `MCP_TEMPLATE_UNRESOLVED` and no upstream request is made
