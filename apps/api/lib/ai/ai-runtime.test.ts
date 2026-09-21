import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type {
  LanguageModelV4,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import {
  AI_CAPABILITY_PROFILES,
  AI_MODEL_PROTOCOLS,
  AI_PROVIDER_CLASSES,
  AI_PROVIDER_KINDS,
  APP_ERROR_CODES,
  type AiProviderKind,
} from "@repo/core";
import { aiModelSelection, aiProviderConnection, schema, user } from "@repo/db";
import { z } from "zod";
import { encryptAiCredential } from "../ai-crypto.js";
import { AppError } from "../app-error.js";
import { updateAiConnection } from "../../services/ai-provider-repository.js";
import {
  generateStructured,
  runStructuredOutputSmokeTest,
  type AiRuntimeDeps,
} from "./ai-runtime.js";
import type { AiProviderAdapter, AiResolvedRoute } from "./provider-adapter.js";
import {
  computeVerificationFingerprint,
  type AiFingerprintInput,
} from "./verification.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const PROFILE_ID = AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.id;
const PROFILE_VERSION = AI_CAPABILITY_PROFILES.STRUCTURED_TEXT_V1.version;
const FAKE_PROTOCOL = AI_MODEL_PROTOCOLS.OPENAI_CHAT_COMPLETIONS;
const FAKE_ORIGIN = "https://mock.test";
const FAKE_ADAPTER_VERSION = 1;
const TEST_CREDENTIAL_SECRET = "test-secret-at-least-32-characters!!";
const GENERATION_PROMPT =
  "Return the required structured object for this owner.";
const CONFORMING_OUTPUT = JSON.stringify({ result: "ok" });
const TEST_OUTPUT_SCHEMA = z.object({ result: z.literal("ok") });

const SMOKE_FIXED_FAILURE_MESSAGES = new Set([
  "The selected model did not pass structured-output verification.",
  "The selected model did not return schema-conforming output.",
]);

type FakeModelBehavior =
  | { mode: "conform"; outputText: string }
  | { mode: "throw"; statusCode: number };

type ConstructedModelCall = {
  providerKind: AiProviderKind;
  plaintext: string;
  modelId: string;
  route: AiResolvedRoute;
};

function providerStatusError(statusCode: number): Error {
  return Object.assign(
    new Error(`provider responded with status ${statusCode}`),
    {
      statusCode,
    },
  );
}

function fakeModelUsage(
  inputTokens: number,
  outputTokens: number,
): LanguageModelV4Usage {
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  };
}

function createFakeModel(
  behavior: FakeModelBehavior,
  modelId: string,
): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: "ai-runtime-test",
    modelId,
    supportedUrls: {},
    async doGenerate() {
      if (behavior.mode === "throw")
        throw providerStatusError(behavior.statusCode);
      return {
        content: [{ type: "text", text: behavior.outputText }],
        finishReason: { unified: "stop", raw: undefined },
        usage: fakeModelUsage(10, 5),
        warnings: [],
      };
    },
    async doStream() {
      if (behavior.mode === "throw")
        throw providerStatusError(behavior.statusCode);
      const parts: LanguageModelV4StreamPart[] = [
        { type: "stream-start", warnings: [] },
        { type: "response-metadata" },
        { type: "text-start", id: "t1" },
        { type: "text-delta", id: "t1", delta: behavior.outputText },
        { type: "text-end", id: "t1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage: fakeModelUsage(10, 5),
        },
      ];
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  };
}

function createFakeAdapter(
  providerKind: AiProviderKind,
  script: { behavior: FakeModelBehavior },
  constructedCalls: ConstructedModelCall[],
): AiProviderAdapter {
  return {
    kind: providerKind,
    providerClass: AI_PROVIDER_CLASSES.DIRECT,
    adapterVersion: FAKE_ADAPTER_VERSION,
    async verifyCredential() {
      throw new Error("verifyCredential is not exercised by the runtime path");
    },
    async discoverModels() {
      throw new Error("discoverModels is not exercised by the runtime path");
    },
    resolveRoute(): AiResolvedRoute {
      return {
        status: "resolved",
        protocol: FAKE_PROTOCOL,
        origin: FAKE_ORIGIN,
      };
    },
    constructModel(input): LanguageModelV4 {
      constructedCalls.push({
        providerKind,
        plaintext: input.credentials.plaintext,
        modelId: input.modelId,
        route: input.route,
      });
      return createFakeModel(script.behavior, input.modelId);
    },
  };
}

