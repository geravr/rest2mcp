# Platform MCP

## Purpose

Streamable HTTP MCP for the owner to manage MCP studio resources from an external agent using a platform-scoped token.

## Requirements

### Requirement: Owner can connect a platform MCP

The system SHALL expose `/api/platform-mcp` in explicit personal-access-token authentication mode and authenticate it with an individually revocable, expiring, policy-versioned Platform PAT backed only by normalized grants. The raw PAT SHALL be shown once, stored only as a unique cryptographic hash, and distinguishable from server-scoped gateway tokens during validation. The endpoint SHALL enforce trusted Origin when present, bounded streaming request bodies, authenticated per-token request/write/invocation limits, and concurrency limits. Invalid credentials SHALL return HTTP 401 with an RFC 6750 Bearer challenge, and the product SHALL NOT advertise PAT mode as OAuth discovery or consent support.

#### Scenario: Read-only PAT connects

- **WHEN** a current-policy PAT has read scope and a valid resource grant
- **THEN** Platform MCP processing proceeds and only tools authorized by that principal are advertised

#### Scenario: Server token is rejected uniformly

- **WHEN** a server-scoped token is sent to Platform MCP
- **THEN** the endpoint returns the same `MCP_AGENT_TOKEN_INVALID` response used for another invalid Platform credential

#### Scenario: Expired or revoked PAT is rejected

- **WHEN** a Platform PAT is expired or revoked
- **THEN** the request is rejected before any Studio data or MCP request body is read

#### Scenario: Unknown policy or malformed grants are rejected

- **WHEN** a token has an unknown policy version, lacks authoritative normalized grants, or has inconsistent grant rows
- **THEN** the endpoint fails closed as an invalid token and no alternate scope representation is consulted

#### Scenario: Chunked oversized body is bounded

- **WHEN** an authenticated request streams more bytes than the Platform MCP body limit without a usable content length
- **THEN** the endpoint stops reading, releases acquired capacity, and returns `MCP_REQUEST_TOO_LARGE`

### Requirement: Platform tools mutate only the owner's studio

Platform tools SHALL use the same shared command schemas, size limits, compiler, ownership checks, and transactions as tRPC Studio while additionally enforcing the immutable Platform principal. Selected-server PATs SHALL query and mutate only granted owned servers and SHALL NOT create servers. Account-wide PATs with author scope MAY create draft servers. Author scope SHALL create or edit only state that is not runtime-effective; enabling or changing an enabled tool or changing configuration consumed by an enabled plan SHALL additionally require publish scope. Curl import SHALL remain a sanitized disabled-draft operation. Destructive Studio operations SHALL require destructive scope plus a confirmation field matching the current resource name.

#### Scenario: Draft author cannot publish a tool

- **WHEN** a PAT has read and author scopes but lacks publish scope
- **THEN** it may create or edit a disabled draft tool
- **AND** an attempt to enable or modify an enabled tool is denied without writing

#### Scenario: Selected-server PAT cannot escape its grant

- **WHEN** a PAT restricted to server A submits server B's id for any read or mutation
- **THEN** the service returns the same not-found outcome as for a nonexistent server and touches neither server

#### Scenario: Selected-server PAT cannot create a server

- **WHEN** a selected-server PAT with author scope calls `create_server`
- **THEN** the operation is denied before validating or reserving the requested server slug

#### Scenario: Account-wide author creates only a draft

- **WHEN** an account-wide PAT with author scope creates a server
- **THEN** the server is created as a draft without authentication, secrets, tools, or agent tokens

#### Scenario: Validation matches tRPC

- **WHEN** an agent submits a tool name, body, agent-input registry, binding collection, or curl larger than the tRPC limit
- **THEN** Platform MCP rejects it with the same stable validation code and writes nothing

#### Scenario: Curl with credential is rejected or sanitized

