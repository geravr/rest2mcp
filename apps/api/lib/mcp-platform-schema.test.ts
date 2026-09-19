import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { MCP_PLATFORM_SECURITY_EVENT_RETENTION_DAYS } from "@repo/core";
import {
  MCP_PLATFORM_SECURITY_EVENT_OUTCOMES,
  MCP_PLATFORM_SECURITY_EVENT_TYPES,
  mcpAgentToken,
  mcpPlatformSecurityEvent,
  mcpPlatformStepUpGrant,
  mcpPlatformTokenScope,
  mcpPlatformTokenServerGrant,
} from "@repo/db";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../db/migrations", import.meta.url),
);
const MIGRATION_PATH = join(MIGRATIONS_DIR, "0006_married_lightspeed.sql");

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function allMigrationsSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
}

function findForeignKey(
  table: PgTable,
  foreignTableName: string,
  columnName: string,
) {
  return getTableConfig(table).foreignKeys.find((fk) => {
    const reference = fk.reference();
    const matchesColumn = reference.columns.some(
      (column) =>
        column.name === columnName ||
        column.name ===
          columnName.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
    );
    return (
      getTableName(reference.foreignTable) === foreignTableName && matchesColumn
    );
  });
}

describe("platform grant storage migration", () => {
  it("creates the four normalized platform tables and drops the legacy scope column", () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "mcp_platform_token_scope"');
    expect(sql).toContain('CREATE TABLE "mcp_platform_token_server_grant"');
    expect(sql).toContain('CREATE TABLE "mcp_platform_step_up_grant"');
    expect(sql).toContain('CREATE TABLE "mcp_platform_security_event"');
    expect(sql).toContain(
      'ALTER TABLE "mcp_agent_token" DROP COLUMN "scopes";',
    );
  });

  it("performs the intentional pre-production platform PAT cutover", () => {
    const sql = migrationSql();
    expect(sql).toContain(
      `DELETE FROM "mcp_agent_token" WHERE "kind" = 'platform';`,
    );
    expect(sql).not.toContain(`WHERE "kind" = 'server'`);
  });

  it("enforces normalized grant and token uniqueness without a singleton token", () => {
    const sql = migrationSql();
    expect(sql).toContain(
      'CONSTRAINT "mcp_platform_token_scope_token_scope_unique" UNIQUE("token_id","scope")',
    );
    expect(sql).toContain(
      'CONSTRAINT "mcp_platform_token_server_grant_token_server_unique" UNIQUE("token_id","server_id")',
    );

    const all = allMigrationsSql();
    expect(all).toContain("mcp_agent_token_hash_unique");

    const activeNameIndex = getTableConfig(mcpAgentToken).indexes.find(
      (index) => index.config.name === "mcp_agent_token_active_name_unique",
    );
    expect(activeNameIndex?.config.unique).toBe(true);
    expect(activeNameIndex?.config.where).toBeDefined();
    expect(all).toMatch(
      /CREATE UNIQUE INDEX "mcp_agent_token_active_name_unique"[\s\S]*?WHERE/,
    );
    expect(all).not.toMatch(/singleton/i);
  });
});

describe("platform grant referential integrity", () => {
  it("cascades scope and server-grant rows when their token is deleted", () => {
    const scopeToken = findForeignKey(
      mcpPlatformTokenScope,
      "mcp_agent_token",
      "token_id",
    );
    expect(scopeToken?.onDelete).toBe("cascade");

    const grantToken = findForeignKey(
      mcpPlatformTokenServerGrant,
      "mcp_agent_token",
      "token_id",
    );
    expect(grantToken?.onDelete).toBe("cascade");
  });

  it("cascades server grants when the granted server is deleted", () => {
    const grantServer = findForeignKey(
      mcpPlatformTokenServerGrant,
      "mcp_server",
      "server_id",
    );
    expect(grantServer?.onDelete).toBe("cascade");
  });

  it("detaches security events instead of deleting them with tokens and servers", () => {
    const eventToken = findForeignKey(
      mcpPlatformSecurityEvent,
      "mcp_agent_token",
      "token_id",
    );
    expect(eventToken?.onDelete).toBe("set null");

    const eventServer = findForeignKey(
      mcpPlatformSecurityEvent,
      "mcp_server",
      "server_id",
    );
    expect(eventServer?.onDelete).toBe("set null");

    const eventUser = findForeignKey(
      mcpPlatformSecurityEvent,
      "user",
      "user_id",
    );
    expect(eventUser?.onDelete).toBe("cascade");
  });

  it("cascades step-up grants with the owning user", () => {
    const stepUpUser = findForeignKey(
      mcpPlatformStepUpGrant,
      "user",
      "user_id",
    );
    expect(stepUpUser?.onDelete).toBe("cascade");
  });
});

describe("platform token policy and step-up storage", () => {
  it("carries platform policy/resource and rotation-lineage columns", () => {
    const columns = getTableColumns(mcpAgentToken);
    expect(columns.policyVersion).toBeDefined();
    expect(columns.resourceMode).toBeDefined();
    expect(columns.replacesTokenId).toBeDefined();
    expect(columns.replacedByTokenId).toBeDefined();
    expect(columns.policyVersion.notNull).toBe(false);
    expect(columns.resourceMode.notNull).toBe(false);

    const sql = migrationSql();
    expect(sql).toContain('ADD COLUMN "policy_version" integer');
    expect(sql).toContain('ADD COLUMN "resource_mode" text');
    expect(sql).toContain('ADD COLUMN "replaces_token_id" text');
  });

  it("stores session-bound single-use step-up grants", () => {
    const columns = getTableColumns(mcpPlatformStepUpGrant);
    expect(columns.sessionId.notNull).toBe(true);
    expect(columns.fingerprint.notNull).toBe(true);
    expect(columns.expiresAt.notNull).toBe(true);
    expect(columns.consumedAt.notNull).toBe(false);

    const sql = migrationSql();
    expect(sql).toContain('"session_id" text NOT NULL');
    expect(sql).toContain('"fingerprint" text NOT NULL');
    expect(sql).toContain('"expires_at" timestamp with time zone NOT NULL');
    expect(sql).toContain('"consumed_at" timestamp with time zone');
  });
});

describe("platform security-event constraints", () => {
  it("constrains event types and outcomes to the canonical allowlists", () => {
    const sql = migrationSql();
    const typeList = MCP_PLATFORM_SECURITY_EVENT_TYPES.map(
      (value) => `'${value}'`,
    ).join(", ");
    const outcomeList = MCP_PLATFORM_SECURITY_EVENT_OUTCOMES.map(
      (value) => `'${value}'`,
    ).join(", ");

    expect(sql).toContain(
      `CONSTRAINT "mcp_platform_security_event_type_check" CHECK ("mcp_platform_security_event"."event_type" in (${typeList}))`,
    );
    expect(sql).toContain(
      `CONSTRAINT "mcp_platform_security_event_outcome_check" CHECK ("mcp_platform_security_event"."outcome" in (${outcomeList}))`,
    );

    const checkNames = getTableConfig(mcpPlatformSecurityEvent).checks.map(
      (check) => check.name,
    );
    expect(checkNames).toEqual([
      "mcp_platform_security_event_type_check",
      "mcp_platform_security_event_outcome_check",
    ]);
  });

  it("retains security events for a 90-day window", () => {
    expect(MCP_PLATFORM_SECURITY_EVENT_RETENTION_DAYS).toBe(90);
  });
});
