/**
 * @file Hono app construction and tRPC router initialization.
 *
 * Combines authentication, tRPC, and health check endpoints into a single HTTP router.
 */

import { TRPCError } from "@trpc/server";
import {
  APP_ERROR_CODES,
  AppError,
  appError,
  appJsonError,
} from "./app-error.js";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { adminRouter } from "../routers/admin.js";
import { mcpRouter } from "../routers/mcp.js";
import { publicAuthRoutes } from "../routers/public-auth.js";
import { userRouter } from "../routers/user.js";
import { createMcpGatewayRoutes } from "./mcp-gateway.js";
import { createPlatformMcpRoutes } from "./mcp-platform.js";
import type { AppContext } from "./context.js";
import { getTrustedRequestId } from "./middleware.js";
import {
  captureServerException,
  extractRequestTelemetryDetails,
} from "./posthog.js";
import { loadSession, requireActiveUser, requireSession } from "./session.js";
import {
  buildStorageObjectKey,
  canAccessStorageObject,
  getObject,
  resolveStorageAccessUrl,
  resolveStorageBucket,
  uploadObject,
} from "./storage.js";
import {
  createStagingAsset,
  markAssetReady,
  SERVER_ICON_PURPOSE,
} from "../services/mcp-asset-service.js";
import { router } from "./trpc.js";

const TRPC_STATUS_MAP: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_SUPPORTED: 405,
  TIMEOUT: 408,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_CONTENT: 400,
  TOO_MANY_REQUESTS: 429,
  CLIENT_CLOSED_REQUEST: 400,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  INTERNAL_SERVER_ERROR: 500,
};

const DEFAULT_CAPTURED_TRPC_CODES = new Set([
  "BAD_GATEWAY",
  "GATEWAY_TIMEOUT",
  "INTERNAL_SERVER_ERROR",
  "SERVICE_UNAVAILABLE",
]);

function getTrpcStatusCode(error: TRPCError): number {
  return TRPC_STATUS_MAP[error.code] ?? 500;
}

function shouldCaptureTrpcError(error: TRPCError): boolean {
  if (DEFAULT_CAPTURED_TRPC_CODES.has(error.code)) {
    return true;
  }
  return false;
}

// tRPC API router
const appRouter = router({
  admin: adminRouter,
  mcp: mcpRouter,
  user: userRouter,
});

// HTTP router
const app = new Hono<AppContext>();

app.get("/", (c) => c.redirect("/api"));

// Root endpoint with API information
app.get("/api", (c) => {
  return c.json({
    name: "@repo/api",
    version: "0.0.0",
    endpoints: {
      trpc: "/api/trpc",
      auth: "/api/auth",
      mcp: "/mcp/:serverId",
      platformMcp: "/api/platform-mcp",
      health: "/health",
    },
    documentation: {
      trpc: "https://trpc.io",
      auth: "https://www.better-auth.com",
    },
  });
});

