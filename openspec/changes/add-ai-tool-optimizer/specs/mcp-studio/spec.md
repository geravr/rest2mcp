## ADDED Requirements

### Requirement: Studio can request bounded AI optimization for draft tools

Studio SHALL let the owner request optimization for one tool, selected tools, or every eligible tool in the current server draft, subject to AI readiness, scope limits, eligibility, and explicit authorization.

#### Scenario: Optimize one tool

- **WHEN** the owner invokes optimization from an eligible tool row or editor
- **THEN** preflight contains only that tool and opens the authorization review before any model call

#### Scenario: Optimize selected tools

- **WHEN** the owner selects multiple eligible tool rows and invokes optimization
- **THEN** preflight preserves exactly those tool identities and reports any ineligible selection separately

#### Scenario: Optimize all eligible tools

- **WHEN** the owner invokes optimization for all tools in the server
- **THEN** preflight includes every currently eligible draft tool regardless of current pagination or search results and reports the full scope and estimate

#### Scenario: AI model is not ready

- **WHEN** `structured-text-v1` readiness is unavailable
- **THEN** optimization controls are disabled and provide a link to AI Settings

#### Scenario: Tool cannot be safely snapshotted

- **WHEN** a draft tool lacks a parseable supported canonical definition or exceeds sanitizer bounds
- **THEN** Studio marks it ineligible with a localized reason and does not send it to the model

#### Scenario: Authorization is declined

- **WHEN** the owner cancels the preflight authorization dialog
- **THEN** no model call occurs and the mutable draft remains unchanged

### Requirement: Studio presents progress and recommendations before applying

Studio SHALL expose durable run progress, cancellation, partial failures, per-tool comparison, advisory findings, and individual executable-operation selection before any draft mutation.

#### Scenario: Running scan is revisited

- **WHEN** the owner leaves and later returns while a run is queued or running
- **THEN** Studio reloads persisted progress and offers cancellation without relying on the original browser session

#### Scenario: Completed item has guarded changes

- **WHEN** a tool recommendation includes request-shaping operations
- **THEN** Studio labels them guarded and shows both field-level changes and the redacted effective-request difference

#### Scenario: Item has immutable-field concern

- **WHEN** analysis suspects a path, method, authentication, host, secret, enablement, mutation, or publication issue
- **THEN** Studio shows an advisory-only finding without an apply checkbox

#### Scenario: Partial run completes

- **WHEN** some tools fail analysis and others produce recommendations
- **THEN** Studio shows both groups and allows valid recommendations to be reviewed without hiding failures

#### Scenario: Owner applies selected operations

- **WHEN** the owner confirms a set of valid recommendation operation IDs against the observed draft revision
- **THEN** Studio applies them through one atomic draft command and refreshes tool, server, compile, and publication-readiness state

#### Scenario: Draft changed during review

- **WHEN** the server or any selected tool changed after authorization
- **THEN** Studio preserves the visible recommendations, reports a stale conflict, and requires a new optimization run rather than silently rebasing

#### Scenario: Successful application remains unpublished

- **WHEN** selected AI recommendations commit
- **THEN** Studio identifies them as saved draft changes and requires the normal publication review before agent-visible behavior changes
