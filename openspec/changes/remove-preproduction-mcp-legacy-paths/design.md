## Context

The MCP slice currently contains two authoring models. The canonical model uses versioned typed request definitions, stable binding ids, ordered common entries, explicit authentication configuration, typed server values, and compiled plans. The older model remains present through `pathTemplate`, `requestTemplate`, `params`, `defaultHeaders`, `defaultQuery`, `isSecret`, nullable metadata, compatibility projections, conversion drafts, and runtime fallback compilation.

Those paths cross the Drizzle schema, domain commands, Studio service, executor, auth helpers, platform tools, SPA forms, telemetry, error codes, scripts, tests, and localization. They are not an external compatibility commitment: the application is `PRE_PRODUCTION`, development records are disposable, and the canonical typed model is already the intended product contract.

Current flow:

```text
typed input ─┬─> typed persistence ───────────────┬─> compiled execution
             └─> legacy projection/dual write ───┤
legacy input ──> inference/conversion/backfill ───┤
legacy row ────> runtime fallback compilation ────┘
```

Target flow:

```text
strict typed input
       │
       ▼
canonical aggregate transaction
       │
       ├─> requestDefinition + compiledPlan
       ├─> commonEntries + authConfiguration
       └─> typed server values (stable ids)
                       │
                       ▼
              fail-closed execution
```

## Goals / Non-Goals

**Goals:**

- Establish one typed authoring and persistence contract from Studio and Platform inputs through execution.
- Physically remove superseded columns, procedures, adapters, fallback readers, converters, and their supporting surface area.
- Make invalid or structurally incomplete tools unavailable instead of trying to infer intent at read or execution time.
- Keep secret handling, ownership, curl isolation, SSRF controls, validation, and atomic write guarantees intact.
- Leave the codebase ready for the active agent-contract, token-scope, and publish-revision changes without legacy branches.

**Non-Goals:**

- Preserve or transform development-only MCP rows.
- Rewrite existing shared Drizzle migration files or consolidate migration history.
- Change the external MCP transport protocol or upstream REST semantics.
- Implement icon cleanup, normalized PAT scopes, richer agent contracts, or revision publishing owned by other active changes.

## Decisions

### 1. Canonical typed state is the only persistence model

`mcp_server` keeps typed `commonEntries` and `authConfiguration`; `mcp_tool` keeps `requestDefinition`, its canonical compiled artifact/status, and ordinary tool metadata; server values keep non-null `kind` and `owner` plus storage appropriate to the kind. The obsolete default maps, template/param projections, `isSecret`, and legacy compile status are removed.

This is preferred over retaining dormant columns because dormant state still invites accidental reads, writes, test fixtures, and ambiguous ownership. Database constraints and service invariants SHALL encode the target model rather than documenting a preferred branch.

### 2. All authoring boundaries are strict and canonical

Studio tRPC and Platform MCP commands share the typed schemas and reject unknown fields. Legacy create/update/preview procedures and command schemas are removed instead of returning deprecation responses. Reads return canonical definitions only.

This is preferred over compatibility aliases because there are no deployed clients to protect. It also prevents copied curl data from mutating authentication, secrets, server values, or common entries: curl remains an isolated endpoint-draft input whose credentials are removed and reported.

### 3. Authentication is explicit configuration, never inferred defaults

Auth helpers create or rotate auth-owned secret server values and persist an explicit `authConfiguration` that references their stable ids and protected request keys. They do not synthesize `defaultHeaders`/`defaultQuery`, inspect placeholder strings, or adopt manual values by name.

This preserves the user-facing term **Secrets** for confidential values while using **Server values** as the umbrella domain term for both `config` and `secret`. Ownership (`manual` or `auth`) remains separate from secrecy.

### 4. Studio renders persisted origins without conversion

The SPA loads typed nodes and binding ids directly. Edit, duplicate, reference checks, previews, and display summaries operate on that graph. The conversion-draft UI, name-based placeholder inference, legacy path fields, and legacy-only localization are deleted. Human-readable path previews are derived for display and are never stored as an authoring source.

