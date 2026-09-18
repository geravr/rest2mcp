import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpExecutionEnvelope } from "./mcp-request-definition.js";

export type McpServerFactory = () => Promise<McpServer> | McpServer;

/**
 * Stateless Streamable HTTP adapter for Hono/Bun.
 * Creates a new transport per request so session state is never reused.
 */
export async function handleMcpHttpRequest(
  request: Request,
  createServer: McpServerFactory,
): Promise<Response> {
  const server = await createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export function jsonToolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function jsonToolError(message: string, appCode?: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ appCode: appCode ?? null, message }),
      },
    ],
  };
}

/** MCP-native success result: compatibility text plus a typed structuredContent envelope. */
export function structuredToolResult(envelope: McpExecutionEnvelope) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(envelope, null, 2) },
    ],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}

/** MCP-native tool error for a completed non-2xx upstream response (not a thrown failure). */
export function structuredToolError(envelope: McpExecutionEnvelope) {
  return {
    isError: true,
    content: [
      { type: "text" as const, text: JSON.stringify(envelope, null, 2) },
    ],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}
