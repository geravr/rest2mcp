import { relations } from "drizzle-orm";
import { mcpAgentToken } from "./mcp-agent-token";
import { mcpCallLog } from "./mcp-call-log";
import { mcpPlatformSecurityEvent } from "./mcp-platform-security-event";
import { mcpPlatformStepUpGrant } from "./mcp-platform-step-up-grant";
import { mcpPlatformTokenScope } from "./mcp-platform-token-scope";
import { mcpPlatformTokenServerGrant } from "./mcp-platform-token-server-grant";
import { mcpServer } from "./mcp-server";
import { mcpServerVariable } from "./mcp-server-variable";
import { mcpStorageAsset } from "./mcp-storage-asset";
import { mcpTool } from "./mcp-tool";
import { user } from "./user";

export const mcpServerRelations = relations(mcpServer, ({ one, many }) => ({
  user: one(user, {
    fields: [mcpServer.userId],
    references: [user.id],
  }),
  iconAsset: one(mcpStorageAsset, {
    fields: [mcpServer.iconAssetId],
    references: [mcpStorageAsset.id],
  }),
  tools: many(mcpTool),
  variables: many(mcpServerVariable),
  agentTokens: many(mcpAgentToken),
  callLogs: many(mcpCallLog),
}));

export const mcpStorageAssetRelations = relations(
  mcpStorageAsset,
  ({ one, many }) => ({
    user: one(user, {
      fields: [mcpStorageAsset.userId],
      references: [user.id],
    }),
    servers: many(mcpServer),
  }),
);

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

export const mcpAgentTokenRelations = relations(
  mcpAgentToken,
  ({ one, many }) => ({
    user: one(user, {
      fields: [mcpAgentToken.userId],
      references: [user.id],
    }),
    server: one(mcpServer, {
      fields: [mcpAgentToken.serverId],
      references: [mcpServer.id],
    }),
    scopes: many(mcpPlatformTokenScope),
    serverGrants: many(mcpPlatformTokenServerGrant),
    securityEvents: many(mcpPlatformSecurityEvent),
  }),
);

export const mcpPlatformStepUpGrantRelations = relations(
  mcpPlatformStepUpGrant,
  ({ one }) => ({
    user: one(user, {
      fields: [mcpPlatformStepUpGrant.userId],
      references: [user.id],
    }),
  }),
);

export const mcpPlatformTokenScopeRelations = relations(
  mcpPlatformTokenScope,
  ({ one }) => ({
    token: one(mcpAgentToken, {
      fields: [mcpPlatformTokenScope.tokenId],
      references: [mcpAgentToken.id],
    }),
  }),
);

export const mcpPlatformTokenServerGrantRelations = relations(
  mcpPlatformTokenServerGrant,
  ({ one }) => ({
    token: one(mcpAgentToken, {
      fields: [mcpPlatformTokenServerGrant.tokenId],
      references: [mcpAgentToken.id],
    }),
    server: one(mcpServer, {
      fields: [mcpPlatformTokenServerGrant.serverId],
      references: [mcpServer.id],
    }),
  }),
);

export const mcpPlatformSecurityEventRelations = relations(
  mcpPlatformSecurityEvent,
  ({ one }) => ({
    user: one(user, {
      fields: [mcpPlatformSecurityEvent.userId],
      references: [user.id],
    }),
    token: one(mcpAgentToken, {
      fields: [mcpPlatformSecurityEvent.tokenId],
      references: [mcpAgentToken.id],
    }),
    server: one(mcpServer, {
      fields: [mcpPlatformSecurityEvent.serverId],
      references: [mcpServer.id],
    }),
  }),
);

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
