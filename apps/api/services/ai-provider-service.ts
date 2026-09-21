/**
 * @file Owner-scoped AI provider connection lifecycle. External provider
 * calls happen strictly outside database transactions; connection mutations
 * take locks in `user -> connection` order, compare optimistic revisions,
 * and never persist unverified credentials. Projections returned from here
 * are secret-free.
 */
import {
  APP_ERROR_CODES,
  type AiCapabilityProfileId,
  type AiConnectionProjection,
  type AiProviderKind,
  type AiReadiness,
} from "@repo/core";
import type { AiProviderConnectionSelect } from "@repo/db";
import { generateId } from "@repo/db";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { appError } from "../lib/app-error.js";
import {
  encryptAiCredential,
  AiCredentialEnvelopeError,
} from "../lib/ai-crypto.js";
import { evaluateSelectionCurrentness } from "../lib/ai/readiness.js";
import { parseCapabilitySnapshot } from "../lib/ai/verification.js";
import { mapAiProviderRequestError } from "../lib/ai/error-mapping.js";
import type { AiProviderAdapter } from "../lib/ai/provider-adapter.js";
import {
  deleteAiConnectionForOwner,
  getAiConnectionByProviderForOwner,
  getAiConnectionForOwner,
  getAiSelectionForOwner,
  insertAiConnection,
  listAiConnectionsForOwner,
  lockAiConnectionForOwner,
  lockAiOwnerForUpdate,
  toAiConnectionProjection,
  toAiSelectionProjection,
  updateAiConnection,
} from "./ai-provider-repository.js";
import { aiCatalogCache } from "./ai-catalog-cache.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type AiProviderServiceDeps = {
  db: DB;
  aiCredentialSecret: string;
  getAdapter: (providerKind: AiProviderKind) => AiProviderAdapter | undefined;
};

function connectionNotFound(): ReturnType<typeof appError> {
  return appError({
    appCode: APP_ERROR_CODES.AI_CONNECTION_NOT_FOUND,
    message: "AI provider connection not found.",
    status: 404,
  });
}

function revisionConflict(
  currentRevision: number,
): ReturnType<typeof appError> {
  return appError({
    appCode: APP_ERROR_CODES.AI_CONNECTION_REVISION_CONFLICT,
    message: "The connection changed elsewhere. Reload and retry.",
    status: 409,
    details: { currentRevision },
  });
}

export async function listAiConnections(
  deps: AiProviderServiceDeps,
  userId: string,
): Promise<{ connections: AiConnectionProjection[] }> {
  const rows = await listAiConnectionsForOwner(deps.db, userId);
  return { connections: rows.map(toAiConnectionProjection) };
}

/**
 * Server-side availability of one capability profile. Every AI feature
 * endpoint re-enforces this check independently of the UI.
 */
export async function getAiReadiness(
  deps: AiProviderServiceDeps,
  userId: string,
  capabilityProfile: AiCapabilityProfileId,
): Promise<AiReadiness> {
  const base = { capabilityProfile };
  const selection = await getAiSelectionForOwner(deps.db, {
    userId,
    capabilityProfile,
  });
  const connections = await listAiConnectionsForOwner(deps.db, userId);
  if (!selection) {
    return {
      ...base,
      ready: false,
      reason: connections.length > 0 ? "no_selection" : "no_connection",
      selection: null,
    };
  }
  const connection = await getAiConnectionForOwner(deps.db, {
    userId,
    connectionId: selection.connectionId,
  });
  if (!connection) {
    return { ...base, ready: false, reason: "no_connection", selection: null };
  }
  if (!connection.verifiedAt) {
    return {
      ...base,
      ready: false,
      reason: "connection_unverified",
      selection: null,
    };
  }

  const providerKind = connection.providerKind as AiProviderKind;
  const adapter = deps.getAdapter(providerKind);
  if (!adapter) {
    return { ...base, ready: false, reason: "no_connection", selection: null };
  }
  const currentness = evaluateSelectionCurrentness({
    snapshot: parseCapabilitySnapshot(selection.capabilitySnapshot),
    storedFingerprint: selection.verificationFingerprint,
    profileId: capabilityProfile,
    current: {
      providerKind,
      credentialRevision: connection.credentialRevision,
      adapterVersion: adapter.adapterVersion,
    },
  });
  const projection = toAiSelectionProjection(selection, providerKind);
  if (!currentness.current) {
    return {
      ...base,
      ready: false,
      reason:
        currentness.reason === "model_removed"
          ? "model_unavailable"
          : "selection_stale",
      selection: projection,
    };
  }
  return { ...base, ready: true, reason: null, selection: projection };
}

/** Guard for AI feature endpoints: throws unless the profile is ready. */
export async function assertAiFeatureReady(
  deps: AiProviderServiceDeps,
  userId: string,
  capabilityProfile: AiCapabilityProfileId,
): Promise<void> {
  const readiness = await getAiReadiness(deps, userId, capabilityProfile);
  if (!readiness.ready) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_FEATURE_NOT_READY,
      message: "AI is not configured for this capability profile.",
      status: 412,
      details: { capabilityProfile },
    });
  }
}

async function verifyOrThrow(input: {
  adapter: AiProviderAdapter;
  credential: string;
  providerKind: AiProviderKind;
}) {
  try {
    await input.adapter.verifyCredential({
      credentials: { plaintext: input.credential },
    });
  } catch (error) {
    throw mapAiProviderRequestError({
      error,
      operation: "verification",
      providerKind: input.providerKind,
    });
  }
}

