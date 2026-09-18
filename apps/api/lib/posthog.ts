import {
  sanitizeTelemetryProperties,
  sanitizeTelemetryText,
  sanitizeTelemetryUrl,
} from "@repo/core";
import type { DatabaseSchema } from "@repo/db";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { PostHog, type EventMessage } from "posthog-node";
import type { Env } from "./env.js";
import { env as bunEnv } from "./env.js";
import {
  canCaptureUserErrorTracking,
  getObservabilitySettingsForUser,
  isObservabilityConsentGranted,
} from "./observability-settings.js";

type RuntimeEnv = Partial<Env> | undefined;

export interface RequestTelemetryDetails {
  distinctId?: string;
  sessionId?: string;
  windowId?: string;
  origin?: string;
  referer?: string;
  userAgent?: string;
  hasTracingHeaders: boolean;
}

export interface ServerTelemetryContext {
  additionalProperties?: Record<string, unknown>;
  allowAnonymous?: boolean;
  db?: PostgresJsDatabase<DatabaseSchema>;
  distinctId?: string | null;
  method?: string;
  path?: string;
  requestId?: string | null;
  requireErrorTracking?: boolean;
  runtimeEnv?: RuntimeEnv;
  sessionId?: string | null;
  source: string;
  statusCode?: number;
  userId?: string | null;
  windowId?: string | null;
}

const posthogClients = new Map<string, PostHog>();
let processHandlersRegistered = false;
const ANONYMOUS_SERVER_DISTINCT_ID = "server_anonymous";

function resolveEnv(runtimeEnv?: RuntimeEnv): Env {
  return {
    ...bunEnv,
    ...runtimeEnv,
  } as Env;
}

function buildClientCacheKey(resolvedEnv: Env): string {
  return `${resolvedEnv.POSTHOG_KEY ?? ""}|${resolvedEnv.POSTHOG_HOST}`;
}

function sanitizePostHogEvent(event: EventMessage | null): EventMessage | null {
  if (!event) {
    return null;
  }

  return {
    ...event,
    properties: sanitizeTelemetryProperties(event.properties ?? {}),
  };
}

export function getPostHogClient(runtimeEnv?: RuntimeEnv): PostHog | null {
  const resolvedEnv = resolveEnv(runtimeEnv);

  if (!resolvedEnv.POSTHOG_KEY) {
    return null;
  }

  const cacheKey = buildClientCacheKey(resolvedEnv);
  const existingClient = posthogClients.get(cacheKey);
  if (existingClient) {
    return existingClient;
  }

  const client = new PostHog(resolvedEnv.POSTHOG_KEY, {
    host: resolvedEnv.POSTHOG_HOST,
    flushAt: resolvedEnv.POSTHOG_FLUSH_AT,
    flushInterval: resolvedEnv.POSTHOG_FLUSH_INTERVAL_MS,
    requestTimeout: resolvedEnv.POSTHOG_REQUEST_TIMEOUT_MS,
    before_send: sanitizePostHogEvent,
  });

  posthogClients.set(cacheKey, client);
  return client;
}

function shouldSample(rate: number): boolean {
  if (rate <= 0) {
    return false;
  }

  if (rate >= 1) {
    return true;
  }

  return Math.random() < rate;
}

function readHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name)?.trim();
  return value ? sanitizeTelemetryText(value) : undefined;
}

export function extractRequestTelemetryDetails(
  requestLike: Request | Headers | { headers: Headers },
): RequestTelemetryDetails {
  const headers =
    requestLike instanceof Headers
      ? requestLike
      : requestLike instanceof Request
        ? requestLike.headers
        : requestLike.headers;

  const distinctId = readHeader(headers, "x-posthog-distinct-id");
  const sessionId = readHeader(headers, "x-posthog-session-id");
  const windowId = readHeader(headers, "x-posthog-window-id");

  return {
    distinctId,
    sessionId,
    windowId,
    origin: readHeader(headers, "origin"),
    referer: headers.get("referer")
      ? sanitizeTelemetryUrl(headers.get("referer")!)
      : undefined,
    userAgent: readHeader(headers, "user-agent"),
    hasTracingHeaders: Boolean(distinctId || sessionId || windowId),
  };
}

