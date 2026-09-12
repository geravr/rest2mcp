import { relations } from "drizzle-orm";
import { mcpAgentToken } from "./mcp-agent-token";
import { mcpServer } from "./mcp-server";
import { identity, session, user } from "./user";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  identities: many(identity),
  mcpServers: many(mcpServer),
  mcpAgentTokens: many(mcpAgentToken),
}));
