import { relations } from "drizzle-orm";
import { aiModelSelection } from "./ai-model-selection";
import { aiProviderConnection } from "./ai-provider-connection";
import { user } from "./user";

export const aiProviderConnectionRelations = relations(
  aiProviderConnection,
  ({ one, many }) => ({
    user: one(user, {
      fields: [aiProviderConnection.userId],
      references: [user.id],
    }),
    modelSelections: many(aiModelSelection),
  }),
);

export const aiModelSelectionRelations = relations(
  aiModelSelection,
  ({ one }) => ({
    user: one(user, {
      fields: [aiModelSelection.userId],
      references: [user.id],
    }),
    connection: one(aiProviderConnection, {
      fields: [aiModelSelection.connectionId],
      references: [aiProviderConnection.id],
    }),
  }),
);
