import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";
import { mcpToolGroup } from "./mcp-tool-group";

export type McpCompileIssueRow = {
  path: string;
  /** Stable definition-local id of the affected node, when known. */
  id?: string;
  code: string;
  message: string;
  severity: "error" | "warning";
};

export type McpBehaviorAnnotationsRow = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export const mcpTool = pgTable(
  "mcp_tool",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("mct")),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Human-facing agent title; required before a tool can be enabled. */
    title: text(),
    description: text(),
    method: text().notNull(),
    /** Versioned explicit request definition (bindings by id). */
    requestDefinition: jsonb().$type<Record<string, unknown>>(),
    /** Immutable compiled effective plan produced by the publish-time compiler. */
    compiledPlan: jsonb().$type<Record<string, unknown>>(),
    /** "valid" | "invalid" | null (uncompiled). */
    compileStatus: text(),
    compileIssues: jsonb().$type<McpCompileIssueRow[]>(),
    annotations: jsonb().$type<McpBehaviorAnnotationsRow>(),
    allowMutation: boolean().notNull().default(false),
    enabled: boolean().notNull().default(true),
    /** "manual" | "curl" | "openapi" */
    source: text().default("manual").notNull(),
    /**
     * Versioned, secret-safe OpenAPI provenance (`McpOpenApiSourceProvenance`).
     * Present only for `source: "openapi"` tools. Never enters agent contracts,
     * runtime fingerprints, or execution snapshots. Services validate the shape
     * before writing; the column is deliberately untyped JSON.
     */
    sourceProvenance: jsonb().$type<Record<string, unknown>>(),
    /**
     * Optional Studio-only group placement. Presentation metadata: never copied
     * into revision rows, publication candidates, or agent contracts.
     */
    groupId: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("mcp_tool_server_name_unique").on(table.serverId, table.name),
    index("mcp_tool_server_id_idx").on(table.serverId),
    index("mcp_tool_compile_status_idx").on(table.compileStatus),
    index("mcp_tool_group_id_idx").on(table.groupId),
    foreignKey({
      columns: [table.groupId],
      foreignColumns: [mcpToolGroup.id],
      name: "mcp_tool_group_id_mcp_tool_group_id_fk",
    }).onDelete("set null"),
    /**
     * Composite membership key: a tool may only reference a group of its own
     * server. A null `groupId` satisfies the constraint under `MATCH SIMPLE`.
     */
    foreignKey({
      columns: [table.serverId, table.groupId],
      foreignColumns: [mcpToolGroup.serverId, mcpToolGroup.id],
      name: "mcp_tool_group_same_server_fk",
    }),
  ],
);

export type McpTool = typeof mcpTool.$inferSelect;
export type NewMcpTool = typeof mcpTool.$inferInsert;
