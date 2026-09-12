import {
  schema as Db,
  generateAuthId,
  type AuthModel,
  type Session,
  type User,
} from "@repo/db";
import { betterAuth } from "better-auth";
import type { DB } from "better-auth/adapters/drizzle";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { sendEmail, sendOTP, sendVerificationEmail } from "./email";
import type { Env } from "./env";

/** Privileged fields must not accept client input — wired into Better Auth config. */
export const AUTH_PRIVILEGED_FIELD_INPUT = {
  role: false,
  bannedAt: false,
  bannedReason: false,
} as const;

/** Native email OTP must not auto-register — wired into Better Auth config. */
export const AUTH_EMAIL_OTP_DISABLE_SIGN_UP = true as const;

/**
 * Environment variables required for authentication configuration.
 * Extracted from the main Env type for better type safety and documentation.
 */
type AuthEnv = Pick<
  Env,
  | "ENVIRONMENT"
  | "APP_NAME"
  | "APP_ORIGIN"
  | "BETTER_AUTH_SECRET"
  | "RESEND_API_KEY"
  | "RESEND_EMAIL_FROM"
>;

/**
 * Creates a Better Auth instance configured for single-user SaaS accounts.
 *
 * Key behaviors:
 * - Uses custom 'identity' table instead of default 'account' model
 * - Generates prefixed CUID2 IDs at application level (e.g. usr_..., ses_...)
 * - Authenticates via email OTP
 *
 * @param db Drizzle database instance - must include required auth tables (user, session, identity, verification).
 * @param env Environment variables containing auth secrets and email credentials
 * @returns Configured Better Auth instance with email OTP support
 * @remarks Missing database tables will cause runtime errors when auth endpoints are called.
 *
 * @example
 * ```ts
 * const auth = createAuth(database, {
 *   BETTER_AUTH_SECRET: "your-secret",
 *   APP_ORIGIN: "http://localhost:5173",
 * });
 * ```
 */
function buildAuth(db: DB, env: AuthEnv): Auth {
  return betterAuth({
    baseURL: `${env.APP_ORIGIN}/api/auth`,
    trustedOrigins: [env.APP_ORIGIN],
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      // Better Auth 1.7.3 account identity stays (providerId, accountId).
      // Do not add a required issuer column: 1.7.3 never writes it.
      schema: {
        identity: Db.identity,
        session: Db.session,
        user: Db.user,
        verification: Db.verification,
      },
    }),

    account: {
      modelName: "identity",
    },

    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "user",
          input: AUTH_PRIVILEGED_FIELD_INPUT.role,
          returned: true,
        },
        bannedAt: {
          type: "date",
          required: false,
          defaultValue: null,
          input: AUTH_PRIVILEGED_FIELD_INPUT.bannedAt,
          returned: false,
        },
        bannedReason: {
          type: "string",
          required: false,
          defaultValue: null,
          input: AUTH_PRIVILEGED_FIELD_INPUT.bannedReason,
          returned: false,
        },
      },
      changeEmail: {
        enabled: true,
        async sendChangeEmailConfirmation({ user, newEmail, url }) {
          await sendEmail(env, {
            to: user.email,
            subject: "Confirm your email change",
            text: [
              `We received a request to change your account email to ${newEmail}.`,
              "",
              "If you started this request, confirm it here:",
              url,
              "",
              "If you did not request this change, you can ignore this email.",
            ].join("\n"),
          });
        },
      },
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(env, { user, url });
      },
    },

    plugins: [
      emailOTP({
        disableSignUp: AUTH_EMAIL_OTP_DISABLE_SIGN_UP,
        async sendVerificationOTP({ email, otp, type }) {
          const emailType =
            type === "sign-in" ? "sign-in" : "email-verification";
          await sendOTP(env, { email, otp, type: emailType });
        },
        otpLength: 6,
        expiresIn: 300, // 5 minutes
        allowedAttempts: 3,
      }),
    ],

    advanced: {
      database: {
        generateId: ({ model }) => generateAuthId(model as AuthModel),
      },
    },

    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        // If a new session was just created, check if the user is banned
        if (ctx.context.newSession) {
          const sessionUser = ctx.context.newSession.user as Record<
            string,
            unknown
          >;
          if (sessionUser?.bannedAt) {
            // Revoke the session immediately
            // Return a 403 response to inform the client
            return new Response(
              JSON.stringify({
                error: "ACCOUNT_SUSPENDED",
                message:
                  (sessionUser.bannedReason as string) ||
                  "Your account has been suspended. Contact an administrator.",
              }),
              {
                status: 403,
                headers: { "content-type": "application/json" },
              },
            );
          }
        }
      }),
    },
  }) as Auth;
}

type AuthSessionResponse = {
  session: Session | null;
  user: AuthUser | null;
};

export interface Auth {
  handler(input: Request): Response | Promise<Response>;
  api: {
    getSession(input: {
      headers: Headers;
    }): Promise<AuthSessionResponse | null>;
    createVerificationOTP(input: {
      body: {
        email: string;
        type:
          "sign-in" | "email-verification" | "forget-password" | "change-email";
      };
    }): Promise<string>;
  };
}

export function createAuth(db: DB, env: AuthEnv): Auth {
  return buildAuth(db, env);
}

/** Platform role values persisted on `user.role`. */
export type PlatformRole = "user" | "super_admin";

export type AuthUser = Omit<User, "role"> & {
  role: PlatformRole;
};
export type AuthSession = Session;
