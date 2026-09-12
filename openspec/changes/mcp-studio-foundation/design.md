## Context

The SPA today is an empty authenticated shell (settings + platform admin). Product accounts are single-user. tRPC is the SPA JSON RPC; Hono owns Better Auth, multipart, and other non-tRPC HTTP. `scripts/mcp.ts` is a stdio stub and MUST NOT become the product runtime.

Layer 1 is the studio loop: REST → tools → hosted MCP URL → agent. Recipes, OpenAPI, connectors, and vertical packs are later. Server/tool/credential rows MUST be snapshot-ready (no secrets in the template shape).

## Goals / Non-Goals

**Goals:**

- An owner can create a server, add tools (form or curl), store one encrypted upstream credential, and copy a hosted MCP URL plus agent token.
- An MCP client can call enabled tools over Streamable HTTP; the gateway proxies to the mapped REST endpoint.
- The owner can invoke a tool from the SPA (playground), see a traffic light, and read a paginated call log with secrets redacted.
- The owner's agent can perform the same build/test/connect loop via a platform MCP.
- Defaults prefer safety: host allowlist, no private-network targets, mutations off until explicitly allowed.

**Non-Goals:**

- Saving, sharing, or publishing recipes; OpenAPI import; on-prem tunnels; upstream OAuth; orgs; self-heal; meta-tool facade; multipart/file tools; GHL-specific operations.

## Decisions

### 1. Two MCP surfaces, one executor

| Surface         | URL                             | Auth                            | Audience                          |
| --------------- | ------------------------------- | ------------------------------- | --------------------------------- |
| Product gateway | `{API_ORIGIN}/mcp/{serverId}`   | Bearer **server** agent token   | Cursor, ChatGPT, Claude           |
| Platform MCP    | `{API_ORIGIN}/api/platform-mcp` | Bearer **platform** agent token | Owner's agent building the studio |

tRPC (`mcp` router, `protectedProcedure`) remains the SPA control plane. Both MCP surfaces and the playground call the same `executeMappedTool` service so behavior cannot drift.

**Alternative:** One MCP that mixes studio admin tools with product tools. Rejected: token scope would be too wide and clients would see the wrong catalog.

**Alternative:** Stdio / generated repo. Rejected: the product is hosted; `scripts/mcp.ts` stays a stub.

### 2. Streamable HTTP on Hono

Use `@modelcontextprotocol/sdk` with Streamable HTTP. Mount handlers on Hono (not tRPC). If the SDK transport is awkward on Bun, wrap it with a thin Hono adapter; do not invent a second RPC.

**Alternative:** SSE-only. Rejected: current clients (ChatGPT, Cursor, Claude) expect Streamable HTTP.

### 3. Data model (recipe-ready, secrets aside)

Singular tables, prefixed CUID2 ids (`generateId`): `mcs` server, `mct` tool, `mcr` credential, `mtk` token, `mcl` call log.

- `mcp_server`: `userId`, `name`, `slug` (unique per user), `description`, `baseUrl`, `allowedHosts` (json, default host of `baseUrl`), `status` (`draft` \| `live` \| `paused`).
- `mcp_tool`: `serverId`, `name` (unique per server, MCP-safe), `description`, `method`, `pathTemplate`, `paramMap` (json: path/query/header/body), `allowMutation` (default `false`), `enabled` (default `true` for GET/HEAD, `false` for other methods until `allowMutation` is true), `source` (`manual` \| `curl`).
- `mcp_credential`: one optional row per server. Recipe-ready: `scheme` (`bearer` \| `api_key` \| `header`), `headerName`, `valueLocation` (`header` \| `query`). Secret: `ciphertext` only. Reads return `hasSecret`, never the value.
- `mcp_agent_token`: `userId`, `serverId` nullable, `kind` (`server` \| `platform`), `name`, `tokenHash`, `prefix`, `expiresAt`, `revokedAt`, `lastUsedAt`. Store SHA-256 only; show the raw token once at creation.
- `mcp_call_log`: `serverId` nullable (null for platform), `toolId` nullable, `source` (`playground` \| `agent` \| `platform`), `status`, `httpStatus`, `durationMs`, `appCode`, redacted summaries, `createdAt`.

