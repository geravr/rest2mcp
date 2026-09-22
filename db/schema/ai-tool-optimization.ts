import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { generateId } from "./id";
import { mcpServer } from "./mcp-server";
import { user } from "./user";

/**
 * Owner/server-scoped AI tool-optimization run. Holds only bounded, secret-safe
 * planning and progress data: raw prompts, raw model output, raw OpenAPI
 * documents, credentials, and secret identities are never persisted.
 */
export const aiToolOptimizationRun = pgTable(
  "ai_tool_optimization_run",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("aor")),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    serverId: text()
      .notNull()
      .references(() => mcpServer.id, { onDelete: "cascade" }),
    /** "draft" | "openapi"; validated against optimizer contracts at the service layer. */
    source: text().notNull(),
    /** "single" | "selected" | "all_eligible" | "openapi". */
    scopeKind: text().notNull(),
    /** Versioned optimizer scope (tool ids or operation keys). */
    scope: jsonb().$type<Record<string, unknown>>().notNull(),
    /**
     * "planned" | "queued" | "running" | "completed" | "completed_with_errors" |
     * "failed" | "cancel_requested" | "cancelled" | "expired".
     */
    state: text().notNull().default("planned"),
    policyVersion: integer().notNull(),
    promptVersion: integer().notNull(),
    /** Public provider/model identity captured at authorization. */
    providerKind: text(),
    modelId: text(),
    /** Model readiness fingerprint captured at authorization; rechecked at claim. */
    readinessFingerprint: text(),
    /** Expected server revisions observed at preflight. */
    serverConfigRevision: integer().notNull(),
    serverDraftRevision: integer().notNull(),
    /** Canonical fingerprint of the parsed OpenAPI source; draft runs leave null. */
    documentFingerprint: text(),
    eligibleCount: integer().notNull().default(0),
    ineligibleCount: integer().notNull().default(0),
    /** Bounded pre-authorization estimate (tokens + pricing state). */
    estimate: jsonb().$type<Record<string, unknown>>(),
    /** Aggregated normalized provider usage; never prompts or outputs. */
    usage: jsonb().$type<Record<string, unknown>>(),
    /** Stable AppErrorCode of the terminal failure, when failed. */
    errorCode: text(),
    /** Claimed-by worker identity and lease window. */
    workerId: text(),
    leaseExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
    attempts: integer().notNull().default(0),
    cancelRequestedAt: timestamp({ withTimezone: true, mode: "date" }),
    authorizedAt: timestamp({ withTimezone: true, mode: "date" }),
    queuedAt: timestamp({ withTimezone: true, mode: "date" }),
    startedAt: timestamp({ withTimezone: true, mode: "date" }),
    completedAt: timestamp({ withTimezone: true, mode: "date" }),
    /** Authorization deadline for planned runs. */
    plannedExpiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    /** Recommendation-history retention deadline, set at terminal completion. */
    retentionExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
    /** Committed application idempotency key; null until a draft apply commits. */
    applyKey: text(),
    /** Result snapshot of the committed application for idempotent replays. */
    applyResult: jsonb().$type<Record<string, unknown>>(),
    appliedConfigRevision: integer(),
    appliedDraftRevision: integer(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("ai_tool_optimization_run_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("ai_tool_optimization_run_server_created_idx").on(
      table.serverId,
      table.createdAt,
    ),
    index("ai_tool_optimization_run_state_idx").on(table.state),
    index("ai_tool_optimization_run_claim_idx").on(
      table.state,
      table.leaseExpiresAt,
    ),
    index("ai_tool_optimization_run_retention_idx").on(
      table.retentionExpiresAt,
    ),
    unique("ai_tool_optimization_run_apply_key_unique").on(
      table.userId,
      table.applyKey,
    ),
    check(
      "ai_tool_optimization_run_state_check",
      sql`${table.state} in ('planned', 'queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancel_requested', 'cancelled', 'expired')`,
    ),
    check(
      "ai_tool_optimization_run_source_check",
      sql`${table.source} in ('draft', 'openapi')`,
    ),
    check(
      "ai_tool_optimization_run_scope_check",
      sql`${table.scopeKind} in ('single', 'selected', 'all_eligible', 'openapi')`,
    ),
  ],
);

export type AiToolOptimizationRun = typeof aiToolOptimizationRun.$inferSelect;
export type NewAiToolOptimizationRun =
  typeof aiToolOptimizationRun.$inferInsert;

/**
 * One analyzed tool or OpenAPI candidate inside a run. `snapshot` holds only
 * the sanitized OptimizerToolSnapshotV1; `review` holds normalized server-owned
 * artifacts (operations, advisories, rejected diagnostics) and never raw model
 * output.
 */
export const aiToolOptimizationItem = pgTable(
  "ai_tool_optimization_item",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("aoi")),
    runId: text()
      .notNull()
      .references(() => aiToolOptimizationRun.id, { onDelete: "cascade" }),
    /** "draft_tool" | "openapi_candidate". */
    refKind: text().notNull(),
    toolId: text(),
    operationKey: text(),
    /** Agent-facing label (tool name or operation key) for projections. */
    name: text().notNull(),
    /** Optimization-relevant fingerprint captured at preflight. */
    fingerprint: text().notNull(),
    /** "queued" | "running" | "recommended" | "no_change" | "failed" | "cancelled" | "applied" | "rejected". */
    state: text().notNull().default("queued"),
    failureCode: text(),
    /** Sanitized snapshot authorized for model input. */
    snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
    /** Normalized review artifacts; null until analysis produced them. */
    review: jsonb().$type<Record<string, unknown>>(),
    /** Deterministic packing order inside the run. */
    ordinal: integer().notNull(),
    appliedToolId: text(),
    appliedToolName: text(),
    appliedDraftRevision: integer(),
    appliedAt: timestamp({ withTimezone: true, mode: "date" }),
    rejectedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("ai_tool_optimization_item_run_ordinal_idx").on(
      table.runId,
      table.ordinal,
    ),
    index("ai_tool_optimization_item_run_state_idx").on(
      table.runId,
      table.state,
    ),
    index("ai_tool_optimization_item_tool_id_idx").on(table.toolId),
    check(
      "ai_tool_optimization_item_ref_kind_check",
      sql`${table.refKind} in ('draft_tool', 'openapi_candidate')`,
    ),
    check(
      "ai_tool_optimization_item_state_check",
      sql`${table.state} in ('queued', 'running', 'recommended', 'no_change', 'failed', 'cancelled', 'applied', 'rejected')`,
    ),
  ],
);

export type AiToolOptimizationItem = typeof aiToolOptimizationItem.$inferSelect;
export type NewAiToolOptimizationItem =
  typeof aiToolOptimizationItem.$inferInsert;
