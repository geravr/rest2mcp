import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { user } from "./user";

export const userConfig = pgTable(
  "user_config",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("ucf")),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .unique(),
    telemetryConsentStatus: text().notNull().default("pending"),
    telemetrySessionReplayEnabled: boolean().notNull().default(true),
    telemetryErrorTrackingEnabled: boolean().notNull().default(true),
    telemetryConsentUpdatedAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("user_config_user_id_idx").on(table.userId)],
);

export type UserConfig = typeof userConfig.$inferSelect;
export type NewUserConfig = typeof userConfig.$inferInsert;

export const userConfigRelations = relations(userConfig, ({ one }) => ({
  user: one(user, {
    fields: [userConfig.userId],
    references: [user.id],
  }),
}));
