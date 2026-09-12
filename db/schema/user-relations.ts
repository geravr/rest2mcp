import { relations } from "drizzle-orm";
import { identity, session, user } from "./user";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  identities: many(identity),
}));
