#!/usr/bin/env bun
/**
 * Bounded reconciliation for staged, replaced, or abandoned MCP icon assets.
 *
 * Deletes `delete_pending` objects and expired `staging`/`ready` assets.
 * Failures stay pending with a bounded retry counter and are safe to re-run.
 *
 * Usage (from the repo root):
 *   bun apps/api/scripts/reconcile-mcp-assets.ts --dry-run
 *   bun apps/api/scripts/reconcile-mcp-assets.ts --limit=100
 *
 * `--dry-run` reports what would be deleted without contacting object storage,
 * so it does not require S3 credentials.
 */
import { createDb } from "../lib/db.js";
import { reconcileStorageAssets } from "../services/mcp-asset-service.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 50;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const db = createDb(databaseUrl, { max: 1 });

const summary = await reconcileStorageAssets(db, {
  dryRun,
  limit,
  deleteObject: async (objectKey) => {
    const { env } = await import("../lib/env.js");
    const { deleteObject, resolveStorageBucket } =
      await import("../lib/storage.js");
    await deleteObject(env, {
      bucket: resolveStorageBucket(env),
      key: objectKey,
    });
  },
});

console.log(JSON.stringify(summary, null, 2));
process.exit(0);
