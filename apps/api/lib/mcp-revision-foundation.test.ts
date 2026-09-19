import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  mcpServer,
  mcpServerRevision,
  mcpServerRevisionConfig,
  mcpServerRevisionTool,
} from "@repo/db";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATION_PATH = `${REPO_ROOT}db/migrations/0007_glamorous_paper_doll.sql`;

describe("revision persistence foundations", () => {
  it("adds a draft revision and nullable active pointer to servers", () => {
    const columns = getTableColumns(mcpServer);
    expect("draftRevision" in columns).toBe(true);
    expect(columns.draftRevision.notNull).toBe(true);
    expect(columns.draftRevision.default).toBe(1);
    expect("publishedRevisionId" in columns).toBe(true);
    expect(columns.publishedRevisionId.notNull).toBe(false);
  });

  it("declares the immutable revision, tool, and config tables", () => {
    const revisionColumns = getTableColumns(mcpServerRevision);
    expect(revisionColumns.revisionNumber.notNull).toBe(true);
    expect(revisionColumns.sourceDraftRevision.notNull).toBe(true);
    expect(revisionColumns.candidateFingerprint.notNull).toBe(true);
    expect(revisionColumns.contractFingerprint.notNull).toBe(true);
    expect(revisionColumns.publishRequestId.notNull).toBe(true);
    expect(revisionColumns.actorSource.notNull).toBe(true);

    const toolColumns = getTableColumns(mcpServerRevisionTool);
    expect(toolColumns.sourceToolId.notNull).toBe(true);
    expect(toolColumns.toolOrder.notNull).toBe(true);
    expect(toolColumns.contractFingerprint.notNull).toBe(false);

    const configColumns = getTableColumns(mcpServerRevisionConfig);
    expect(configColumns.sourceValueId.notNull).toBe(true);
    expect(configColumns.isSecret.notNull).toBe(true);
    expect(configColumns.value.notNull).toBe(false);
  });

  it("creates the tables and columns through the generated migration", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toContain('CREATE TABLE "mcp_server_revision"');
    expect(sql).toContain('CREATE TABLE "mcp_server_revision_config"');
    expect(sql).toContain('CREATE TABLE "mcp_server_revision_tool"');
    expect(sql).toContain(
      'ADD COLUMN "draft_revision" integer DEFAULT 1 NOT NULL',
    );
    expect(sql).toContain('ADD COLUMN "published_revision_id" text');
    expect(sql).toContain(
      'CONSTRAINT "mcp_server_revision_number_unique" UNIQUE("server_id","revision_number")',
    );
    expect(sql).toContain(
      'CONSTRAINT "mcp_server_revision_request_unique" UNIQUE("server_id","publish_request_id")',
    );
    expect(sql).toContain(
      'CONSTRAINT "mcp_server_revision_tool_source_unique" UNIQUE("revision_id","source_tool_id")',
    );
    expect(sql).toContain(
      'CONSTRAINT "mcp_server_revision_config_source_unique" UNIQUE("revision_id","source_value_id")',
    );
    expect(sql).toContain("mcp_server_published_revision_idx");
  });

  it("never backfills an active revision during the migration", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).not.toMatch(/\bINSERT INTO\b/i);
    expect(sql).not.toMatch(/SET\s+"published_revision_id"/i);
    expect(sql).not.toMatch(/UPDATE\s+"mcp_server"/i);
  });
});