No `recipe` table. A future snapshot is `{ server, tools, credentialScheme }` minus ciphertext and tokens.

### 4. Credential encryption

Add required env `MCP_CREDENTIAL_SECRET` (min 32 chars). Encrypt with AES-256-GCM. Do not reuse `BETTER_AUTH_SECRET` so auth rotation does not brick credentials.

**Alternative:** Plaintext in Postgres. Rejected.

### 5. Curl import

Parse method, URL, headers, and body. If the server has `baseUrl`, the path is the remainder; otherwise set `baseUrl` from origin + first path segment policy: origin only, path on the tool. Authorization / api-key headers become a **credential suggestion** and MUST NOT be copied into `paramMap` headers.

### 6. SSRF and mutations

Before fetch: hostname MUST be in `allowedHosts`; resolve DNS and reject loopback, link-local, private, and metadata ranges; do not follow cross-host redirects.

`allowMutation` defaults false. GET/HEAD tools execute when enabled. POST/PUT/PATCH/DELETE require `allowMutation === true` and `enabled === true`. The gateway MUST reject a mismatched method (e.g. a GET tool rewritten to POST).

### 7. Traffic light

Derived, not stored: `paused` → paused; no enabled tools → draft; else last five product/playground calls: all failed → red; any failed → yellow; otherwise green (including “configured, never called”).

### 8. Platform token

Created from Settings (or first platform-MCP visit). One active platform token per user is enough; rotation revokes the previous hash. Platform tools: `list_servers`, `create_server`, `add_tool`, `add_tool_from_curl`, `set_credential`, `list_tools`, `test_tool`, `get_connection_snippet`, `list_recent_calls`. Same ownership and validation as tRPC.

### 9. SPA

Routes: `/(app)/servers/`, `/(app)/servers/$serverId` (tools, credential, snippet, playground, logs). Nav item “Servers”. Dashboard links here with a truthful empty state. Lists use `@repo/core` pagination. Copy en/es.

### 10. Limits

Max 50 tools per server. Upstream timeout 15s. Log/response summaries capped (64 KiB stored, 256 KiB returned to the agent). Telemetry MUST NOT include secrets, tokens, or raw upstream bodies.

## Risks / Trade-offs

- **[SSRF / credential proxy]** → Allowlist + DNS checks + no secret echo in logs or MCP errors.
- **[Agent token leak]** → Hash at rest, show once, revoke; tokens are server-scoped (platform token is owner-scoped by design).
- **[SDK/Bun transport friction]** → Adapter isolated in `lib/mcp-http.ts`; executor stays SDK-agnostic.
- **[Official vendor MCP improves]** → We are a generic studio, not a clone of any catalog.
- **[Dual MCP for dogfood (e.g. GHL + our upload later)]** → Accepted; file tools stay a later change.
- **[Recipe fields unused]** → Small schema cost; avoids a rewrite when private recipes ship.

## Migration Plan

1. Add `MCP_CREDENTIAL_SECRET` to `.env.example` and `env.ts`.
2. `bun db:generate` / `bun db:migrate` for the five tables (one feature, one migration).
3. Deploy API then SPA. Empty studio is valid.
4. Rollback: drop the Hono mounts and SPA routes; keep tables if any servers exist (no destructive down in production without a backup). Local reset: drop DB volume per `db/AGENTS.md`.

## Open Questions

- Exact Streamable HTTP session semantics on Bun (stateless per request vs SDK session store). Spike in the first gateway task; prefer stateless if clients allow.
- Whether `allowedHosts` may include extra hosts beyond `baseUrl` in v1 (yes, explicit owner-added only).
