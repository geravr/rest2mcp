/**
 * @file Auth recipe facade: maps a typed auth recipe (none/bearer/header/query/
 * basic) onto a secret variable plus the header/query keys it owns.
 */
import { z } from "zod";
import { APP_ERROR_CODES, appError } from "./app-error.js";

const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const TOKEN_PREFIX = /^(?:Bearer|Token)\s+/i;
const HEADER_VALUE_AS_PAIR = /^([A-Za-z0-9._-]+)\s*:\s*(.+)$/;

const AUTH_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-apikey",
  "api-key",
  "apikey",
  "x-auth-token",
  "x-access-token",
]);

export const serverAuthRecipeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("bearer"),
    token: z.string(),
  }),
  z.object({
    type: z.literal("header"),
    headerName: z.string().trim().min(1).max(200),
    value: z.string(),
  }),
  z.object({
    type: z.literal("query"),
    paramName: z.string().trim().min(1).max(200),
    value: z.string(),
    /** Required: query-string credentials are visible in logs and history. */
    queryExposureAcknowledged: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("basic"),
    username: z.string(),
    password: z.string(),
  }),
]);

export type ServerAuthRecipe = z.infer<typeof serverAuthRecipeSchema>;

export type AuthRecipeMapping = {
  variableName: string | null;
  plaintext: string | null;
  /** Header keys this recipe owns (for replace/cleanup). */
  headerKeys: string[];
  /** Query keys this recipe owns. */
  queryKeys: string[];
};

/** Auth-ish header names: fixed set, api-key variants, or names with token/secret. */
export function isAuthHeaderName(name: string): boolean {
  const normalized = name.toLowerCase();
  if (AUTH_HEADER_NAMES.has(normalized)) return true;
  if (/api[-_]?key/i.test(normalized)) return true;
  return /token|secret/i.test(normalized);
}

/** Query param names that look like credentials when the value is a sole placeholder. */
export function isCredentialQueryName(name: string): boolean {
  const normalized = name.toLowerCase();
  return /api[-_]?key|token|secret|auth|password|passwd|access/i.test(
    normalized,
  );
}

export function slugifyVariableName(raw: string, fallback: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (VARIABLE_NAME_PATTERN.test(slug)) return slug;
  return fallback;
}

/**
 * Normalize a pasted credential for the given recipe type.
 * Bearer strips a leading Bearer/Token prefix; header/query strip
 * `Name: value` paste shapes.
 */
export function normalizeAuthPaste(
  type: Exclude<ServerAuthRecipe["type"], "none">,
  value: string,
): string {
  let next = value.trim();
  if (type === "bearer") {
    next = next.replace(TOKEN_PREFIX, "").trim();
    return next;
  }
  if (type === "header" || type === "query") {
    const pair = next.match(HEADER_VALUE_AS_PAIR);
    if (pair) {
      return pair[2].trim();
    }
    return next;
  }
  return next;
}

export function encodeBasicAuth(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`, "utf8").toString("base64");
}

function rejectEmpty(field: string, value: string): string {
  if (value.length === 0) {
    throw appError({
      appCode: APP_ERROR_CODES.INVALID_INPUT,
      message: `${field} must not be empty.`,
      status: 400,
    });
  }
  return value;
}

/** Compile a validated recipe into the secret variable plus the keys it owns. */
export function recipeToMapping(recipe: ServerAuthRecipe): AuthRecipeMapping {
  if (recipe.type === "none") {
    return {
      variableName: null,
      plaintext: null,
      headerKeys: [],
      queryKeys: [],
    };
  }

  if (recipe.type === "bearer") {
    const token = rejectEmpty(
      "token",
      normalizeAuthPaste("bearer", recipe.token),
    );
    return {
      variableName: "api_token",
      plaintext: token,
      headerKeys: ["Authorization"],
      queryKeys: [],
    };
  }

  if (recipe.type === "header") {
    const headerName = rejectEmpty("headerName", recipe.headerName.trim());
    const value = rejectEmpty(
      "value",
      normalizeAuthPaste("header", recipe.value),
    );
    const variableName = slugifyVariableName(headerName, "api_key");
    return {
      variableName,
      plaintext: value,
      headerKeys: [headerName],
      queryKeys: [],
    };
  }

  if (recipe.type === "query") {
    const paramName = rejectEmpty("paramName", recipe.paramName.trim());
    const value = rejectEmpty(
      "value",
      normalizeAuthPaste("query", recipe.value),
    );
    const variableName = slugifyVariableName(paramName, "api_key");
    return {
      variableName,
      plaintext: value,
      headerKeys: [],
      queryKeys: [paramName],
    };
  }

  const username = rejectEmpty("username", recipe.username.trim());
  const password = rejectEmpty("password", recipe.password);
  return {
    variableName: "basic_auth",
    plaintext: encodeBasicAuth(username, password),
    headerKeys: ["Authorization"],
    queryKeys: [],
  };
}
