/**
 * @file Owner-scoped model catalog discovery and model-selection
 * verification. Credentials are decrypted only inside the bounded provider
 * call frame, discovery failures fall back to same-revision cached
 * snapshots marked stale, and selections persist only when the connection
 * revisions observed before the smoke test are still current.
 */
import {
  APP_ERROR_CODES,
  compareAiCatalogEntries,
  type AiCapabilityProfileId,
  type AiCatalogEntry,
  type AiCatalogSnapshot,
  type AiModelDescriptor,
  type AiProviderKind,
  type AiSelectionProjection,
} from "@repo/core";
import { generateId } from "@repo/db";
import { appError } from "../lib/app-error.js";
import { decryptAiCredential } from "../lib/ai-crypto.js";
import { normalizeCatalogCandidates } from "../lib/ai/catalog-normalize.js";
import { buildCatalogCacheKey } from "../lib/ai/catalog-cache.js";
import { fetchModelsDevEnrichment } from "../lib/ai/models-dev.js";
import {
  aiCredentialUnavailableError,
  isAiCredentialEnvelopeError,
  mapAiProviderRequestError,
} from "../lib/ai/error-mapping.js";
import { qualifyModelForStructuredTextV1 } from "../lib/ai/capability-profile.js";
import { runStructuredOutputSmokeTest } from "../lib/ai/ai-runtime.js";
import {
  buildCapabilitySnapshot,
  computeVerificationFingerprint,
} from "../lib/ai/verification.js";
import type { AiProviderAdapter } from "../lib/ai/provider-adapter.js";
import type { AiProviderServiceDeps } from "./ai-provider-service.js";
import {
  getAiConnectionByProviderForOwner,
  getAiConnectionForOwner,
  lockAiConnectionForOwner,
  lockAiOwnerForUpdate,
  toAiSelectionProjection,
  upsertAiSelection,
} from "./ai-provider-repository.js";
import { aiCatalogCache } from "./ai-catalog-cache.js";

function connectionNotFound() {
  return appError({
    appCode: APP_ERROR_CODES.AI_CONNECTION_NOT_FOUND,
    message: "AI provider connection not found.",
    status: 404,
  });
}

function modelNotSelectable(input: {
  modelId: string;
  capabilityProfile: AiCapabilityProfileId;
  unsupportedReason?: string;
}) {
  return appError({
    appCode: APP_ERROR_CODES.AI_MODEL_NOT_SELECTABLE,
    message:
      "This model is not selectable for the requested capability profile.",
    status: 400,
    details: {
      modelId: input.modelId,
      capabilityProfile: input.capabilityProfile,
      unsupportedReason: input.unsupportedReason,
    },
  });
}

function revisionConflict(currentRevision: number) {
  return appError({
    appCode: APP_ERROR_CODES.AI_CONNECTION_REVISION_CONFLICT,
    message: "The connection changed elsewhere. Reload and retry.",
    status: 409,
    details: { currentRevision },
  });
}

async function decryptCredentialForCall(input: {
  deps: AiProviderServiceDeps;
  userId: string;
  connectionId: string;
  providerKind: AiProviderKind;
  ciphertext: string;
}): Promise<string> {
  return decryptAiCredential(
    input.ciphertext,
    {
      userId: input.userId,
      connectionId: input.connectionId,
      providerKind: input.providerKind,
    },
    input.deps.aiCredentialSecret,
  );
}

/**
 * Runs one bounded, credential-authenticated discovery call and normalizes
 * the response. No locks are held and no database write happens here.
 */
async function discoverDescriptors(input: {
  deps: AiProviderServiceDeps;
  userId: string;
  connectionId: string;
  providerKind: AiProviderKind;
  ciphertext: string;
  adapter: AiProviderAdapter;
}): Promise<{ descriptors: AiModelDescriptor[]; retrievedAt: Date }> {
  let plaintext: string;
  try {
    plaintext = await decryptCredentialForCall({
      deps: input.deps,
      userId: input.userId,
      connectionId: input.connectionId,
      providerKind: input.providerKind,
      ciphertext: input.ciphertext,
    });
  } catch (error) {
    if (isAiCredentialEnvelopeError(error)) {
      throw aiCredentialUnavailableError(error);
    }
    throw error;
  }
  try {
    const candidates = await input.adapter.discoverModels({
      credentials: { plaintext },
    });
    const { entries } = normalizeCatalogCandidates(candidates);
    return { descriptors: entries, retrievedAt: new Date() };
  } catch (error) {
    throw mapAiProviderRequestError({
      error,
      operation: "discovery",
      providerKind: input.providerKind,
    });
  }
}

/** Best-effort public registry enrichment; failures never fail discovery. */
async function safeEnrichment(
  providerKind: AiProviderKind,
): Promise<
  Map<string, import("../lib/ai/provider-adapter.js").AiModelEnrichment>
> {
  try {
    return await fetchModelsDevEnrichment(providerKind);
  } catch {
    return new Map();
  }
}