- **WHEN** `add_tool_from_curl` receives curl containing Authorization, cookies, proxy auth, or credential-like protected fields
- **THEN** no credential value is stored, no server-wide state changes, and the result reports separate secure authentication configuration is required

#### Scenario: Destructive confirmation mismatch

- **WHEN** a destructive-scoped PAT submits a confirmation name that does not match the current granted resource
- **THEN** deletion fails and all resources remain

### Requirement: Platform tools can test and connect

`test_tool` SHALL require invoke scope for enabled GET or HEAD tools and SHALL additionally require invoke-mutation scope for POST, PUT, PATCH, or DELETE tools. HTTP method classification SHALL be authoritative even when annotations claim the tool is read-only. Mutating tools SHALL still require the owner's persisted `allowMutation`; a tool marked destructive SHALL also require confirmation matching its current name. The invocation SHALL use the shared compiled executor and structured result contract. `get_connection_snippet` SHALL require read scope, return no token, and SHALL NOT mint credentials.

#### Scenario: Read-only invoke is allowed

- **WHEN** a granted PAT has invoke scope and tests an enabled GET tool
- **THEN** the shared executor runs subject to normal execution policy and returns the standard result or tool-error envelope

#### Scenario: Invoke scope cannot execute a mutation

- **WHEN** a PAT has invoke scope but lacks invoke-mutation scope and tests an enabled POST, PUT, PATCH, or DELETE tool
- **THEN** the request is denied before upstream contact even if `allowMutation` is true

#### Scenario: Mutating invoke preserves product policy

- **WHEN** a granted PAT has invoke and invoke-mutation scopes but the selected mutating tool has `allowMutation` false
- **THEN** execution fails with `MCP_MUTATION_NOT_ALLOWED` before upstream contact

#### Scenario: Destructive upstream tool requires confirmation

- **WHEN** an otherwise authorized PAT invokes a tool whose compiled contract is destructive without matching current-name confirmation
- **THEN** the system denies the call before upstream contact

#### Scenario: Read token cannot invoke

- **WHEN** a read-only PAT directly calls `test_tool`
- **THEN** the transport returns an insufficient-scope denial and does not contact upstream

### Requirement: Platform calls stay secret-safe

Platform MCP SHALL never accept new plaintext secret values, raw authentication credentials, or secret-bearing curl as normal agent-authored fields. Read scope SHALL return safe agent-visible contracts rather than stored authoring definitions and SHALL omit undisclosed secret-dependent fields instead of representing them as false or null. Reading or binding existing secret ids SHALL require secret-reference scope, while values and ciphertext SHALL never be returned. Without secret-reference scope, an unknown, foreign, or non-visible server-value id SHALL produce the same policy denial as a secret id.

#### Scenario: Ordinary read does not expose authoring secret ids

- **WHEN** a read-scoped PAT lists a tool whose stored definition contains a secret binding
- **THEN** the result contains the safe agent-visible contract but no stored request definition, secret id, binding location, or false placeholder

#### Scenario: Authoring definition with secret is all-or-nothing

- **WHEN** an author-scoped PAT without secret-reference scope requests an editable definition containing a secret binding
- **THEN** the entire definition read is denied and no partial definition or secret metadata is returned

#### Scenario: Agent cannot create plaintext secret

- **WHEN** `set_variable` requests a secret kind or submits a plaintext credential in a protected placement
- **THEN** Platform MCP rejects the request and directs the owner to the secure Studio secret flow

#### Scenario: Existing secret reference is allowed by scope

- **WHEN** an authorized authoring command binds an existing secret id and the PAT has secret-reference scope for that server
- **THEN** the definition may compile without revealing the secret value or ciphertext

#### Scenario: Secret and nonexistent ids are indistinguishable without scope

- **WHEN** a PAT without secret-reference scope submits an id that is not in its visible non-secret value catalog
- **THEN** the operation returns the same generic policy denial whether the id is secret, nonexistent, or belongs to another resource

#### Scenario: Operational logs require observe scope

