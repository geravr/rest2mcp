/**
 * @file Durable staged object-storage assets.
 *
 * Object storage cannot participate in the PostgreSQL transaction, so icon
 * uploads are staged as user-owned asset rows: `staging` before the S3 put,
 * `ready` after it, `attached` when a committed server revision references
 * them, and `delete_pending` when replaced or abandoned. A bounded reconciler
 * performs the actual object deletion after commit and records retryable
 * failures in non-secret metadata.
 */
import { and, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { mcpStorageAsset, type McpStorageAsset } from "@repo/db";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import type { Env } from "../lib/env.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export const SERVER_ICON_PURPOSE = "server_icon";
export const ASSET_STAGING_TTL_MS = 24 * 60 * 60 * 1000;

/** Same-origin path the SPA uses to render a stored asset. */
export function buildAssetAccessPath(objectKey: string): string {
  return `/api/storage/object?key=${encodeURIComponent(objectKey)}`;
}

export async function createStagingAsset(
  db: DB,
  input: {
    userId: string;
    objectKey: string;
    purpose?: string;
    contentType?: string | null;
    byteSize?: number | null;
    ttlMs?: number;
  },
): Promise<McpStorageAsset> {
  if (!input.objectKey.startsWith(`users/${input.userId}/`)) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Asset object key must be scoped to its owner.",
      status: 400,
    });
  }
  const expiresAt = new Date(
    Date.now() + (input.ttlMs ?? ASSET_STAGING_TTL_MS),
  );
  const [created] = await db
    .insert(mcpStorageAsset)
    .values({
      userId: input.userId,
      objectKey: input.objectKey,
      purpose: input.purpose ?? SERVER_ICON_PURPOSE,
      state: "staging",
      contentType: input.contentType ?? null,
      byteSize: input.byteSize ?? null,
      expiresAt,
    })
    .returning();
  return created;
}

/** Marks a just-uploaded staging asset ready; the only path to attachment. */
export async function markAssetReady(
  db: DB,
  userId: string,
  assetId: string,
): Promise<McpStorageAsset> {
  const [updated] = await db
    .update(mcpStorageAsset)
    .set({ state: "ready" })
    .where(
      and(
        eq(mcpStorageAsset.id, assetId),
        eq(mcpStorageAsset.userId, userId),
        eq(mcpStorageAsset.state, "staging"),
      ),
    )
    .returning();
  if (!updated) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "The uploaded asset could not be finalized.",
      status: 409,
    });
  }
  return updated;
}

/**
 * Loads an asset that may be attached to a server: it must belong to the
 * caller and be `ready` (never staging, never another user's asset).
 */
export async function requireAttachableAsset(
  db: DB,
  userId: string,
  assetId: string,
): Promise<McpStorageAsset> {
  const [asset] = await db
    .select()
    .from(mcpStorageAsset)
    .where(
      and(eq(mcpStorageAsset.id, assetId), eq(mcpStorageAsset.userId, userId)),
    )
    .limit(1);
  if (!asset) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Icon asset not found.",
      status: 404,
    });
  }
  if (asset.purpose !== SERVER_ICON_PURPOSE) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "This asset cannot be used as a server icon.",
      status: 400,
    });
  }
  if (asset.state !== "ready") {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "The icon asset is not ready to be attached.",
      status: 409,
    });
  }
  if (asset.expiresAt && asset.expiresAt.getTime() <= Date.now()) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "The icon asset expired before it could be attached.",
      status: 409,
    });
  }
  return asset;
}

export async function markAssetAttached(
  db: DB,
  userId: string,
  assetId: string,
): Promise<void> {
  // Compare-and-swap on `ready` so two concurrent attaches cannot both claim
  // the same asset (which would later let one server's cleanup delete the
  // object the other still renders).
  const claimed = await db
    .update(mcpStorageAsset)
    .set({ state: "attached", expiresAt: null })
    .where(
      and(
        eq(mcpStorageAsset.id, assetId),
        eq(mcpStorageAsset.userId, userId),
        eq(mcpStorageAsset.state, "ready"),
      ),
    )
    .returning({ id: mcpStorageAsset.id });
  if (claimed.length === 0) {
    throw appError({
      appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
      message: "The icon asset was already claimed. Reload and retry.",
      status: 409,
      details: { retryable: false },
    });
  }
}

