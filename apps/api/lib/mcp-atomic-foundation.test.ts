import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { mcpAgentToken, mcpServer, mcpStorageAsset } from "@repo/db";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATION_PATH = `${REPO_ROOT}db/migrations/0005_atomic_studio_writes.sql`;

describe("atomic studio write persistence foundations", () => {
  it("gives every server a non-null default configuration revision", () => {
    const columns = getTableColumns(mcpServer);
    expect("configRevision" in columns).toBe(true);
    expect(columns.configRevision.notNull).toBe(true);
    expect(columns.configRevision.default).toBe(1);
  });

  it("stores the icon as an owned asset reference and drops the legacy URL field", () => {
    const serverColumns = getTableColumns(mcpServer);
    expect("iconAssetId" in serverColumns).toBe(true);
    expect(serverColumns.iconAssetId.notNull).toBe(false);
    expect("iconImage" in serverColumns).toBe(false);

    const assetColumns = getTableColumns(mcpStorageAsset);
    expect(assetColumns.userId.notNull).toBe(true);
    expect(assetColumns.objectKey.notNull).toBe(true);
    expect(assetColumns.purpose.notNull).toBe(true);
    expect(assetColumns.state.default).toBe("staging");
  });

  it("constrains asset lifecycle states", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toContain("mcp_storage_asset_state_check");
    expect(sql).toContain(
      "'staging', 'ready', 'attached', 'delete_pending', 'deleted'",
    );
    expect(sql).not.toContain('ADD COLUMN "icon_image"');
  });

  it("enforces multi-PAT hash and active-name uniqueness without a singleton token", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toContain("mcp_agent_token_hash_unique");
    expect(sql).toContain("mcp_agent_token_active_name_unique");
    expect(sql).toMatch(/WHERE .*revoked_at.*is null/i);
    expect(sql).not.toMatch(/singleton/i);
  });

  it("carries rotation metadata for selected-token compare-and-swap", () => {
    const tokenColumns = getTableColumns(mcpAgentToken);
    expect("replacedByTokenId" in tokenColumns).toBe(true);
    expect("rotationMeta" in tokenColumns).toBe(true);
  });

  it("creates the revision and asset columns through the generated migration", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toContain(
      'ADD COLUMN "config_revision" integer DEFAULT 1 NOT NULL',
    );
    expect(sql).toContain('ADD COLUMN "icon_asset_id" text');
    expect(sql).toContain('DROP COLUMN "icon_image"');
    expect(sql).toContain("mcp_storage_asset_object_key_unique");
  });
});
