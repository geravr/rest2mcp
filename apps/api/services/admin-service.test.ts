import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "../lib/app-error.js";

const tables = vi.hoisted(() => ({
  adminAuditLog: {
    id: "admin_audit_log.id",
    actorId: "admin_audit_log.actor_id",
    action: "admin_audit_log.action",
    targetType: "admin_audit_log.target_type",
    targetId: "admin_audit_log.target_id",
    metadata: "admin_audit_log.metadata",
    ipAddress: "admin_audit_log.ip_address",
    createdAt: "admin_audit_log.created_at",
  },
  platformInvitation: {
    id: "platform_invitation.id",
    email: "platform_invitation.email",
    status: "platform_invitation.status",
    expiresAt: "platform_invitation.expires_at",
    token: "platform_invitation.token",
    invitedBy: "platform_invitation.invited_by",
    acceptedAt: "platform_invitation.accepted_at",
    createdAt: "platform_invitation.created_at",
  },
  platformSettings: {
    id: "platform_settings.id",
    registrationEnabled: "platform_settings.registration_enabled",
    registrationDisabledMessage:
      "platform_settings.registration_disabled_message",
    createdAt: "platform_settings.created_at",
    updatedAt: "platform_settings.updated_at",
  },
  user: {
    id: "user.id",
    email: "user.email",
    role: "user.role",
    createdAt: "user.created_at",
    name: "user.name",
    bannedAt: "user.banned_at",
    bannedReason: "user.banned_reason",
  },
  session: {
    id: "session.id",
    userId: "session.user_id",
  },
}));

