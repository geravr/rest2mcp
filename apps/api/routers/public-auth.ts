import { platformSettings, user } from "@repo/db";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import {
  APP_ERROR_CODES,
  appJsonError,
  resolveRequestLocale,
} from "../lib/app-error.js";
import type { AppContext } from "../lib/context.js";
import { sendOTP } from "../lib/email.js";
import { isSignInOtpValid, clearSignInOtps } from "../lib/otp-peek.js";
import { assertOtpSendAllowed } from "../lib/otp-send-limiter.js";
import { isUserBanned } from "../lib/user-access.js";
import {
  markInvitationAccepted,
  validateInvitationToken,
} from "../services/admin-service.js";

type PublicAuthContext = Context<AppContext>;

const OTP_SEND_SUCCESS = {
  success: true,
  message: "If this email can be used, a code was sent.",
  code: "OTP_SENT",
} as const;

const OTP_VERIFY_FAILURE = appJsonError(
  APP_ERROR_CODES.OTP_VERIFY_FAILED,
  "Unable to complete verification with this email and code.",
);

const authOtpEmailSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
});

const authOtpLoginVerifySchema = authOtpEmailSchema.extend({
  otp: z.string().regex(/^\d{6}$/),
});

const authOtpSignupVerifySchema = authOtpLoginVerifySchema.extend({
  name: z.string().trim().min(1).max(128),
});

