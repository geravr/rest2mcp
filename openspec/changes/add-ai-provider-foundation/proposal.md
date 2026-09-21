## Why

rest2mcp is expected to add agentic product workflows soon, but it has no account-scoped AI provider configuration, model discovery, compatibility qualification, or common runtime. Establishing this foundation now avoids coupling each AI feature to one vendor and allows users to bring credentials for fast, economical models or frontier models without application releases for every model change.

## What Changes

- Add account-scoped AI provider connections for OpenAI, Anthropic, xAI, Meta Model API, OpenRouter, OpenCode Zen, and OpenCode Go.
- Store provider credentials only as authenticated ciphertext backed by dedicated deployment key material; never return, log, or expose plaintext after submission.
- Add a user Settings experience to connect, verify, rotate, and remove a provider, then select a compatible model from a live provider catalog.
- Add normalized model discovery and feature-specific compatibility profiles instead of a hardcoded model allowlist.
- Treat direct providers as trusted integrations with a selected-model smoke test, while requiring stricter model-and-route verification for multiprovider gateways.
- Add Mastra as the shared orchestration and model-resolution layer, with credentials resolved from the database per execution rather than process environment mutation.
- Disable AI-dependent product controls when the account has no verified provider and compatible selected model, with server-side enforcement matching the UI.
- Add secret-safe diagnostics, bounded catalog caching, connection status, and verification metadata.
- Non-goals: tool auto-improvement, autonomous MCP writes, agent memory, RAG, arbitrary user-supplied provider URLs, billing aggregation, and model-quality benchmarking.

## Capabilities

### New Capabilities

- `ai-provider-management`: Account-scoped provider credential lifecycle, connection verification, Settings UI, and AI feature availability.
- `ai-model-runtime`: Live model discovery, compatibility qualification, selected-model persistence, and Mastra-backed runtime resolution.

### Modified Capabilities

None.

## Impact

- Adds Drizzle schemas and a generated migration for provider connections, encrypted credentials, selected models, and verification state.
- Adds authenticated tRPC APIs, service-layer provider adapters, dedicated AI credential encryption, and stable AI error codes.
- Adds Mastra and the minimum provider/runtime dependencies required for dynamic account credentials.
- Extends the SPA Settings route, hooks, components, and English/Spanish locale modules.
- Adds outbound calls to approved provider catalog and inference hosts; raw credentials, prompts, and provider responses remain excluded from telemetry.