- **WHEN** a read-scoped PAT without observe scope calls `list_recent_calls`
- **THEN** the tool is absent from discovery and a direct call is denied without returning log metadata

### Requirement: Platform tool authoring exposes typed bindings

Platform MCP SHALL describe tool authoring with discriminated literal, server-value, and agent-input bindings, stable definition-local ids, an agent-input registry, and typed body variants. Responses SHALL return the canonical stored request definition and location-aware compile issues so an AI agent can repair a draft without parsing legacy placeholder strings or English error messages.

#### Scenario: Agent repairs a binding by issue path

- **WHEN** preview reports an unresolved agent-input id at a query entry id
- **THEN** the response identifies both ids and the agent can resubmit a corrected definition

#### Scenario: Typed response omits compatibility projection

- **WHEN** Platform MCP creates a valid typed tool
- **THEN** its result presents the canonical request definition and does not ask the agent to reason about generated legacy templates

### Requirement: Platform tools expose complete agent contracts

Every Platform MCP tool SHALL be registered from a centralized contract containing a stable name, human-facing title, outcome-oriented description, closed input schema with descriptions for every property, explicit output schema, behavior annotations, and namespaced contract version/fingerprint metadata. Scope filtering SHALL remove unauthorized tools and properties; it SHALL NOT represent undisclosed state as false or null. Contract ordering and fingerprints SHALL be deterministic.

#### Scenario: Read tool is fully described

- **WHEN** a read-scoped token lists `list_servers`
- **THEN** the tool has title, purpose, described pagination inputs, paginated output schema, read-only/non-destructive annotations, and contract metadata

#### Scenario: Destructive tool advertises risk

- **WHEN** a destructive-scoped token lists `delete_server`
- **THEN** the tool describes the confirmation requirement and has destructive, non-read-only annotations while server-side confirmation remains mandatory

#### Scenario: Unauthorized property is omitted

- **WHEN** a read token lacks secret-reference scope
- **THEN** result schemas and data omit secret-existence properties rather than returning a misleading false or null value

#### Scenario: Unchanged Platform contract is stable

- **WHEN** the same scoped token lists tools repeatedly without a deployment or scope change
- **THEN** tool order, normalized contracts, and fingerprints are identical

### Requirement: Platform tool outcomes use the structured contract

Every completed Platform MCP tool call SHALL return MCP `content` text and `structuredContent` matching its advertised output schema and representing the same safe outcome. Successes SHALL use the shared base envelope with explicitly typed data. Failures SHALL use the shared structured error object with category, stable code, safe message, retryability, optional retry delay, and location-aware issues, without superseded flat error fields. Scope, authorization, destructive confirmation, validation, rate-limit, and internal failures SHALL NOT fall back to an unrelated text-only shape.

#### Scenario: Validation error is repairable

- **WHEN** an agent calls `create_server` with an invalid base URL
- **THEN** the result has `isError: true`, category `invalid_arguments`, a non-retryable flag, and an issue identifying `baseUrl`

#### Scenario: Scope denial does not reveal resource existence

- **WHEN** a token without secret-reference scope submits a secret id
- **THEN** the result uses category `policy`, identifies the missing scope, and omits whether the secret exists

#### Scenario: Rate limit tells the agent when to retry

- **WHEN** a Platform tool exceeds its token budget
- **THEN** the result has category `rate_limit`, `retryable: true`, and the available retry delay

#### Scenario: Successful pagination is typed

- **WHEN** `list_servers` succeeds
- **THEN** `structuredContent.data` matches the advertised pagination schema and MCP text represents the same safe envelope

#### Scenario: Internal error remains schema-valid

- **WHEN** an unexpected exception occurs inside a Platform operation
- **THEN** the result is a redacted internal-error envelope that validates against the advertised output schema

### Requirement: Platform mutations share Studio write semantics

