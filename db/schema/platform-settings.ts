/**
 * Singleton table for platform-wide settings managed by the super-admin.
 *
 * Only one row should ever exist (id = "default"). Application code
 * should always use `WHERE id = 'default'` when reading or upserting.
 */

import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const platformSettings = pgTable("platform_settings", {
  /** Fixed singleton key — always "default". */
  id: text().primaryKey().default("default"),
  /** When false, public signup endpoints return 403. Only invited users can register. */
  registrationEnabled: boolean().default(true).notNull(),
  /** When non-null, displayed on the signup page when registration is disabled. */
  registrationDisabledMessage: text(),
  createdAt: timestamp({ withTimezone: true, mode: "date" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp({ withTimezone: true, mode: "date" })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type PlatformSettings = typeof platformSettings.$inferSelect;
export type NewPlatformSettings = typeof platformSettings.$inferInsert;
