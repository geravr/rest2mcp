## ADDED Requirements

### Requirement: Owner can search the Studio tool list by name

The Studio tools list SHALL accept an optional name query `q` that is trimmed client-side and bounded in length; an absent or blank `q` SHALL mean unfiltered. The list and count queries SHALL apply the same case-insensitive, LIKE-escaped name predicate combined with the active group filter, so page rows and total can never diverge. Changing `q` or the group filter SHALL reset the page to the first page, and the query SHALL persist in the route URL. Search SHALL match draft tool names only and SHALL NOT affect publication, gateway discovery, execution, or Platform MCP outputs.

#### Scenario: Search narrows rows and total with one predicate

- **WHEN** the owner searches for `ad_account` on a server with matching and non-matching tools
- **THEN** the page rows and the reported total contain only tools whose name matches case-insensitively

#### Scenario: Search combines with the group filter

- **WHEN** the owner filters by group `Ad Manager` and searches for `pause`
- **THEN** the response contains only matching tools assigned to `Ad Manager` and the total reflects both predicates

#### Scenario: Metacharacters match literally

- **WHEN** the owner searches for `100%_off`
- **THEN** only a tool literally named with that substring matches, with no wildcard interpretation of `%` or `_`

#### Scenario: Blank query is unfiltered

- **WHEN** the owner clears the search input
- **THEN** the unfiltered paginated list returns with the page reset to the first page
