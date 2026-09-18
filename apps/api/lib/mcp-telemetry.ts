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
  legacyCompatWrite: "mcp_legacy_compat_write",
  legacyConversion: "mcp_legacy_conversion",
  definitionNotProjectable: "mcp_definition_not_projectable",
  typedCompileFailed: "mcp_typed_compile_failed",
} as const;

export type McpTelemetryEvent =
  (typeof MCP_TELEMETRY_EVENTS)[keyof typeof MCP_TELEMETRY_EVENTS];

export function captureMcpTelemetry(
  event: McpTelemetryEvent,
  input: {
    db:
      | PostgresJsDatabase<DatabaseSchema>
      | PostgresJsDatabase<Record<string, unknown>>;
    userId: string;
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