async function resolveCapturePermissions(
  context: Pick<
    ServerTelemetryContext,
    | "allowAnonymous"
    | "db"
    | "distinctId"
    | "requireErrorTracking"
    | "sessionId"
    | "userId"
    | "windowId"
  >,
): Promise<{
  canCapture: boolean;
  consentGranted: boolean;
  distinctId?: string;
  sessionId?: string;
  windowId?: string;
}> {
  const allowAnonymous = context.allowAnonymous ?? true;

  if (!context.userId || !context.db) {
    const distinctId =
      context.distinctId ??
      (allowAnonymous ? ANONYMOUS_SERVER_DISTINCT_ID : undefined);

    return {
      canCapture: Boolean(distinctId),
      consentGranted: Boolean(context.distinctId),
      distinctId,
      sessionId: context.distinctId
        ? (context.sessionId ?? undefined)
        : undefined,
      windowId: context.distinctId
        ? (context.windowId ?? undefined)
        : undefined,
    };
  }

  const settings = await getObservabilitySettingsForUser(
    context.db,
    context.userId,
  );
  const consentGranted = context.requireErrorTracking
    ? canCaptureUserErrorTracking(settings)
    : isObservabilityConsentGranted(settings);

  if (!consentGranted) {
    return {
      canCapture: allowAnonymous,
      consentGranted: false,
      distinctId: allowAnonymous ? ANONYMOUS_SERVER_DISTINCT_ID : undefined,
    };
  }

  return {
    canCapture: true,
    consentGranted: true,
    distinctId: context.distinctId ?? context.userId,
    sessionId: context.sessionId ?? undefined,
    windowId: context.windowId ?? undefined,
  };
}

function buildBaseProperties(
  context: ServerTelemetryContext,
  resolvedEnv: Env,
  capturePermissions: Awaited<ReturnType<typeof resolveCapturePermissions>>,
): Record<string, unknown> {
  return sanitizeTelemetryProperties({
    source: context.source,
    method: context.method,
    path: context.path,
    statusCode: context.statusCode,
    requestId: context.requestId,
    environment: resolvedEnv.ENVIRONMENT,
    isAnonymousCapture: !capturePermissions.consentGranted,
    sessionId: capturePermissions.consentGranted
      ? capturePermissions.sessionId
      : undefined,
    windowId: capturePermissions.consentGranted
      ? capturePermissions.windowId
      : undefined,
    ...context.additionalProperties,
  });
}

export async function captureServerException(
  error: unknown,
  context: ServerTelemetryContext,
): Promise<void> {
  try {
    const client = getPostHogClient(context.runtimeEnv);
    if (!client) {
      return;
    }

    const resolvedEnv = resolveEnv(context.runtimeEnv);
    if (!shouldSample(resolvedEnv.POSTHOG_SERVER_ERROR_SAMPLE_RATE)) {
      return;
    }

    const capturePermissions = await resolveCapturePermissions({
      ...context,
      requireErrorTracking: context.requireErrorTracking ?? true,
    });

    if (!capturePermissions.canCapture) {
      return;
    }

    client.captureException(
      error,
      capturePermissions.distinctId,
      buildBaseProperties(context, resolvedEnv, capturePermissions),
    );
  } catch (captureError) {
    console.error("[PostHog] Failed to capture exception:", captureError);
  }
}

/**
 * Captures a consent-gated product event. Unlike exceptions this does not
 * require error-tracking consent, only general observability consent, and it
 * never includes request values (callers pass ids/codes/counts only).
 */
export async function captureServerEvent(
  event: string,
  context: ServerTelemetryContext,
): Promise<void> {
  try {
    const client = getPostHogClient(context.runtimeEnv);
    if (!client) {
      return;
    }

    const resolvedEnv = resolveEnv(context.runtimeEnv);
    const capturePermissions = await resolveCapturePermissions({
      ...context,
      requireErrorTracking: false,
    });

    if (!capturePermissions.canCapture) {
      return;
    }

    client.capture({
      distinctId: capturePermissions.distinctId ?? ANONYMOUS_SERVER_DISTINCT_ID,
      event,
      properties: buildBaseProperties(context, resolvedEnv, capturePermissions),
    });
  } catch (captureError) {
    console.error("[PostHog] Failed to capture event:", captureError);
  }
}

export function registerPostHogProcessHandlers(
  label: string,
  runtimeEnv?: RuntimeEnv,
): void {
  const client = getPostHogClient(runtimeEnv);
  if (!client || processHandlersRegistered) {
    return;
  }

  processHandlersRegistered = true;

  process.on("unhandledRejection", (reason) => {
    const rejectionError =
      reason instanceof Error
        ? reason
        : new Error(sanitizeTelemetryText(String(reason)));

    void captureServerException(rejectionError, {
      allowAnonymous: true,
      runtimeEnv,
      source: `${label}.unhandled_rejection`,
    });
    void client.flush().catch(() => {});
  });

  process.on("uncaughtExceptionMonitor", (error) => {
    void captureServerException(error, {
      allowAnonymous: true,
      runtimeEnv,
      source: `${label}.uncaught_exception`,
    });
    void client.flush().catch(() => {});
  });
}

export async function shutdownPostHogClient(
  runtimeEnv?: RuntimeEnv,
): Promise<void> {
  const client = getPostHogClient(runtimeEnv);
  if (!client) {
    return;
  }

  await client._shutdown(5_000).catch(() => {});
}
