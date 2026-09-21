import { envSchema, type Env } from "./env-schema.js";

export { envSchema };
export type { Env };

/**
 * Runtime environment variables accessor for Bun-based servers.
 */
export const env: Env = envSchema.parse(Bun.env);
