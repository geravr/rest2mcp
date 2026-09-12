/**
 * @file Local development server for Bun-based development.
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

const app = new Hono<AppContext>();

// Error and 404 handlers (must be on top-level app)
app.onError(errorHandler);
app.notFound(notFoundHandler);

// Standard middleware
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

const db = createDb(env.DATABASE_URL);
// Bun mode uses one direct PostgreSQL pool for both read and write handles.
const dbDirect = db;

// Create auth instance at startup for request context and session handling.
const auth = createAuth(db, env);
registerPostHogProcessHandlers("api-dev", env);

app.use(async (c, next) => {
  c.set("db", db);
  c.set("dbDirect", dbDirect);
  c.set("auth", auth);
  c.set("env", env);
  c.set("session", null);
  c.set("user", null);
  await next();
});

app.route("/", api);

const DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS = 50;

// Start Bun server
const port = parseInt(process.env.PORT || "3456", 10);

Bun.serve({
  fetch: (request, server) => {
    return app.fetch(request, { server });
  },
  idleTimeout: DEFAULT_HTTP_IDLE_TIMEOUT_SECONDS,
  port,
});

console.log(`[dev] Server running on http://localhost:${port}`);

// Seed super-admin if SUPER_ADMIN_EMAIL is set and no super-admin exists
ensureSuperAdmin(dbDirect, env).catch((err) => {
  console.error("[admin] Failed to seed super-admin:", err);
});

async function shutdown() {
  await shutdownPostHogClient(env);
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});
