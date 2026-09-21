# Research: external runtime APIs and pinned versions

Recorded 2026-09-21 from official sources (npm registry, vendor docs, models.dev data API, live endpoint probes). Drives the pinned dependency set and adapter design.

## Pinned dependency set (apps/api)

| Package                     | Version    | Role                                                                               |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `@mastra/core`              | `^1.67.0`  | Agent orchestration + structured output. Peer dep: zod `^3.25                      |     | ^4`. Internally accepts AI SDK provider v5/v6/v7 model instances (`@ai-sdk/provider-v5/6/7` aliases). |
| `ai`                        | `^7.0.107` | AI SDK core (`LanguageModel` types, `generateText` if ever needed outside Mastra). |
| `@ai-sdk/openai`            | `^4.0.71`  | OpenAI direct provider factory (`createOpenAI().responses/chat`). Peer zod 4 OK.   |
| `@ai-sdk/anthropic`         | `^4.0.58`  | Anthropic Messages factory (`createAnthropic({ baseURL })` appends `/messages`).   |
| `@ai-sdk/xai`               | `^5.0.4`   | xAI direct provider factory.                                                       |
| `@ai-sdk/openai-compatible` | `^3.0.53`  | OpenAI-compatible Chat Completions client for Meta / OpenRouter / OpenCode.        |

Zod stays at the workspace `^4.6.1` (all above accept `^3.25.76 || ^4.1.8`). Bun 1.3.14 runtime — all packages are plain JS/TS with no native bindings.

## Mastra runtime facts (docs.mastra.ai, reference/agents/generate)

- `agent.generate(messages, options)`; structured output: `options.structuredOutput: { schema }` (zod or JSON Schema); `options.output` is deprecated.
- Result: `result.object` (schema-validated), `result.finishReason`, `result.usage`, `result.text`.
- Bounds: `options.maxSteps`, `options.modelSettings.maxOutputTokens`, `options.abortSignal`, `options.modelSettings.timeout: { totalMs, stepMs, firstChunkMs }` (fails with Mastra timeout error).
- Agent works without a registered `Mastra` instance (no storage/memory/telemetry) — suitable for short-lived, request-scoped agents.
- Model per agent: docs feature the `"provider/model"` router string (env-coupled — NOT used here). Raw AI SDK `LanguageModel` instances are the supported alternative per `@mastra/core` types (verify against installed `.d.ts` after install); the runtime factory constructs `new Agent({ ..., model: <instance> })` per execution so credentials never enter `process.env` or Mastra model-router config.

## Provider registry facts (fixed HTTPS origins)

| Provider kind  | Base URL                        | Auth header                                                                                                                         | Discovery                                                 | Verification (connect/rotate)                                                                                                                                                                                                                                                                       | Protocol                                                               |
| -------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `openai`       | `https://api.openai.com/v1`     | `Authorization: Bearer`                                                                                                             | `GET /models` (auth)                                      | `GET /models` 401 on bad key                                                                                                                                                                                                                                                                        | Responses (default) / Chat                                             |
| `anthropic`    | `https://api.anthropic.com/v1`  | `x-api-key` + `anthropic-version`                                                                                                   | `GET /models` (auth)                                      | `GET /models`                                                                                                                                                                                                                                                                                       | Anthropic Messages                                                     |
| `xai`          | `https://api.x.ai/v1`           | `Authorization: Bearer`                                                                                                             | `GET /models` (auth; probe confirmed 401 unauthenticated) | `GET /models`                                                                                                                                                                                                                                                                                       | Chat Completions                                                       |
| `meta`         | `https://api.meta.ai/v1`        | `Authorization: Bearer`                                                                                                             | `GET /models` (auth; probe confirmed 401 unauthenticated) | `GET /models`                                                                                                                                                                                                                                                                                       | Chat Completions (OpenAI-compatible, models.dev `npm: @ai-sdk/openai`) |
| `openrouter`   | `https://openrouter.ai/api/v1`  | `Authorization: Bearer`                                                                                                             | `GET /models` (public, key optional)                      | `GET /auth/key` (free key metadata; 401 on bad key)                                                                                                                                                                                                                                                 | Chat Completions for all models                                        |
| `opencode_zen` | `https://opencode.ai/zen/v1`    | `Authorization: Bearer` on Chat/Responses; `x-api-key` + `anthropic-version` on Messages                                            | `GET /models` (public)                                    | No key-info endpoint. One minimal completion on the first catalog model whose Models.dev npm resolves: `@ai-sdk/openai` → `POST /responses`, `@ai-sdk/openai-compatible` → `POST /chat/completions`, `@ai-sdk/anthropic` → `POST /messages`. Provider-level `npm` fills models that omit their own. | Per model, from that npm.                                              |
| `opencode_go`  | `https://opencode.ai/zen/go/v1` | same as zen, plus required `x-opencode-session` on inference (a missing header is HTTP 400 `MissingSessionID`, not an auth failure) | `GET /models` (public)                                    | same as zen, and every inference request includes a fresh `x-opencode-session`                                                                                                                                                                                                                      | same as zen                                                            |

Gateways expose public catalogs, so the credential is always sent on catalog calls and verified with the dedicated authenticated call listed above; the UI copy discloses that connecting may send a minimal verification request.

## Route resolution for gateways (metadata-driven, fail-closed)

`https://models.dev/api.json` (public, documented data API) provides per-model enrichment: `name`, `modalities.input/output`, `limit.context/output`, `cost`, `tool_call`, `structured_output`, and — for OpenCode Zen/Go — `provider.npm`:

- `provider.npm === "@ai-sdk/anthropic"` → Anthropic Messages at `<base>/messages` (`createAnthropic({ baseURL: base })` appends `/messages`). Auth is `x-api-key`, not Bearer.
- `provider.npm === "@ai-sdk/openai-compatible"` → Chat Completions (`/chat/completions`). This is also the provider-level default npm on both OpenCode gateways, so models that omit a per-model npm inherit it.
- `provider.npm === "@ai-sdk/openai"` → OpenAI Responses (`/responses`). The vendor tables pair this package with that endpoint; it is not Chat Completions.
- `provider.npm === "@ai-sdk/google"` or absent after applying the provider default → route unresolvable → model excluded, never guessed.
- OpenCode Go inference (verification probe and runtime) must send `x-opencode-session`. Without it the gateway returns HTTP 400 `MissingSessionID`.
- OpenRouter route is fixed by the gateway itself (Chat Completions), independent of per-model metadata.

models.dev never adds models: it only enriches/annotates entries already returned by the provider catalog response.

## Envelope + env

- `AI_CREDENTIAL_SECRET` (`min(32)`) joins `MCP_CREDENTIAL_SECRET` in `apps/api/lib/env-schema.ts`; AES-256-GCM envelope with version field, random 12-byte IV, AAD = `{ version, userId, connectionId, providerKind }` (distinct from `lib/mcp-crypto.ts` which has no AAD and hashes the secret directly).
- Env modules must stay importable under Node/Vitest: no top-level `Bun.env` (pattern: `typeof Bun === "undefined" ? process.env : Bun.env`).
