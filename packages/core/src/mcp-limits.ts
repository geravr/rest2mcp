/**
 * Bounded limits for the MCP Studio tool cap.
 *
 * The effective cap is deployment configuration (`MCP_MAX_TOOLS_PER_SERVER`).
 * The fallback and the accepted range live here so the environment schema, the
 * API enforcement points, and the Studio UI cannot drift apart.
 */

/** Per-server tool cap applied when a deployment configures no override. */
export const MCP_MAX_TOOLS_PER_SERVER_DEFAULT = 50;

/** Accepted range for a configured per-server tool cap. */
export const MCP_MAX_TOOLS_PER_SERVER_BOUNDS = {
  min: 1,
  max: 500,
} as const;