const drizzleFns = vi.hoisted(() => ({
  and: vi.fn((...args: unknown[]) => ({ kind: "and", args })),
  count: vi.fn(() => ({ kind: "count" })),
  desc: vi.fn((value: unknown) => ({ kind: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
  gte: vi.fn((left: unknown, right: unknown) => ({ kind: "gte", left, right })),
  ilike: vi.fn((left: unknown, right: unknown) => ({
    kind: "ilike",
    left,
    right,
  })),
  isNotNull: vi.fn((value: unknown) => ({ kind: "isNotNull", value })),
  isNull: vi.fn((value: unknown) => ({ kind: "isNull", value })),
  lt: vi.fn((left: unknown, right: unknown) => ({ kind: "lt", left, right })),
  or: vi.fn((...args: unknown[]) => ({ kind: "or", args })),
}));

const sendPlatformInvitationMock = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => tables);
vi.mock("drizzle-orm", () => drizzleFns);
vi.mock("../lib/email.js", () => ({
  sendPlatformInvitation: sendPlatformInvitationMock,
}));

import {
  banUser,
  createPlatformInvitation,
  getAuditLog,
  getDashboardStats,
  listPlatformInvitations,
  listUsers,
  markInvitationAccepted,
  validateInvitationToken,
} from "./admin-service.js";

function makeChain<T>(result: T) {
  const handler: ProxyHandler<object> = {
    get(_, prop: string | symbol) {
      if (prop === "then") {
        return (
          resolve: (value: T) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject);
      }

      if (prop === "catch") {
        return (fn: (reason: unknown) => unknown) =>
          Promise.resolve(result).catch(fn);
      }

      if (prop === "finally") {
        return (fn: () => void) => Promise.resolve(result).finally(fn);
      }

      return () => new Proxy({}, handler);
    },
  };

  return new Proxy({}, handler);
}

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function asServiceDb(
  db: MockDb,
): Parameters<typeof createPlatformInvitation>[0] {
  return db as unknown as Parameters<typeof createPlatformInvitation>[0];
}

function makeDb(options?: {
  selectResults?: unknown[];
  insertResults?: unknown[];
  updateResults?: unknown[];
  deleteResults?: unknown[];
}): MockDb {
  const selectResults = [...(options?.selectResults ?? [])];
  const insertResults = [...(options?.insertResults ?? [])];
  const updateResults = [...(options?.updateResults ?? [])];
  const deleteResults = [...(options?.deleteResults ?? [])];

  return {
    select: vi.fn(() => makeChain(selectResults.shift() ?? [])),
    insert: vi.fn(() => makeChain(insertResults.shift())),
    update: vi.fn(() => makeChain(updateResults.shift())),
    delete: vi.fn(() => makeChain(deleteResults.shift())),
  };
}

const env = {
  APP_NAME: "Charro Stack",
  APP_ORIGIN: "http://localhost:5173",
  RESEND_API_KEY: "re_test",
  RESEND_EMAIL_FROM: "hello@example.com",
} as const;

describe("createPlatformInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendPlatformInvitationMock.mockResolvedValue({ id: "email-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a platform invitation email with a usable signup link", async () => {
    const createdInvite = {
      id: "inv-1",
      email: "invitee@example.com",
      token: "invite-token",
      status: "pending",
      expiresAt: new Date("2026-05-02T12:00:00.000Z"),
    };
    const db = makeDb({
      selectResults: [[], []],
      updateResults: [undefined],
      insertResults: [[createdInvite], undefined],
    });

    const result = await createPlatformInvitation(
      asServiceDb(db),
      "user-1",
      env,
      { email: " Invitee@Example.com " },
      "127.0.0.1",
    );

    expect(result).toEqual(createdInvite);
    expect(sendPlatformInvitationMock).toHaveBeenCalledTimes(1);
    expect(sendPlatformInvitationMock).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        email: "invitee@example.com",
        expiresInDays: 7,
      }),
    );
    const inviteUrl = new URL(
      sendPlatformInvitationMock.mock.calls[0]?.[1]?.inviteUrl,
    );
    expect(inviteUrl.origin).toBe("http://localhost:5173");
    expect(inviteUrl.pathname).toBe("/signup");
    expect(inviteUrl.searchParams.get("invite")).toMatch(/^[a-f0-9]{64}$/);
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("does not block re-invites when the previous pending invite is already expired", async () => {
    const createdInvite = {
      id: "inv-2",
      email: "invitee@example.com",
      token: "fresh-token",
      status: "pending",
      expiresAt: new Date("2026-05-03T12:00:00.000Z"),
    };
    const db = makeDb({
      selectResults: [[], []],
      updateResults: [undefined],
      insertResults: [[createdInvite], undefined],
    });

    await createPlatformInvitation(
      asServiceDb(db),
      "user-1",
      env,
      { email: "invitee@example.com" },
      null,
    );

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(sendPlatformInvitationMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back the inserted invitation when email delivery fails", async () => {
    const createdInvite = {
      id: "inv-3",
      email: "invitee@example.com",
      token: "invite-token",
      status: "pending",
      expiresAt: new Date("2026-05-02T12:00:00.000Z"),
    };
    const db = makeDb({
      selectResults: [[], []],
      updateResults: [undefined],
      insertResults: [[createdInvite]],
      deleteResults: [undefined],
    });
    sendPlatformInvitationMock.mockRejectedValueOnce(
      new Error("resend failed"),
    );

    await expect(
      createPlatformInvitation(
        asServiceDb(db),
        "user-1",
        env,
        { email: "invitee@example.com" },
        null,
      ),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.INVITATION_EMAIL_FAILED &&
        error.status === 500 &&
        error.message === "Failed to send the invitation email."
      );
    });

    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});

