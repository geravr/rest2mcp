/**
 * @file Consent-gated MCP authoring telemetry. Events carry only ids, codes,
 * and counts — never request values, secret material, or user copy.
 *
 * The PostHog client is imported lazily so telemetry can never block or break
 * request handling (and so non-Bun test runtimes never load env at import).
 */
import type { DatabaseSchema } from "@repo/db";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export const MCP_TELEMETRY_EVENTS = {
  typedCompileFailed: "mcp_typed_compile_failed",
  contractReadinessFailed: "mcp_contract_readiness_failed",
  contractEmitted: "mcp_contract_emitted",
  schemaInvalidInternalResult: "mcp_schema_invalid_internal_result",
  /** One committed server-scoped write with lock/duration/attempt counts. */
  aggregateWrite: "mcp_aggregate_write",
  /** A stale `expectedRevision` was rejected. */
  aggregateConflict: "mcp_aggregate_conflict",
  /** A fully-rolled-back transient failure was retried. */
  aggregateRetry: "mcp_aggregate_retry",
  /** A Platform security event could not be persisted (runtime paths only). */
  securityEventPersistFailed: "mcp_platform_security_event_persist_failed",
  /** A Platform scope/resource denial occurred, counted without resource ids. */
  platformDenial: "mcp_platform_denial",
  /** A high-risk Platform grant was issued. */
  platformHighRiskGrant: "mcp_platform_high_risk_grant",
  /** Active Platform PAT inventory snapshot (counts only). */
  platformTokenInventory: "mcp_platform_token_inventory",
  /** A publication preview failed before returning a candidate. */
  publishPreviewFailed: "mcp_publish_preview_failed",
  /** A publish command was rejected by an optimistic or idempotency conflict. */
  publishConflict: "mcp_publish_conflict",
  /** One committed publication with latency and revision identity. */
  publishSucceeded: "mcp_publish_succeeded",
  /** The active published revision could not be materialized for runtime. */
  revisionSnapshotLoadFailed: "mcp_revision_snapshot_load_failed",
  /** An agent called a removed tool or a contract the active revision no longer serves. */
  staleAgentCall: "mcp_stale_agent_call",
  /** A bounded revision retention cleanup run (counts only). */
  revisionRetentionCleanup: "mcp_revision_retention_cleanup",
  /** A write-free OpenAPI import preview was returned (counts and stable codes only). */
  openapiImportPreviewed: "mcp_openapi_import_previewed",
  /** One committed OpenAPI import batch (counts, duration, and source kind only). */
  openapiImportConfirmed: "mcp_openapi_import_confirmed",
  /** One finished AI optimizer run (counts, versions, model identity, usage; no content). */
  optimizerRunCompleted: "mcp_ai_optimizer_run_completed",
  /** One committed optimizer application (class counts and revisions; no content). */
  optimizerApplied: "mcp_ai_optimizer_applied",
} as const;

export type McpTelemetryEvent =
  (typeof MCP_TELEMETRY_EVENTS)[keyof typeof MCP_TELEMETRY_EVENTS];

export function captureMcpTelemetry(
  event: McpTelemetryEvent,
  input: {
    db:
      | PostgresJsDatabase<DatabaseSchema>
      | PostgresJsDatabase<Record<string, unknown>>;
    /** Omitted for system-wide operational runs (e.g. retention cleanup). */
    userId?: string;
    properties: Record<string, unknown>;
  },
): void {
  void (async () => {
    try {
      const { captureServerEvent } = await import("./posthog.js");
      await captureServerEvent(event, {
        db: input.db as PostgresJsDatabase<DatabaseSchema>,
        userId: input.userId,
        source: "mcp.studio",
        additionalProperties: input.properties,
      });
    } catch {
      // Telemetry must never affect authoring behavior.
    }
  })();
}
