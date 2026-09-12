import type { Context, Next } from "hono";
import type { Auth, AuthSession, AuthUser } from "./auth.js";
import { APP_ERROR_CODES, appError } from "./app-error.js";
import type { AppContext } from "./context.js";
import { isUserBanned } from "./user-access.js";

export type LoadedSession = {
  session: AuthSession | null;
  user: AuthUser | null;
};

export async function loadSession(
  auth: Auth,
  headers: Headers,
): Promise<LoadedSession> {
  const sessionData = await auth.api.getSession({ headers });
  return {
    session: sessionData?.session ?? null,
    user: sessionData?.user ?? null,
  };
}

export async function requireSession(
  c: Context<AppContext>,
  next: Next,
): Promise<void> {
  const auth = c.get("auth");
  if (!auth) {
    throw new Error("Authentication service not available in context");
  }

  const loaded = await loadSession(auth, c.req.raw.headers);
  c.set("session", loaded.session);
  c.set("user", loaded.user);

  if (!loaded.session || !loaded.user) {
    throw appError({
      appCode: APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
      message: "Authentication required",
      status: 401,
    });
  }

  await next();
}

export async function requireActiveUser(
  c: Context<AppContext>,
  next: Next,
): Promise<void> {
  const user = c.get("user");
  if (!user) {
    throw appError({
      appCode: APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
      message: "Authentication required",
      status: 401,
    });
  }

  const db = c.get("db");
  if (db && (await isUserBanned(db, user.id))) {
    throw appError({
      appCode: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
      message: "Your account has been suspended.",
      status: 403,
    });
  }

  await next();
}
