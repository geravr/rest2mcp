/**
 * @file Client-side auth recipe form state for create + settings.
 * Maps UI fields to the tRPC/platform auth discriminator; never shows
 * variable names or isSecret.
 */

export type AuthFormType =
  "none" | "bearer" | "header" | "query" | "basic" | "custom";

export type AuthFormState = {
  type: AuthFormType;
  token: string;
  headerName: string;
  headerValue: string;
  paramName: string;
  paramValue: string;
  /** Required before a query recipe can be saved: query strings are visible in logs and history. */
  queryExposureAcknowledged: boolean;
  username: string;
  password: string;
};

export type AuthRecipePayload =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "header"; headerName: string; value: string }
  | {
      type: "query";
      paramName: string;
      value: string;
      queryExposureAcknowledged: true;
    }
  | { type: "basic"; username: string; password: string };

export type InferredAuth = {
  type: AuthFormType;
  variableName?: string;
  headerName?: string;
  paramName?: string;
  /** Header/query keys currently owned by authentication (names only, never values). */
  protectedKeys?: { headers: string[]; query: string[] };
};

export const DEFAULT_AUTH_FORM: AuthFormState = {
  type: "none",
  token: "",
  headerName: "X-API-Key",
  headerValue: "",
  paramName: "api_key",
  paramValue: "",
  queryExposureAcknowledged: false,
  username: "",
  password: "",
};

export function authFormFromInferred(inferred: InferredAuth): AuthFormState {
  return {
    ...DEFAULT_AUTH_FORM,
    type: inferred.type,
    headerName: inferred.headerName ?? DEFAULT_AUTH_FORM.headerName,
    paramName: inferred.paramName ?? DEFAULT_AUTH_FORM.paramName,
  };
}

/**
 * Build the API recipe. Returns null when Custom (cannot save via recipe)
 * or when required fields are empty (caller should surface validation).
 */
export function buildAuthRecipe(
  state: AuthFormState,
): AuthRecipePayload | null {
  if (state.type === "custom") return null;
  if (state.type === "none") return { type: "none" };
  if (state.type === "bearer") {
    const token = state.token.trim();
    if (!token) return null;
    return { type: "bearer", token };
  }
  if (state.type === "header") {
    const headerName = state.headerName.trim();
    const value = state.headerValue.trim();
    if (!headerName || !value) return null;
    return { type: "header", headerName, value };
  }
  if (state.type === "query") {
    const paramName = state.paramName.trim();
    const value = state.paramValue.trim();
    if (!paramName || !value || !state.queryExposureAcknowledged) return null;
    return {
      type: "query",
      paramName,
      value,
      queryExposureAcknowledged: true,
    };
  }
  const username = state.username.trim();
  if (!username || !state.password) return null;
  return {
    type: "basic",
    username,
    password: state.password,
  };
}

/** For create: omit auth when None so the payload stays minimal. */
export function buildCreateAuth(
  state: AuthFormState,
): AuthRecipePayload | undefined {
  const recipe = buildAuthRecipe(state);
  if (!recipe || recipe.type === "none") return undefined;
  return recipe;
}
