/**
 * Application-owned Mastra runtime boundary. The runtime resolves an owner's
 * current verified selection, decrypts the credential in server memory,
 * constructs the AI SDK model through the adapter, and supplies that
 * request-scoped instance to a short-lived Mastra agent. It never writes
 * credentials to `process.env`, provider singletons, Mastra storage, or any
 * other process-global state, and registers no tools or memory.
 */
import { Agent } from "@mastra/core/agent";
import {
  APP_ERROR_CODES,
  type AiCapabilityProfileId,
  type AiProviderKind,
} from "@repo/core";
import { z } from "zod";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { AppError, appError } from "../app-error.js";
import { decryptAiCredential } from "../ai-crypto.js";
import {
  aiCredentialUnavailableError,
  isAiCredentialEnvelopeError,
} from "./error-mapping.js";
import {
  getAiConnectionForOwner,
  getAiSelectionForOwner,
  updateAiConnection,
} from "../../services/ai-provider-repository.js";
import type {
  AiConstructedModel,
  AiProviderAdapter,
  AiResolvedRoute,
} from "./provider-adapter.js";
import { evaluateSelectionCurrentness } from "./readiness.js";
import type { AiCapabilitySnapshot } from "./verification.js";
import { parseCapabilitySnapshot } from "./verification.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type AiRuntimeDeps = {
  db: DB;
  getAdapter: (providerKind: AiProviderKind) => AiProviderAdapter;
  aiCredentialSecret: string;
};

/** Tiny synthetic output schema used only by the verification smoke test. */
export const AI_SMOKE_OUTPUT_SCHEMA = z.object({
  confirmation: z.literal("ok"),
});

const SMOKE_INSTRUCTIONS =
  "You are completing an automated model verification check. Produce exactly the required structured JSON data and nothing else.";
const SMOKE_PROMPT =
  "Model verification probe. Return the required structured object: the field confirmation must contain exactly the text ok.";

const SMOKE_MAX_OUTPUT_TOKENS = 64;
const SMOKE_DEADLINE_MS = 30_000;
const MAX_PROMPT_LENGTH = 32_000;

export type AiSmokeTestResult = {
  tokenUsage: number | null;
};

/**
 * Bounded, tool-free structured-output smoke test over a constructed model.
 * Sends only the synthetic prompt above and retains no generated content.
 * Throws `AppError` with `AI_MODEL_VERIFICATION_FAILED` when the model does
 * not produce schema-conforming output within the token and time budget.
 */
export async function runStructuredOutputSmokeTest(input: {
  model: AiConstructedModel;
  deadlineMs?: number;
  signal?: AbortSignal;
}): Promise<AiSmokeTestResult> {
  const agent = new Agent({
    id: "ai-model-verification",
    name: "AI Model Verification",
    instructions: SMOKE_INSTRUCTIONS,
    model: input.model,
  });

  let object: unknown;
  let tokenUsage: number | null = null;
  try {
    const result = await agent.generate(SMOKE_PROMPT, {
      structuredOutput: { schema: AI_SMOKE_OUTPUT_SCHEMA },
      maxSteps: 1,
      modelSettings: {
        maxOutputTokens: SMOKE_MAX_OUTPUT_TOKENS,
        timeout: { totalMs: input.deadlineMs ?? SMOKE_DEADLINE_MS },
      },
      abortSignal: input.signal,
    });
    object = result.object;
    tokenUsage = result.usage?.totalTokens ?? null;
  } catch (error) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_MODEL_VERIFICATION_FAILED,
      message:
        "The selected model did not pass structured-output verification.",
      status: 422,
      cause: error,
    });
  }

  const parsed = AI_SMOKE_OUTPUT_SCHEMA.safeParse(object);
  if (!parsed.success) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_MODEL_VERIFICATION_FAILED,
      message: "The selected model did not return schema-conforming output.",
      status: 422,
    });
  }
  return { tokenUsage };
}

export type AiResolvedRuntimeSelection = {
  connectionId: string;
  providerKind: AiProviderKind;
  modelId: string;
  route: AiResolvedRoute;
  adapter: AiProviderAdapter;
  snapshot: AiCapabilitySnapshot;
  storedFingerprint: string;
};

/**
 * Loads and validates the owner's current verified selection for a profile
 * without taking locks (read-only execution path). Fails closed before any
 * credential work when readiness does not hold.
 */
export async function resolveVerifiedSelection(input: {
  db: DB;
  getAdapter: (providerKind: AiProviderKind) => AiProviderAdapter;
  userId: string;
  capabilityProfile: AiCapabilityProfileId;
}): Promise<AiResolvedRuntimeSelection> {
  const selection = await getAiSelectionForOwner(input.db, {
    userId: input.userId,
    capabilityProfile: input.capabilityProfile,
  });
  if (!selection) {
    throw notReadyError(input.capabilityProfile);
  }
  const connection = await getAiConnectionForOwner(input.db, {
    userId: input.userId,
    connectionId: selection.connectionId,
  });
  if (!connection || !connection.verifiedAt) {
    throw notReadyError(input.capabilityProfile);
  }

  const snapshot = parseCapabilitySnapshot(selection.capabilitySnapshot);
  if (!snapshot) {
    throw notReadyError(input.capabilityProfile);
  }
  const adapter = input.getAdapter(connection.providerKind as AiProviderKind);
  const currentness = evaluateSelectionCurrentness({
    snapshot,
    storedFingerprint: selection.verificationFingerprint,
    profileId: input.capabilityProfile,
    current: {
      providerKind: connection.providerKind as AiProviderKind,
      credentialRevision: connection.credentialRevision,
      adapterVersion: adapter.adapterVersion,
    },
  });
  if (!currentness.current) {
    throw notReadyError(input.capabilityProfile);
  }

  return {
    connectionId: connection.id,
    providerKind: connection.providerKind as AiProviderKind,
    modelId: selection.modelId,
    route: {
      status: "resolved",
      protocol: snapshot.fingerprintInput.protocol,
      origin: snapshot.fingerprintInput.routeOrigin,
    },
    adapter,
    snapshot,
    storedFingerprint: selection.verificationFingerprint,
  };
}

