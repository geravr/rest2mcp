import {
  REDACTED_TELEMETRY_VALUE,
  TELEMETRY_BLOCK_SELECTORS,
  TELEMETRY_MASK_TEXT_SELECTORS,
  buildTelemetrySelectorList,
  isRecord,
  sanitizeTelemetryProperties,
  sanitizeTelemetryUrl,
  type ObservabilitySettings,
} from "@repo/core";
import posthog, {
  type CapturedNetworkRequest,
  type PostHog,
  type PostHogConfig,
} from "posthog-js";
import { getApiBaseUrl, getApiOriginUrl } from "./api-url";
import { getErrorStatus } from "./errors";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const DEFAULT_REPLAY_SAMPLE_RATE = 0.15;
const DEFAULT_ERROR_SAMPLE_RATE = 1;

type TelemetryProperties = Record<string, unknown>;
interface HandledPostHogCaptureOptions {
  includeStatuses?: number[];
}

type BrowserTelemetryUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

export type AppPostHogEventName =
  "api_key.deleted" | "api_key.saved" | "auth.login.succeeded" | "auth.logout";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY?.trim();
const POSTHOG_ENABLED = Boolean(POSTHOG_KEY);
const POSTHOG_HOST = trimTrailingSlash(
  import.meta.env.VITE_POSTHOG_HOST?.trim() || DEFAULT_POSTHOG_HOST,
);
const POSTHOG_CONSENT_REQUIRED = parseBoolean(
  import.meta.env.VITE_POSTHOG_REQUIRE_CONSENT,
  true,
);
const POSTHOG_REPLAY_SAMPLE_RATE = parseRate(
  import.meta.env.VITE_POSTHOG_REPLAY_SAMPLE_RATE,
  DEFAULT_REPLAY_SAMPLE_RATE,
);
const POSTHOG_ERROR_SAMPLE_RATE = parseRate(
  import.meta.env.VITE_POSTHOG_ERROR_SAMPLE_RATE,
  DEFAULT_ERROR_SAMPLE_RATE,
);
const POSTHOG_MASK_TEXT_SELECTOR = buildTelemetrySelectorList([
  ...TELEMETRY_MASK_TEXT_SELECTORS,
  ...splitCsv(import.meta.env.VITE_POSTHOG_MASK_TEXT_SELECTORS),
]);
const POSTHOG_BLOCK_SELECTOR = buildTelemetrySelectorList([
  ...TELEMETRY_BLOCK_SELECTORS,
  ...splitCsv(import.meta.env.VITE_POSTHOG_BLOCK_SELECTORS),
]);
const POSTHOG_TRACE_TARGETS = uniqueValues([
  getApiOriginUrl(),
  getApiBaseUrl(),
  ...splitCsv(import.meta.env.VITE_POSTHOG_TRACE_TARGETS),
]).map(trimTrailingSlash);

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function parseRate(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.min(1, Math.max(0, parsed));
}

function splitCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isUrlLikeKey(key: string): boolean {
  return /(href|path|referrer|uri|url)/i.test(key);
}

function sanitizeBrowserTelemetryValue(key: string, value: unknown): unknown {
  if (typeof value === "string" && isUrlLikeKey(key)) {
    return sanitizeTelemetryUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeBrowserTelemetryValue(key, entry));
  }

  if (isRecord(value)) {
    return sanitizeBrowserTelemetryProperties(value);
  }

  return value;
}

function sanitizeBrowserTelemetryProperties(
  properties: TelemetryProperties,
): TelemetryProperties {
  const sanitized = sanitizeTelemetryProperties(properties);

  return Object.fromEntries(
    Object.entries(sanitized).map(([key, value]) => [
      key,
      sanitizeBrowserTelemetryValue(key, value),
    ]),
  );
}

function sanitizeCapturedHeaders(
  headers: CapturedNetworkRequest["requestHeaders"],
): CapturedNetworkRequest["requestHeaders"] {
  if (!headers) {
    return headers;
  }

  const sanitized = sanitizeTelemetryProperties(headers);

  return Object.fromEntries(
    Object.entries(sanitized).map(([key, value]) => [key, String(value)]),
  );
}

function sanitizeCapturedNetworkRequest(
  value: CapturedNetworkRequest,
): CapturedNetworkRequest {
  const nextValue: CapturedNetworkRequest = { ...value };

  if (typeof nextValue.name === "string") {
    nextValue.name = sanitizeTelemetryUrl(nextValue.name);
  }

  if ("requestBody" in nextValue) {
    nextValue.requestBody = REDACTED_TELEMETRY_VALUE;
  }

  if ("responseBody" in nextValue) {
    nextValue.responseBody = REDACTED_TELEMETRY_VALUE;
  }

  if (isRecord(nextValue.requestHeaders)) {
    nextValue.requestHeaders = sanitizeCapturedHeaders(
      nextValue.requestHeaders,
    );
  }

  if (isRecord(nextValue.responseHeaders)) {
    nextValue.responseHeaders = sanitizeCapturedHeaders(
      nextValue.responseHeaders,
    );
  }

  return nextValue;
}

function shouldSampleException(eventName: string | undefined): boolean {
  if (POSTHOG_ERROR_SAMPLE_RATE >= 1 || !eventName?.includes("$exception")) {
    return true;
  }

  return Math.random() <= POSTHOG_ERROR_SAMPLE_RATE;
}

