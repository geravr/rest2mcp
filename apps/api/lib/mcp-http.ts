import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

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