// Health check endpoint
app.get("/health", (c) => {
  return c.json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.route("/api/auth", publicAuthRoutes);
app.route("/mcp", createMcpGatewayRoutes());
app.route("/api/platform-mcp", createPlatformMcpRoutes());

// Authentication routes
app.on(["GET", "POST", "OPTIONS"], "/api/auth/*", (c) => {
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  const auth = c.get("auth");
  if (!auth) {
    return c.json(
      appJsonError(
        APP_ERROR_CODES.AUTH_UNAVAILABLE,
        "Authentication service not initialized",
      ),
      503,
    );
  }
  return auth.handler(c.req.raw);
});

app.post(
  "/api/storage/upload",
  requireSession,
  requireActiveUser,
  async (c) => {
    const user = c.get("user");
    const env = c.get("env") ?? c.env;

    if (!user) {
      throw appError({
        appCode: APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
        message: "Authentication required",
        status: 401,
      });
    }

    const formData = await c.req.formData();
    const fileEntry = formData.get("file");
    const directoryEntry = formData.get("directory");
    const purposeEntry = formData.get("purpose");

    if (
      typeof fileEntry !== "object" ||
      fileEntry === null ||
      !("arrayBuffer" in fileEntry) ||
      !("name" in fileEntry) ||
      !("size" in fileEntry) ||
      !("type" in fileEntry)
    ) {
      return c.json(
        appJsonError(APP_ERROR_CODES.FILE_REQUIRED, "File is required."),
        400,
      );
    }

    const file = fileEntry as Blob & {
      name: string;
      size: number;
      type: string;
    };

    const directory =
      typeof directoryEntry === "string" ? directoryEntry.trim() : undefined;

    const purpose =
      typeof purposeEntry === "string" &&
      purposeEntry.trim() === SERVER_ICON_PURPOSE
        ? SERVER_ICON_PURPOSE
        : undefined;

    if (directory && !/^[a-z0-9/_-]*$/i.test(directory)) {
      return c.json(
        appJsonError(
          APP_ERROR_CODES.INVALID_DIRECTORY,
          "Directory contains invalid characters.",
        ),
        400,
      );
    }

    if (directory && directory.length > 120) {
      return c.json(
        appJsonError(
          APP_ERROR_CODES.DIRECTORY_TOO_LONG,
          "Directory is too long.",
        ),
        400,
      );
    }

    if (file.size <= 0) {
      return c.json(
        appJsonError(APP_ERROR_CODES.FILE_EMPTY, "File is empty."),
        400,
      );
    }

    if (file.size > 50 * 1024 * 1024) {
      return c.json(
        appJsonError(APP_ERROR_CODES.FILE_TOO_LARGE, "File is too large."),
        400,
      );
    }

    const bucket = resolveStorageBucket(env);
    const object = buildStorageObjectKey(
      {
        user,
      },
      file.name,
      { directory },
    );
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const db = c.get("db");

    let assetId: string | undefined;
    if (purpose === SERVER_ICON_PURPOSE) {
      const asset = await createStagingAsset(db, {
        userId: user.id,
        objectKey: object.key,
        purpose,
        contentType: file.type || "application/octet-stream",
        byteSize: file.size,
      });
      assetId = asset.id;
    }

    try {
      await uploadObject(env, {
        bucket,
        key: object.key,
        body: fileBytes,
        contentType: file.type || "application/octet-stream",
        contentLength: file.size,
        metadata: {
          uploaderId: user.id,
          scopeType: object.scope.type,
          scopeId: object.scope.id,
        },
      });
      if (assetId) {
        await markAssetReady(db, user.id, assetId);
      }
    } catch (error) {
      // A staged asset that never becomes ready is garbage-collected later.
      if (error instanceof AppError) {
        throw error;
      }
      throw appError({
        appCode: APP_ERROR_CODES.FILE_UPLOAD_FAILED,
        message: "Failed to upload file.",
        status: 500,
        cause: error,
      });
    }

    return c.json({
      bucket,
      key: object.key,
      scope: object.scope,
      contentType: file.type || "application/octet-stream",
      contentLength: file.size,
      accessUrl: resolveStorageAccessUrl(env, object.key),
      ...(assetId ? { assetId } : {}),
    });
  },
);

app.get("/api/storage/object", requireSession, requireActiveUser, async (c) => {
  const user = c.get("user");
  const env = c.get("env") ?? c.env;

  if (!user) {
    throw appError({
      appCode: APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
      message: "Authentication required",
      status: 401,
    });
  }

  const key = c.req.query("key")?.trim();

  if (!key) {
    throw appError({
      appCode: APP_ERROR_CODES.STORAGE_KEY_REQUIRED,
      message: "Storage key is required.",
      status: 400,
    });
  }

  const canAccess = canAccessStorageObject(key, {
    user,
  });

  if (!canAccess) {
    throw appError({
      appCode: APP_ERROR_CODES.STORAGE_ACCESS_DENIED,
      message: "You do not have access to this object.",
      status: 403,
    });
  }

  const bucket = resolveStorageBucket(env);
  const object = await getObject(env, {
    bucket,
    key,
  });

  const headers = new Headers();

  if (object.ContentType) {
    headers.set("Content-Type", object.ContentType);
  }

  if (typeof object.ContentLength === "number") {
    headers.set("Content-Length", String(object.ContentLength));
  }

  if (object.ETag) {
    headers.set("ETag", object.ETag);
  }

  headers.set("Cache-Control", "private, max-age=300");

  return new Response(object.Body as BodyInit, {
    status: 200,
    headers,
  });
});

// tRPC API routes
app.use("/api/trpc/*", (c) => {
  return fetchRequestHandler({
    req: c.req.raw,
    router: appRouter,
    endpoint: "/api/trpc",
    async createContext({ req, resHeaders, info }) {
      const db = c.get("db");
      const dbDirect = c.get("dbDirect");
      const auth = c.get("auth");
      const env = c.get("env") ?? c.env;

      if (!db) {
        throw new Error("Database not available in context");
      }

      if (!dbDirect) {
        throw new Error("Direct database not available in context");
      }

      if (!auth) {
        throw new Error("Authentication service not available in context");
      }

      const { session, user } = await loadSession(auth, req.headers);
      c.set("session", session);
      c.set("user", user);

      return {
        req,
        res: c.res,
        resHeaders,
        info,
        env,
        db,
        dbDirect,
        auth,
        session,
        user,
      };
    },
    batching: {
      enabled: true,
    },
    onError({ ctx, error, input, path, req, type }) {
      console.error("tRPC error on path", path, ":", error);

      if (!shouldCaptureTrpcError(error)) {
        return;
      }

      const statusCode = getTrpcStatusCode(error);

      const requestTelemetry = extractRequestTelemetryDetails(req);
      void captureServerException(error, {
        additionalProperties: {
          hasInput: input !== undefined,
          hasTracingHeaders: requestTelemetry.hasTracingHeaders,
          origin: requestTelemetry.origin,
          referer: requestTelemetry.referer,
          trpcPath: path,
          trpcType: type,
          userAgent: requestTelemetry.userAgent,
        },
        db: ctx?.db,
        distinctId: requestTelemetry.distinctId,
        method: req.method,
        path: path ? `/api/trpc/${path}` : "/api/trpc",
        requestId: getTrustedRequestId(req.headers),
        runtimeEnv: ctx?.env,
        sessionId: requestTelemetry.sessionId,
        source: "trpc.fetch",
        statusCode,
        userId: ctx?.user?.id ?? null,
        windowId: requestTelemetry.windowId,
      });
    },
  });
});

export { appRouter };
export type AppRouter = typeof appRouter;
export default app;
