import { initTRPC, TRPCError, type TRPCProcedureBuilder } from "@trpc/server";
import { flattenError, ZodError } from "zod";
import {
  APP_ERROR_CODES,
  AppError,
  appError,
  extractAppCodeFromTrpcCause,
  extractDetailsFromTrpcCause,
  toTrpcError,
} from "./app-error.js";
import type { TRPCContext } from "./context.js";
import { isUserBanned } from "./user-access.js";

function unwrapAppError(error: unknown): AppError | undefined {
  if (error instanceof AppError) return error;
  if (error instanceof TRPCError && error.cause instanceof AppError) {
    return error.cause;
  }
  return undefined;
}

const t = initTRPC.context<TRPCContext>().create({
  errorFormatter({ shape, error }) {
    const appCode = extractAppCodeFromTrpcCause(error.cause);
    const details = extractDetailsFromTrpcCause(error.cause);
    return {
      ...shape,
      data: {
        ...shape.data,
        appCode,
        ...(details ? { details } : {}),
        zodError:
          error.cause instanceof ZodError ? flattenError(error.cause) : null,
      },
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

export const publicProcedure = t.procedure.use(async ({ next }) => {
  try {
    const result = await next();
    if (!result.ok) {
      const appErr = unwrapAppError(result.error);
      if (appErr) {
        throw toTrpcError(appErr);
      }
    }
    return result;
  } catch (error) {
    if (error instanceof AppError) {
      throw toTrpcError(error);
    }
    throw error;
  }
});

// Derive type from publicProcedure to stay in sync with initTRPC config.
// Explicit annotation required to avoid TS2742 (non-portable inferred type).
type ProtectedProcedure =
  typeof publicProcedure extends TRPCProcedureBuilder<
    infer TContext,
    infer TMeta,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    infer TContextOverrides,
    infer TInputIn,
    infer TInputOut,
    infer TOutputIn,
    infer TOutputOut,
    infer TCaller
  >
    ? TRPCProcedureBuilder<
        TContext,
        TMeta,
        {
          session: NonNullable<TRPCContext["session"]>;
          user: NonNullable<TRPCContext["user"]>;
        },
        TInputIn,
        TInputOut,
        TOutputIn,
        TOutputOut,
        TCaller
      >
    : never;

export const protectedProcedure: ProtectedProcedure = publicProcedure.use(
  async ({ ctx, next }) => {
    if (!ctx.session || !ctx.user) {
      throw appError({
        appCode: APP_ERROR_CODES.AUTHENTICATION_REQUIRED,
        message: "Authentication required",
        status: 401,
      });
    }

    if (await isUserBanned(ctx.db, ctx.user.id)) {
      throw appError({
        appCode: APP_ERROR_CODES.ACCOUNT_SUSPENDED,
        message: "Your account has been suspended.",
        status: 403,
      });
    }

    return next({
      ctx: {
        ...ctx,
        session: ctx.session,
        user: ctx.user,
      },
    });
  },
);

export const superAdminProcedure: ProtectedProcedure = protectedProcedure.use(
  ({ ctx, next }) => {
    if (ctx.user.role !== "super_admin") {
      throw appError({
        appCode: APP_ERROR_CODES.SUPER_ADMIN_REQUIRED,
        message: "Super-admin access required",
        status: 403,
      });
    }
    return next({ ctx });
  },
);
