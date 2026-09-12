/**
 * Platform-level invitations sent by the super-admin.
 *
 * These allow a user to create an account on the platform itself —
 * especially useful when public registration is disabled.
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { user } from "./user";

export const platformInvitation = pgTable(
  "platform_invitation",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("pin")),
    /** Email the invitation was sent to. */
    email: text().notNull(),
    /** Crypto-random token embedded in the invite link. */
    token: text().notNull().unique(),
    /** "pending" | "accepted" | "expired" | "revoked" */
    status: text().default("pending").notNull(),
    /** The super-admin who created this invitation. */
    invitedBy: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    acceptedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("platform_invitation_email_idx").on(table.email),
    index("platform_invitation_token_idx").on(table.token),
    index("platform_invitation_status_idx").on(table.status),
  ],
);

export type PlatformInvitation = typeof platformInvitation.$inferSelect;
export type NewPlatformInvitation = typeof platformInvitation.$inferInsert;

// —————————————————————————————————————————————————————————————————————————————
// Relations
// —————————————————————————————————————————————————————————————————————————————

export const platformInvitationRelations = relations(
  platformInvitation,
  ({ one }) => ({
    inviter: one(user, {
      fields: [platformInvitation.invitedBy],
      references: [user.id],
    }),
  }),
);
