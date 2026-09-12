/**
 * @file Admin service — business logic for super-admin operations.
 *
 * Follows the Router → Service → Infrastructure layering:
 * - Throws AppError for request-facing failures.
 * - Writes admin_audit_log entries for every mutation.
 */

import type { Paginated, PaginationInput } from "@repo/core";
import {
  adminAuditLog,
  platformInvitation,
  platformSettings,
  session,
  user,
  type PlatformSettings,
} from "@repo/db";
import { APP_ERROR_CODES, appError } from "../lib/app-error.js";
import { likeContainsPattern, normalizeSearchQuery } from "../lib/like.js";
import { paginate } from "../lib/paginate.js";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomBytes } from "node:crypto";
import { sendPlatformInvitation } from "../lib/email.js";
import type { Env } from "../lib/env.js";

export const ADMIN_AUDIT_ACTIONS = [
  "registration.enabled",
  "registration.disabled",
  "platform_invitation.created",
  "platform_invitation.revoked",
  "user.banned",
  "user.unbanned",
] as const;

export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export type ListUsersInput = PaginationInput & {
  q?: string;
  status?: "active" | "suspended";
  role?: "user" | "super_admin";
};

export type ListPlatformInvitationsInput = PaginationInput & {
  q?: string;
  status?: "pending" | "accepted" | "expired" | "revoked";
};

export type GetAuditLogInput = PaginationInput & {
  q?: string;
  action?: AdminAuditAction;
};

function combinedWhere(conditions: Array<SQL | undefined>): SQL | undefined {
  const present = conditions.filter((condition): condition is SQL =>
    Boolean(condition),
  );
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : and(...present);
}

type DB = PostgresJsDatabase<Record<string, unknown>>;

// ─────────────────────────────────────────────────────────────────────────────
// Platform Settings
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_ID = "default";

/** Ensure the singleton settings row exists and return it. */
export async function getOrCreatePlatformSettings(
  db: DB,
): Promise<PlatformSettings> {
  const [existing] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, SETTINGS_ID))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(platformSettings)
    .values({ id: SETTINGS_ID })
    .onConflictDoNothing()
    .returning();

  // If concurrent insert won, read again
  if (!created) {
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.id, SETTINGS_ID))
      .limit(1);
    return row!;
  }

  return created;
}

export async function updateRegistrationStatus(
  db: DB,
  actorId: string,
  input: { enabled: boolean; message?: string | null },
  ipAddress: string | null,
) {
  const settings = await getOrCreatePlatformSettings(db);

  const [updated] = await db
    .update(platformSettings)
    .set({
      registrationEnabled: input.enabled,
      registrationDisabledMessage: input.message ?? null,
    })
    .where(eq(platformSettings.id, SETTINGS_ID))
    .returning();

  await db.insert(adminAuditLog).values({
    actorId,
    action: input.enabled ? "registration.enabled" : "registration.disabled",
    targetType: "platform_settings",
    targetId: SETTINGS_ID,
    metadata: JSON.stringify({
      previous: settings.registrationEnabled,
      current: input.enabled,
      message: input.message ?? null,
    }),
    ipAddress,
  });

  return updated!;
}

// Removed model policy handlers

// ─────────────────────────────────────────────────────────────────────────────
// Platform Invitations
// ─────────────────────────────────────────────────────────────────────────────

const INVITATION_EXPIRY_DAYS = 7;

function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

function buildPlatformInviteUrl(appOrigin: string, token: string): string {
  const url = new URL("/signup", appOrigin);
  url.searchParams.set("invite", token);
  return url.toString();
}

async function expireStalePlatformInvitations(
  db: DB,
  filters?: {
    email?: string;
    invitationId?: string;
    token?: string;
  },
) {
  const conditions = [
    eq(platformInvitation.status, "pending"),
    lt(platformInvitation.expiresAt, new Date()),
  ];

  if (filters?.email) {
    conditions.push(eq(platformInvitation.email, filters.email));
  }

  if (filters?.invitationId) {
    conditions.push(eq(platformInvitation.id, filters.invitationId));
  }

  if (filters?.token) {
    conditions.push(eq(platformInvitation.token, filters.token));
  }

  await db
    .update(platformInvitation)
    .set({ status: "expired" })
    .where(and(...conditions));
}