describe("validateInvitationToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("expires stale pending invitations before validating the token", async () => {
    const db = makeDb({
      updateResults: [undefined],
      selectResults: [[]],
    });

    const result = await validateInvitationToken(
      asServiceDb(db),
      "expired-token",
    );

    expect(result).toBeNull();
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe("markInvitationAccepted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only accepts a matching pending unexpired invitation for the same email", async () => {
    const db = makeDb({
      updateResults: [undefined, [{ id: "inv-1" }]],
    });

    const result = await markInvitationAccepted(
      asServiceDb(db),
      "token-1",
      " Invitee@Example.com ",
    );

    expect(result).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it("returns false when no valid invitation matches the token and email", async () => {
    const db = makeDb({
      updateResults: [undefined, []],
    });

    const result = await markInvitationAccepted(
      asServiceDb(db),
      "token-1",
      "other@example.com",
    );

    expect(result).toBe(false);
  });
});

describe("getDashboardStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("expires stale invitations before counting pending invitations", async () => {
    const db = makeDb({
      updateResults: [undefined],
      selectResults: [
        [{ count: 10 }],
        [{ count: 3 }],
        [{ count: 1 }],
        [
          {
            id: "default",
            registrationEnabled: false,
          },
        ],
      ],
    });

    const stats = await getDashboardStats(asServiceDb(db));

    expect(stats).toEqual({
      totalUsers: 10,
      newUsersLast7Days: 3,
      pendingInvitations: 1,
      registrationEnabled: false,
    });
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe("banUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the ban and deletes the target user's sessions", async () => {
    const bannedAt = new Date("2026-09-09T12:00:00.000Z");
    const db = makeDb({
      selectResults: [[{ id: "usr_target", role: "user" }]],
      updateResults: [
        [
          {
            id: "usr_target",
            name: "Target",
            email: "target@example.com",
            bannedAt,
          },
        ],
      ],
      insertResults: [undefined],
      deleteResults: [undefined],
    });

    const result = await banUser(
      asServiceDb(db),
      "usr_admin",
      { userId: "usr_target", reason: "abuse" },
      "127.0.0.1",
    );

    expect(result).toEqual({
      id: "usr_target",
      name: "Target",
      email: "target@example.com",
      bannedAt,
    });
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledWith(tables.session);
    expect(drizzleFns.eq).toHaveBeenCalledWith(
      tables.session.userId,
      "usr_target",
    );
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("throws AppError USER_NOT_FOUND when the target is missing", async () => {
    const db = makeDb({
      selectResults: [[]],
    });

    await expect(
      banUser(
        asServiceDb(db),
        "usr_admin",
        { userId: "usr_missing" },
        "127.0.0.1",
      ),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.USER_NOT_FOUND &&
        error.status === 404
      );
    });
    expect(db.update).not.toHaveBeenCalled();
  });
});

const listedUser = {
  id: "usr_1",
  name: "Ana",
  email: "ana@example.com",
  emailVerified: true,
  image: null,
  role: "user",
  bannedAt: null,
  bannedReason: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("listUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a pagination envelope and uses the count total", async () => {
    const db = makeDb({
      selectResults: [[listedUser], [{ count: 25 }]],
    });

    await expect(
      listUsers(asServiceDb(db), { page: 1, pageSize: 10 }),
    ).resolves.toEqual({
      items: [listedUser],
      page: 1,
      pageSize: 10,
      total: 25,
    });
    expect(drizzleFns.ilike).not.toHaveBeenCalled();
  });

  it("keeps an out-of-range page empty without rewriting page", async () => {
    const db = makeDb({
      selectResults: [[], [{ count: 12 }]],
    });

    await expect(
      listUsers(asServiceDb(db), { page: 5, pageSize: 10 }),
    ).resolves.toEqual({
      items: [],
      page: 5,
      pageSize: 10,
      total: 12,
    });
  });

  it("applies escaped search to name and email", async () => {
    const db = makeDb({
      selectResults: [[listedUser], [{ count: 1 }]],
    });

    await listUsers(asServiceDb(db), {
      page: 1,
      pageSize: 10,
      q: "  100%  ",
    });

    expect(drizzleFns.ilike).toHaveBeenCalledWith(tables.user.name, "%100\\%%");
    expect(drizzleFns.ilike).toHaveBeenCalledWith(
      tables.user.email,
      "%100\\%%",
    );
  });

  it("ignores blank search", async () => {
    const db = makeDb({
      selectResults: [[listedUser], [{ count: 1 }]],
    });

    await listUsers(asServiceDb(db), { page: 1, pageSize: 10, q: "   " });
    expect(drizzleFns.ilike).not.toHaveBeenCalled();
  });

  it("filters suspended users by bannedAt", async () => {
    const db = makeDb({
      selectResults: [
        [{ ...listedUser, bannedAt: new Date() }],
        [{ count: 1 }],
      ],
    });

    await listUsers(asServiceDb(db), {
      page: 1,
      pageSize: 10,
      status: "suspended",
    });

    expect(drizzleFns.isNotNull).toHaveBeenCalledWith(tables.user.bannedAt);
  });

  it("filters active users and super_admin role", async () => {
    const db = makeDb({
      selectResults: [[{ ...listedUser, role: "super_admin" }], [{ count: 1 }]],
    });

    await listUsers(asServiceDb(db), {
      page: 1,
      pageSize: 20,
      status: "active",
      role: "super_admin",
    });

    expect(drizzleFns.isNull).toHaveBeenCalledWith(tables.user.bannedAt);
    expect(drizzleFns.eq).toHaveBeenCalledWith(tables.user.role, "super_admin");
  });
});

