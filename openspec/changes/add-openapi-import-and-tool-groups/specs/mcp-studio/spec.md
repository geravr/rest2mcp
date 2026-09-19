## MODIFIED Requirements

### Requirement: Owner can add a tool from curl

The system SHALL import curl as a sanitized definition for one endpoint. The confirmed import SHALL create exactly one disabled draft tool in one transaction and MAY assign it to one optional existing group owned by the same server. It SHALL NOT create, update, rotate, delete, or overwrite server authentication, server values, secrets, default headers/query, or groups. Credential headers, cookies, proxy credentials, and unsafe transport headers SHALL be excluded. Detected authentication SHALL be reported only by kind and header/query name, without its value, as a separate configuration requirement. Value markings SHALL identify a concrete location and occurrence rather than matching globally by literal value.

#### Scenario: Curl credential is excluded

- **WHEN** the owner imports `curl -H 'Authorization: Bearer secret' https://api.example.com/v1/items`
- **THEN** the draft tool contains no Authorization value, no secret or auth row changes, and the result reports that Bearer authentication must be configured separately

#### Scenario: Existing authentication is untouched

- **WHEN** the server already has authentication and the imported curl contains a different credential
- **THEN** the existing authentication and all secret values remain byte-for-byte unchanged

#### Scenario: Mark one repeated literal

- **WHEN** the same literal appears in path and body and the owner marks only the body occurrence as an agent input
- **THEN** only the selected body location receives that binding

#### Scenario: Import into an existing group

- **WHEN** the owner confirms a curl import with an existing group belonging to the selected server
- **THEN** the one disabled draft tool is created in that group without changing the group itself

#### Scenario: Foreign group is rejected atomically

- **WHEN** the curl confirmation references a group from another server or owner
- **THEN** import fails with not-found semantics and creates no tool or other persistent row

#### Scenario: Import is atomic

- **WHEN** draft tool creation fails after preview
- **THEN** no tool, group, server value, auth configuration, default, or other persistent row is changed

#### Scenario: Foreign origin is rejected

- **WHEN** the curl target origin differs from the selected server origin
- **THEN** import fails with a validation issue instead of silently applying the path to the selected server

#### Scenario: Unsupported curl flag is rejected

- **WHEN** a curl command uses an unsupported flag whose semantics affect the request
- **THEN** preview fails with `MCP_CURL_INVALID` naming the unsupported flag
