/**
 * Audit log for super-admin actions.
 *
 * Every mutation performed through the admin panel is recorded here
 * for accountability and forensic review.
 */

import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { user } from "./user";

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("aal")),
    /** The super-admin who performed the action. */
    actorId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Machine-readable action identifier, e.g. "registration.disabled", "user.banned". */
    action: text().notNull(),
    /** Optional target entity type, e.g. "user", "platform_invitation". */
    targetType: text(),
    /** Optional target entity ID, e.g. a user ID or invitation ID. */
    targetId: text(),
    /** JSON-serialized additional context (old/new values, reason, etc.). Opaque blob — app owns parsing. */
    metadata: text(),
    /** IP address of the request. */
    ipAddress: text(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("admin_audit_log_actor_id_idx").on(table.actorId),
    index("admin_audit_log_action_idx").on(table.action),
    index("admin_audit_log_created_at_idx").on(table.createdAt),
  ],
);

export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLog.$inferInsert;

// —————————————————————————————————————————————————————————————————————————————
// Relations
// —————————————————————————————————————————————————————————————————————————————

export const adminAuditLogRelations = relations(adminAuditLog, ({ one }) => ({
  actor: one(user, {
    fields: [adminAuditLog.actorId],
    references: [user.id],
  }),
}));