/**
 * Merges registry metadata into a descriptor: fills only what the provider
 * response left unknown, upgrades gateway routes, and never adds models.
 */
function enrichDescriptor(
  descriptor: AiModelDescriptor,
  adapter: AiProviderAdapter,
  enrichment: Map<
    string,
    import("../lib/ai/provider-adapter.js").AiModelEnrichment
  >,
): AiModelDescriptor {
  const meta = enrichment.get(descriptor.modelId);
  if (!meta) return descriptor;
  const route = adapter.resolveRoute({
    modelId: descriptor.modelId,
    enrichment: meta,
  });
  return {
    ...descriptor,
    displayName:
      descriptor.displayName === descriptor.modelId && meta.displayName
        ? meta.displayName.slice(0, 200)
        : descriptor.displayName,
    inputModalities:
      descriptor.inputModalities.length > 0
        ? descriptor.inputModalities
        : (meta.inputModalities ?? []),
    outputModalities:
      descriptor.outputModalities.length > 0
        ? descriptor.outputModalities
        : (meta.outputModalities ?? []),
    contextWindowTokens:
      descriptor.contextWindowTokens ?? meta.contextWindowTokens ?? null,
    maxOutputTokens: descriptor.maxOutputTokens ?? meta.maxOutputTokens ?? null,
    supportsToolCalls:
      descriptor.supportsToolCalls ?? meta.supportsToolCalls ?? null,
    supportsStructuredOutput:
      descriptor.supportsStructuredOutput ??
      meta.supportsStructuredOutput ??
      null,
    deprecated: descriptor.deprecated || meta.deprecated === true,
    route,
    confidence: "provider_enriched",
  };
}

function qualifyCatalog(
  descriptors: AiModelDescriptor[],
  adapter: AiProviderAdapter,
): AiCatalogEntry[] {
  return descriptors
    .map((descriptor) => ({
      descriptor,
      qualification: qualifyModelForStructuredTextV1({
        descriptor,
        providerClass: adapter.providerClass,
      }),
    }))
    .sort(compareAiCatalogEntries);
}

async function getDescriptors(input: {
  deps: AiProviderServiceDeps;
  userId: string;
  connectionId: string;
  credentialRevision: number;
  providerKind: AiProviderKind;
  adapter: AiProviderAdapter;
  ciphertext: string;
  refresh: boolean;
}): Promise<{
  descriptors: AiModelDescriptor[];
  retrievedAt: Date;
  stale: boolean;
}> {
  const key = buildCatalogCacheKey({
    connectionId: input.connectionId,
    credentialRevision: input.credentialRevision,
    adapterVersion: input.adapter.adapterVersion,
  });
  if (!input.refresh) {
    const cached = aiCatalogCache.get(key);
    if (cached) {
      return {
        descriptors: cached.descriptors,
        retrievedAt: cached.retrievedAt,
        stale: false,
      };
    }
  }
  try {
    const discovered = await discoverDescriptors({
      deps: input.deps,
      userId: input.userId,
      connectionId: input.connectionId,
      providerKind: input.providerKind,
      ciphertext: input.ciphertext,
      adapter: input.adapter,
    });
    aiCatalogCache.set(key, {
      descriptors: discovered.descriptors,
      retrievedAt: discovered.retrievedAt,
      credentialRevision: input.credentialRevision,
      adapterVersion: input.adapter.adapterVersion,
    });
    return { ...discovered, stale: false };
  } catch (error) {
    const stale = aiCatalogCache.getStaleForConnection({
      connectionId: input.connectionId,
      credentialRevision: input.credentialRevision,
    });
    if (stale) {
      return {
        descriptors: stale.descriptors,
        retrievedAt: stale.retrievedAt,
        stale: true,
      };
    }
    throw error;
  }
}

/**
 * Live model discovery for one owner connection: provider catalog plus
 * optional public-registry enrichment, qualified against a capability
 * profile. Transient discovery failures serve a same-revision cached
 * snapshot marked stale; without one, a retryable discovery error is thrown.
 */
export async function getAiCatalogSnapshot(
  deps: AiProviderServiceDeps,
  userId: string,
  input: {
    providerKind: AiProviderKind;
    capabilityProfile: AiCapabilityProfileId;
    refresh?: boolean;
  },
): Promise<AiCatalogSnapshot> {
  const adapter = deps.getAdapter(input.providerKind);
  if (!adapter) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_PROVIDER_UNSUPPORTED,
      message: "That AI provider is not supported.",
      status: 400,
      details: { providerKind: input.providerKind },
    });
  }
  const connection = await getAiConnectionByProviderForOwner(deps.db, {
    userId,
    providerKind: input.providerKind,
  });
  if (!connection) throw connectionNotFound();

  const { descriptors, retrievedAt, stale } = await getDescriptors({
    deps,
    userId,
    connectionId: connection.id,
    credentialRevision: connection.credentialRevision,
    providerKind: input.providerKind,
    adapter,
    ciphertext: connection.ciphertext,
    refresh: input.refresh === true,
  });
  const enrichment = await safeEnrichment(input.providerKind);
  const enriched = descriptors.map((descriptor) =>
    enrichDescriptor(descriptor, adapter, enrichment),
  );
  return {
    providerKind: input.providerKind,
    capabilityProfile: input.capabilityProfile,
    retrievedAt,
    stale,
    entries: qualifyCatalog(enriched, adapter),
  };
}

