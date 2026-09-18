import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";

export type McpBodyType = "json" | "form" | "raw";

export type McpRequestTemplate = {
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: string | null;
  bodyType?: McpBodyType;
};

export type McpToolParamType = "string" | "number" | "boolean" | "json";

export type McpToolParam = {
  name: string;
  description?: string;
  required: boolean;
  type: McpToolParamType;
  /** Never logged/previewed in call history; masked as a password field in the playground. */
  sensitive?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: Array<string | number | boolean>;
  examples?: unknown[];
  allowEmpty?: boolean;
};

export type McpCompileIssueRow = {
  path: string;
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
    description: text(),
    method: text().notNull(),
    pathTemplate: text().notNull(),
    /** Legacy request template (query/headers/body) with {{placeholder}} interpolation. */
    requestTemplate: jsonb().$type<McpRequestTemplate>(),
    /** Declared agent params used to derive the gateway input schema (legacy). */
    params: jsonb().$type<McpToolParam[]>(),
    /** Versioned explicit request definition (bindings by id). */
    requestDefinition: jsonb().$type<Record<string, unknown>>(),
    /** Immutable compiled effective plan produced by the publish-time compiler. */
    compiledPlan: jsonb().$type<Record<string, unknown>>(),
    /** "valid" | "invalid" | "legacy" | null (uncompiled). */
    compileStatus: text(),
    compileIssues: jsonb().$type<McpCompileIssueRow[]>(),
    annotations: jsonb().$type<McpBehaviorAnnotationsRow>(),
    allowMutation: boolean().notNull().default(false),
    enabled: boolean().notNull().default(true),
    /** "manual" | "curl" */
    source: text().default("manual").notNull(),
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
  ],
);

export type McpTool = typeof mcpTool.$inferSelect;
export type NewMcpTool = typeof mcpTool.$inferInsert;
