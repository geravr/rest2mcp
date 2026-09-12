import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import type { AppContext } from "./context.js";

vi.mock("./posthog.js", () => ({
  captureServerException: vi.fn(),
  extractRequestTelemetryDetails: vi.fn(() => ({
    hasTracingHeaders: false,
  })),
}));

const isUserBannedMock = vi.hoisted(() => vi.fn());

vi.mock("./user-access.js", () => ({
  isUserBanned: isUserBannedMock,
}));

vi.mock("./storage.js", async () => {
  const actual =
    await vi.importActual<typeof import("./storage.js")>("./storage.js");
  return {
    ...actual,
    uploadObject: vi.fn(),
    getObject: vi.fn(),
  };
});

import api from "./app.js";
import { errorHandler } from "./middleware.js";
import { uploadObject } from "./storage.js";

afterEach(() => {
  vi.clearAllMocks();
});

function createApp(
  session: {
    session: { id: string } | null;
    user: { id: string } | null;
  } | null,
  env: Record<string, string> = {},
) {
  const app = new Hono<AppContext>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("auth", {
      api: {
        getSession: vi.fn(async () => session),
      },
    } as never);
    c.set("db", {} as never);
    c.set("dbDirect", {} as never);
    c.set("env", {
      APP_ORIGIN: "http://localhost:5173",
      ...env,
    } as never);
    await next();
  });
  app.route("/", api);
  return app;
}

function uploadFile() {
  const form = new FormData();
  form.set("file", new File(["hello"], "photo.png", { type: "image/png" }));
  return form;
}

describe("storage route auth envelopes", () => {
  it("rejects upload without a session", async () => {
    const app = createApp(null);
    const response = await app.request("/api/storage/upload", {
      method: "POST",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
      message: "Authentication required",
    });
  });

  it("rejects upload for a banned caller", async () => {
    isUserBannedMock.mockResolvedValueOnce(true);
    const app = createApp({
      session: { id: "ses_1" },
      user: { id: "usr_banned" },
    });

    const response = await app.request("/api/storage/upload", {
      method: "POST",
      body: uploadFile(),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
      message: "Your account has been suspended.",
    });
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("returns S3_NOT_CONFIGURED when an authenticated user uploads without S3", async () => {
    isUserBannedMock.mockResolvedValueOnce(false);
    const app = createApp({
      session: { id: "ses_1" },
      user: { id: "usr_1" },
    });

    const response = await app.request("/api/storage/upload", {
      method: "POST",
      body: uploadFile(),
    });

    expect(response.status).toBe(412);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.S3_NOT_CONFIGURED,
      message: "S3 storage is not configured.",
    });
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it("returns FILE_UPLOAD_FAILED when the object store rejects the write", async () => {
    isUserBannedMock.mockResolvedValueOnce(false);
    vi.mocked(uploadObject).mockRejectedValueOnce(new Error("s3 down"));
    const app = createApp(
      {
        session: { id: "ses_1" },
        user: { id: "usr_1" },
      },
      {
        STORAGE_S3_BUCKET: "bucket",
        STORAGE_S3_ACCESS_KEY_ID: "id",
        STORAGE_S3_SECRET_ACCESS_KEY: "secret",
      },
    );

    const response = await app.request("/api/storage/upload", {
      method: "POST",
      body: uploadFile(),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.FILE_UPLOAD_FAILED,
      message: "Failed to upload file.",
    });
  });

  it("rejects object GET without a session", async () => {
    const app = createApp(null);
    const response = await app.request("/api/storage/object?key=users/usr_1/a");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
      message: "Authentication required",
    });
  });

  it("rejects object GET for a banned caller", async () => {
    isUserBannedMock.mockResolvedValueOnce(true);
    const app = createApp({
      session: { id: "ses_1" },
      user: { id: "usr_banned" },
    });

    const response = await app.request(
      "/api/storage/object?key=users/usr_banned/a",
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
      message: "Your account has been suspended.",
    });
  });

  it("rejects object GET without a key", async () => {
    isUserBannedMock.mockResolvedValueOnce(false);
    const app = createApp({
      session: { id: "ses_1" },
      user: { id: "usr_1" },
    });

    const response = await app.request("/api/storage/object");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.STORAGE_KEY_REQUIRED,
      message: "Storage key is required.",
    });
  });

  it("rejects object GET when the caller cannot access the key", async () => {
    isUserBannedMock.mockResolvedValueOnce(false);
    const app = createApp({
      session: { id: "ses_1" },
      user: { id: "usr_1" },
    });

    const response = await app.request(
      "/api/storage/object?key=users/usr_other/file.png",
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: APP_ERROR_CODES.STORAGE_ACCESS_DENIED,
      message: "You do not have access to this object.",
    });
  });
});

describe("tRPC stays tRPC-shaped", () => {
  it("returns AUTHENTICATION_REQUIRED as a tRPC error, not a Hono envelope", async () => {
    const app = createApp(null);
    const response = await app.request("/api/trpc/user.me");
    const body = (await response.json()) as {
      error?: { data?: { appCode?: string; code?: string } };
      code?: string;
    };

    expect(body.code).not.toBe(APP_ERROR_CODES.AUTHENTICATION_REQUIRED);
    expect(body.error?.data?.appCode).toBe(
      APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
    );
    expect(body.error?.data?.code).toBe("UNAUTHORIZED");
  });
});
