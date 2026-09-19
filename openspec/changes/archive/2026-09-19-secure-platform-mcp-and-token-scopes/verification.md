# Spec Coverage Map

Maps each `platform-mcp` and `mcp-observability` scenario in this change to the
automated coverage that protects it. Verified with `bun typecheck`, `bun lint`,
and `bun test:run` (1336+ tests, 106 files).

**Integration coverage requires `DATABASE_URL`.** Tests suffixed
`.integration.test.ts` use `describe.skip` when `DATABASE_URL` is absent, so a
CI run without a database reports them green while executing no assertions.
Run the suite with a migrated database to exercise lifecycle, isolation, and
end-to-end coverage.

## platform-mcp

| Requirement / Scenario                             | Coverage                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Read-only PAT connects                             | `lib/mcp-platform.test.ts`, `lib/mcp-platform-matrix.test.ts`, `services/mcp-platform-e2e.integration.test.ts` |
| Server token is rejected uniformly                 | `lib/mcp-platform.test.ts`, `services/mcp-platform-auth.test.ts`                                               |
| Expired or revoked PAT is rejected                 | `services/mcp-platform-auth.test.ts`, `services/mcp-platform-e2e.integration.test.ts`                          |
| Unknown policy or malformed grants are rejected    | `services/mcp-platform-auth.test.ts`, `lib/mcp-platform-principal.test.ts`, e2e unknown-policy case            |
| Chunked oversized body is bounded                  | `lib/mcp-platform.test.ts` (transport hardening)                                                               |
| Draft author cannot publish a tool                 | `lib/mcp-platform-policy.test.ts`                                                                              |
| Selected-server PAT cannot escape its grant        | `lib/mcp-platform-matrix.test.ts`                                                                              |
| Selected-server PAT cannot create a server         | `lib/mcp-platform-policy.test.ts`, `lib/mcp-platform-matrix.test.ts`                                           |
| Account-wide author creates only a draft           | `lib/mcp-platform-policy.test.ts`, e2e                                                                         |
| Validation matches tRPC                            | `lib/mcp-platform.test.ts` (invalid baseUrl/issues)                                                            |
| Curl with credential is rejected or sanitized      | `lib/mcp-platform.test.ts`, `lib/mcp-curl*.test.ts`, `lib/mcp-platform-nondisclosure.test.ts`                  |
| Destructive confirmation mismatch                  | `lib/mcp-platform.test.ts`, `lib/mcp-platform-policy.test.ts`                                                  |
| Read-only invoke is allowed                        | `lib/mcp-platform.test.ts`, e2e                                                                                |
| Invoke scope cannot execute a mutation             | `lib/mcp-platform-policy.test.ts`, e2e                                                                         |
| Mutating invoke preserves product policy           | `services/mcp-executor-service.test.ts`, `lib/mcp-platform-policy.test.ts`                                     |
| Destructive upstream tool requires confirmation    | `lib/mcp-platform-policy.test.ts`                                                                              |
| Read token cannot invoke                           | `lib/mcp-platform.test.ts`                                                                                     |
| Ordinary read does not expose authoring secret ids | `lib/mcp-platform-nondisclosure.test.ts`                                                                       |
| Authoring definition with secret is all-or-nothing | `lib/mcp-platform-nondisclosure.test.ts`                                                                       |
| Agent cannot create plaintext secret               | `lib/mcp-platform.test.ts` (`set_variable`)                                                                    |
| Existing secret reference is allowed by scope      | `lib/mcp-platform-nondisclosure.test.ts`                                                                       |
| Secret and nonexistent ids are indistinguishable   | `lib/mcp-platform-nondisclosure.test.ts`                                                                       |
| Operational logs require observe scope             | `lib/mcp-platform.test.ts`                                                                                     |
| Independent PAT creation preserves existing agents | `services/mcp-platform-token.integration.test.ts`                                                              |
| Rotation succeeds as one unit                      | `services/mcp-platform-token.integration.test.ts`, e2e                                                         |
| Rotation insert or grant creation fails            | `services/mcp-platform-token-service.test.ts`                                                                  |
| Concurrent rotation has one winner                 | `services/mcp-platform-token.integration.test.ts`                                                              |
| Individual revocation is immediate                 | `services/mcp-platform-token.integration.test.ts`, e2e                                                         |
| Default creation is read-only                      | `lib/mcp-platform-principal.test.ts`, integration                                                              |
| Invalid dependency is rejected at issuance         | `lib/mcp-platform-principal.test.ts`                                                                           |
| Invalid persisted scope fails authentication       | `services/mcp-platform-auth.test.ts`                                                                           |
| Direct call is checked independently of discovery  | `lib/mcp-platform-matrix.test.ts`                                                                              |
| Selected list is filtered at query time            | `lib/mcp-platform-matrix.test.ts`                                                                              |
| Deleted selected server does not broaden access    | `lib/mcp-platform-matrix.test.ts`, `lib/mcp-platform-schema.test.ts` (cascade)                                 |
| Grant edit requires rotation                       | `services/mcp-platform-token.integration.test.ts` (rotation lifecycle)                                         |
| Missing step-up blocks high-risk PAT               | `services/mcp-platform-token.integration.test.ts`, e2e                                                         |
| Step-up cannot be replayed for broader access      | `services/mcp-platform-token.integration.test.ts` (double consume)                                             |
| High-risk lifetime is capped                       | `lib/mcp-platform-principal.test.ts` (TTL/risk), SPA TTL test                                                  |
| Invalid token body is not consumed                 | `lib/mcp-platform.test.ts` (transport hardening)                                                               |
| Control-plane write rate is exceeded               | `lib/mcp-rate-limit.test.ts`                                                                                   |
| Static scope denial uses Bearer challenge          | `lib/mcp-platform.test.ts` (transport hardening)                                                               |

## mcp-observability

| Requirement / Scenario                            | Coverage                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple token inventory is clear                 | `apps/app/components/settings/platform-token-tab.test.tsx`, `apps/app/hooks/use-mcp-platform.test.ts`                                 |
| Security events are owner-only                    | `services/mcp-platform-security-event-service.test.ts` + integration; no Platform tool exposes it (`lib/mcp-platform-matrix.test.ts`) |
| Rotation relationship is visible                  | `apps/app/components/settings/platform-token-tab.test.tsx` (rotate flow), inventory projections                                       |
| Grant lifecycle event commits atomically          | `services/mcp-platform-token-service.test.ts` (rollback on event failure)                                                             |
| Runtime denial is audited without changing denial | `services/mcp-platform-security-event-service.test.ts` (best-effort)                                                                  |
| High-risk call event omits arguments              | `services/mcp-platform-security-event-service.test.ts` (sanitizer)                                                                    |
| Security events expire                            | `services/mcp-platform-security-event-service.test.ts` + integration (retention)                                                      |
