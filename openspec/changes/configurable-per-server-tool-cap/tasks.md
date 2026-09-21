## 1. Shared limits in `@repo/core`

- [x] 1.1 Add `packages/core/src/mcp-limits.ts` with `MCP_MAX_TOOLS_PER_SERVER_DEFAULT` (50) and `MCP_MAX_TOOLS_PER_SERVER_BOUNDS` (`min: 1`, `max: 500`)
- [x] 1.2 Export both from `packages/core/index.ts`
- [x] 1.3 Cover the default-inside-bounds invariant in `packages/core/src/mcp-limits.test.ts`

## 2. API configuration

- [x] 2.1 Split the environment schema into `apps/api/lib/env-schema.ts` (Bun-free) and keep `apps/api/lib/env.ts` as the `Bun.env` accessor, so configuration modules load under the Node test runner
- [x] 2.2 Add optional `MCP_MAX_TOOLS_PER_SERVER` to the schema with the shared default and bounds; a blank assignment falls back to the default
- [x] 2.3 Add `apps/api/lib/mcp-limits.ts` exposing the effective cap
- [x] 2.4 Remove `MCP_MAX_TOOLS_PER_SERVER` from `apps/api/lib/mcp-redact.ts`
- [x] 2.5 Cover default, blank, in-range, and out-of-range values in `apps/api/lib/env-schema.test.ts`, and the resolved cap in `apps/api/lib/mcp-limits.test.ts`
- [x] 2.6 Document the environment contract in `apps/api/AGENTS.md`

## 3. API enforcement

- [x] 3.1 `assertToolCapacity` reads the configured cap (covers create, duplicate, and curl import)
- [x] 3.2 The settings recompilation guard on enabled tools reads the configured cap
- [x] 3.3 OpenAPI import capacity projection and confirmation read the configured cap
- [x] 3.4 `getServer` returns `limits.maxToolsPerServer`

## 4. Studio UI

- [x] 4.1 `ServerToolsTab` takes `toolLimit` and uses it for `atCap` instead of a local constant
- [x] 4.2 The server detail route passes `data.limits.maxToolsPerServer`
- [x] 4.3 Remove `MCP_MAX_TOOLS` from `apps/app/lib/mcp-limits.ts`
- [x] 4.4 `servers.toolCap` copy takes a `{limit}` placeholder in `en` and `es`
- [x] 4.5 Studio tests cover the configured cap in the alert and above the old fixed value

## 5. Documentation and configuration surface

- [x] 5.1 Document `MCP_MAX_TOOLS_PER_SERVER` in `.env.example` with its default and accepted range
- [x] 5.2 Record the change in `openspec/changes/configurable-per-server-tool-cap/`
- [x] 5.3 Retarget the `scripts/rename.test.ts` product-name canary to `env-schema.ts`, where the `APP_NAME` default now lives

## 6. Verification

- [x] 6.1 `bun typecheck`
- [x] 6.2 `bun lint`
- [x] 6.3 `bun test` (1769 tests across all projects)
- [x] 6.4 Database-backed tool-cap suites re-run with `MCP_MAX_TOOLS_PER_SERVER=6` to confirm enforcement follows configuration
- [x] 6.5 `bunx prettier --write .`
- [x] 6.6 Re-verify the full suite at caps 1, 2, 3 and 500 (every accepted configuration is green)

## 7. Quality gate follow-ups

- [x] 7.1 Enforce the cap on publication in `runPublishTransaction` (the spec claimed it; nothing checked it)
- [x] 7.2 Report both the tool count and the limit in the at-cap Studio alert (the limit alone misstated the count)
- [x] 7.3 Gate the Duplicate row action on `atCap`, like the other creation actions
- [x] 7.4 Add enforcement tests that stub a non-default cap (studio settings bound, curl import capacity, OpenAPI import confirmation, publication)
- [x] 7.5 Guard capacity-dependent tests with `it.skipIf` so a small configured cap skips rather than fails
- [x] 7.6 Cover `BOUNDS.min`, whitespace-only input, and en/es placeholder parity
