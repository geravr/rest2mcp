#!/usr/bin/env bun
/**
 * Bounded retention for immutable MCP publication revisions.
 *
 * Always retains the active revision plus at least the newest 20 revisions per
 * server. Only superseded revisions older than the retention window are
 * deleted, and children cascade with the parent revision.
 *
 * Usage (from the repo root):
 *   bun apps/api/scripts/cleanup-mcp-revisions.ts --dry-run
 *   bun apps/api/scripts/cleanup-mcp-revisions.ts --retention-days=90
 *   bun apps/api/scripts/cleanup-mcp-revisions.ts --minimum-retained=20
 *
 * `--dry-run` reports what would be deleted without deleting anything.
 */
import { createDb } from "../lib/db.js";
import { cleanupSupersededRevisions } from "../services/mcp-publishing-service.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function numericOption(prefix: string): number | undefined {
  const arg = args.find((value) => value.startsWith(`${prefix}=`));
  if (!arg) return undefined;
  const parsed = Number(arg.slice(prefix.length + 1));
  return Number.isFinite(parsed) ? parsed : undefined;
}

const retentionDays = numericOption("--retention-days");
const minimumRetained = numericOption("--minimum-retained");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const db = createDb(databaseUrl, { max: 1 });

const summary = await cleanupSupersededRevisions(
  db as unknown as Parameters<typeof cleanupSupersededRevisions>[0],
  {
    dryRun,
    ...(retentionDays !== undefined ? { retentionDays } : {}),
    ...(minimumRetained !== undefined ? { minimumRetained } : {}),
  },
);

console.log(
  JSON.stringify(
    {
      dryRun,
      ...(retentionDays !== undefined ? { retentionDays } : {}),
      ...(minimumRetained !== undefined ? { minimumRetained } : {}),
      ...summary,
    },
    null,
    2,
  ),
);
process.exit(0);
