/**
 * Database schema for Better Auth authentication system.
 *
 * This schema is designed to be fully compatible with Better Auth's database
 * requirements as documented at https://www.better-auth.com/docs/concepts/database
 *
 * Tables defined:
 * - `user`: Core user accounts with profile information
 * - `session`: Active user sessions for authentication state
 * - `identity`: Account credential records (renamed from Better Auth's `account`)
 * - `verification`: Tokens for email verification
 *
 * @see https://www.better-auth.com/docs/concepts/database
 * @see https://www.better-auth.com/docs/adapters/drizzle
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { generateAuthId } from "./id";

/**
 * User accounts table.
 * Matches to the `user` table in Better Auth.
 */
export const user = pgTable("user", {
  id: text()
    .primaryKey()
    .$defaultFn(() => generateAuthId("user")),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().default(false).notNull(),
  image: text(),
  /** Platform-level role. "user" for regular users, "super_admin" for platform administrators. */
  role: text().default("user").notNull(),
  /** When non-null the account is suspended – the user cannot sign in. */
  bannedAt: timestamp({ withTimezone: true, mode: "date" }),
  /** Optional reason shown to the user when their account is suspended. */
  bannedReason: text(),
  createdAt: timestamp({ withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;

/**
 * Stores user session data for authentication.
 * Matches to the `session` table in Better Auth.
 */
export const session = pgTable(
  "session",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateAuthId("session")),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    token: text().notNull().unique(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;

/**
 * Stores OAuth provider account information.
 * Matches to the `account` table in Better Auth.
 */
export const identity = pgTable(
  "identity",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateAuthId("account")),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true, mode: "date" }),
    scope: text(),
    password: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Better Auth 1.7.3 keys accounts on (providerId, accountId), not issuer.
    unique("identity_provider_account_unique").on(
      table.providerId,
      table.accountId,
    ),
    index("identity_user_id_idx").on(table.userId),
  ],
);

export type Identity = typeof identity.$inferSelect;
export type NewIdentity = typeof identity.$inferInsert;

/**
 * Stores verification tokens (email verification, password reset, etc.)
 * Matches to the `verification` table in Better Auth.
 */
export const verification = pgTable(
  "verification",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateAuthId("verification")),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("verification_identifier_value_unique").on(
      table.identifier,
      table.value,
    ),
    index("verification_identifier_idx").on(table.identifier),
    index("verification_value_idx").on(table.value),
    index("verification_expires_at_idx").on(table.expiresAt),
  ],
);

export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;

// —————————————————————————————————————————————————————————————————————————————
// Relations for better query experience (auth tables only)
// Extended user relations are in user-relations.ts to avoid circular imports
// —————————————————————————————————————————————————————————————————————————————

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const identityRelations = relations(identity, ({ one }) => ({
  user: one(user, {
    fields: [identity.userId],
    references: [user.id],
  }),
}));
