import {
  observabilitySettingsSchema,
  updateObservabilitySettingsSchema,
} from "@repo/core";
import { user } from "@repo/db";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../lib/trpc.js";
import {
  getUserObservabilitySettings,
  updateUserObservabilitySettings,
} from "../services/observability-service.js";

const updateProfileInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(128),
  image: z.url().nullable().optional(),
});

export const userRouter = router({
  me: protectedProcedure.query(async ({ ctx }) => {
    return {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      emailVerified: ctx.user.emailVerified,
      image: ctx.user.image ?? null,
    };
  }),

  observabilitySettings: protectedProcedure
    .output(observabilitySettingsSchema)
    .query(({ ctx }) => getUserObservabilitySettings(ctx, ctx.user.id)),

  updateObservabilitySettings: protectedProcedure
    .input(updateObservabilitySettingsSchema)
    .output(observabilitySettingsSchema)
    .mutation(({ ctx, input }) =>
      updateUserObservabilitySettings(ctx, ctx.user.id, input),
    ),

  updateProfile: protectedProcedure
    .input(updateProfileInputSchema)
    .mutation(async ({ input, ctx }) => {
      const [updatedUser] = await ctx.dbDirect
        .update(user)
        .set({
          name: input.name.trim(),
          image: input.image,
        })
        .where(eq(user.id, ctx.user.id))
        .returning({
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          image: user.image,
        });

      if (!updatedUser) {
        throw appError({
          appCode: APP_ERROR_CODES.USER_NOT_FOUND,
          message: "User account not found.",
          status: 404,
        });
      }

      return {
        ...updatedUser,
        image: updatedUser.image ?? null,
      };
    }),
});