export async function createPlatformInvitation(
  db: DB,
  actorId: string,
  env: Pick<
    Env,
    "APP_NAME" | "APP_ORIGIN" | "RESEND_API_KEY" | "RESEND_EMAIL_FROM"
  >,
  input: { email: string },
  ipAddress: string | null,
) {
  const normalizedEmail = input.email.trim().toLowerCase();

  // Check if user already exists
  const [existingUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, normalizedEmail))
    .limit(1);

  if (existingUser) {
    throw appError({
      appCode: APP_ERROR_CODES.USER_ALREADY_EXISTS,
      message: "A user with this email already exists.",
      status: 409,
    });
  }

  await expireStalePlatformInvitations(db, { email: normalizedEmail });

  // Check for existing pending invitation
  const [existingInvite] = await db
    .select({ id: platformInvitation.id })
    .from(platformInvitation)
    .where(
      and(
        eq(platformInvitation.email, normalizedEmail),
        eq(platformInvitation.status, "pending"),
      ),
    )
    .limit(1);

  if (existingInvite) {
    throw appError({
      appCode: APP_ERROR_CODES.INVITATION_ALREADY_EXISTS,
      message: "A pending invitation already exists for this email.",
      status: 409,
    });
  }

  const token = generateInviteToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);
  const inviteUrl = buildPlatformInviteUrl(env.APP_ORIGIN, token);

  const [created] = await db
    .insert(platformInvitation)
    .values({
      email: normalizedEmail,
      token,
      invitedBy: actorId,
      expiresAt,
    })
    .returning();

  try {
    await sendPlatformInvitation(env, {
      email: normalizedEmail,
      inviteUrl,
      expiresInDays: INVITATION_EXPIRY_DAYS,
    });
  } catch (error) {
    await db
      .delete(platformInvitation)
      .where(eq(platformInvitation.id, created!.id));

    throw appError({
      appCode: APP_ERROR_CODES.INVITATION_EMAIL_FAILED,
      message: "Failed to send the invitation email.",
      status: 500,
      cause: error,
    });
  }

  await db.insert(adminAuditLog).values({
    actorId,
    action: "platform_invitation.created",
    targetType: "platform_invitation",
    targetId: created!.id,
    metadata: JSON.stringify({ email: normalizedEmail }),
    ipAddress,
  });

  return created!;
}

export async function listPlatformInvitations(
  db: DB,
  input: ListPlatformInvitationsInput,
): Promise<
  Paginated<{
    id: string;
    email: string;
    status: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    createdAt: Date;
  }>
> {
  await expireStalePlatformInvitations(db);

  const q = normalizeSearchQuery(input.q);
  const where = combinedWhere([
    q ? ilike(platformInvitation.email, likeContainsPattern(q)) : undefined,
    input.status ? eq(platformInvitation.status, input.status) : undefined,
  ]);

  return paginate({
    page: input.page,
    pageSize: input.pageSize,
    list: (offset, limit) =>
      db
        .select({
          id: platformInvitation.id,
          email: platformInvitation.email,
          status: platformInvitation.status,
          expiresAt: platformInvitation.expiresAt,
          acceptedAt: platformInvitation.acceptedAt,
          createdAt: platformInvitation.createdAt,
        })
        .from(platformInvitation)
        .where(where)
        .orderBy(desc(platformInvitation.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ count: count() })
        .from(platformInvitation)
        .where(where);
      return row?.count ?? 0;
    },
  });
}

export async function revokePlatformInvitation(
  db: DB,
  actorId: string,
  invitationId: string,
  ipAddress: string | null,
) {
  await expireStalePlatformInvitations(db, { invitationId });

  const [invite] = await db
    .select()
    .from(platformInvitation)
    .where(eq(platformInvitation.id, invitationId))
    .limit(1);

  if (!invite) {
    throw appError({
      appCode: APP_ERROR_CODES.INVITATION_NOT_FOUND,
      message: "Invitation not found.",
      status: 404,
    });
  }

  if (invite.status !== "pending") {
    throw appError({
      appCode: APP_ERROR_CODES.INVITATION_INVALID_STATUS,
      message: `Cannot revoke invitation with status "${invite.status}".`,
      status: 400,
    });
  }

  const [updated] = await db
    .update(platformInvitation)
    .set({ status: "revoked" })
    .where(eq(platformInvitation.id, invitationId))
    .returning();

  await db.insert(adminAuditLog).values({
    actorId,
    action: "platform_invitation.revoked",
    targetType: "platform_invitation",
    targetId: invitationId,
    metadata: JSON.stringify({ email: invite.email }),
    ipAddress,
  });

  return updated!;
}