function snapshotEnvKeys(): string {
  return Object.keys(process.env).sort().join("\n");
}

async function expectAppError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw new Error(`Expected an AppError but got: ${String(error)}`);
  }
  throw new Error("Expected the promise to reject with an AppError.");
}

describe("runStructuredOutputSmokeTest", () => {
  it("resolves token usage when the model returns schema-conforming output", async () => {
    const envBefore = snapshotEnvKeys();
    const model = createFakeModel(
      { mode: "conform", outputText: JSON.stringify({ confirmation: "ok" }) },
      "unit-conform",
    );

    const result = await runStructuredOutputSmokeTest({ model });

    expect(result.tokenUsage).toBe(15);
    expect(snapshotEnvKeys()).toBe(envBefore);
  });

  it("fails bounded for non-conforming output without leaking generated content", async () => {
    const envBefore = snapshotEnvKeys();
    const marker = "UNIT-LEAK-MARKER";
    const model = createFakeModel(
      { mode: "conform", outputText: JSON.stringify({ confirmation: marker }) },
      "unit-nonconform",
    );

    const error = await expectAppError(runStructuredOutputSmokeTest({ model }));

    expect(error.appCode).toBe(APP_ERROR_CODES.AI_MODEL_VERIFICATION_FAILED);
    expect(SMOKE_FIXED_FAILURE_MESSAGES.has(error.message)).toBe(true);
    expect(error.message).not.toContain(marker);
    expect(error.message).not.toContain("Model verification probe");
    expect(snapshotEnvKeys()).toBe(envBefore);
  });

  it("fails bounded when the model throws a transient provider error", async () => {
    const envBefore = snapshotEnvKeys();
    const model = createFakeModel(
      { mode: "throw", statusCode: 429 },
      "unit-throws",
    );

    const error = await expectAppError(runStructuredOutputSmokeTest({ model }));

    expect(error.appCode).toBe(APP_ERROR_CODES.AI_MODEL_VERIFICATION_FAILED);
    expect(SMOKE_FIXED_FAILURE_MESSAGES.has(error.message)).toBe(true);
    expect(error.message).not.toContain("provider responded with status");
    expect(snapshotEnvKeys()).toBe(envBefore);
  });
});