The system SHALL route Platform MCP mutations through the same atomic, revision-aware service commands used by the first-party Studio and SHALL not maintain a weaker agent-specific write path.

#### Scenario: Agent mutation commits completely

- **WHEN** an authorized Platform MCP command supplies the current server revision and valid input
- **THEN** all related configuration, compilation, lifecycle, and revision writes commit together
- **AND** the structured result includes the new revision without secret values

#### Scenario: Agent retry after an unknown outcome is safe

- **WHEN** an agent retries a server-scoped mutation with the same previously observed revision after losing the first response
- **THEN** the retry cannot create a duplicate or overwrite a committed result
- **AND** a revision conflict directs the agent to reread the aggregate before taking further action

#### Scenario: Concurrent browser and agent edits conflict explicitly

- **WHEN** a Studio user and Platform agent mutate the same server from one observed revision
- **THEN** at most one command commits from that revision
- **AND** the losing command receives `MCP_WRITE_CONFLICT` with no partial state or secret material

### Requirement: Platform token replacement is atomic

The system SHALL support multiple active named Platform PATs and SHALL rotate only an explicitly selected active PAT. Rotation SHALL insert the successor and its immutable scopes/resource grants, record safe security metadata, and revoke the predecessor in one transaction. If any step fails, the predecessor SHALL remain active and no successor SHALL be usable. Creating a separate PAT SHALL NOT revoke unrelated PATs, and revocation SHALL target one PAT id.

#### Scenario: Independent PAT creation preserves existing agents

- **WHEN** an owner creates a new PAT below the active-token limit
- **THEN** existing active PATs remain unchanged and the new raw PAT is shown once

#### Scenario: Rotation succeeds as one unit

- **WHEN** an owner rotates one active PAT with valid grants
- **THEN** exactly one successor becomes active, the selected predecessor is revoked, and unrelated PATs remain active

#### Scenario: Rotation insert or grant creation fails

- **WHEN** successor creation, scope insertion, server-grant insertion, or security-event persistence fails
- **THEN** the predecessor remains active and no partial successor or grants remain

#### Scenario: Concurrent rotation has one winner

- **WHEN** two requests attempt to rotate the same active PAT
- **THEN** at most one successor commits and the other returns a stable conflict without revoking the winner

#### Scenario: Individual revocation is immediate

- **WHEN** an owner revokes one PAT
- **THEN** subsequent requests using it fail authentication while other active PATs continue working

#### Scenario: Token failure returns no recoverable plaintext

- **WHEN** token creation or replacement rolls back or its response is lost
- **THEN** no plaintext token is stored in a command receipt, log, error, or telemetry event
- **AND** the caller must inspect token metadata and explicitly revoke or create again

### Requirement: Platform conflicts are recoverable agent outcomes

The system SHALL expose write conflicts and transient fully rolled-back database failures as stable structured Platform MCP outcomes that distinguish reread-required conflicts from retryable infrastructure failures.

#### Scenario: Stale revision requires reread

- **WHEN** a Platform mutation uses a stale revision
- **THEN** the outcome identifies the conflict code, current revision, and affected server
- **AND** it does not instruct the agent to repeat the same mutation blindly

#### Scenario: Fully rolled-back transient failure is retryable

- **WHEN** a transient database failure is known to have rolled back the entire command and automatic retries are exhausted
- **THEN** the outcome marks the failure as retryable
- **AND** it contains no partial-success claim or secret-bearing diagnostic

### Requirement: Platform PAT scopes are least-privilege and fail-closed

The system SHALL support the canonical scopes `read`, `observe`, `author`, `publish`, `invoke`, `invoke_mutation`, `secret_reference`, and `destructive`. Every PAT SHALL include `read`; `publish` SHALL require `author`; `invoke_mutation` SHALL require `invoke`; and every other non-read scope SHALL require `read`. Unknown scopes, duplicate scope rows, missing dependencies, or conflicting persisted grants SHALL invalidate the entire PAT. The default preset SHALL grant only `read`.

