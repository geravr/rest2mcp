import { APP_ERROR_CODES } from "@repo/core";
import { describe, expect, it } from "vitest";
import { AppError } from "./app-error.js";
import {
  buildStorageObjectKey,
  canAccessStorageObject,
  getObject,
  resolveStorageBucket,
  uploadObject,
} from "./storage.js";

describe("buildStorageObjectKey", () => {
  it("scopes uploads under users/{userId}", () => {
    const result = buildStorageObjectKey(
      {
        user: {
          id: "usr_123",
        },
      },
      "Quarterly Report.pdf",
      {
        directory: "reports",
        date: new Date("2026-03-16T12:00:00.000Z"),
      },
    );

    expect(result.scope).toEqual({
      type: "user",
      id: "usr_123",
    });
    expect(result.key).toMatch(
      /^users\/usr_123\/reports\/2026\/03\/.+-quarterly-report\.pdf$/,
    );
  });

  it("builds user-scoped keys without a directory", () => {
    const result = buildStorageObjectKey(
      {
        user: {
          id: "usr_123",
        },
      },
      "avatar.PNG",
      {
        date: new Date("2026-03-16T12:00:00.000Z"),
      },
    );

    expect(result.scope).toEqual({
      type: "user",
      id: "usr_123",
    });
    expect(result.key).toMatch(/^users\/usr_123\/2026\/03\/.+-avatar\.png$/);
  });
});

describe("resolveStorageBucket", () => {
  it("throws AppError when S3 is not configured", () => {
    try {
      resolveStorageBucket({} as never);
      expect.unreachable("expected AppError");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).appCode).toBe(
        APP_ERROR_CODES.S3_NOT_CONFIGURED,
      );
      expect((error as AppError).status).toBe(412);
    }
  });
});

describe("uploadObject / getObject", () => {
  it("throw AppError when S3 is not configured", async () => {
    const env = {} as never;
    const params = {
      bucket: "bucket",
      key: "users/usr_1/file.png",
      body: new Uint8Array([1]),
      contentType: "image/png",
    };

    await expect(uploadObject(env, params)).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.S3_NOT_CONFIGURED,
      status: 412,
    });
    await expect(
      getObject(env, { bucket: params.bucket, key: params.key }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.S3_NOT_CONFIGURED,
      status: 412,
    });
  });
});

describe("canAccessStorageObject", () => {
  const ctx = {
    user: {
      id: "usr_123",
    },
  };

  it("allows the caller to read their own user-scoped key", () => {
    expect(canAccessStorageObject("users/usr_123/2026/03/file.png", ctx)).toBe(
      true,
    );
  });

  it("denies reading another user's users/{id} prefix", () => {
    expect(
      canAccessStorageObject("users/usr_other/2026/03/file.png", ctx),
    ).toBe(false);
  });

  it("denies keys under the workspaces/ prefix", () => {
    expect(
      canAccessStorageObject("workspaces/org_123/2026/03/file.png", ctx),
    ).toBe(false);
  });
});
