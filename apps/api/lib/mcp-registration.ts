/**
 * @file MCP tool registration at the wire boundary. Registers `tools/list` and
 * `tools/call` handlers directly so the advertised JSON Schemas are exactly the
 * compiled contract schemas and argument validation runs through the same
 * normalizer that builds structured results. The MCP SDK's per-tool callback
 * wrapper is bypassed because it pre-validates arguments and returns a
 * text-only error without `structuredContent`.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";

export type RegisteredContractTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  metadata: Record<string, unknown>;
  /** Receives the raw arguments; validates and returns a structured result. */
  handler: (rawArgs: unknown) => Promise<CallToolResult>;
};

export function installContractTools(
  mcp: McpServer,
  tools: RegisteredContractTool[],
): void {
  const ordered = [...tools].sort((a, b) => a.name.localeCompare(b.name));

  // Declare the tools capability before installing handlers; the SDK rejects
  // handler registration when the capability is absent.
  mcp.server.registerCapabilities({ tools: { listChanged: false } });

  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ordered.map((tool): Tool => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema as Tool["inputSchema"],
      outputSchema: tool.outputSchema as Tool["outputSchema"],
      annotations: tool.annotations,
      _meta: tool.metadata,
    })),
  }));

  const byName = new Map(ordered.map((tool) => [tool.name, tool]));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Tool ${request.params.name} not found`,
          },
        ],
      };
    }
    return tool.handler(request.params.arguments ?? {});
  });
}
