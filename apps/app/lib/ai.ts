import {
  AI_PROVIDER_KINDS,
  isAppErrorCode,
  type AiProviderKind,
  type AppErrorDetails,
} from "@repo/core";
import type { UI } from "@/i18n";

/**
 * Preferred display order for provider cards. Kinds added server-side later
 * are appended automatically so the UI never hides a supported provider.
 */
const AI_PROVIDER_DISPLAY_ORDER: readonly AiProviderKind[] = [
  AI_PROVIDER_KINDS.OPENAI,
  AI_PROVIDER_KINDS.ANTHROPIC,
  AI_PROVIDER_KINDS.XAI,
  AI_PROVIDER_KINDS.META,
  AI_PROVIDER_KINDS.OPENROUTER,
  AI_PROVIDER_KINDS.OPENCODE_ZEN,
  AI_PROVIDER_KINDS.OPENCODE_GO,
];

export function aiProviderKindsInOrder(): AiProviderKind[] {
  const ordered = new Set<AiProviderKind>(AI_PROVIDER_DISPLAY_ORDER);
  const appended = (
    Object.values(AI_PROVIDER_KINDS) as AiProviderKind[]
  ).filter((kind) => !ordered.has(kind));
  return [...AI_PROVIDER_DISPLAY_ORDER, ...appended];
}

/**
 * Client-side extraction of the tRPC error `details` payload injected by the
 * API error formatter (`data.details` on the serialized TRPCClientError).
 */
export function getAppErrorDetails(
  error: unknown,
): AppErrorDetails | undefined {
  if (!error || typeof error !== "object") return undefined;
  const err = error as Record<string, unknown>;
  const data = err.data;
  if (data && typeof data === "object") {
    const details = (data as { details?: unknown }).details;
    if (details && typeof details === "object") {
      return details as AppErrorDetails;
    }
  }
  const shape = err.shape;
  if (shape && typeof shape === "object") {
    const shapeData = (shape as { data?: { details?: unknown } }).data;
    if (
      shapeData &&
      typeof shapeData === "object" &&
      shapeData.details &&
      typeof shapeData.details === "object"
    ) {
      return shapeData.details as AppErrorDetails;
    }
  }
  return undefined;
}

/**
 * Localizes a stored connection `lastErrorCode`. Unknown or non-app codes
 * return undefined so callers can fall back to a generic label instead of
 * ever rendering raw provider error text.
 */
export function localizeConnectionErrorCode(
  code: string,
  t: UI,
): string | undefined {
  if (!isAppErrorCode(code)) return undefined;
  return t.errors.codes[code];
}
