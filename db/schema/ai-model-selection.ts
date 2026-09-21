import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { aiProviderConnection } from "./ai-provider-connection";
import { generateId } from "./id";
import { user } from "./user";

export const aiModelSelection = pgTable(
  "ai_model_selection",
  {
    id: text()
      .primaryKey()
      .$defaultFn(() => generateId("ams")),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    connectionId: text()
      .notNull()
      .references(() => aiProviderConnection.id, { onDelete: "cascade" }),
    /** Capability profile identifier, e.g. "structured-text-v1". */
    capabilityProfile: text().notNull(),
    modelId: text().notNull(),
    /** One of @repo/core AI_MODEL_PROTOCOLS values; validated at the service layer. */
    protocol: text().notNull(),
    /** HTTPS origin the model route was verified against. */
    routeOrigin: text().notNull(),
    /** Bounded normalized capability snapshot captured at verification. */
    capabilitySnapshot: jsonb().$type<Record<string, unknown>>().notNull(),
    /**
     * Deterministic SHA-256 hex over provider, credential revision, adapter
     * version, model, route/protocol, and profile version; computed by the
     * API layer to detect stale selections.
     */
    verificationFingerprint: text().notNull(),
    verifiedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    createdAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("ai_model_selection_user_profile_unique").on(
      table.userId,
      table.capabilityProfile,
    ),
    index("ai_model_selection_connection_id_idx").on(table.connectionId),
    index("ai_model_selection_user_id_idx").on(table.userId),
  ],
);

export type AiModelSelectionSelect = typeof aiModelSelection.$inferSelect;
export type AiModelSelectionInsert = typeof aiModelSelection.$inferInsert;
