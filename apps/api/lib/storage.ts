import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { APP_ERROR_CODES, appError } from "./app-error.js";
import type { Env } from "./env.js";

type StorageScopeContext = {
  user: {
    id: string;
  };
};

type Scope = {
  type: "user";
  id: string;
};

export interface UploadObjectParams {
  bucket: string;
  key: string;
  body: Blob | Uint8Array;
  contentType: string;
  contentLength?: number;
  metadata?: Record<string, string>;
}

export interface GetObjectParams {
  bucket: string;
  key: string;
}

function assertStorageConfig(env: Env) {
  if (
    !env.STORAGE_S3_BUCKET ||
    !env.STORAGE_S3_ACCESS_KEY_ID ||
    !env.STORAGE_S3_SECRET_ACCESS_KEY
  ) {
    throw appError({
      appCode: APP_ERROR_CODES.S3_NOT_CONFIGURED,
      message: "S3 storage is not configured.",
      status: 412,
    });
  }
}

function createStorageClient(env: Env) {
  assertStorageConfig(env);

  return new S3Client({
    region: env.STORAGE_S3_REGION,
    endpoint: env.STORAGE_S3_ENDPOINT,
    forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID!,
      secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY!,
    },
  });
}

function sanitizeFilename(filename: string) {
  const lastDotIndex = filename.lastIndexOf(".");
  const baseName =
    lastDotIndex > 0 ? filename.slice(0, lastDotIndex) : filename;
  const extension = lastDotIndex > 0 ? filename.slice(lastDotIndex) : "";

  const sanitizedBaseName = baseName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase()
    .slice(0, 80);

  const sanitizedExtension = extension
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 16);

  return `${sanitizedBaseName || "file"}${sanitizedExtension}`;
}

function getCurrentDateSegments(date = new Date()) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  return { year, month };
}

export function getStorageScope(ctx: StorageScopeContext): Scope {
  return {
    type: "user",
    id: ctx.user.id,
  };
}

export function buildStorageObjectKey(
  ctx: StorageScopeContext,
  filename: string,
  options?: {
    directory?: string;
    date?: Date;
  },
) {
  const scope = getStorageScope(ctx);
  const { year, month } = getCurrentDateSegments(options?.date);
  const safeFilename = sanitizeFilename(filename);
  const directory = options?.directory?.trim().replace(/^\/+|\/+$/g, "");
  const scopePrefix = `users/${scope.id}`;
  const directoryPrefix = directory ? `${directory}/` : "";

  return {
    key: `${scopePrefix}/${directoryPrefix}${year}/${month}/${crypto.randomUUID()}-${safeFilename}`,
    scope,
  };
}

export async function uploadObject(env: Env, params: UploadObjectParams) {
  const client = createStorageClient(env);

  await client.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ContentLength: params.contentLength,
      Metadata: params.metadata,
    }),
  );
}

export async function getObject(env: Env, params: GetObjectParams) {
  const client = createStorageClient(env);

  return client.send(
    new GetObjectCommand({
      Bucket: params.bucket,
      Key: params.key,
    }),
  );
}

export function resolveStorageBucket(env: Env) {
  assertStorageConfig(env);
  return env.STORAGE_S3_BUCKET!;
}

export function resolveStorageAccessUrl(env: Env, key: string) {
  const url = new URL("/api/storage/object", env.APP_ORIGIN);
  url.searchParams.set("key", key);
  return url.toString();
}

export function assertOwnedStorageAccessUrl(
  accessUrl: string,
  ctx: StorageScopeContext,
  appOrigin: string,
) {
  let parsed: URL;
  let expectedOrigin: string;

  try {
    parsed = new URL(accessUrl);
    expectedOrigin = new URL(appOrigin).origin;
  } catch {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Storage access URL is invalid.",
      status: 400,
    });
  }

  if (parsed.origin !== expectedOrigin) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Storage access URL is invalid.",
      status: 400,
    });
  }

  if (parsed.pathname !== "/api/storage/object") {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Storage access URL is invalid.",
      status: 400,
    });
  }

  const key = parsed.searchParams.get("key");
  if (!key || !canAccessStorageObject(key, ctx)) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: "Storage access URL is not allowed for this user.",
      status: 403,
    });
  }
}

export function canAccessStorageObject(key: string, ctx: StorageScopeContext) {
  const segments = key.split("/");

  if (segments.length < 2) {
    return false;
  }

  if (segments[0] === "workspaces") {
    return false;
  }

  if (segments[0] === "users") {
    return segments[1] === ctx.user.id;
  }

  return false;
}
