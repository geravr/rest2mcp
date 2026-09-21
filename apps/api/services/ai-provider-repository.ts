/**
 * @file Owner-scoped repository helpers for AI provider connections and
 * model selections. Callers that touch more than one row must lock in
 * `user -> connection -> selection` order inside a transaction; every read
 * and write is scoped by userId so cross-owner access resolves to not-found.
 * Projections returned to callers outside the service layer never include
 * ciphertext.
 */
import {
  aiModelSelection,
  aiProviderConnection,
  type AiModelSelectionSelect,
  type AiProviderConnectionSelect,
} from "@repo/db";
import {
  aiModelProtocolSchema,
  aiProviderKindSchema,
  isAppErrorCode,
  type AiCapabilityProfileId,
  type AiConnectionProjection,
  type AiProviderKind,
  type AiSelectionProjection,
} from "@repo/core";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { user } from "@repo/db";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export type AiWriteTx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type AiDbExecutor = DB | AiWriteTx;

/** Locks the owner row first so every AI mutation takes locks in one order. */
export async function lockAiOwnerForUpdate(tx: AiWriteTx, userId: string) {
  await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userId))
    .for("update")
    .limit(1);
}

export async function getAiConnectionForOwner(
  db: AiDbExecutor,
  input: { userId: string; connectionId: string },
): Promise<AiProviderConnectionSelect | null> {
  const [row] = await db
    .select()
    .from(aiProviderConnection)
    .where(
      and(
        eq(aiProviderConnection.id, input.connectionId),
        eq(aiProviderConnection.userId, input.userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getAiConnectionByProviderForOwner(
  db: AiDbExecutor,
  input: { userId: string; providerKind: AiProviderKind },
): Promise<AiProviderConnectionSelect | null> {
  const [row] = await db
    .select()
    .from(aiProviderConnection)
    .where(
      and(
        eq(aiProviderConnection.userId, input.userId),
        eq(aiProviderConnection.providerKind, input.providerKind),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listAiConnectionsForOwner(
  db: AiDbExecutor,
  userId: string,
): Promise<AiProviderConnectionSelect[]> {
  return db
    .select()
    .from(aiProviderConnection)
    .where(eq(aiProviderConnection.userId, userId));
}

/** Locks one owner connection row; must run after `lockAiOwnerForUpdate`. */
export async function lockAiConnectionForOwner(
  tx: AiWriteTx,
  input: { userId: string; connectionId: string },
): Promise<AiProviderConnectionSelect | null> {
  const [row] = await tx
    .select()
    .from(aiProviderConnection)
    .where(
      and(
        eq(aiProviderConnection.id, input.connectionId),
        eq(aiProviderConnection.userId, input.userId),
      ),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function lockAiConnectionByProviderForOwner(
  tx: AiWriteTx,
  input: { userId: string; providerKind: AiProviderKind },
): Promise<AiProviderConnectionSelect | null> {
  const [row] = await tx
    .select()
    .from(aiProviderConnection)
    .where(
      and(
        eq(aiProviderConnection.userId, input.userId),
        eq(aiProviderConnection.providerKind, input.providerKind),
      ),
    )
    .for("update")
    .limit(1);
  return row ?? null;
}

export async function insertAiConnection(
  tx: AiDbExecutor,
  values: typeof aiProviderConnection.$inferInsert,
): Promise<AiProviderConnectionSelect> {
  const [row] = await tx
    .insert(aiProviderConnection)
    .values(values)
    .returning();
  return row;
}

export async function updateAiConnection(
  tx: AiDbExecutor,
  input: {
    userId: string;
    connectionId: string;
    patch: Partial<typeof aiProviderConnection.$inferInsert>;
  },
): Promise<AiProviderConnectionSelect | null> {
  const [row] = await tx
    .update(aiProviderConnection)
    .set(input.patch)
    .where(
      and(
        eq(aiProviderConnection.id, input.connectionId),
        eq(aiProviderConnection.userId, input.userId),
      ),
    )
    .returning();
  return row ?? null;
}

/** Deletes the connection; selections cascade inside the same transaction. */
export async function deleteAiConnectionForOwner(
  tx: AiDbExecutor,
  input: { userId: string; connectionId: string },
): Promise<boolean> {
  const deleted = await tx
    .delete(aiProviderConnection)
    .where(
      and(
        eq(aiProviderConnection.id, input.connectionId),
        eq(aiProviderConnection.userId, input.userId),
      ),
    )
    .returning({ id: aiProviderConnection.id });
  return deleted.length > 0;
}

export async function getAiSelectionForOwner(
  db: AiDbExecutor,
  input: { userId: string; capabilityProfile: AiCapabilityProfileId },
): Promise<AiModelSelectionSelect | null> {
  const [row] = await db
    .select()
    .from(aiModelSelection)
    .where(
      and(
        eq(aiModelSelection.userId, input.userId),
        eq(aiModelSelection.capabilityProfile, input.capabilityProfile),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listAiSelectionsForOwner(
  db: AiDbExecutor,
  userId: string,
): Promise<AiModelSelectionSelect[]> {
  return db
    .select()
    .from(aiModelSelection)
    .where(eq(aiModelSelection.userId, userId));
}

export async function listAiSelectionsForConnection(
  db: AiDbExecutor,
  input: { userId: string; connectionId: string },
): Promise<AiModelSelectionSelect[]> {
  return db
    .select()
    .from(aiModelSelection)
    .where(
      and(
        eq(aiModelSelection.userId, input.userId),
        eq(aiModelSelection.connectionId, input.connectionId),
      ),
    );
}

/** Locks every owner selection row; must run after the connection lock. */
export async function lockAiSelectionsForOwner(
  tx: AiWriteTx,
  userId: string,
): Promise<AiModelSelectionSelect[]> {
  return tx
    .select()
    .from(aiModelSelection)
    .where(eq(aiModelSelection.userId, userId))
    .for("update");
}

export async function upsertAiSelection(
  tx: AiDbExecutor,
  values: typeof aiModelSelection.$inferInsert,
): Promise<AiModelSelectionSelect> {
  const [row] = await tx
    .insert(aiModelSelection)
    .values(values)
    .onConflictDoUpdate({
      target: [aiModelSelection.userId, aiModelSelection.capabilityProfile],
      set: {
        connectionId: values.connectionId,
        modelId: values.modelId,
        protocol: values.protocol,
        routeOrigin: values.routeOrigin,
        capabilitySnapshot: values.capabilitySnapshot,
        verificationFingerprint: values.verificationFingerprint,
        verifiedAt: values.verifiedAt ?? new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function deleteAiSelectionsForConnection(
  tx: AiDbExecutor,
  input: { userId: string; connectionId: string },
): Promise<number> {
  const deleted = await tx
    .delete(aiModelSelection)
    .where(
      and(
        eq(aiModelSelection.userId, input.userId),
        eq(aiModelSelection.connectionId, input.connectionId),
      ),
    )
    .returning({ id: aiModelSelection.id });
  return deleted.length;
}

/** Secret-free projection: ciphertext never leaves the service layer. */
export function toAiConnectionProjection(
  row: AiProviderConnectionSelect,
): AiConnectionProjection {
  return {
    id: row.id,
    providerKind: aiProviderKindSchema.parse(row.providerKind),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    configRevision: row.configRevision,
    credentialRevision: row.credentialRevision,
    verifiedAt: row.verifiedAt,
    lastErrorCode:
      row.lastErrorCode && isAppErrorCode(row.lastErrorCode)
        ? row.lastErrorCode
        : null,
    lastAttemptAt: row.lastAttemptAt,
  };
}

export function toAiSelectionProjection(
  row: AiModelSelectionSelect,
  providerKind: AiProviderKind,
): AiSelectionProjection {
  return {
    connectionId: row.connectionId,
    providerKind: aiProviderKindSchema.parse(providerKind),
    capabilityProfile: row.capabilityProfile as AiCapabilityProfileId,
    modelId: row.modelId,
    protocol: aiModelProtocolSchema.parse(row.protocol),
    verifiedAt: row.verifiedAt,
  };
}
