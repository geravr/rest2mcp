/**
 * AI SDK model construction helpers shared by provider adapters. Every
 * factory receives an explicit request-scoped API key and the fixed base URL
 * from the provider registry; nothing reads process state.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { AiModelProtocol } from "@repo/core";
import type { AiConstructedModel } from "./provider-adapter.js";

export type AiModelFactoryInput = {
  apiKey: string;
  /** Fixed base URL from the adapter registry (origin plus path, if any). */
  baseURL: string;
  modelId: string;
  /** Extra request headers. Auth headers stay owned by each SDK factory. */
  headers?: Record<string, string>;
};

export function constructOpenAiModel(
  input: AiModelFactoryInput & { providerName?: string },
  protocol: Extract<
    AiModelProtocol,
    "openai-responses" | "openai-chat-completions"
  >,
): AiConstructedModel {
  const openai = createOpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    headers: input.headers,
    name: input.providerName,
  });
  return protocol === "openai-responses"
    ? openai.responses(input.modelId)
    : openai.chat(input.modelId);
}

export function constructOpenAiCompatibleChatModel(
  input: AiModelFactoryInput & { providerName: string },
): AiConstructedModel {
  const provider = createOpenAICompatible({
    name: input.providerName,
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    headers: input.headers,
  });
  return provider.chatModel(input.modelId);
}

export function constructAnthropicModel(
  input: AiModelFactoryInput,
): AiConstructedModel {
  const anthropic = createAnthropic({
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    headers: input.headers,
  });
  return anthropic.languageModel(input.modelId);
}

export function constructXaiModel(
  input: AiModelFactoryInput,
): AiConstructedModel {
  const xai = createXai({ apiKey: input.apiKey, baseURL: input.baseURL });
  return xai.languageModel(input.modelId);
}