/** Validate a platform invitation token. Returns the invitation if valid. */
export async function validateInvitationToken(db: DB, token: string) {
  await expireStalePlatformInvitations(db, { token });

  const [invite] = await db
    .select()
    .from(platformInvitation)
    .where(
      and(
        eq(platformInvitation.token, token),
        eq(platformInvitation.status, "pending"),
      ),
    )
    .limit(1);

  return invite ?? null;
}

/** Mark an invitation as accepted after the user registers. */
export async function markInvitationAccepted(
  db: DB,
  token: string,
  email: string,
) {
  await expireStalePlatformInvitations(db, { token });

  const normalizedEmail = email.trim().toLowerCase();
  const [updated] = await db
    .update(platformInvitation)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(
      and(
        eq(platformInvitation.token, token),
        eq(platformInvitation.email, normalizedEmail),
        eq(platformInvitation.status, "pending"),
        gte(platformInvitation.expiresAt, new Date()),
      ),
    )
    .returning({ id: platformInvitation.id });

  return !!updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// User Management
// ─────────────────────────────────────────────────────────────────────────────

export async function listUsers(db: DB, input: ListUsersInput) {
  const q = normalizeSearchQuery(input.q);
  const where = combinedWhere([
    q
      ? or(
          ilike(user.name, likeContainsPattern(q)),
          ilike(user.email, likeContainsPattern(q)),
        )
      : undefined,
    input.status === "active" ? isNull(user.bannedAt) : undefined,
    input.status === "suspended" ? isNotNull(user.bannedAt) : undefined,
    input.role ? eq(user.role, input.role) : undefined,
  ]);

  return paginate({
    page: input.page,
    pageSize: input.pageSize,
    list: (offset, limit) =>
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
          role: user.role,
          bannedAt: user.bannedAt,
          bannedReason: user.bannedReason,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(where)
        .orderBy(desc(user.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db.select({ count: count() }).from(user).where(where);
      return row?.count ?? 0;
    },
  });
}

export async function banUser(
  db: DB,
  actorId: string,
  input: { userId: string; reason?: string },
  ipAddress: string | null,
) {
  if (input.userId === actorId) {
    throw appError({
      appCode: APP_ERROR_CODES.CANNOT_BAN_SELF,
      message: "You cannot ban yourself.",
      status: 400,
    });
  }

  const [target] = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);

  if (!target) {
    throw appError({
      appCode: APP_ERROR_CODES.USER_NOT_FOUND,
      message: "User not found.",
      status: 404,
    });
  }

  if (target.role === "super_admin") {
    throw appError({
      appCode: APP_ERROR_CODES.CANNOT_BAN_SUPER_ADMIN,
      message: "Cannot ban a super-admin.",
      status: 403,
    });
  }

  const [updated] = await db
    .update(user)
    .set({ bannedAt: new Date(), bannedReason: input.reason ?? null })
    .where(eq(user.id, input.userId))
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      bannedAt: user.bannedAt,
    });

  await db.delete(session).where(eq(session.userId, input.userId));

  await db.insert(adminAuditLog).values({
    actorId,
    action: "user.banned",
    targetType: "user",
    targetId: input.userId,
    metadata: JSON.stringify({ reason: input.reason ?? null }),
    ipAddress,
  });

  return updated!;
}

