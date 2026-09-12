import { z } from "zod";

/**
 * Zod schema for validating environment variables.
 * Ensures all required configuration values are present and correctly formatted.
 *
 * @throws {ZodError} When environment variables don't match the schema
 */
export const envSchema = z.object({
  ENVIRONMENT: z.enum(["production", "staging", "preview", "development"]),
  APP_NAME: z.string().default("Charro Stack"),
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),

  POSTHOG_KEY: z.string().optional(),
  POSTHOG_HOST: z.url().default("https://us.i.posthog.com"),
  POSTHOG_FLUSH_AT: z
    .preprocess((value) => {
      if (typeof value === "string" && value.length > 0) {
        return Number(value);
      }

      return value;
    }, z.number().int().min(1).max(200))
    .default(20),
  POSTHOG_FLUSH_INTERVAL_MS: z
    .preprocess((value) => {
      if (typeof value === "string" && value.length > 0) {
        return Number(value);
      }

      return value;
    }, z.number().int().min(0).max(60_000))
    .default(10_000),
  POSTHOG_REQUEST_TIMEOUT_MS: z
    .preprocess((value) => {
      if (typeof value === "string" && value.length > 0) {
        return Number(value);
      }

      return value;
    }, z.number().int().min(1_000).max(60_000))
    .default(10_000),
  POSTHOG_SERVER_ERROR_SAMPLE_RATE: z
    .preprocess((value) => {
      if (typeof value === "string" && value.length > 0) {
        return Number(value);
      }

      return value;
    }, z.number().min(0).max(1))
    .default(1),
  RESEND_API_KEY: z.string(),
  RESEND_EMAIL_FROM: z.email(),
  STORAGE_S3_REGION: z.string().default("auto"),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_ENDPOINT: z.url().optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z
    .preprocess(
      (value) =>
        typeof value === "string" ? value.toLowerCase() === "true" : value,
      z.boolean(),
    )
    .default(false),

  /** When set, the user with this email is promoted to super_admin on startup if no super-admin exists yet. */
  SUPER_ADMIN_EMAIL: z.email().optional(),
});

/**
 * Runtime environment variables accessor for Bun-based servers.
 */
export const env = envSchema.parse(Bun.env);

/**
 * Type-safe environment variables interface.
 * Inferred from the Zod schema to ensure type safety.
 */
export type Env = z.infer<typeof envSchema>;