function notReadyError(capabilityProfile: AiCapabilityProfileId): AppError {
  return appError({
    appCode: APP_ERROR_CODES.AI_FEATURE_NOT_READY,
    message: "AI is not configured for this capability profile.",
    status: 412,
    details: { capabilityProfile },
  });
}

/**
 * Narrow structured-generation entry point for AI features. Resolves the
 * verified selection, decrypts the credential for this call only, constructs
 * the model, and runs one bounded Mastra generation with the caller's zod
 * schema. No tools, no memory, no process-global state, no generated-content
 * retention (the object is returned to the caller and nothing is stored).
 */
export async function generateStructured<T>(input: {
  deps: AiRuntimeDeps;
  userId: string;
  capabilityProfile: AiCapabilityProfileId;
  schema: z.ZodType<T>;
  prompt: string;
  maxOutputTokens?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
}): Promise<{ object: T; tokenUsage: number | null }> {
  if (input.prompt.length === 0 || input.prompt.length > MAX_PROMPT_LENGTH) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "The generation prompt is empty or exceeds the bounded length.",
      status: 400,
    });
  }

  const selection = await resolveVerifiedSelection({
    db: input.deps.db,
    getAdapter: input.deps.getAdapter,
    userId: input.userId,
    capabilityProfile: input.capabilityProfile,
  });

  const connection = await getAiConnectionForOwner(input.deps.db, {
    userId: input.userId,
    connectionId: selection.connectionId,
  });
  if (!connection) {
    throw notReadyError(input.capabilityProfile);
  }

  let plaintextCredential: string;
  try {
    plaintextCredential = decryptAiCredential(
      connection.ciphertext,
      {
        userId: input.userId,
        connectionId: selection.connectionId,
        providerKind: selection.providerKind,
      },
      input.deps.aiCredentialSecret,
    );
  } catch (error) {
    if (isAiCredentialEnvelopeError(error)) {
      throw aiCredentialUnavailableError(error);
    }
    throw error;
  }

  const model = await selection.adapter.constructModel({
    credentials: { plaintext: plaintextCredential },
    modelId: selection.modelId,
    route: selection.route,
  });

  const agent = new Agent({
    id: "ai-structured-generation",
    name: "AI Structured Generation",
    instructions:
      "You complete application analysis tasks. Produce exactly the required structured JSON data.",
    model,
  });

  try {
    const result = await agent.generate(input.prompt, {
      structuredOutput: { schema: input.schema },
      maxSteps: 1,
      modelSettings: {
        maxOutputTokens: input.maxOutputTokens ?? 2_000,
        timeout: { totalMs: input.deadlineMs ?? 60_000 },
      },
      abortSignal: input.signal,
    });
    const parsed = input.schema.safeParse(result.object);
    if (!parsed.success) {
      throw appError({
        appCode: APP_ERROR_CODES.AI_MODEL_VERIFICATION_FAILED,
        message: "The model did not return schema-conforming output.",
        status: 422,
      });
    }
    return {
      object: parsed.data,
      tokenUsage: result.usage?.totalTokens ?? null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw await mapRuntimeProviderError({
      deps: input.deps,
      connectionId: selection.connectionId,
      userId: input.userId,
      providerKind: selection.providerKind,
      error,
    });
  }
}

/**
 * Normalizes unbounded provider/agent failures into stable `AI_*` codes.
 * Authentication failures additionally clear the connection's verified flag
 * (readiness invalidation); transient failures never erase the selection.
 */
async function mapRuntimeProviderError(input: {
  deps: AiRuntimeDeps;
  connectionId: string;
  userId: string;
  providerKind: AiProviderKind;
  error: unknown;
}): Promise<AppError> {
  const status = extractHttpStatus(input.error);
  if (status === 401 || status === 403) {
    try {
      await updateAiConnection(input.deps.db, {
        userId: input.userId,
        connectionId: input.connectionId,
        patch: {
          verifiedAt: null,
          lastErrorCode: APP_ERROR_CODES.AI_PROVIDER_CREDENTIAL_INVALID,
          lastAttemptAt: new Date(),
        },
      });
    } catch {
      // Best-effort invalidation; readiness re-checks independently.
    }
    return appError({
      appCode: APP_ERROR_CODES.AI_PROVIDER_CREDENTIAL_INVALID,
      message: "The provider rejected the stored credential.",
      status: 400,
      details: { providerKind: input.providerKind },
    });
  }
  if (status === 429) {
    return appError({
      appCode: APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE,
      message: "The provider is rate limiting requests.",
      status: 429,
      details: { providerKind: input.providerKind, retryable: true },
    });
  }
  return appError({
    appCode: APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE,
    message: "The provider call failed transiently.",
    status: 503,
    cause: input.error,
    details: { providerKind: input.providerKind, retryable: true },
  });
}

/** Reads the structured HTTP status from AI SDK provider errors, if any. */
function extractHttpStatus(error: unknown): number | null {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth += 1
  ) {
    const source = current as {
      statusCode?: unknown;
      status?: unknown;
      cause?: unknown;
    };
    if (typeof source.statusCode === "number") return source.statusCode;
    if (typeof source.status === "number") return source.status;
    current = source.cause;
  }
  return null;
}
