/**
 * @file Auth recipe facade: maps typed auth (none/bearer/header/query/basic)
 * onto a secret variable + defaultHeaders/defaultQuery. Inference reads the
 * same shapes back; unrecognized setups are Custom.
 */
import { z } from "zod";
import { APP_ERROR_CODES, appError } from "./app-error.js";
import { extractPlaceholders } from "./mcp-template.js";

const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const EXACT_PLACEHOLDER = /^\{\{([A-Za-z][A-Za-z0-9_]*)\}\}$/;
const BEARER_TEMPLATE = /^Bearer\s+\{\{([A-Za-z][A-Za-z0-9_]*)\}\}$/i;
const BASIC_TEMPLATE = /^Basic\s+\{\{([A-Za-z][A-Za-z0-9_]*)\}\}$/i;
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
  defaultHeadersPatch: Record<string, string>;
  defaultQueryPatch: Record<string, string>;
};

export type InferredServerAuth =
  | { type: "none" }
  | { type: "bearer"; variableName: string }
  | { type: "header"; headerName: string; variableName: string }
  | { type: "query"; paramName: string; variableName: string }
  | { type: "basic"; variableName: string }
  | { type: "custom" };

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

/** Compile a validated recipe into the variable + default mapping to write. */
export function recipeToMapping(recipe: ServerAuthRecipe): AuthRecipeMapping {
  if (recipe.type === "none") {
    return {
      variableName: null,
      plaintext: null,
      headerKeys: [],
      queryKeys: [],
      defaultHeadersPatch: {},
      defaultQueryPatch: {},
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
      defaultHeadersPatch: {
        Authorization: "Bearer {{api_token}}",
      },
      defaultQueryPatch: {},
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
      defaultHeadersPatch: {
        [headerName]: `{{${variableName}}}`,
      },
      defaultQueryPatch: {},
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
      defaultHeadersPatch: {},
      defaultQueryPatch: {
        [paramName]: `{{${variableName}}}`,
      },
    };
  }

  const username = rejectEmpty("username", recipe.username.trim());
  const password = rejectEmpty("password", recipe.password);
  return {
    variableName: "basic_auth",
    plaintext: encodeBasicAuth(username, password),
    headerKeys: ["Authorization"],
    queryKeys: [],
    defaultHeadersPatch: {
      Authorization: "Basic {{basic_auth}}",
    },
    defaultQueryPatch: {},
  };
}

type AuthCandidate =
  | {
      kind: "bearer" | "basic" | "header";
      headerName: string;
      variableName: string;
    }
  | { kind: "query"; paramName: string; variableName: string };

/** Templated credential-ish headers beyond the plaintext-guard set (e.g. X-Partner-Key). */
function isCredentialHeaderCandidate(name: string): boolean {
  if (isAuthHeaderName(name)) return true;
  return /key|token|secret|auth/i.test(name);
}

function collectAuthCandidates(
  defaultHeaders: Record<string, string> | null | undefined,
  defaultQuery: Record<string, string> | null | undefined,
): AuthCandidate[] {
  const candidates: AuthCandidate[] = [];

  for (const [headerName, value] of Object.entries(defaultHeaders ?? {})) {
    if (!isCredentialHeaderCandidate(headerName)) continue;

    const bearer = value.match(BEARER_TEMPLATE);
    if (bearer && headerName.toLowerCase() === "authorization") {
      candidates.push({
        kind: "bearer",
        headerName,
        variableName: bearer[1],
      });
      continue;
    }

    const basic = value.match(BASIC_TEMPLATE);
    if (basic && headerName.toLowerCase() === "authorization") {
      candidates.push({
        kind: "basic",
        headerName,
        variableName: basic[1],
      });
      continue;
    }

    const exact = value.match(EXACT_PLACEHOLDER);
    if (exact) {
      candidates.push({
        kind: "header",
        headerName,
        variableName: exact[1],
      });
    }
  }

  for (const [paramName, value] of Object.entries(defaultQuery ?? {})) {
    if (!isCredentialQueryName(paramName)) continue;
    const exact = value.match(EXACT_PLACEHOLDER);
    if (exact) {
      candidates.push({
        kind: "query",
        paramName,
        variableName: exact[1],
      });
    }
  }

  return candidates;
}

