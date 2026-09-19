## Why

Studio currently persists editable configuration and the gateway's executable `compiledPlan` in the same mutable rows, so saving a tool, authentication change, common value, or base URL can immediately alter a live agent contract. Owners need a deliberate publish boundary that lets them prepare and validate a complete server change without exposing partial or unreviewed behavior to connected agents.

## What Changes

- Introduce immutable, monotonically numbered server publish revisions containing the complete executable server configuration, tool contracts, compiled plans, and non-secret config snapshot.
- Keep existing server/tool/value rows as the mutable draft; ordinary Studio and Platform authoring changes only the draft and marks it dirty.
- Add publish preview with readiness validation, secret-safe diff, warnings, exact agent-contract fingerprints, and optimistic draft/published revision checks.
- Atomically create a revision and switch the server's published pointer only when every enabled tool and dependency is valid; failed publication leaves both draft and runtime unchanged.
- Make the gateway, product execution, connection metadata, and contract discovery read only the active published revision. One invocation remains pinned to the revision it loaded even if another revision publishes concurrently.
- Separate versioned configuration from operational controls: pause/resume, token revocation, and secret-material rotation remain immediate; structural authentication changes and non-secret config edits require publication.
- Add paginated revision history, safe change summaries, actor/source metadata, and “restore to draft” rather than moving the runtime pointer backward.
- Record published revision identity on call logs and calculate runtime health from the active revision while allowing explicit draft testing in Studio.
- **BREAKING**: after the clean cutover, saving an edit no longer changes agent behavior until the owner publishes. Existing development servers have no active revision and must be explicitly reviewed/published or recreated from seeds; no mutable-row runtime fallback or automatic backfill is retained.

Non-goals: branching or merging drafts, per-tool independent publication, storing historical plaintext/ciphertext secrets, automatic publication, multi-user approval workflows, or direct rollback that bypasses validation.

## Capabilities

### New Capabilities

- `mcp-publishing`: Draft lifecycle, publish readiness, immutable aggregate revisions, safe history/diff, retention, and restore-to-draft behavior.

### Modified Capabilities

- `mcp-studio`: Distinguish saving drafts, publishing runtime changes, pausing, and testing draft versus published behavior.
- `mcp-templates`: Snapshot non-secret configuration while keeping secret material in immediate operational slots with explicit deletion safety.
- `mcp-gateway`: Advertise and execute exactly one active published revision rather than mutable authoring rows.
- `platform-mcp`: Expose revision-aware preview, publish, history, and restore commands aligned with author/publish scopes.
- `mcp-observability`: Attribute calls and health to published revisions and isolate draft-playground results from production health.

## Impact

- New Drizzle revision/tool/config snapshot tables, server published pointer, call-log revision identity, clean generated migration, development reset/reseed guidance, and retention cleanup.
- Studio services, compiler orchestration, gateway/executor snapshot loading, tRPC/Platform command schemas, stable error codes, and telemetry.
- SPA server detail, navigation status, publish review/diff/history UI, playground mode, and en/es copy.
- This builds on `make-studio-writes-atomic` for draft concurrency and on `improve-agent-tool-contracts` for deterministic fingerprints; `secure-platform-mcp-and-token-scopes` supplies the author/publish permission split.
