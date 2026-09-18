#!/usr/bin/env bun
/**
 * Run after `bun db:migrate` when deploying harden-mcp-execution-boundary.
 *
 * Usage (from repo root, with DATABASE_URL set):
 *   bun apps/api/scripts/backfill-mcp-execution-boundary.ts
 */
import { createDb } from "../lib/db.js";
import { backfillMcpExecutionBoundary } from "../services/mcp-backfill-service.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const db = createDb(databaseUrl, { max: 1 });
const summary = await backfillMcpExecutionBoundary(db);
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
