## ADDED Requirements

### Requirement: Unresolved template errors name the placeholder

When a playground or studio request fails with `MCP_TEMPLATE_UNRESOLVED`, the SPA SHALL show localized copy (en and es) that includes the unresolved placeholder name. The name SHALL come from structured error details, not from parsing the English server `message`.

#### Scenario: Playground toast names the missing placeholder

- **WHEN** invoke fails because query placeholder `limit` cannot be resolved
- **THEN** the owner sees an error that includes `limit` in the active locale
