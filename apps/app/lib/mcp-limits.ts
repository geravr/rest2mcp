export const MCP_MAX_TOOLS = 50;

/** Mirrors `MCP_PLATFORM_SCOPES` in apps/api/lib/mcp-policy.ts. */
export const MCP_PLATFORM_SCOPES = [
  "read",
  "author",
  "invoke",
  "secret_reference",
  "destructive",
] as const;

export type McpPlatformScope = (typeof MCP_PLATFORM_SCOPES)[number];

export const MCP_DEFAULT_PLATFORM_SCOPES: McpPlatformScope[] = [
  "read",
  "author",
  "invoke",
  "secret_reference",
];