#### Scenario: Default creation is read-only

- **WHEN** an owner creates a PAT without choosing a broader preset or custom scopes
- **THEN** the token receives only read scope and no invocation, authoring, log, secret-reference, publishing, or destructive authority

#### Scenario: Invalid dependency is rejected at issuance

- **WHEN** token creation requests publish without author or invoke-mutation without invoke
- **THEN** creation fails with a stable validation error and no token row or grant is written

#### Scenario: Invalid persisted scope fails authentication

- **WHEN** a stored current-policy PAT has an unknown, duplicate, or dependency-invalid scope set
- **THEN** authentication rejects the PAT as invalid instead of ignoring or broadening the malformed grant

#### Scenario: Direct call is checked independently of discovery

- **WHEN** a client directly calls a tool absent from its authorized `tools/list`
- **THEN** the static policy is enforced again and the handler or service mutation does not run

### Requirement: Platform PATs have immutable resource boundaries

Each Platform PAT SHALL be either account-wide or restricted to a non-empty immutable set of owned server ids. Selected-server grants SHALL be enforced in list queries, resource reads, mutations, invocation, and destructive operations. Scope or resource changes SHALL require rotation rather than in-place mutation.

#### Scenario: Selected list is filtered at query time

- **WHEN** a selected-server PAT lists servers
- **THEN** the database query returns only currently owned granted servers and pagination totals use the same grant predicate

#### Scenario: Deleted selected server does not broaden access

- **WHEN** a granted server is deleted and its grant row cascades
- **THEN** the PAT retains only its remaining explicit grants and never falls back to account-wide access

#### Scenario: Grant edit requires rotation

- **WHEN** an owner changes a PAT's scopes or selected servers
- **THEN** the system creates an explicitly rotated successor rather than mutating the active principal in place

### Requirement: High-risk PAT issuance requires recent step-up

The system SHALL classify publish, invoke-mutation, secret-reference, destructive, and account-wide grants as high-risk. Creating or rotating a PAT with any high-risk property SHALL consume a short-lived, single-use step-up grant bound to the authenticated owner session and the exact requested grant fingerprint. High-risk PAT lifetime SHALL be capped at 30 days; other PATs SHALL be capped at 90 days.

#### Scenario: Missing step-up blocks high-risk PAT

- **WHEN** an authenticated owner requests a high-risk PAT without a valid matching step-up grant
- **THEN** issuance fails and no credential or authorization row is created

#### Scenario: Step-up cannot be replayed for broader access

- **WHEN** a step-up grant was approved for one scope/resource fingerprint
- **THEN** it cannot authorize a different grant, another session, or a second token issuance

#### Scenario: High-risk lifetime is capped

- **WHEN** a high-risk PAT request asks for more than 30 days
- **THEN** validation rejects the request rather than silently extending or truncating the requested authority

### Requirement: Platform HTTP authorization is ordered and bounded

The Platform MCP boundary SHALL validate the Bearer principal and acquire control-plane capacity before reading a non-empty request body. It SHALL apply per-token budgets to read, write, and invocation traffic, release all concurrency slots on every completion path, and return public required scope names in standards-aligned insufficient-scope challenges without exposing resource existence.

#### Scenario: Invalid token body is not consumed

- **WHEN** a request carries an invalid PAT and a streaming body
- **THEN** the endpoint returns HTTP 401 without consuming the MCP payload or constructing a Platform MCP server

#### Scenario: Control-plane write rate is exceeded

- **WHEN** an authenticated PAT exhausts its write budget
- **THEN** the operation returns a retryable rate-limit outcome with bounded retry metadata and performs no service write

#### Scenario: Static scope denial uses Bearer challenge

- **WHEN** an authenticated PAT directly calls a known tool without its static required scope
- **THEN** the endpoint returns HTTP 403 with `error="insufficient_scope"` and required public scopes
- **AND** it does not look up the referenced server or resource