This is preferred over a one-time conversion screen because disposable development records do not justify permanent product complexity.

### 5. Execution fails closed on missing canonical artifacts

The executor, connectivity probe, playground, gateway, and Platform test path use only canonical typed state. An enabled tool without a valid definition and execution artifact is unavailable and produces a stable, sanitized configuration error on owner-only surfaces; it is never advertised and never contacts upstream. No runtime analyzer, placeholder renderer, or fallback compiler remains.

The publish-revision change may relocate the execution artifact into an immutable revision, but it SHALL preserve this no-fallback invariant.

### 6. Migration is intentionally destructive to development data

Drizzle schema changes generate a new migration; existing migration files remain unchanged. Before applying it, developers reset/reseed local MCP data or databases as required. The final schema uses non-null/default constraints where canonical state is structurally required. There is no runtime backfill command, startup migration, dual-read period, or rollback adapter.

Rollback is source-and-database restoration to the pre-change development snapshot, not forward compatibility. If a developer needs existing test fixtures, they recreate them through canonical APIs after migration.

### 7. Active changes have explicit ownership boundaries

`make-studio-writes-atomic` owns aggregate transaction and concurrency semantics and should land first. This cleanup then removes obsolete branches from those atomic paths. `improve-agent-tool-contracts`, `secure-platform-mcp-and-token-scopes`, and `add-server-publish-revisions` build on the canonical-only model and retain ownership of their respective agent schema, PAT, and publication requirements.

The preferred integration order is:

```text
make-studio-writes-atomic
          │
          ▼
remove-preproduction-mcp-legacy-paths
          │
          ├─> improve-agent-tool-contracts
          ├─> secure-platform-mcp-and-token-scopes
          └─> add-server-publish-revisions
```

## Risks / Trade-offs

- **[Development data loss]** Existing legacy-only records cannot be opened after migration. → Require an explicit reset/reseed note, verify canonical seed fixtures, and do not imply preservation.
- **[Cross-change conflicts]** Active changes touch several of the same services and specs. → Use the ownership boundaries and integration order above; rebase each implementation and re-run strict OpenSpec validation before apply.
- **[Accidental removal of security behavior]** Legacy helpers sometimes sit next to redaction or auth logic. → Characterize canonical secret, ownership, curl isolation, SSRF, and atomicity behavior before deletion and keep focused regression tests.
- **[Hidden fallback caller]** A script, test factory, or UI helper may still construct old shapes. → Use repository-wide symbol and persisted-field searches, then make strict schemas and type errors expose remaining callers.
- **[Migration fails on populated local databases]** New constraints can reject old rows. → Document and verify the destructive reset path before migration; do not weaken constraints to preserve disposable data.
- **[Human-readable previews regress]** Removing `pathTemplate` removes an easy display string. → Derive sanitized summaries from typed path segments without making them writable state.

## Migration Plan

1. Confirm the atomic-write change is integrated, inspect the other active changes for overlapping edits, and record the exact symbols/columns they own.
2. Add canonical-state characterization tests for secrets, curl isolation, strict typed authoring, compilation, reference checks, and fail-closed execution.
3. Remove legacy API procedures and frontend conversion/inference flows so all compile-time callers use typed commands.
4. Refactor auth, common-entry, Studio, Platform, and executor services to canonical-only reads and writes; delete fallback modules once no callers remain.
5. Update Drizzle definitions, generate the destructive migration, and verify both a clean database migration and the documented local reset/reseed path.
6. Remove obsolete errors, telemetry, translations, scripts, fixtures, tests, and documentation; run repository-wide residue searches.
7. Run typecheck, lint, focused and full tests, formatting, strict OpenSpec validation, and coordinate rebases for dependent active changes.

Rollback during development restores the prior source revision and a matching database snapshot or recreates the database from the prior migration state. No application-level downgrade path is provided.

## Open Questions

None. The pre-production lifecycle policy resolves the only material product decision: obsolete internal compatibility is removed rather than migrated.
