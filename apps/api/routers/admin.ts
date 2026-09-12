/**
 * @file Admin router — tRPC procedures for super-admin operations.
 *
 * All procedures use `superAdminProcedure` which enforces
 * `user.role === "super_admin"` in middleware.
 */

import { paginationInputSchema } from "@repo/core";
import { z } from "zod";
import { router, superAdminProcedure } from "../lib/trpc.js";
import {
  ADMIN_AUDIT_ACTIONS,
  banUser,
  createPlatformInvitation,
  getAuditLog,
  getDashboardStats,
  getOrCreatePlatformSettings,
  listPlatformInvitations,
  listUsers,
  revokePlatformInvitation,
  unbanUser,
  updateRegistrationStatus,
} from "../services/admin-service.js";

const usersListInputSchema = paginationInputSchema.extend({
  q: z.string().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  role: z.enum(["user", "super_admin"]).optional(),
});

const invitationsListInputSchema = paginationInputSchema.extend({
  q: z.string().optional(),
  status: z.enum(["pending", "accepted", "expired", "revoked"]).optional(),
});

const auditLogListInputSchema = paginationInputSchema.extend({
  q: z.string().optional(),
  action: z.enum(ADMIN_AUDIT_ACTIONS).optional(),
});

function getIpAddress(req: Request): string | null {
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  return cfIp && cfIp.length > 0 ? cfIp : null;
}

export const adminRouter = router({
  // ── Dashboard ──────────────────────────────────────────────────────────
  stats: superAdminProcedure.query(async ({ ctx }) => {
    return getDashboardStats(ctx.db);
  }),

  // ── Platform Settings ──────────────────────────────────────────────────
  settings: superAdminProcedure.query(async ({ ctx }) => {
    const settings = await getOrCreatePlatformSettings(ctx.db);

    return {
      id: settings.id,
      registrationEnabled: settings.registrationEnabled,
      registrationDisabledMessage: settings.registrationDisabledMessage,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }),

  updateRegistration: superAdminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        message: z.string().max(500).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return updateRegistrationStatus(
        ctx.dbDirect,
        ctx.user.id,
        input,
        getIpAddress(ctx.req),
      );
    }),

  // ── Platform Invitations ───────────────────────────────────────────────
  invitations: superAdminProcedure
    .input(invitationsListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      return listPlatformInvitations(
        ctx.db,
        invitationsListInputSchema.parse(input ?? {}),
      );
    }),

  createInvitation: superAdminProcedure
    .input(
      z.object({
        email: z.email(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return createPlatformInvitation(
        ctx.dbDirect,
        ctx.user.id,
        ctx.env,
        input,
        getIpAddress(ctx.req),
      );
    }),

  revokeInvitation: superAdminProcedure
    .input(
      z.object({
        invitationId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return revokePlatformInvitation(
        ctx.dbDirect,
        ctx.user.id,
        input.invitationId,
        getIpAddress(ctx.req),
      );
    }),

  // ── User Management ────────────────────────────────────────────────────
  users: superAdminProcedure
    .input(usersListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      return listUsers(ctx.db, usersListInputSchema.parse(input ?? {}));
    }),

  banUser: superAdminProcedure
    .input(
      z.object({
        userId: z.string(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return banUser(ctx.dbDirect, ctx.user.id, input, getIpAddress(ctx.req));
    }),

  unbanUser: superAdminProcedure
    .input(
      z.object({
        userId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return unbanUser(
        ctx.dbDirect,
        ctx.user.id,
        input.userId,
        getIpAddress(ctx.req),
      );
    }),

  // ── Audit Log ──────────────────────────────────────────────────────────
  auditLog: superAdminProcedure
    .input(auditLogListInputSchema.optional())
    .query(async ({ ctx, input }) => {
      return getAuditLog(ctx.db, auditLogListInputSchema.parse(input ?? {}));
    }),
});