/**
 * Connects a supported provider. The credential is verified against the
 * provider before any write; invalid credentials are never persisted.
 */
export async function connectAiProvider(
  deps: AiProviderServiceDeps,
  userId: string,
  input: { providerKind: AiProviderKind; credential: string },
): Promise<AiConnectionProjection> {
  const adapter = deps.getAdapter(input.providerKind);
  if (!adapter) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_PROVIDER_UNSUPPORTED,
      message: "That AI provider is not supported.",
      status: 400,
      details: { providerKind: input.providerKind },
    });
  }
  const existing = await getAiConnectionByProviderForOwner(deps.db, {
    userId,
    providerKind: input.providerKind,
  });
  if (existing) {
    throw revisionConflict(existing.configRevision);
  }

  await verifyOrThrow({
    adapter,
    credential: input.credential,
    providerKind: input.providerKind,
  });

  const connectionId = generateId("aic");
  let ciphertext: string;
  try {
    ciphertext = encryptAiCredential(
      input.credential,
      { userId, connectionId, providerKind: input.providerKind },
      deps.aiCredentialSecret,
    );
  } catch (error) {
    if (error instanceof AiCredentialEnvelopeError) {
      throw appError({
        appCode: APP_ERROR_CODES.AI_CREDENTIAL_UNAVAILABLE,
        message: "The credential could not be encrypted.",
        status: 503,
      });
    }
    throw error;
  }

  const row = await deps.db.transaction(async (tx) => {
    await lockAiOwnerForUpdate(tx, userId);
    try {
      return await insertAiConnection(tx, {
        id: connectionId,
        userId,
        providerKind: input.providerKind,
        ciphertext,
        verifiedAt: new Date(),
        lastAttemptAt: new Date(),
      });
    } catch (error) {
      // A concurrent connect for the same provider won the unique constraint.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "23505"
      ) {
        throw revisionConflict(1);
      }
      throw error;
    }
  });
  return toAiConnectionProjection(row);
}

/**
 * Replaces a connection credential. Verification of the replacement happens
 * before any write; on any failure the stored connection, revisions, and
 * selections remain untouched.
 */
export async function rotateAiProviderCredential(
  deps: AiProviderServiceDeps,
  userId: string,
  input: {
    connectionId: string;
    credential: string;
    expectedConfigRevision: number;
    expectedCredentialRevision?: number;
  },
): Promise<AiConnectionProjection> {
  const current = await getAiConnectionForOwner(deps.db, {
    userId,
    connectionId: input.connectionId,
  });
  if (!current) throw connectionNotFound();
  const providerKind = current.providerKind as AiProviderKind;
  const adapter = deps.getAdapter(providerKind);
  if (!adapter) {
    throw appError({
      appCode: APP_ERROR_CODES.AI_PROVIDER_UNSUPPORTED,
      message: "That AI provider is not supported.",
      status: 400,
      details: { providerKind },
    });
  }

  await verifyOrThrow({ adapter, credential: input.credential, providerKind });

  let ciphertext: string;
  try {
    ciphertext = encryptAiCredential(
      input.credential,
      { userId, connectionId: input.connectionId, providerKind },
      deps.aiCredentialSecret,
    );
  } catch (error) {
    if (error instanceof AiCredentialEnvelopeError) {
      throw appError({
        appCode: APP_ERROR_CODES.AI_CREDENTIAL_UNAVAILABLE,
        message: "The credential could not be encrypted.",
        status: 503,
      });
    }
    throw error;
  }

  const row = await deps.db.transaction(async (tx) => {
    await lockAiOwnerForUpdate(tx, userId);
    const locked = await lockAiConnectionForOwner(tx, {
      userId,
      connectionId: input.connectionId,
    });
    if (!locked) throw connectionNotFound();
    if (locked.configRevision !== input.expectedConfigRevision) {
      throw revisionConflict(locked.configRevision);
    }
    if (
      input.expectedCredentialRevision !== undefined &&
      locked.credentialRevision !== input.expectedCredentialRevision
    ) {
      throw revisionConflict(locked.configRevision);
    }
    return updateAiConnection(tx, {
      userId,
      connectionId: input.connectionId,
      patch: {
        ciphertext,
        credentialRevision: locked.credentialRevision + 1,
        configRevision: locked.configRevision + 1,
        verifiedAt: new Date(),
        lastErrorCode: null,
        lastAttemptAt: new Date(),
      },
    });
  });
  if (!row) throw connectionNotFound();
  aiCatalogCache.invalidateConnection(input.connectionId);
  return toAiConnectionProjection(row);
}

/**
 * Removes a confirmed connection atomically; dependent model selections
 * cascade in the same transaction and the catalog cache is invalidated.
 */
export async function removeAiConnection(
  deps: AiProviderServiceDeps,
  userId: string,
  input: { connectionId: string; expectedConfigRevision: number },
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await lockAiOwnerForUpdate(tx, userId);
    const locked = await lockAiConnectionForOwner(tx, {
      userId,
      connectionId: input.connectionId,
    });
    if (!locked) throw connectionNotFound();
    if (locked.configRevision !== input.expectedConfigRevision) {
      throw revisionConflict(locked.configRevision);
    }
    await deleteAiConnectionForOwner(tx, {
      userId,
      connectionId: input.connectionId,
    });
  });
  aiCatalogCache.invalidateConnection(input.connectionId);
}

export type { AiProviderConnectionSelect };