describeIntegration("ai-runtime execution guarantees", () => {
  const runId = randomUUID().replaceAll("-", "").slice(0, 8);
  const userAId = `usr_ai_rt_1_${runId}`;
  const userBId = `usr_ai_rt_2_${runId}`;
  const userCId = `usr_ai_rt_3_${runId}`;
  const connectionAId = `aicon_rt_1_${runId}`;
  const connectionBId = `aicon_rt_2_${runId}`;
  const modelIdA = "mock-model-a";
  const modelIdB = "mock-model-b";
  const plaintextA = "sk-test-owner-1";
  const plaintextB = "sk-test-owner-2";
  const integrationTimeoutMs = 30_000;

  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let envSnapshot: string;

  const constructedCalls: ConstructedModelCall[] = [];
  const fakeScript: { behavior: FakeModelBehavior } = {
    behavior: { mode: "conform", outputText: CONFORMING_OUTPUT },
  };
  const openAiFakeAdapter = createFakeAdapter(
    AI_PROVIDER_KINDS.OPENAI,
    fakeScript,
    constructedCalls,
  );
  const anthropicFakeAdapter = createFakeAdapter(
    AI_PROVIDER_KINDS.ANTHROPIC,
    fakeScript,
    constructedCalls,
  );

  function runtimeDeps(): AiRuntimeDeps {
    return {
      db,
      getAdapter: (providerKind) => {
        if (providerKind === AI_PROVIDER_KINDS.OPENAI) return openAiFakeAdapter;
        if (providerKind === AI_PROVIDER_KINDS.ANTHROPIC) {
          return anthropicFakeAdapter;
        }
        throw new Error(`Unexpected provider kind: ${providerKind}`);
      },
      aiCredentialSecret: TEST_CREDENTIAL_SECRET,
    };
  }

  function generateFor(userId: string) {
    return generateStructured({
      deps: runtimeDeps(),
      userId,
      capabilityProfile: PROFILE_ID,
      schema: TEST_OUTPUT_SCHEMA,
      prompt: GENERATION_PROMPT,
    });
  }

  function fingerprintInputFor(
    providerKind: AiProviderKind,
    modelId: string,
  ): AiFingerprintInput {
    return {
      providerKind,
      credentialRevision: 1,
      adapterVersion: FAKE_ADAPTER_VERSION,
      modelId,
      protocol: FAKE_PROTOCOL,
      routeOrigin: FAKE_ORIGIN,
      profileId: PROFILE_ID,
      profileVersion: PROFILE_VERSION,
    };
  }

  function selectionWhere(userId: string) {
    return and(
      eq(aiModelSelection.userId, userId),
      eq(aiModelSelection.capabilityProfile, PROFILE_ID),
    );
  }

  async function loadConnection(userId: string, connectionId: string) {
    const rows = await db
      .select()
      .from(aiProviderConnection)
      .where(
        and(
          eq(aiProviderConnection.id, connectionId),
          eq(aiProviderConnection.userId, userId),
        ),
      );
    return rows[0] ?? null;
  }

  async function loadSelection(userId: string) {
    const rows = await db
      .select()
      .from(aiModelSelection)
      .where(selectionWhere(userId));
    return rows[0] ?? null;
  }

  function assertNoSecrets(error: AppError): void {
    const payload = `${error.message} ${JSON.stringify(error.details ?? null)}`;
    expect(payload).not.toContain(plaintextA);
    expect(payload).not.toContain(plaintextB);
    expect(payload).not.toMatch(/v1\./);
  }

  beforeAll(async () => {
    envSnapshot = snapshotEnvKeys();
    client = postgres(connectionString!, { max: 4 });
    db = drizzle(client, { schema, casing: "snake_case" });

    await db.insert(user).values([
      {
        id: userAId,
        name: "AI Runtime A",
        email: `${userAId}@example.com`,
        emailVerified: true,
      },
      {
        id: userBId,
        name: "AI Runtime B",
        email: `${userBId}@example.com`,
        emailVerified: true,
      },
      {
        id: userCId,
        name: "AI Runtime C",
        email: `${userCId}@example.com`,
        emailVerified: true,
      },
    ]);

    await db.insert(aiProviderConnection).values([
      {
        id: connectionAId,
        userId: userAId,
        providerKind: AI_PROVIDER_KINDS.OPENAI,
        ciphertext: encryptAiCredential(
          plaintextA,
          {
            userId: userAId,
            connectionId: connectionAId,
            providerKind: AI_PROVIDER_KINDS.OPENAI,
          },
          TEST_CREDENTIAL_SECRET,
        ),
        credentialRevision: 1,
        verifiedAt: new Date(),
      },
      {
        id: connectionBId,
        userId: userBId,
        providerKind: AI_PROVIDER_KINDS.ANTHROPIC,
        ciphertext: encryptAiCredential(
          plaintextB,
          {
            userId: userBId,
            connectionId: connectionBId,
            providerKind: AI_PROVIDER_KINDS.ANTHROPIC,
          },
          TEST_CREDENTIAL_SECRET,
        ),
        credentialRevision: 1,
        verifiedAt: new Date(),
      },
    ]);

    await db.insert(aiModelSelection).values([
      {
        userId: userAId,
        connectionId: connectionAId,
        capabilityProfile: PROFILE_ID,
        modelId: modelIdA,
        protocol: FAKE_PROTOCOL,
        routeOrigin: FAKE_ORIGIN,
        capabilitySnapshot: {
          contextWindowTokens: 200_000,
          fingerprintInput: fingerprintInputFor(
            AI_PROVIDER_KINDS.OPENAI,
            modelIdA,
          ),
        },
        verificationFingerprint: computeVerificationFingerprint(
          fingerprintInputFor(AI_PROVIDER_KINDS.OPENAI, modelIdA),
        ),
        verifiedAt: new Date(),
      },
      {
        userId: userBId,
        connectionId: connectionBId,
        capabilityProfile: PROFILE_ID,
        modelId: modelIdB,
        protocol: FAKE_PROTOCOL,
        routeOrigin: FAKE_ORIGIN,
        capabilitySnapshot: {
          contextWindowTokens: 200_000,
          fingerprintInput: fingerprintInputFor(
            AI_PROVIDER_KINDS.ANTHROPIC,
            modelIdB,
          ),
        },
        verificationFingerprint: computeVerificationFingerprint(
          fingerprintInputFor(AI_PROVIDER_KINDS.ANTHROPIC, modelIdB),
        ),
        verifiedAt: new Date(),
      },
    ]);
  }, integrationTimeoutMs);

  beforeEach(() => {
    constructedCalls.length = 0;
    fakeScript.behavior = { mode: "conform", outputText: CONFORMING_OUTPUT };
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userAId));
    await db.delete(user).where(eq(user.id, userBId));
    await db.delete(user).where(eq(user.id, userCId));
    await client.end();
  });

  it(
    "constructs each owner's model with only their own credential",
    { timeout: integrationTimeoutMs },
    async () => {
      const resultA = await generateFor(userAId);
      expect(resultA).toEqual({ object: { result: "ok" }, tokenUsage: 15 });
      expect(constructedCalls).toEqual([
        {
          providerKind: AI_PROVIDER_KINDS.OPENAI,
          plaintext: plaintextA,
          modelId: modelIdA,
          route: {
            status: "resolved",
            protocol: FAKE_PROTOCOL,
            origin: FAKE_ORIGIN,
          },
        },
      ]);

      const resultB = await generateFor(userBId);
      expect(resultB).toEqual({ object: { result: "ok" }, tokenUsage: 15 });
      expect(constructedCalls).toEqual([
        {
          providerKind: AI_PROVIDER_KINDS.OPENAI,
          plaintext: plaintextA,
          modelId: modelIdA,
          route: {
            status: "resolved",
            protocol: FAKE_PROTOCOL,
            origin: FAKE_ORIGIN,
          },
        },
        {
          providerKind: AI_PROVIDER_KINDS.ANTHROPIC,
          plaintext: plaintextB,
          modelId: modelIdB,
          route: {
            status: "resolved",
            protocol: FAKE_PROTOCOL,
            origin: FAKE_ORIGIN,
          },
        },
      ]);
    },
  );

  it(
    "runs concurrent different-provider executions without cross-owner leakage",
    { timeout: integrationTimeoutMs },
    async () => {
      const [resultA, resultB] = await Promise.all([
        generateFor(userAId),
        generateFor(userBId),
      ]);
      expect(resultA.object).toEqual({ result: "ok" });
      expect(resultB.object).toEqual({ result: "ok" });
      expect(constructedCalls).toHaveLength(2);

      const openAiCalls = constructedCalls.filter(
        (call) => call.providerKind === AI_PROVIDER_KINDS.OPENAI,
      );
      const anthropicCalls = constructedCalls.filter(
        (call) => call.providerKind === AI_PROVIDER_KINDS.ANTHROPIC,
      );
      expect(openAiCalls).toHaveLength(1);
      expect(anthropicCalls).toHaveLength(1);
      expect(openAiCalls[0]?.plaintext).toBe(plaintextA);
      expect(openAiCalls[0]?.modelId).toBe(modelIdA);
      expect(anthropicCalls[0]?.plaintext).toBe(plaintextB);
      expect(anthropicCalls[0]?.modelId).toBe(modelIdB);
    },
  );

  it(
    "fails closed before model construction when the owner has no selection",
    { timeout: integrationTimeoutMs },
    async () => {
      const error = await expectAppError(generateFor(userCId));

      expect(error.appCode).toBe(APP_ERROR_CODES.AI_FEATURE_NOT_READY);
      expect(constructedCalls).toHaveLength(0);
    },
  );

  it(
    "fails closed for a selection pointing at another owner's connection",
    { timeout: integrationTimeoutMs },
    async () => {
      await db
        .update(aiModelSelection)
        .set({ connectionId: connectionBId })
        .where(selectionWhere(userAId));
      try {
        const error = await expectAppError(generateFor(userAId));
        expect(error.appCode).toBe(APP_ERROR_CODES.AI_FEATURE_NOT_READY);
        expect(constructedCalls).toHaveLength(0);
      } finally {
        await db
          .update(aiModelSelection)
          .set({ connectionId: connectionAId })
          .where(selectionWhere(userAId));
      }
    },
  );

  it(
    "fails closed when the stored credential revision drifted",
    { timeout: integrationTimeoutMs },
    async () => {
      await updateAiConnection(db, {
        userId: userAId,
        connectionId: connectionAId,
        patch: { credentialRevision: 2 },
      });
      try {
        const error = await expectAppError(generateFor(userAId));
        expect(error.appCode).toBe(APP_ERROR_CODES.AI_FEATURE_NOT_READY);
        expect(constructedCalls).toHaveLength(0);
      } finally {
        await updateAiConnection(db, {
          userId: userAId,
          connectionId: connectionAId,
          patch: { credentialRevision: 1 },
        });
      }
    },
  );

  it(
    "keeps the selection and verification when the provider fails transiently",
    { timeout: integrationTimeoutMs },
    async () => {
      fakeScript.behavior = { mode: "throw", statusCode: 429 };
      try {
        const error = await expectAppError(generateFor(userAId));
        expect(error.appCode).toBe(
          APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE,
        );
        expect(error.details).toMatchObject({ retryable: true });

        const selection = await loadSelection(userAId);
        expect(selection?.verificationFingerprint).toBeTruthy();
        const connection = await loadConnection(userAId, connectionAId);
        expect(connection?.verifiedAt).not.toBeNull();
      } finally {
        fakeScript.behavior = {
          mode: "conform",
          outputText: CONFORMING_OUTPUT,
        };
      }
    },
  );

  it(
    "invalidates the connection when the provider rejects the credential",
    { timeout: integrationTimeoutMs },
    async () => {
      fakeScript.behavior = { mode: "throw", statusCode: 401 };
      try {
        const error = await expectAppError(generateFor(userAId));
        expect(error.appCode).toBe(
          APP_ERROR_CODES.AI_PROVIDER_CREDENTIAL_INVALID,
        );

        const connection = await loadConnection(userAId, connectionAId);
        expect(connection?.verifiedAt).toBeNull();
        expect(connection?.lastErrorCode).toBe(
          APP_ERROR_CODES.AI_PROVIDER_CREDENTIAL_INVALID,
        );

        const callsAfterFailure = constructedCalls.length;
        const followUp = await expectAppError(generateFor(userAId));
        expect(followUp.appCode).toBe(APP_ERROR_CODES.AI_FEATURE_NOT_READY);
        expect(constructedCalls).toHaveLength(callsAfterFailure);
      } finally {
        fakeScript.behavior = {
          mode: "conform",
          outputText: CONFORMING_OUTPUT,
        };
        await updateAiConnection(db, {
          userId: userAId,
          connectionId: connectionAId,
          patch: { verifiedAt: new Date(), lastErrorCode: null },
        });
      }
    },
  );

  it(
    "keeps secrets out of error diagnostics",
    { timeout: integrationTimeoutMs },
    async () => {
      try {
        assertNoSecrets(await expectAppError(generateFor(userCId)));

        fakeScript.behavior = { mode: "throw", statusCode: 429 };
        assertNoSecrets(await expectAppError(generateFor(userAId)));

        fakeScript.behavior = { mode: "throw", statusCode: 401 };
        assertNoSecrets(await expectAppError(generateFor(userAId)));
        assertNoSecrets(await expectAppError(generateFor(userAId)));
      } finally {
        fakeScript.behavior = {
          mode: "conform",
          outputText: CONFORMING_OUTPUT,
        };
        await updateAiConnection(db, {
          userId: userAId,
          connectionId: connectionAId,
          patch: { verifiedAt: new Date(), lastErrorCode: null },
        });
      }
    },
  );

  it("leaves process.env untouched across the block", () => {
    expect(snapshotEnvKeys()).toBe(envSnapshot);
  });
});