/** Same-commit transition for replaced, cleared, or deleted-server assets. */
export async function markAssetsDeletePending(
  db: DB,
  assetIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = assetIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  await db
    .update(mcpStorageAsset)
    .set({ state: "delete_pending" })
    .where(
      and(
        inArray(mcpStorageAsset.id, ids),
        eq(mcpStorageAsset.state, "attached"),
      ),
    );
}

export async function loadAssetAccessPaths(
  db: DB,
  assetIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(assetIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: mcpStorageAsset.id, objectKey: mcpStorageAsset.objectKey })
    .from(mcpStorageAsset)
    .where(inArray(mcpStorageAsset.id, ids));
  return new Map(
    rows.map((row) => [row.id, buildAssetAccessPath(row.objectKey)]),
  );
}

export type ReconcileSummary = {
  scanned: number;
  deleted: number;
  failures: number;
  /** Age of the oldest scanned cleanup candidate, or null when none. */
  oldestPendingAgeMs: number | null;
  dryRun: boolean;
};

/**
 * Bounded cleanup pass. Deletes `delete_pending` objects and expired
 * `staging`/`ready` assets. Failures stay pending with a bounded counter in
 * non-secret metadata so a later run can retry idempotently.
 */
export async function reconcileStorageAssets(
  db: DB,
  options: {
    dryRun?: boolean;
    limit?: number;
    now?: Date;
    deleteObject: (objectKey: string) => Promise<void>;
  },
): Promise<ReconcileSummary> {
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? 50;
  const now = options.now ?? new Date();

  const candidates = await db
    .select()
    .from(mcpStorageAsset)
    .where(
      or(
        eq(mcpStorageAsset.state, "delete_pending"),
        and(
          isNotNull(mcpStorageAsset.expiresAt),
          lt(mcpStorageAsset.expiresAt, now),
          inArray(mcpStorageAsset.state, ["staging", "ready"]),
        ),
      ),
    )
    .orderBy(mcpStorageAsset.createdAt)
    .limit(limit);

  const summary: ReconcileSummary = {
    scanned: candidates.length,
    deleted: 0,
    failures: 0,
    oldestPendingAgeMs: candidates.reduce<number | null>((oldest, asset) => {
      const age = Math.max(0, now.getTime() - asset.createdAt.getTime());
      return oldest === null ? age : Math.max(oldest, age);
    }, null),
    dryRun,
  };
  if (dryRun) return summary;

  for (const asset of candidates) {
    // Defense in depth: never delete a key outside the owner's scope, even if
    // a corrupt or legacy row stored a foreign or `workspaces/` key.
    if (!asset.objectKey.startsWith(`users/${asset.userId}/`)) {
      summary.failures += 1;
      continue;
    }
    try {
      await options.deleteObject(asset.objectKey);
      // CAS on the observed state so a concurrent transition is not clobbered.
      await db
        .update(mcpStorageAsset)
        .set({ state: "deleted" })
        .where(
          and(
            eq(mcpStorageAsset.id, asset.id),
            eq(mcpStorageAsset.state, asset.state),
          ),
        );
      summary.deleted += 1;
    } catch {
      summary.failures += 1;
      const metadata = asset.metadata ?? {};
      const previous =
        typeof metadata.failureCount === "number" ? metadata.failureCount : 0;
      await db
        .update(mcpStorageAsset)
        .set({ metadata: { ...metadata, failureCount: previous + 1 } })
        .where(eq(mcpStorageAsset.id, asset.id));
    }
  }

  return summary;
}

/**
 * Opportunistic post-commit reconciliation. Best-effort and bounded: it never
 * throws to the caller and leaves failed objects `delete_pending` for the next
 * run. Object-storage failures never roll back a committed configuration.
 */
export async function reconcileServerIconAssets(
  db: DB,
  deleteObject: (objectKey: string) => Promise<void>,
  limit = 10,
): Promise<ReconcileSummary> {
  try {
    return await reconcileStorageAssets(db, { limit, deleteObject });
  } catch {
    return {
      scanned: 0,
      deleted: 0,
      failures: 0,
      oldestPendingAgeMs: null,
      dryRun: false,
    };
  }
}

/** Env-bound opportunistic sweep used after commit by request handlers. */
export async function reconcileServerIconAssetsWithEnv(
  db: DB,
  env: Env,
  limit = 10,
): Promise<ReconcileSummary> {
  const { deleteObject, resolveStorageBucket } =
    await import("../lib/storage.js");
  return reconcileServerIconAssets(
    db,
    async (objectKey) => {
      await deleteObject(env, {
        bucket: resolveStorageBucket(env),
        key: objectKey,
      });
    },
    limit,
  );
}
