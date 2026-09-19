import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import { generateAuthId, mcpStorageAsset, schema, user } from "@repo/db";
import {
  createStagingAsset,
  markAssetReady,
  reconcileStorageAssets,
} from "./mcp-asset-service.js";
import { deleteServer, updateServer } from "./mcp-studio-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

describeIntegration("staged icon assets and reconciliation", () => {
  const ownerId = generateAuthId("user");
  const otherId = generateAuthId("user");
  const serverId = "mcs_asset_integration";
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  async function currentRevision(id: string = serverId): Promise<number> {
    const [row] = await db
      .select({ configRevision: schema.mcpServer.configRevision })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, id));
    return row!.configRevision;
  }

  async function readyAsset(objectKey: string) {
    const staging = await createStagingAsset(db as never, {
      userId: ownerId,
      objectKey,
    });
    return markAssetReady(db as never, ownerId, staging.id);
  }

  async function assetState(id: string) {
    const [row] = await db
      .select({ state: mcpStorageAsset.state })
      .from(mcpStorageAsset)
      .where(eq(mcpStorageAsset.id, id));
    return row?.state;
  }

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 4 });
    db = drizzle(client, { schema, casing: "snake_case" });
    for (const [id, name] of [
      [ownerId, "Asset Owner"],
      [otherId, "Other Owner"],
    ]) {
      await db.insert(user).values({
        id: id!,
        name: name!,
        email: `${id}@example.com`,
        emailVerified: true,
      });
    }
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId: ownerId,
      name: "Asset Server",
      slug: serverId,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, ownerId));
    await db.delete(user).where(eq(user.id, otherId));
    await client.end();
  });

  it("attaches a ready owned asset, replaces it, and clears it atomically", async () => {
    const first = await readyAsset(`users/${ownerId}/server-icons/first.png`);
    await updateServer(db as never, ownerId, serverId, {
      expectedRevision: await currentRevision(),
      iconAssetId: first.id,
    });
    expect(await assetState(first.id)).toBe("attached");

    const second = await readyAsset(`users/${ownerId}/server-icons/second.png`);
    await updateServer(db as never, ownerId, serverId, {
      expectedRevision: await currentRevision(),
      iconAssetId: second.id,
    });
    // The replaced asset is marked in the same commit as the revision change.
    expect(await assetState(second.id)).toBe("attached");
    expect(await assetState(first.id)).toBe("delete_pending");

    await updateServer(db as never, ownerId, serverId, {
      expectedRevision: await currentRevision(),
      iconAssetId: null,
    });
    expect(await assetState(second.id)).toBe("delete_pending");
  });

  it("rejects another user's asset and staging assets", async () => {
    const foreign = await createStagingAsset(db as never, {
      userId: otherId,
      objectKey: `users/${otherId}/server-icons/foreign.png`,
    });
    await expect(
      updateServer(db as never, ownerId, serverId, {
        expectedRevision: await currentRevision(),
        iconAssetId: foreign.id,
      }),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.INVALID_INPUT });

    const staging = await createStagingAsset(db as never, {
      userId: ownerId,
      objectKey: `users/${ownerId}/server-icons/not-ready.png`,
    });
    await expect(
      updateServer(db as never, ownerId, serverId, {
        expectedRevision: await currentRevision(),
        iconAssetId: staging.id,
      }),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.INVALID_INPUT });
  });

  it("keeps the previous icon and leaves the new asset unattached when the mutation fails", async () => {
    const current = await readyAsset(
      `users/${ownerId}/server-icons/current.png`,
    );
    await updateServer(db as never, ownerId, serverId, {
      expectedRevision: await currentRevision(),
      iconAssetId: current.id,
    });
    const attempted = await readyAsset(
      `users/${ownerId}/server-icons/attempted.png`,
    );

    await expect(
      updateServer(db as never, ownerId, serverId, {
        // Stale revision forces a conflict after the asset was staged/ready.
        expectedRevision: 1,
        iconAssetId: attempted.id,
      }),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT });

    const [serverRow] = await db
      .select({ iconAssetId: schema.mcpServer.iconAssetId })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    expect(serverRow?.iconAssetId).toBe(current.id);
    // The unattached asset remains eligible for durable garbage collection.
    expect(await assetState(attempted.id)).toBe("ready");
    await updateServer(db as never, ownerId, serverId, {
      expectedRevision: await currentRevision(),
      iconAssetId: null,
    });
  });

  it("marks the attached asset for deletion when the server is deleted", async () => {
    const attached = await readyAsset(
      `users/${ownerId}/server-icons/attached.png`,
    );
    await updateServer(db as never, ownerId, serverId, {
      expectedRevision: await currentRevision(),
      iconAssetId: attached.id,
    });
    await deleteServer(db as never, ownerId, serverId, await currentRevision());
    expect(await assetState(attached.id)).toBe("delete_pending");
  });

  it("reconciles pending objects once and is idempotent on a second run", async () => {
    const dryRun = await reconcileStorageAssets(db as never, {
      dryRun: true,
      deleteObject: async () => {
        throw new Error("dry-run must not delete");
      },
    });
    expect(dryRun.scanned).toBeGreaterThan(0);
    expect(dryRun.deleted).toBe(0);
    expect(dryRun.oldestPendingAgeMs).not.toBeNull();

    const deletedKeys: string[] = [];
    const first = await reconcileStorageAssets(db as never, {
      deleteObject: async (key) => {
        deletedKeys.push(key);
      },
    });
    expect(first.dryRun).toBe(false);
    expect(first.deleted).toBe(first.scanned);
    expect(first.failures).toBe(0);
    expect(deletedKeys.length).toBeGreaterThan(0);
    for (const key of deletedKeys) {
      expect(key).not.toContain("workspaces/");
    }

    const second = await reconcileStorageAssets(db as never, {
      deleteObject: async () => {
        throw new Error("should not be called");
      },
    });
    expect(second.scanned).toBe(0);
  });
  it("retains a failed deletion as delete_pending and succeeds on retry", async () => {
    // Dedicated server so this test is independent of the shared one.
    const failureServerId = "mcs_asset_failure";
    await db.insert(schema.mcpServer).values({
      id: failureServerId,
      userId: ownerId,
      name: "Failure Server",
      slug: failureServerId,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
    const doomed = await readyAsset(`users/${ownerId}/server-icons/doomed.png`);
    await updateServer(db as never, ownerId, failureServerId, {
      expectedRevision: await currentRevision(failureServerId),
      iconAssetId: doomed.id,
    });
    await updateServer(db as never, ownerId, failureServerId, {
      expectedRevision: await currentRevision(failureServerId),
      iconAssetId: null,
    });
    expect(await assetState(doomed.id)).toBe("delete_pending");

    const failed = await reconcileStorageAssets(db as never, {
      limit: 100,
      deleteObject: async () => {
        throw new Error("S3 unavailable");
      },
    });
    expect(failed.scanned).toBeGreaterThanOrEqual(1);
    expect(failed.deleted).toBe(0);
    expect(failed.failures).toBe(failed.scanned);
    expect(await assetState(doomed.id)).toBe("delete_pending");
    const [doomedRow] = await db
      .select({ metadata: mcpStorageAsset.metadata })
      .from(mcpStorageAsset)
      .where(eq(mcpStorageAsset.id, doomed.id));
    expect(doomedRow?.metadata?.failureCount).toBeGreaterThanOrEqual(1);

    const retried = await reconcileStorageAssets(db as never, {
      limit: 100,
      deleteObject: async () => {},
    });
    expect(retried.deleted).toBeGreaterThanOrEqual(1);
    expect(await assetState(doomed.id)).toBe("deleted");
  });
});