export async function unbanUser(
  db: DB,
  actorId: string,
  userId: string,
  ipAddress: string | null,
) {
  const [target] = await db
    .select({ id: user.id, bannedAt: user.bannedAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (!target) {
    throw appError({
      appCode: APP_ERROR_CODES.USER_NOT_FOUND,
      message: "User not found.",
      status: 404,
    });
  }

  if (!target.bannedAt) {
    throw appError({
      appCode: APP_ERROR_CODES.USER_NOT_BANNED,
      message: "User is not banned.",
      status: 400,
    });
  }

  const [updated] = await db
    .update(user)
    .set({ bannedAt: null, bannedReason: null })
    .where(eq(user.id, userId))
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      bannedAt: user.bannedAt,
    });

  await db.insert(adminAuditLog).values({
    actorId,
    action: "user.unbanned",
    targetType: "user",
    targetId: userId,
    metadata: JSON.stringify({}),
    ipAddress,
  });

  return updated!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard Stats
// ─────────────────────────────────────────────────────────────────────────────

export async function getDashboardStats(db: DB) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  await expireStalePlatformInvitations(db);

  const [[totalUsersRow], [newUsersRow], [pendingInvitesRow], settings] =
    await Promise.all([
      db.select({ count: count() }).from(user),
      db
        .select({ count: count() })
        .from(user)
        .where(gte(user.createdAt, sevenDaysAgo)),
      db
        .select({ count: count() })
        .from(platformInvitation)
        .where(eq(platformInvitation.status, "pending")),
      getOrCreatePlatformSettings(db),
    ]);

  return {
    totalUsers: totalUsersRow?.count ?? 0,
    newUsersLast7Days: newUsersRow?.count ?? 0,
    pendingInvitations: pendingInvitesRow?.count ?? 0,
    registrationEnabled: settings.registrationEnabled,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit Log
// ─────────────────────────────────────────────────────────────────────────────

export async function getAuditLog(db: DB, input: GetAuditLogInput) {
  const q = normalizeSearchQuery(input.q);
  const where = combinedWhere([
    q
      ? or(
          ilike(user.name, likeContainsPattern(q)),
          ilike(user.email, likeContainsPattern(q)),
        )
      : undefined,
    input.action ? eq(adminAuditLog.action, input.action) : undefined,
  ]);

  return paginate({
    page: input.page,
    pageSize: input.pageSize,
    list: (offset, limit) =>
      db
        .select({
          id: adminAuditLog.id,
          action: adminAuditLog.action,
          targetType: adminAuditLog.targetType,
          targetId: adminAuditLog.targetId,
          metadata: adminAuditLog.metadata,
          ipAddress: adminAuditLog.ipAddress,
          createdAt: adminAuditLog.createdAt,
          actorName: user.name,
          actorEmail: user.email,
        })
        .from(adminAuditLog)
        .innerJoin(user, eq(adminAuditLog.actorId, user.id))
        .where(where)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(limit)
        .offset(offset),
    count: async () => {
      const [row] = await db
        .select({ count: count() })
        .from(adminAuditLog)
        .innerJoin(user, eq(adminAuditLog.actorId, user.id))
        .where(where);
      return row?.count ?? 0;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Super-Admin Seed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensures a super-admin exists when SUPER_ADMIN_EMAIL is configured.
 *
 * - If no super-admin exists and the email matches an existing user → promote.
 * - If no super-admin exists and no user matches → log a warning (user must register first).
 * - If a super-admin already exists → no-op.
 */
export async function ensureSuperAdmin(
  db: DB,
  env: Pick<Env, "SUPER_ADMIN_EMAIL">,
) {
  const email = env.SUPER_ADMIN_EMAIL;
  if (!email) return;

  const normalizedEmail = email.trim().toLowerCase();

  // Check if any super-admin already exists
  const [existingAdmin] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.role, "super_admin"))
    .limit(1);

  if (existingAdmin) return; // Already have a super-admin

  // Try to promote the target user
  const [targetUser] = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.email, normalizedEmail))
    .limit(1);

  if (!targetUser) {
    console.warn(
      `[admin] SUPER_ADMIN_EMAIL="${normalizedEmail}" set but no user found. ` +
        `The user must register first, then the promotion will happen on next startup.`,
    );
    return;
  }

  await db
    .update(user)
    .set({ role: "super_admin" })
    .where(eq(user.id, targetUser.id));

  // Also ensure platform settings exist
  await getOrCreatePlatformSettings(db);

  console.info(
    `[admin] Promoted user "${normalizedEmail}" (${targetUser.id}) to super_admin.`,
  );
}
