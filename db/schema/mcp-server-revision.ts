import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import {
  mcpServer,
  type McpAuthConfigurationRow,
  type McpNamedEntryRow,
} from "./mcp-server";

/** Schema version of the immutable revision payload contract. */
export const MCP_REVISION_SCHEMA_VERSION = 1;

/** Compiler version recorded with every published revision. */
export const MCP_REVISION_COMPILER_VERSION = "1";

/** Where a publication originated. Never a raw token or session identifier. */
export type McpRevisionActorSource = "studio" | "platform";

/** Secret-safe structural change categories recorded with a revision. */
export type McpRevisionDiffSummary = {
  serverChanged: string[];
  commonChanged: boolean;
  authChanged: boolean;
  toolsAdded: string[];
  toolsRemoved: string[];
  toolsChanged: string[];
  toolsEnabled: string[];
  toolsDisabled: string[];
  configChanged: boolean;
  contractChanged: boolean;
};

/**
 * Immutable, monotonically numbered publication of one complete server
 * aggregate. Rows are insert/select only; corrections require a new revision.
 * `publishedRevisionId` on `mcp_server` is the sole activity pointer.
 */
export const mcpServerRevision = pgTable(
  "mcp_server_revision",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("msr")),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
    /** Monotonic per-server revision number; allocated under the server lock. */
    revisionNumber: integer().notNull(),
    /** Publishable draft revision observed when this revision was published. */
    sourceDraftRevision: integer().notNull(),
    /** Canonical fingerprint of the full candidate aggregate. */
    candidateFingerprint: text().notNull(),
    /** Aggregate agent-contract fingerprint of enabled valid tools. */
    contractFingerprint: text().notNull(),
    schemaVersion: integer().notNull(),
    compilerVersion: text().notNull(),
    name: text().notNull(),
    description: text(),
    baseUrl: text().notNull(),
    allowedHosts: jsonb().$type<string[]>().notNull(),
    commonEntries: jsonb().$type<{
      headers: McpNamedEntryRow[];
      query: McpNamedEntryRow[];
    }>(),
    authConfiguration: jsonb().$type<McpAuthConfigurationRow>(),
    /** Secret-safe structural diff against the previously active revision. */
    diffSummary: jsonb().$type<McpRevisionDiffSummary>(),
    /** Client-generated idempotency key, unique per server. */
    publishRequestId: text().notNull(),
    /** "studio" | "platform" */
    actorSource: text().notNull(),
    /** Owner user id that published; never a token or session identifier. */
    actorUserId: text(),
    note: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("mcp_server_revision_number_unique").on(
      table.serverId,
      table.revisionNumber,
    ),
    unique("mcp_server_revision_request_unique").on(
      table.serverId,
      table.publishRequestId,
    ),
    index("mcp_server_revision_server_number_idx").on(
      table.serverId,
      table.revisionNumber,
    ),
    index("mcp_server_revision_server_created_idx").on(
      table.serverId,
      table.createdAt,
    ),
    index("mcp_server_revision_server_fingerprint_idx").on(
      table.serverId,
      table.candidateFingerprint,
    ),
  ],
);

export type McpServerRevision = typeof mcpServerRevision.$inferSelect;
export type NewMcpServerRevision = typeof mcpServerRevision.$inferInsert;

/**
 * Immutable per-tool snapshot for one revision. Retains disabled or invalid
 * draft tools for faithful history/restore, but only enabled valid tools are
 * advertised and executed. Never references the mutable draft tool row.
 */
export const mcpServerRevisionTool = pgTable(
  "mcp_server_revision_tool",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mrt")),
    revisionId: text()
      .notNull()
      .references(() => mcpServerRevision.id, { onDelete: "cascade" }),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
    /** Stable draft tool id this snapshot originated from; denormalized only. */
    sourceToolId: text().notNull(),
    name: text().notNull(),
    title: text(),
    description: text(),
    method: text().notNull(),
    requestDefinition: jsonb().$type<Record<string, unknown>>(),
    /** Immutable compiled plan for enabled valid tools; null otherwise. */
    compiledPlan: jsonb().$type<Record<string, unknown>>(),
    compileStatus: text(),
    compileIssues: jsonb().$type<Array<Record<string, unknown>>>(),
    annotations: jsonb().$type<Record<string, unknown>>(),
    allowMutation: boolean().notNull(),
    enabled: boolean().notNull(),
    source: text().notNull(),
    /**
     * Versioned, secret-safe OpenAPI provenance copied from the draft tool at
     * publication so a restore can reproduce the imported operation's identity.
     * Excluded from candidate, contract, and runtime fingerprints.
     */
    sourceProvenance: jsonb().$type<Record<string, unknown>>(),
    /** Deterministic agent-contract fingerprint; null when not contract-ready. */
    contractFingerprint: text(),
    definitionHash: text(),
    /** Deterministic discovery ordering within the revision. */
    toolOrder: integer().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("mcp_server_revision_tool_source_unique").on(
      table.revisionId,
      table.sourceToolId,
    ),
    unique("mcp_server_revision_tool_name_unique").on(
      table.revisionId,
      table.name,
    ),
    index("mcp_server_revision_tool_revision_idx").on(table.revisionId),
    index("mcp_server_revision_tool_server_name_idx").on(
      table.serverId,
      table.name,
    ),
  ],
);

export type McpServerRevisionTool = typeof mcpServerRevisionTool.$inferSelect;
export type NewMcpServerRevisionTool =
  typeof mcpServerRevisionTool.$inferInsert;

/**
 * Immutable snapshot of one server value referenced by a revision. Config
 * values are copied verbatim; secret slots are represented only by stable id
 * and metadata and never contain plaintext or ciphertext.
 */
export const mcpServerRevisionConfig = pgTable(
  "mcp_server_revision_config",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mrc")),
    revisionId: text()
      .notNull()
      .references(() => mcpServerRevision.id, { onDelete: "cascade" }),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
    /** Stable draft server-value id; the only secret identity retained. */
    sourceValueId: text().notNull(),
    name: text().notNull(),
    /** "config" | "secret" */
    kind: text().notNull(),
    /** "manual" | "auth" */
    owner: text(),
    description: text(),
    /** Non-secret config value snapshot; null for secret slots. */
    value: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("mcp_server_revision_config_source_unique").on(
      table.revisionId,
      table.sourceValueId,
    ),
    index("mcp_server_revision_config_revision_idx").on(table.revisionId),
    index("mcp_server_revision_config_server_idx").on(table.serverId),
  ],
);

export type McpServerRevisionConfig =
  typeof mcpServerRevisionConfig.$inferSelect;
export type NewMcpServerRevisionConfig =
  typeof mcpServerRevisionConfig.$inferInsert;
