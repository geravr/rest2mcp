import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";

vi.mock("./posthog.js", () => ({
  captureServerException: vi.fn(),
  extractRequestTelemetryDetails: vi.fn(() => ({
    hasTracingHeaders: false,
  })),
}));

import { Hono } from "hono";
import { APP_ERROR_CODES } from "@repo/core";
import { appError } from "./app-error.js";
import {
  errorHandler,
  getRequestIdForTelemetry,
  getTrustedRequestId,
  notFoundHandler,
  requestIdGenerator,
} from "./middleware.js";

function createContext(headers?: Record<string, string>) {
  return {
    req: {
      raw: new Request("https://example.com", { headers }),
    },
  } as Context;
}

describe("errorHandler", () => {
  it("serializes AppError as a catalog envelope", async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.get("/fail", () => {
      throw appError({
        appCode: APP_ERROR_CODES.FILE_UPLOAD_FAILED,
        message: "Failed to upload file.",
        status: 500,
      });
    });

    const response = await app.request("/fail");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.FILE_UPLOAD_FAILED,
      message: "Failed to upload file.",
    });
  });

  it("serializes unexpected errors as INTERNAL_ERROR", async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.get("/boom", () => {
      throw new Error("secret internals");
    });

    const response = await app.request("/boom");
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.INTERNAL_ERROR,
      message: "Internal Server Error",
    });
  });
});

describe("notFoundHandler", () => {
  it("returns ROUTE_NOT_FOUND", async () => {
    const app = new Hono();
    app.notFound(notFoundHandler);

    const response = await app.request("/missing");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.ROUTE_NOT_FOUND,
      message: "Not Found",
    });
  });
});

describe("requestIdGenerator", () => {
  it("preserves sanitized upstream request ids", () => {
    expect(
      requestIdGenerator(createContext({ "x-request-id": " req-123 " })),
    ).toBe("req-123");
  });

  it("falls back to x-correlation-id when x-request-id is invalid", () => {
    expect(
      getTrustedRequestId(
        new Headers({
          "x-request-id": "bad/id",
          "x-correlation-id": "corr-123",
        }),
      ),
    ).toBe("corr-123");
  });

  it("generates a uuid when no trusted upstream id is available", () => {
    expect(
      requestIdGenerator(createContext({ "x-request-id": "bad/id" })),
    ).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("prefers the canonical response header for telemetry", () => {
    expect(
      getRequestIdForTelemetry(
        new Headers({ "x-request-id": "server-456" }),
        new Headers({ "x-request-id": "client-123" }),
      ),
    ).toBe("server-456");
  });
});
