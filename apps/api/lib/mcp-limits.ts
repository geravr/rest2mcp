import { envSchema } from "./env-schema.js";

/**
 * The process environment, whichever runtime is hosting it.
 *
 * `Bun.env` and `process.env` are the same map under Bun; the fallback keeps
 * modules that read configuration loadable under the Node-based test runner.
 */
function environmentSource(): Record<string, string | undefined> {
  return typeof Bun === "undefined" ? process.env : Bun.env;
}

/**
 * Effective per-server MCP tool cap for this deployment.
 *
 * Resolved on read through the environment schema, so every enforcement point
 * and the Studio consume the configured value instead of a copy of it. The
 * environment is fixed for the process lifetime and startup parses the same
 * field, so a value that booted cannot fail this read.
 */
export function getMcpMaxToolsPerServer(): number {
  return envSchema.shape.MCP_MAX_TOOLS_PER_SERVER.parse(
    environmentSource().MCP_MAX_TOOLS_PER_SERVER,
  );
}
