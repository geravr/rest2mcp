import { relations } from "drizzle-orm";
import { mcpAgentToken } from "./mcp-agent-token";
import { mcpCallLog } from "./mcp-call-log";
import { mcpServer } from "./mcp-server";
import { mcpServerVariable } from "./mcp-server-variable";
import { mcpTool } from "./mcp-tool";
import { user } from "./user";

export const mcpServerRelations = relations(mcpServer, ({ one, many }) => ({
  user: one(user, {
    fields: [mcpServer.userId],
    references: [user.id],
  }),
  tools: many(mcpTool),
  variables: many(mcpServerVariable),
  agentTokens: many(mcpAgentToken),
  callLogs: many(mcpCallLog),
}));

export const mcpToolRelations = relations(mcpTool, ({ one, many }) => ({
  server: one(mcpServer, {
    fields: [mcpTool.serverId],
    references: [mcpServer.id],
  }),
  callLogs: many(mcpCallLog),
}));

export const mcpServerVariableRelations = relations(
  mcpServerVariable,
  ({ one }) => ({
    server: one(mcpServer, {
      fields: [mcpServerVariable.serverId],
      references: [mcpServer.id],
    }),
  }),
);

export const mcpAgentTokenRelations = relations(mcpAgentToken, ({ one }) => ({
  user: one(user, {
    fields: [mcpAgentToken.userId],
    references: [user.id],
  }),
  server: one(mcpServer, {
    fields: [mcpAgentToken.serverId],
    references: [mcpServer.id],
  }),
}));

export const mcpCallLogRelations = relations(mcpCallLog, ({ one }) => ({
  server: one(mcpServer, {
    fields: [mcpCallLog.serverId],
    references: [mcpServer.id],
  }),
  tool: one(mcpTool, {
    fields: [mcpCallLog.toolId],
    references: [mcpTool.id],
  }),
}));