/**
 * Verifies one model with the bounded structured-output smoke test and
 * persists the selection only when the pre-call connection revisions are
 * still current. No partial write happens on any failure path.
 */
export async function verifyAndSelectAiModel(
  deps: AiProviderServiceDeps,
  userId: string,
  input: {
    connectionId: string;
    capabilityProfile: AiCapabilityProfileId;
    modelId: string;
    expectedConfigRevision?: number;
  },
): Promise<AiSelectionProjection> {
  const connection = await getAiConnectionForOwner(deps.db, {
    userId,
    connectionId: input.connectionId,
  });
  if (!connection) throw connectionNotFound();
  const providerKind = connection.providerKind as AiProviderKind;
  const adapter = deps.getAdapter(providerKind);
  if (!adapter) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_PROVIDER_UNSUPPORTED,
      message: "That AI provider is not supported.",
      status: 400,
      details: { providerKind },
    });
  }

  // Pre-call revision capture: the smoke test must only commit against the
  // exact connection state observed here.
  const preCallCredentialRevision = connection.credentialRevision;
  const preCallConfigRevision = connection.configRevision;
  if (
    input.expectedConfigRevision !== undefined &&
    input.expectedConfigRevision !== preCallConfigRevision
  ) {
    throw revisionConflict(preCallConfigRevision);
  }

  const { descriptors } = await getDescriptors({
    deps,
    userId,
    connectionId: connection.id,
    credentialRevision: preCallCredentialRevision,
    providerKind,
    adapter,
    ciphertext: connection.ciphertext,
    refresh: false,
  });
  const descriptor = descriptors.find(
    (entry) => entry.modelId === input.modelId,
  );
  if (!descriptor) {
    throw modelNotSelectable({
      modelId: input.modelId,
      capabilityProfile: input.capabilityProfile,
    });
  }
  const enrichment = await safeEnrichment(providerKind);
  const enriched = enrichDescriptor(descriptor, adapter, enrichment);
  const qualification = qualifyModelForStructuredTextV1({
    descriptor: enriched,
    providerClass: adapter.providerClass,
  });
  if (qualification.state === "unsupported") {
    throw modelNotSelectable({
      modelId: input.modelId,
      capabilityProfile: input.capabilityProfile,
      unsupportedReason: qualification.reason,
    });
  }
  if (enriched.route.status !== "resolved") {
    throw modelNotSelectable({
      modelId: input.modelId,
      capabilityProfile: input.capabilityProfile,
      unsupportedReason: "route_unresolved",
    });
  }
  const resolvedRoute = enriched.route;

  let plaintext: string;
  try {
    plaintext = await decryptCredentialForCall({
      deps,
      userId,
      connectionId: connection.id,
      providerKind,
      ciphertext: connection.ciphertext,
    });
  } catch (error) {
    if (isAiCredentialEnvelopeError(error)) {
      throw aiCredentialUnavailableError(error);
    }
    throw error;
  }
  const model = await adapter.constructModel({
    credentials: { plaintext },
    modelId: enriched.modelId,
    route: resolvedRoute,
  });
  await runStructuredOutputSmokeTest({ model });

  const fingerprintInput = {
    providerKind,
    credentialRevision: preCallCredentialRevision,
    adapterVersion: adapter.adapterVersion,
    modelId: enriched.modelId,
    protocol: resolvedRoute.protocol,
    routeOrigin: resolvedRoute.origin,
    profileId: input.capabilityProfile,
    profileVersion: 1,
  };
  const snapshot = buildCapabilitySnapshot({
    contextWindowTokens: enriched.contextWindowTokens,
    fingerprintInput,
  });

  const selection = await deps.db.transaction(async (tx) => {
    await lockAiOwnerForUpdate(tx, userId);
    const locked = await lockAiConnectionForOwner(tx, {
      userId,
      connectionId: connection.id,
    });
    if (!locked) throw connectionNotFound();
    if (
      locked.credentialRevision !== preCallCredentialRevision ||
      locked.configRevision !== preCallConfigRevision
    ) {
      throw revisionConflict(locked.configRevision);
    }
    return upsertAiSelection(tx, {
      id: generateId("ams"),
      userId,
      connectionId: connection.id,
      capabilityProfile: input.capabilityProfile,
      modelId: enriched.modelId,
      protocol: resolvedRoute.protocol,
      routeOrigin: resolvedRoute.origin,
      capabilitySnapshot: JSON.parse(JSON.stringify(snapshot)) as Record<
        string,
        unknown
      >,
      verificationFingerprint: computeVerificationFingerprint(fingerprintInput),
      verifiedAt: new Date(),
    });
  });
  return toAiSelectionProjection(selection, providerKind);
}