describe("listPlatformInvitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const invitation = {
    id: "inv-1",
    email: "invitee@example.com",
    status: "pending",
    expiresAt: new Date("2026-05-02T12:00:00.000Z"),
    acceptedAt: null,
    createdAt: new Date("2026-04-25T12:00:00.000Z"),
  };

  it("returns a pagination envelope after expiring stale invites", async () => {
    const db = makeDb({
      updateResults: [undefined],
      selectResults: [[invitation], [{ count: 4 }]],
    });

    await expect(
      listPlatformInvitations(asServiceDb(db), { page: 1, pageSize: 10 }),
    ).resolves.toEqual({
      items: [invitation],
      page: 1,
      pageSize: 10,
      total: 4,
    });
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it("filters by status and escaped email search", async () => {
    const db = makeDb({
      updateResults: [undefined],
      selectResults: [[invitation], [{ count: 1 }]],
    });

    await listPlatformInvitations(asServiceDb(db), {
      page: 1,
      pageSize: 10,
      status: "pending",
      q: "a_b%",
    });

    expect(drizzleFns.eq).toHaveBeenCalledWith(
      tables.platformInvitation.status,
      "pending",
    );
    expect(drizzleFns.ilike).toHaveBeenCalledWith(
      tables.platformInvitation.email,
      "%a\\_b\\%%",
    );
  });

  it("ignores blank search", async () => {
    const db = makeDb({
      updateResults: [undefined],
      selectResults: [[invitation], [{ count: 4 }]],
    });

    await listPlatformInvitations(asServiceDb(db), {
      page: 1,
      pageSize: 10,
      q: "   ",
    });
    expect(drizzleFns.ilike).not.toHaveBeenCalled();
  });

  it("keeps an out-of-range page empty without rewriting page", async () => {
    const db = makeDb({
      updateResults: [undefined],
      selectResults: [[], [{ count: 4 }]],
    });

    await expect(
      listPlatformInvitations(asServiceDb(db), { page: 3, pageSize: 10 }),
    ).resolves.toEqual({
      items: [],
      page: 3,
      pageSize: 10,
      total: 4,
    });
  });
});

describe("getAuditLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const entry = {
    id: "log-1",
    action: "user.banned",
    targetType: "user",
    targetId: "usr_1",
    metadata: "{}",
    ipAddress: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    actorName: "Admin",
    actorEmail: "admin@example.com",
  };

  it("returns a pagination envelope without a limit field", async () => {
    const db = makeDb({
      selectResults: [[entry], [{ count: 30 }]],
    });

    await expect(
      getAuditLog(asServiceDb(db), { page: 2, pageSize: 10 }),
    ).resolves.toEqual({
      items: [entry],
      page: 2,
      pageSize: 10,
      total: 30,
    });
  });

  it("filters by action and escaped actor search", async () => {
    const db = makeDb({
      selectResults: [[entry], [{ count: 1 }]],
    });

    await getAuditLog(asServiceDb(db), {
      page: 1,
      pageSize: 10,
      action: "user.banned",
      q: "Ad_min%",
    });

    expect(drizzleFns.eq).toHaveBeenCalledWith(
      tables.adminAuditLog.action,
      "user.banned",
    );
    expect(drizzleFns.ilike).toHaveBeenCalledWith(
      tables.user.name,
      "%Ad\\_min\\%%",
    );
    expect(drizzleFns.ilike).toHaveBeenCalledWith(
      tables.user.email,
      "%Ad\\_min\\%%",
    );
  });

  it("ignores blank search", async () => {
    const db = makeDb({
      selectResults: [[entry], [{ count: 1 }]],
    });

    await getAuditLog(asServiceDb(db), { page: 1, pageSize: 10, q: "   " });
    expect(drizzleFns.ilike).not.toHaveBeenCalled();
  });
});

describe("admin-service transport boundary", () => {
  it("does not import tRPC", () => {
    const source = readFileSync(
      new URL("./admin-service.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("@trpc/server");
    expect(source).not.toContain("appTrpcError");
    expect(source).toContain("appError");
  });
});