function getClientIp(c: PublicAuthContext): string | null {
  const cfIp = c.req.header("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded && forwarded.length > 0 ? forwarded : null;
}

async function lookupUserId(c: PublicAuthContext, email: string) {
  const db = c.get("db");

  return db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
    .then((rows) => rows[0]?.id ?? null);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code =
    "code" in error && typeof error.code === "string" ? error.code : null;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  return code === "23505" || /unique|duplicate/i.test(message);
}

async function proxyBetterAuthRequest(
  c: PublicAuthContext,
  path: string,
  payload: unknown,
) {
  const auth = c.get("auth");

  if (!auth) {
    return c.json(
      appJsonError(
        APP_ERROR_CODES.AUTH_UNAVAILABLE,
        "Authentication service not initialized",
      ),
      503,
    );
  }

  const url = new URL(`/api/auth/${path}`, c.req.url);
  const headers = new Headers(c.req.raw.headers);
  headers.set("content-type", "application/json");

  return auth.handler(
    new Request(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
  );
}

function otpSendSuccessResponse(c: PublicAuthContext) {
  return c.json(OTP_SEND_SUCCESS, 200);
}

function otpVerifyFailureResponse(c: PublicAuthContext) {
  return c.json(OTP_VERIFY_FAILURE, 400);
}

async function enforceOtpSendThrottle(
  c: PublicAuthContext,
  email: string,
): Promise<Response | null> {
  if (!assertOtpSendAllowed(email, getClientIp(c))) {
    return c.json(
      appJsonError(
        APP_ERROR_CODES.OTP_SEND_RATE_LIMITED,
        "Too many verification emails. Try again shortly.",
      ),
      429,
    );
  }
  return null;
}

const publicAuthRoutes = new Hono<AppContext>();

/**
 * Check if public registration is enabled.
 * Returns false when the platform_settings row disables it.
 */
async function isRegistrationEnabled(c: PublicAuthContext): Promise<boolean> {
  const db = c.get("db");
  const [settings] = await db
    .select({ registrationEnabled: platformSettings.registrationEnabled })
    .from(platformSettings)
    .where(eq(platformSettings.id, "default"))
    .limit(1);
  // If no settings row exists yet, default to enabled
  return settings?.registrationEnabled ?? true;
}

/** Returns a 403 if registration is closed and no valid invite token is provided. */
async function assertRegistrationAllowed(
  c: PublicAuthContext,
  expectedEmail?: string,
): Promise<Response | null> {
  const enabled = await isRegistrationEnabled(c);

  // Check for invite token in query params or body
  const url = new URL(c.req.url);
  const token = url.searchParams.get("invite");

  if (token) {
    const db = c.get("db");
    const invite = await validateInvitationToken(db, token);
    if (invite) {
      if (!expectedEmail || invite.email === expectedEmail) {
        return null;
      }

      return c.json(
        appJsonError(
          APP_ERROR_CODES.INVITATION_EMAIL_MISMATCH,
          "This invitation is for a different email address.",
        ),
        403,
      );
    }
  }

  if (enabled) return null;

  return c.json(
    appJsonError(
      APP_ERROR_CODES.REGISTRATION_DISABLED,
      "Registration is currently closed. You need an invitation to sign up.",
    ),
    403,
  );
}

// ── Public status endpoints ──────────────────────────────────────────────

/** Public endpoint to check if registration is open (no auth required). */
publicAuthRoutes.get("/registration-status", async (c) => {
  const db = c.get("db");
  const [settings] = await db
    .select({
      registrationEnabled: platformSettings.registrationEnabled,
      registrationDisabledMessage: platformSettings.registrationDisabledMessage,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, "default"))
    .limit(1);

  return c.json({
    registrationEnabled: settings?.registrationEnabled ?? true,
    message: settings?.registrationDisabledMessage ?? null,
  });
});

/** Validate a platform invitation token (no auth required). */
publicAuthRoutes.get("/validate-invite", async (c) => {
  const token = c.req.query("token");
  if (!token) {
    return c.json(
      {
        valid: false,
        ...appJsonError(
          APP_ERROR_CODES.NO_TOKEN_PROVIDED,
          "No token provided.",
        ),
      },
      400,
    );
  }

  const db = c.get("db");
  const invite = await validateInvitationToken(db, token);
  if (!invite) {
    return c.json({
      valid: false,
      ...appJsonError(
        APP_ERROR_CODES.INVALID_INVITATION,
        "Invalid or expired invitation.",
      ),
    });
  }

  return c.json({ valid: true, email: invite.email });
});

publicAuthRoutes.post("/otp/login/send", async (c) => {
  const parsed = authOtpEmailSchema.safeParse(
    await c.req.json().catch(() => null),
  );

  if (!parsed.success) {
    return c.json(
      appJsonError(
        APP_ERROR_CODES.INVALID_EMAIL,
        "Enter a valid email address.",
      ),
      400,
    );
  }

  const throttle = await enforceOtpSendThrottle(c, parsed.data.email);
  if (throttle) return throttle;

  const existingUserId = await lookupUserId(c, parsed.data.email);
  if (!existingUserId) {
    // Same success body as a real send — do not reveal account existence.
    return otpSendSuccessResponse(c);
  }

  if (await isUserBanned(c.get("db"), existingUserId)) {
    // Do not send OTP to banned accounts; keep the generic success body.
    return otpSendSuccessResponse(c);
  }

  const response = await proxyBetterAuthRequest(
    c,
    "email-otp/send-verification-otp",
    {
      email: parsed.data.email,
      type: "sign-in",
    },
  );

  if (response.status >= 200 && response.status < 300) {
    return otpSendSuccessResponse(c);
  }

  return response;
});

publicAuthRoutes.post("/otp/login/verify", async (c) => {
  const parsed = authOtpLoginVerifySchema.safeParse(
    await c.req.json().catch(() => null),
  );

  if (!parsed.success) {
    return c.json(
      appJsonError(
        APP_ERROR_CODES.INVALID_INPUT,
        "Enter a valid email and 6-digit code.",
      ),
      400,
    );
  }

  const existingUserId = await lookupUserId(c, parsed.data.email);
  if (!existingUserId) {
    return otpVerifyFailureResponse(c);
  }

  if (await isUserBanned(c.get("db"), existingUserId)) {
    return c.json(
      appJsonError(
        APP_ERROR_CODES.ACCOUNT_SUSPENDED,
        "Your account has been suspended. Contact an administrator.",
      ),
      403,
    );
  }

  return proxyBetterAuthRequest(c, "sign-in/email-otp", parsed.data);
});

publicAuthRoutes.post("/otp/signup/send", async (c) => {
  const parsed = authOtpEmailSchema.safeParse(
    await c.req.json().catch(() => null),
  );

  if (!parsed.success) {
    return c.json(
      appJsonError(
        APP_ERROR_CODES.INVALID_EMAIL,
        "Enter a valid email address.",
      ),
      400,
    );
  }

  // Gate: block when registration is disabled (unless invite token present)
  const gateResponse = await assertRegistrationAllowed(c, parsed.data.email);
  if (gateResponse) return gateResponse;

  const throttle = await enforceOtpSendThrottle(c, parsed.data.email);
  if (throttle) return throttle;

  const existingUserId = await lookupUserId(c, parsed.data.email);
  if (existingUserId) {
    // Same success body as a real send — do not reveal account existence.
    return otpSendSuccessResponse(c);
  }

  const auth = c.get("auth");
  const env = c.get("env") ?? c.env;

  if (!auth) {
    return c.json(
      appJsonError(
        APP_ERROR_CODES.AUTH_UNAVAILABLE,
        "Authentication service not initialized",
      ),
      503,
    );
  }

  // With disableSignUp, Better Auth will not email unknown addresses.
  // Create the sign-in OTP server-side and send it from the wrapper.
  await clearSignInOtps(c.get("db"), parsed.data.email);
  const otp = await auth.api.createVerificationOTP({
    body: {
      email: parsed.data.email,
      type: "sign-in",
    },
  });

  await sendOTP(env, {
    email: parsed.data.email,
    otp,
    type: "sign-in",
    locale: resolveRequestLocale(c.req.header("cookie")),
  });

  return otpSendSuccessResponse(c);
});

publicAuthRoutes.post("/otp/signup/verify", async (c) => {
  const parsed = authOtpSignupVerifySchema.safeParse(
    await c.req.json().catch(() => null),
  );

  if (!parsed.success) {
    return c.json(
      appJsonError(
        APP_ERROR_CODES.INVALID_INPUT,
        "Enter your name, a valid email, and the 6-digit code.",
      ),
      400,
    );
  }

  // Gate: block when registration is disabled (unless invite token present)
  const gateResponse = await assertRegistrationAllowed(c, parsed.data.email);
  if (gateResponse) return gateResponse;

  const existingUserId = await lookupUserId(c, parsed.data.email);
  if (existingUserId) {
    return otpVerifyFailureResponse(c);
  }

  const db = c.get("db");

  // Validate OTP before creating any user row (non-consuming peek).
  if (!(await isSignInOtpValid(db, parsed.data.email, parsed.data.otp))) {
    return otpVerifyFailureResponse(c);
  }

  let created: { id: string } | undefined;
  try {
    // Create the account server-side with a fixed role before establishing the session.
    // Ignore any client-supplied role / ban fields (input: false + explicit insert).
    const inserted = await db
      .insert(user)
      .values({
        email: parsed.data.email,
        name: parsed.data.name,
        emailVerified: true,
        role: "user",
      })
      .returning({ id: user.id });
    created = inserted[0];
  } catch (error) {
    if (isUniqueViolation(error)) {
      return otpVerifyFailureResponse(c);
    }
    throw error;
  }

  if (!created) {
    return otpVerifyFailureResponse(c);
  }

  const response = await proxyBetterAuthRequest(c, "sign-in/email-otp", {
    email: parsed.data.email,
    otp: parsed.data.otp,
  });

  if (response.status < 200 || response.status >= 300) {
    await db
      .delete(user)
      .where(eq(user.id, created.id))
      .catch(() => {
        // Best-effort rollback if session establishment failed after create.
      });
    return otpVerifyFailureResponse(c);
  }

  const url = new URL(c.req.url);
  const inviteToken = url.searchParams.get("invite");
  if (inviteToken) {
    await markInvitationAccepted(db, inviteToken, parsed.data.email).catch(
      () => {
        // Non-critical — don't fail the signup
      },
    );
  }

  return response;
});

export { publicAuthRoutes, OTP_SEND_SUCCESS, OTP_VERIFY_FAILURE };
