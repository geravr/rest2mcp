import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { generateId } from "./id";
import { user } from "./user";

export const aiProviderConnection = pgTable(
  "ai_provider_connection",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("aic")),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** One of @repo/core AI_PROVIDER_KINDS values; validated at the service layer. */
    providerKind: text().notNull(),
    /** Versioned AES-256-GCM envelope; never plaintext or a reversible derivative. */
    ciphertext: text().notNull(),
    /** Monotonic revision; incremented when the credential material is rotated. */
    credentialRevision: integer().default(1).notNull(),
    /** Monotonic revision; incremented when non-secret connection configuration changes. */
    configRevision: integer().default(1).notNull(),
    verifiedAt: timestamp({ withTimezone: true, mode: "date" }),
    /** Stable AppErrorCode string of the most recent failed verification attempt. */
    lastErrorCode: text(),
    lastAttemptAt: timestamp({ withTimezone: true, mode: "date" }),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("ai_provider_connection_user_provider_unique").on(
      table.userId,
      table.providerKind,
    ),
    index("ai_provider_connection_user_id_idx").on(table.userId),
  ],
);

export type AiProviderConnectionSelect =
  typeof aiProviderConnection.$inferSelect;
export type AiProviderConnectionInsert =
  typeof aiProviderConnection.$inferInsert;
