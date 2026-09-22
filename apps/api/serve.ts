/**
 * @file Production server entrypoint for VPS / Docker deployment.
 *
 * Connects directly to PostgreSQL via DATABASE_URL.
 * Reads all configuration from environment variables via Bun.env.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import api from "./index.js";
import { createAuth } from "./lib/auth.js";
import type { AppContext } from "./lib/context.js";
import { createDb } from "./lib/db.js";
import { env } from "./lib/env.js";
import { drainAuditQueue } from "./lib/mcp-audit-queue.js";
import {
  errorHandler,
  notFoundHandler,
  requestIdGenerator,
} from "./lib/middleware.js";
import {
  registerPostHogProcessHandlers,
  shutdownPostHogClient,
} from "./lib/posthog.js";
import { ensureSuperAdmin } from "./services/admin-service.js";
import { getAiProviderAdapter } from "./lib/ai/provider-registry.js";
import {
  startOptimizerReconciler,
  startOptimizerWorker,
} from "./services/ai-optimizer-worker.js";

// Single connection pool for both reads and writes in VPS mode
const db = createDb(env.DATABASE_URL);

// ============================================================================
// App
// ============================================================================

const app = new Hono<AppContext>();

app.onError(errorHandler);
app.notFound(notFoundHandler);

// cors must run first — secureHeaders CORP/COEP/COOP would block cross-origin responses
app.use(
  cors({
    origin: env.APP_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "x-csrf-token",
      "x-trpc-source",
    ],
    credentials: true,
    maxAge: 600,
  }),
);
app.use(secureHeaders());
app.use(requestId({ generator: requestIdGenerator }));
app.use(logger());

const auth = createAuth(db, env);
registerPostHogProcessHandlers("api-serve", env);

app.use(async (c, next) => {
  c.set("db", db);
  c.set("dbDirect", db);
  c.set("auth", auth);
  c.set("env", env);
  c.set("session", null);
  c.set("user", null);
  await next();
});

app.route("/", api);

const DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS = 30;

// ============================================================================
// Start
// ============================================================================

const port = parseInt(process.env.PORT || "8080", 10);

Bun.serve({
  fetch: (request, server) => {
    return app.fetch(request, { server });
  },
  idleTimeout: DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS,
  port,
});

console.log(`[serve] Production server running on port ${port}`);

// Seed super-admin if SUPER_ADMIN_EMAIL is set and no super-admin exists
ensureSuperAdmin(db, env).catch((err) => {
  console.error("[admin] Failed to seed super-admin:", err);
});

const optimizerLifecycleDeps = {
  db,
  getAdapter: getAiProviderAdapter,
  aiCredentialSecret: env.AI_CREDENTIAL_SECRET,
};
const optimizerWorker = startOptimizerWorker(optimizerLifecycleDeps);
const optimizerReconciler = startOptimizerReconciler(optimizerLifecycleDeps);

async function shutdown() {
  await Promise.all([optimizerWorker.stop(), optimizerReconciler.stop()]);
  await drainAuditQueue(db);
  await shutdownPostHogClient(env);
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});