function sanitizeBeforeSend(event: unknown): unknown | null {
  if (!isRecord(event)) {
    return event;
  }

  const eventName = typeof event.event === "string" ? event.event : undefined;

  // Session recording snapshots use their own privacy controls
  // (mask/block selectors, maskCapturedNetworkRequestFn). Sanitizing
  // their protocol fields ($session_id, $window_id) corrupts them.
  if (eventName === "$snapshot") {
    return event;
  }

  if (!shouldSampleException(eventName)) {
    return null;
  }

  if (!isRecord(event.properties)) {
    return event;
  }

  return {
    ...event,
    properties: sanitizeBrowserTelemetryProperties(event.properties),
  };
}

function createPostHogConfig(): Partial<PostHogConfig> {
  return {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_exceptions: false,
    capture_pageleave: "if_capture_pageview",
    capture_pageview: "history_change",
    disable_session_recording: true,
    opt_out_capturing_by_default: true,
    opt_out_persistence_by_default: true,
    person_profiles: "identified_only",
    respect_dnt: true,
    session_recording: {
      sampleRate: POSTHOG_REPLAY_SAMPLE_RATE,
      maskAllInputs: true,
      maskTextSelector: POSTHOG_MASK_TEXT_SELECTOR,
      blockSelector: POSTHOG_BLOCK_SELECTOR,
      maskCapturedNetworkRequestFn: sanitizeCapturedNetworkRequest,
    } as NonNullable<PostHogConfig["session_recording"]>,
    __add_tracing_headers: POSTHOG_TRACE_TARGETS,
    before_send: sanitizeBeforeSend as NonNullable<
      PostHogConfig["before_send"]
    >,
    loaded: (client) => {
      client.stopExceptionAutocapture();
    },
  } as Partial<PostHogConfig>;
}

function getInitializedPostHogClient(): PostHog | null {
  if (!POSTHOG_ENABLED) {
    return null;
  }

  return initializePostHogClient();
}

export function initializePostHogClient(): PostHog {
  if (!POSTHOG_ENABLED || typeof window === "undefined") {
    return posthog;
  }

  const globalWindow = window as Window & {
    __posthogInitialized?: boolean;
  };

  if (globalWindow.__posthogInitialized) {
    return posthog;
  }

  posthog.init(POSTHOG_KEY!, createPostHogConfig());
  globalWindow.__posthogInitialized = true;

  return posthog;
}

export function getPostHogClient(): PostHog {
  return posthog;
}

export function isPostHogEnabled(): boolean {
  return POSTHOG_ENABLED;
}

export function isPostHogConsentRequired(): boolean {
  return POSTHOG_ENABLED && POSTHOG_CONSENT_REQUIRED;
}

export function shouldCaptureHandledPostHogError(
  error: unknown,
  options?: HandledPostHogCaptureOptions,
): boolean {
  const status = getErrorStatus(error);

  if (status === undefined || status >= 500) {
    return true;
  }

  return options?.includeStatuses?.includes(status) ?? false;
}

export function capturePostHogEvent(
  eventName: AppPostHogEventName | string,
  properties?: TelemetryProperties,
): void {
  const client = getInitializedPostHogClient();
  if (!client) {
    return;
  }

  client.capture(
    eventName,
    properties ? sanitizeBrowserTelemetryProperties(properties) : undefined,
  );
}

export function capturePostHogException(
  error: unknown,
  properties?: TelemetryProperties,
): void {
  const client = getInitializedPostHogClient();
  if (!client || error == null || !client.has_opted_in_capturing()) {
    return;
  }

  client.captureException(
    error,
    properties ? sanitizeBrowserTelemetryProperties(properties) : undefined,
  );
}

export function captureHandledPostHogException(
  error: unknown,
  properties?: TelemetryProperties,
  options?: HandledPostHogCaptureOptions,
): void {
  if (!shouldCaptureHandledPostHogError(error, options)) {
    return;
  }

  capturePostHogException(error, properties);
}

export function identifyPostHogUser(user: BrowserTelemetryUser): void {
  const client = getInitializedPostHogClient();
  if (!client) {
    return;
  }

  client.identify(
    user.id,
    sanitizeBrowserTelemetryProperties({
      email: user.email ?? null,
      image: user.image ?? null,
      name: user.name ?? null,
    }),
  );
}

export function resetPostHogIdentity(options?: {
  resetDeviceId?: boolean;
}): void {
  const client = getInitializedPostHogClient();
  if (!client) {
    return;
  }

  client.reset(options?.resetDeviceId);
}

export function applyPostHogObservabilitySettings(
  settings: ObservabilitySettings,
  source: "banner" | "runtime" | "settings" = "runtime",
): void {
  const client = getInitializedPostHogClient();
  if (!client) {
    return;
  }

  if (settings.consentStatus !== "granted") {
    client.stopExceptionAutocapture();
    client.stopSessionRecording();

    if (client.has_opted_in_capturing()) {
      client.opt_out_capturing();
    }

    client.reset();
    return;
  }

  if (!client.has_opted_in_capturing()) {
    client.opt_in_capturing({
      captureEventName: source === "runtime" ? false : "$opt_in",
      captureProperties:
        source === "runtime"
          ? undefined
          : sanitizeBrowserTelemetryProperties({ source }),
    });
  }

  if (settings.errorTrackingEnabled) {
    client.startExceptionAutocapture();
  } else {
    client.stopExceptionAutocapture();
  }

  if (settings.sessionReplayEnabled) {
    client.startSessionRecording();
  } else {
    client.stopSessionRecording();
  }
}