/**
 * Infer the auth scheme from stored defaults. Multiple credential defaults
 * (or unrecognized shapes) yield Custom so editors do not clobber extras.
 */
export function inferServerAuth(
  defaultHeaders: Record<string, string> | null | undefined,
  defaultQuery: Record<string, string> | null | undefined,
): InferredServerAuth {
  const candidates = collectAuthCandidates(defaultHeaders, defaultQuery);
  if (candidates.length === 0) return { type: "none" };
  if (candidates.length > 1) return { type: "custom" };

  const only = candidates[0];
  if (only.kind === "bearer") {
    return { type: "bearer", variableName: only.variableName };
  }
  if (only.kind === "basic") {
    return { type: "basic", variableName: only.variableName };
  }
  if (only.kind === "header") {
    return {
      type: "header",
      headerName: only.headerName,
      variableName: only.variableName,
    };
  }
  if (only.kind === "query") {
    return {
      type: "query",
      paramName: only.paramName,
      variableName: only.variableName,
    };
  }
  return { type: "custom" };
}

/** True when the server already has a mapped auth default (header or query). */
export function serverHasMappedAuth(
  defaultHeaders: Record<string, string> | null | undefined,
  defaultQuery: Record<string, string> | null | undefined,
): boolean {
  return collectAuthCandidates(defaultHeaders, defaultQuery).length > 0;
}

/**
 * Header/query keys owned by the current inferred recipe (for cleanup when
 * switching). Custom / none → empty so unrelated defaults stay.
 */
export function inferredAuthOwnedKeys(inferred: InferredServerAuth): {
  headerKeys: string[];
  queryKeys: string[];
  variableName: string | null;
} {
  if (inferred.type === "none" || inferred.type === "custom") {
    return { headerKeys: [], queryKeys: [], variableName: null };
  }
  if (inferred.type === "bearer" || inferred.type === "basic") {
    return {
      headerKeys: ["Authorization"],
      queryKeys: [],
      variableName: inferred.variableName,
    };
  }
  if (inferred.type === "header") {
    return {
      headerKeys: [inferred.headerName],
      queryKeys: [],
      variableName: inferred.variableName,
    };
  }
  return {
    headerKeys: [],
    queryKeys: [inferred.paramName],
    variableName: inferred.variableName,
  };
}

/**
 * All credential default keys currently mapped (including Custom multi-key).
 * Used when applying `none` so clearing auth does not leave Custom leftovers.
 */
export function allCredentialMappingKeys(
  defaultHeaders: Record<string, string> | null | undefined,
  defaultQuery: Record<string, string> | null | undefined,
): {
  headerKeys: string[];
  queryKeys: string[];
  variableNames: string[];
} {
  const candidates = collectAuthCandidates(defaultHeaders, defaultQuery);
  const headerKeys: string[] = [];
  const queryKeys: string[] = [];
  const variableNames: string[] = [];
  for (const candidate of candidates) {
    variableNames.push(candidate.variableName);
    if (candidate.kind === "query") {
      queryKeys.push(candidate.paramName);
    } else {
      headerKeys.push(candidate.headerName);
    }
  }
  return { headerKeys, queryKeys, variableNames };
}

/** True when any template string references `{{name}}`. */
export function templatesReferenceVariable(
  name: string,
  templates: Iterable<string | null | undefined>,
): boolean {
  const needle = `{{${name}}}`;
  for (const template of templates) {
    if (!template) continue;
    if (extractPlaceholders(template).includes(name)) return true;
    if (template.includes(needle)) return true;
  }
  return false;
}
