/**
 * Database-backed integration tests for the AI provider lifecycle. Fake
 * adapters stand in for real providers, and global fetch is stubbed to fail
 * loudly so the suite proves the services perform zero network activity
 * while database locks are held (and none at all outside the models.dev
 * enrichment fixture stubs).
 */
import { APP_ERROR_CODES, type AiProviderKind } from "@repo/core";
import {
  aiModelSelection,
  aiProviderConnection,
  schema,
  user,
  type AiModelSelectionSelect,
  type AiProviderConnectionSelect,
} from "@repo/db";
import { and, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { decryptAiCredential } from "../lib/ai-crypto.js";
import { AiProviderRequestError } from "../lib/ai/provider-http.js";
import type {
  AiConstructedModel,
  AiProviderAdapter,
  AiResolvedRoute,
} from "../lib/ai/provider-adapter.js";
import type { AiCatalogCandidate } from "../lib/ai/catalog-normalize.js";
import {
  connectAiProvider,
  getAiReadiness,
  removeAiConnection,
  rotateAiProviderCredential,
} from "./ai-provider-service.js";
import type { AiProviderServiceDeps as Deps } from "./ai-provider-service.js";
import {
  getAiCatalogSnapshot,
  verifyAndSelectAiModel,
} from "./ai-catalog-service.js";
import { aiCatalogCache } from "./ai-catalog-cache.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const SECRET = "test-secret-at-least-32-characters!!";
const PROFILE = "structured-text-v1" as const;
const ROUTE: AiResolvedRoute = {
  status: "resolved",
  protocol: "openai-chat-completions",
  origin: "https://mock.test",
};

type FakeAdapter = AiProviderAdapter & {
  verifyCalls: number;
  constructions: Array<{ plaintext: string; modelId: string }>;
  discoverModelsError?: AiProviderRequestError;
  candidates: AiCatalogCandidate[];
  beforeConstruct?: () => Promise<void> | void;
};

function makeFakeAdapter(input?: {
  kind?: AiProviderKind;
  gateway?: boolean;
  beforeConstruct?: () => Promise<void> | void;
}): FakeAdapter {
  const kind = input?.kind ?? "openai";
  const adapter: FakeAdapter = {
    kind,
    providerClass: input?.gateway ? "gateway" : "direct",
    adapterVersion: 1,
    verifyCalls: 0,
    constructions: [],
    candidates: [
      {
        modelId: "mock-language-1",
        displayName: "Mock Language 1",
        inputModalities: ["text"],
        outputModalities: ["text"],
        contextWindowTokens: 128_000,
        supportsStructuredOutput: true,
        route: input?.gateway
          ? { status: "unresolved", reason: "route_metadata_missing" }
          : ROUTE,
        confidence: "provider",
      },
    ],
    beforeConstruct: input?.beforeConstruct,
    async verifyCredential() {
      adapter.verifyCalls += 1;
    },
    async discoverModels() {
      if (adapter.discoverModelsError) throw adapter.discoverModelsError;
      return adapter.candidates;
    },
    resolveRoute({ enrichment }) {
      if (!input?.gateway) return ROUTE;
      if (enrichment?.gatewayNpm === "@ai-sdk/anthropic") {
        return {
          status: "resolved",
          protocol: "anthropic-messages",
          origin: "https://mock.test",
        };
      }
      if (enrichment?.gatewayNpm === "@ai-sdk/openai") return ROUTE;
      return { status: "unresolved", reason: "route_metadata_missing" };
    },
    async constructModel({ credentials, modelId }) {
      if (adapter.beforeConstruct) await adapter.beforeConstruct();
      adapter.constructions.push({ plaintext: credentials.plaintext, modelId });
      return createMockModel({
        objectGenerationMode: "json",
        mockText: { confirmation: "ok" },
      }) as unknown as AiConstructedModel;
    },
  };
  return adapter;
}

type Suite = {
  db: PostgresJsDatabase<Record<string, unknown>>;
  client: ReturnType<typeof postgres>;
};

const suite = {} as Suite;
const createdUserIds: string[] = [];

/** Each test gets fresh users so the one-connection-per-provider rule never collides. */
async function makeUser(): Promise<string> {
  const id = `usr_ai_it_${(createdUserIds.length + 1).toString(36)}_${Date.now().toString(36)}`;
  await suite.db.insert(user).values({
    id,
    name: "AI Integration Owner",
    email: `${id}@example.com`,
    emailVerified: true,
  });
  createdUserIds.push(id);
  return id;
}

function depsWith(
  adapters: Partial<Record<AiProviderKind, AiProviderAdapter>>,
): Deps {
  return {
    db: suite.db,
    aiCredentialSecret: SECRET,
    getAdapter: (kind) => adapters[kind],
  };
}

async function getConnectionRow(connectionId: string) {
  const [row] = await suite.db
    .select()
    .from(aiProviderConnection)
    .where(eq(aiProviderConnection.id, connectionId))
    .limit(1);
  return row ?? null;
}

async function getSelectionRow(userId: string) {
  const [row] = await suite.db
    .select()
    .from(aiModelSelection)
    .where(
      and(
        eq(aiModelSelection.userId, userId),
        eq(aiModelSelection.capabilityProfile, PROFILE),
      ),
    )
    .limit(1);
  return (row as AiModelSelectionSelect | undefined) ?? null;
}

function expectAppError(error: unknown, appCode: string) {
  expect(error).toBeInstanceOf(Error);
  const appErr = error as { appCode?: unknown };
  expect(appErr.appCode).toBe(appCode);
}

describeIntegration("ai provider services", () => {
  beforeAll(async () => {
    suite.client = postgres(connectionString!, { max: 4 });
    suite.db = drizzle(suite.client, { schema, casing: "snake_case" });
  });

  beforeEach(() => {
    // Any fetch reaching the network fails the test: the only legitimate
    // fetch in these services is the models.dev enrichment stub below.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("unexpected network request in AI service suite");
      }),
    );
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await suite.db.delete(user).where(eq(user.id, id));
    }
    await suite.client.end();
    vi.unstubAllGlobals();
  });

  it("connects a provider only after verification and stores a secret-free projection", async () => {
    const userIdA = await makeUser();
    const adapter = makeFakeAdapter();
    const deps = depsWith({ openai: adapter });
    const projection = await connectAiProvider(deps, userIdA, {
      providerKind: "openai",
      credential: "sk-live-owner-a",
    });
    expect(adapter.verifyCalls).toBe(1);
    expect(projection.verifiedAt).not.toBeNull();
    expect(JSON.stringify(projection)).not.toContain("sk-live-owner-a");
    const row = await getConnectionRow(projection.id);
    expect(row?.ciphertext.startsWith("v1.")).toBe(true);
    expect(row?.ciphertext).not.toContain("sk-live-owner-a");
  });

  it("rejects a second connection for the same provider with a revision conflict", async () => {
    const userIdA = await makeUser();
    const adapter = makeFakeAdapter();
    const deps = depsWith({ anthropic: adapter });
    await connectAiProvider(deps, userIdA, {
      providerKind: "anthropic",
      credential: "sk-ant-first",
    });
    await expect(
      connectAiProvider(deps, userIdA, {
        providerKind: "anthropic",
        credential: "sk-ant-second",
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_CONNECTION_REVISION_CONFLICT,
    });
  });

  it("rejects unsupported provider kinds without outbound calls or writes", async () => {
    const userIdA = await makeUser();
    const deps = depsWith({});
    await expect(
      connectAiProvider(deps, userIdA, {
        providerKind: "xai",
        credential: "sk-xai-unused",
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_PROVIDER_UNSUPPORTED,
    });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(0);
  });

  it("persists nothing when the provider rejects the credential", async () => {
    const userIdA = await makeUser();
    const adapter = makeFakeAdapter();
    adapter.verifyCredential = async () => {
      adapter.verifyCalls += 1;
      throw new AiProviderRequestError({
        code: "unauthorized",
        message: "rejected",
        retryable: false,
      });
    };
    const deps = depsWith({ xai: adapter });
    await expect(
      connectAiProvider(deps, userIdA, {
        providerKind: "xai",
        credential: "sk-bad",
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_PROVIDER_CREDENTIAL_INVALID,
    });
    expect(await getConnectionRowByOwner(userIdA, "xai")).toBeNull();
  });

  it("enforces owner isolation: another owner's connection id resolves to not-found", async () => {
    const userIdA = await makeUser();
    const userIdB = await makeUser();
    const adapter = makeFakeAdapter({ kind: "meta" });
    const depsForB = depsWith({ meta: adapter });
    const owned = await connectAiProvider(depsForB, userIdB, {
      providerKind: "meta",
      credential: "sk-meta-owner-b",
    });
    const depsForA = depsWith({ meta: adapter });
    await expect(
      rotateAiProviderCredential(depsForA, userIdA, {
        connectionId: owned.id,
        credential: "sk-attacker",
        expectedConfigRevision: 1,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_CONNECTION_NOT_FOUND,
    });
    await expect(
      removeAiConnection(depsForA, userIdA, {
        connectionId: owned.id,
        expectedConfigRevision: 1,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_CONNECTION_NOT_FOUND,
    });
    const row = await getConnectionRow(owned.id);
    expect(row?.userId).toBe(userIdB);
  });

  it("rotates atomically: increments revisions, replaces ciphertext, invalidates the cache", async () => {
    const userIdA = await makeUser();
    const adapter = makeFakeAdapter();
    const deps = depsWith({ openrouter: adapter });
    const connection = await connectAiProvider(deps, userIdA, {
      providerKind: "openrouter",
      credential: "sk-or-first",
    });
    const rotated = await rotateAiProviderCredential(deps, userIdA, {
      connectionId: connection.id,
      credential: "sk-or-second",
      expectedConfigRevision: 1,
      expectedCredentialRevision: 1,
    });
    expect(rotated.configRevision).toBe(2);
    expect(rotated.credentialRevision).toBe(2);
    expect(rotated.verifiedAt).not.toBeNull();
    const row = (await getConnectionRow(
      connection.id,
    )) as AiProviderConnectionSelect;
    const plaintext = decryptAiCredential(
      row.ciphertext,
      {
        userId: userIdA,
        connectionId: connection.id,
        providerKind: "openrouter",
      },
      SECRET,
    );
    expect(plaintext).toBe("sk-or-second");
    expect(
      aiCatalogCache.getStaleForConnection({
        connectionId: connection.id,
        credentialRevision: 2,
      }),
    ).toBeNull();
  });

  it("rejects stale revision rotations and preserves the current connection", async () => {
    const userIdA = await makeUser();
    const adapter = makeFakeAdapter();
    const deps = depsWith({ openai: adapter });
    const connection = await connectAiProvider(deps, userIdA, {
      providerKind: "openai",
      credential: "sk-oa-first",
    });
    await expect(
      rotateAiProviderCredential(deps, userIdA, {
        connectionId: connection.id,
        credential: "sk-oa-second",
        expectedConfigRevision: 99,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_CONNECTION_REVISION_CONFLICT,
    });
    const row = (await getConnectionRow(
      connection.id,
    )) as AiProviderConnectionSelect;
    expect(row.configRevision).toBe(1);
    expect(
      decryptAiCredential(
        row.ciphertext,
        {
          userId: userIdA,
          connectionId: connection.id,
          providerKind: "openai",
        },
        SECRET,
      ),
    ).toBe("sk-oa-first");
  });

  it("keeps the existing credential when replacement verification fails", async () => {
    const userIdA = await makeUser();
    const adapter = makeFakeAdapter();
    const deps = depsWith({ opencode_zen: adapter });
    const connection = await connectAiProvider(deps, userIdA, {
      providerKind: "opencode_zen",
      credential: "sk-zen-first",
    });
    adapter.verifyCredential = async () => {
      throw new AiProviderRequestError({
        code: "transient",
        message: "provider down",
        retryable: true,
      });
    };
    await expect(
      rotateAiProviderCredential(deps, userIdA, {
        connectionId: connection.id,
        credential: "sk-zen-second",
        expectedConfigRevision: 1,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_PROVIDER_TRANSIENT_FAILURE,
    });
    const row = (await getConnectionRow(
      connection.id,
    )) as AiProviderConnectionSelect;
    expect(row.credentialRevision).toBe(1);
    expect(
      decryptAiCredential(
        row.ciphertext,
        {
          userId: userIdA,
          connectionId: connection.id,
          providerKind: "opencode_zen",
        },
        SECRET,
      ),
    ).toBe("sk-zen-first");
  });

  it("verifies and selects a model, then reports readiness", async () => {
    const userIdA = await makeUser();
    const adapter = makeFakeAdapter();
    const deps = depsWith({ openai: adapter });
    const connection = await connectAiProvider(deps, userIdA, {
      providerKind: "openai",
      credential: "sk-oa-select",
    });
    const selection = await verifyAndSelectAiModel(deps, userIdA, {
      connectionId: connection.id,
      capabilityProfile: PROFILE,
      modelId: "mock-language-1",
    });
    expect(selection.modelId).toBe("mock-language-1");
    expect(adapter.constructions).toHaveLength(1);
    expect(adapter.constructions[0]?.plaintext).toBe("sk-oa-select");
    const readiness = await getAiReadiness(deps, userIdA, PROFILE);
    expect(readiness.ready).toBe(true);
    expect(readiness.selection?.modelId).toBe("mock-language-1");
    const row = await getSelectionRow(userIdA);
    expect(row?.verificationFingerprint).toHaveLength(64);
  });

  it("refuses selection when rotation races the smoke test (no partial write)", async () => {
    const userIdA = await makeUser();
    const adapter = makeFakeAdapter();
    const deps = depsWith({ openai: adapter });
    const connection = await connectAiProvider(deps, userIdA, {
      providerKind: "openai",
      credential: "sk-oa-race",
    });
    adapter.beforeConstruct = async () => {
      // Rotation wins the race while the smoke test is in flight.
      await rotateAiProviderCredential(deps, userIdA, {
        connectionId: connection.id,
        credential: "sk-oa-race-rotated",
        expectedConfigRevision: 1,
      });
    };
    await expect(
      verifyAndSelectAiModel(deps, userIdA, {
        connectionId: connection.id,
        capabilityProfile: PROFILE,
        modelId: "mock-language-1",
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_CONNECTION_REVISION_CONFLICT,
    });
    expect(await getSelectionRow(userIdA)).toBeNull();
  });

  it("excludes models absent from the catalog and gateway models with unresolved routes", async () => {
    const userIdA = await makeUser();
    const direct = makeFakeAdapter();
    const gateway = makeFakeAdapter({ kind: "opencode_go", gateway: true });
    const deps = depsWith({ openai: direct, opencode_go: gateway });
    const directConnection = await connectAiProvider(deps, userIdA, {
      providerKind: "openai",
      credential: "sk-oa-catalog",
    });
    await expect(
      verifyAndSelectAiModel(deps, userIdA, {
        connectionId: directConnection.id,
        capabilityProfile: PROFILE,
        modelId: "does-not-exist",
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_MODEL_NOT_SELECTABLE,
    });

    const gatewayConnection = await connectAiProvider(deps, userIdA, {
      providerKind: "opencode_go",
      credential: "sk-go-catalog",
    });
    const error = await verifyAndSelectAiModel(deps, userIdA, {
      connectionId: gatewayConnection.id,
      capabilityProfile: PROFILE,
      modelId: "mock-language-1",
    }).catch((e: unknown) => e);
    expectAppError(error, APP_ERROR_CODES.AI_MODEL_NOT_SELECTABLE);
    expect(
      (error as { details?: { unsupportedReason?: string } }).details
        ?.unsupportedReason,
    ).toBe("route_unresolved");
  });

  it("serves a marked stale catalog snapshot after transient discovery failure", async () => {
    const userIdA = await makeUser();
    const adapter = makeFakeAdapter();
    const deps = depsWith({ openai: adapter });
    await connectAiProvider(deps, userIdA, {
      providerKind: "openai",
      credential: "sk-oa-stale",
    });
    const fresh = await getAiCatalogSnapshot(deps, userIdA, {
      providerKind: "openai",
      capabilityProfile: PROFILE,
    });
    expect(fresh.stale).toBe(false);
    expect(fresh.entries.length).toBeGreaterThan(0);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(1);

    adapter.discoverModelsError = new AiProviderRequestError({
      code: "transient",
      message: "provider down",
      retryable: true,
    });
    const stale = await getAiCatalogSnapshot(deps, userIdA, {
      providerKind: "openai",
      capabilityProfile: PROFILE,
      refresh: true,
    });
    expect(stale.stale).toBe(true);
    expect(stale.entries.length).toBe(fresh.entries.length);
  });

  it("fails discovery with a retryable error when no cache fallback exists", async () => {
    const userIdC = await makeUser();
    const adapter = makeFakeAdapter({ kind: "anthropic" });
    const deps = depsWith({ anthropic: adapter });
    await connectAiProvider(deps, userIdC, {
      providerKind: "anthropic",
      credential: "sk-anthropic-c",
    });
    adapter.discoverModelsError = new AiProviderRequestError({
      code: "transient",
      message: "provider down",
      retryable: true,
    });
    await expect(
      getAiCatalogSnapshot(deps, userIdC, {
        providerKind: "anthropic",
        capabilityProfile: PROFILE,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.AI_DISCOVERY_UNAVAILABLE,
    });
  });

  it("reports the full readiness transition chain", async () => {
    const userIdB = await makeUser();
    const adapter = makeFakeAdapter({ kind: "xai" });
    const deps = depsWith({ xai: adapter });
    expect((await getAiReadiness(deps, userIdB, PROFILE)).reason).toBe(
      "no_connection",
    );
    await connectAiProvider(deps, userIdB, {
      providerKind: "xai",
      credential: "sk-xai-b",
    });
    expect((await getAiReadiness(deps, userIdB, PROFILE)).reason).toBe(
      "no_selection",
    );
    await verifyAndSelectAiModel(deps, userIdB, {
      connectionId: (await getConnectionRowByOwner(userIdB, "xai"))!.id,
      capabilityProfile: PROFILE,
      modelId: "mock-language-1",
    });
    expect((await getAiReadiness(deps, userIdB, PROFILE)).ready).toBe(true);
    const row = (await getConnectionRowByOwner(
      userIdB,
      "xai",
    )) as AiProviderConnectionSelect;
    await suite.db
      .update(aiProviderConnection)
      .set({ credentialRevision: row.credentialRevision + 1 })
      .where(eq(aiProviderConnection.id, row.id));
    expect((await getAiReadiness(deps, userIdB, PROFILE)).reason).toBe(
      "selection_stale",
    );
  });

  it("removes a connection atomically with its dependent selections", async () => {
    const userIdB = await makeUser();
    const adapter = makeFakeAdapter({ kind: "meta" });
    const deps = depsWith({ meta: adapter });
    const connection = await connectAiProvider(deps, userIdB, {
      providerKind: "meta",
      credential: "sk-meta-remove",
    });
    await verifyAndSelectAiModel(deps, userIdB, {
      connectionId: connection.id,
      capabilityProfile: PROFILE,
      modelId: "mock-language-1",
    });
    expect(await getSelectionRow(userIdB)).not.toBeNull();
    await removeAiConnection(deps, userIdB, {
      connectionId: connection.id,
      expectedConfigRevision: 1,
    });
    expect(await getConnectionRow(connection.id)).toBeNull();
    expect(await getSelectionRow(userIdB)).toBeNull();
  });
});

async function getConnectionRowByOwner(
  userId: string,
  providerKind: AiProviderKind,
) {
  const [row] = await suite.db
    .select()
    .from(aiProviderConnection)
    .where(
      and(
        eq(aiProviderConnection.userId, userId),
        eq(aiProviderConnection.providerKind, providerKind),
      ),
    )
    .limit(1);
  return (row as AiProviderConnectionSelect | undefined) ?? null;
}
