/**
 * Server-only typed registry of AI provider adapters. Provider identities,
 * fixed HTTPS origins, and protocol behavior live here in code — never in
 * database rows or browser input. The registry hands request-scoped adapter
 * access to services; unknown provider kinds resolve to undefined.
 */
import type { AiProviderKind } from "@repo/core";
import type { AiProviderAdapter } from "./provider-adapter.js";
import { openAiAdapter } from "./adapters/openai.js";
import { anthropicAdapter } from "./adapters/anthropic.js";
import { xaiAdapter } from "./adapters/xai.js";
import { metaAdapter } from "./adapters/meta.js";
import { openRouterAdapter } from "./adapters/openrouter.js";
import { opencodeZenAdapter } from "./adapters/opencode-zen.js";
import { opencodeGoAdapter } from "./adapters/opencode-go.js";

const AI_PROVIDER_ADAPTERS: Readonly<
  Record<AiProviderKind, AiProviderAdapter | undefined>
> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
  xai: xaiAdapter,
  meta: metaAdapter,
  openrouter: openRouterAdapter,
  opencode_zen: opencodeZenAdapter,
  opencode_go: opencodeGoAdapter,
};

export function getAiProviderAdapter(
  providerKind: AiProviderKind,
): AiProviderAdapter | undefined {
  return AI_PROVIDER_ADAPTERS[providerKind];
}
