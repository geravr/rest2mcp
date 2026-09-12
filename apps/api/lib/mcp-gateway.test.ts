import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError, appError } from "./app-error.js";
import type { AppContext } from "./context.js";

vi.mock("./posthog.js", () => ({
  captureServerException: vi.fn(),
  extractRequestTelemetryDetails: vi.fn(() => ({
    hasTracingHeaders: false,
  })),
}));

const authenticateAgentToken = vi.hoisted(() => vi.fn());
const executeMappedTool = vi.hoisted(() => vi.fn());

vi.mock("../services/mcp-studio-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-studio-service.js")
  >("../services/mcp-studio-service.js");
  return {
    ...actual,
    authenticateAgentToken,
  };
});

vi.mock("../services/mcp-executor-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-executor-service.js")
  >("../services/mcp-executor-service.js");
  return {
    ...actual,
    executeMappedTool,
  };
});

vi.mock("@repo/db", () => ({
  mcpServer: { id: "id" },
  mcpTool: { serverId: "serverId", enabled: "enabled" },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((...args: unknown[]) => args),
}));

import { createMcpGatewayRoutes } from "./mcp-gateway.js";
import { errorHandler } from "./middleware.js";

function createApp() {
  const app = new Hono<AppContext>();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("db", {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: "mcs_1", name: "CRM" }],
          }),
        }),
      }),
    } as never);
    c.set("dbDirect", c.get("db"));
    c.set("env", { MCP_CREDENTIAL_SECRET: "s".repeat(32) } as never);
    await next();
  });
  app.route("/mcp", createMcpGatewayRoutes());
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("product MCP gateway", () => {
  it("rejects a missing token", async () => {
    const response = await createApp().request("/mcp/mcs_1", {
      method: "POST",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
    expect(authenticateAgentToken).not.toHaveBeenCalled();
  });

  it("rejects a token issued for another server", async () => {
    authenticateAgentToken.mockRejectedValue(
      appError({
        appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
        message: "Agent token is invalid.",
        status: 401,
      }),
    );

    const response = await createApp().request("/mcp/mcs_b", {
      method: "POST",
      headers: { Authorization: "Bearer other-server-token" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });
    expect(authenticateAgentToken).toHaveBeenCalledWith(
      expect.anything(),
      "other-server-token",
      { kind: "server", serverId: "mcs_b" },
    );
  });

  it("maps executor AppErrors without echoing secrets", async () => {
    authenticateAgentToken.mockResolvedValue({
      id: "mtk_1",
      kind: "server",
      serverId: "mcs_1",
      userId: "usr_1",
    });

    const cases: Array<{ error: AppError; code: string }> = [
      {
        error: appError({
          appCode: APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
          message: "Mutating this tool is not allowed.",
          status: 403,
        }),
        code: APP_ERROR_CODES.MCP_MUTATION_NOT_ALLOWED,
      },
      {
        error: appError({
          appCode: APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
          message: "The request target is not allowed.",
          status: 403,
        }),
        code: APP_ERROR_CODES.MCP_HOST_NOT_ALLOWED,
      },
      {
        error: appError({
          appCode: APP_ERROR_CODES.INVALID_INPUT,
          message: "Server is paused.",
          status: 400,
        }),
        code: APP_ERROR_CODES.INVALID_INPUT,
      },
    ];

    for (const testCase of cases) {
      executeMappedTool.mockRejectedValueOnce(testCase.error);
      const result = await executeMappedTool.mock.results;
      expect(testCase.error.message).not.toContain("secret");
      expect(testCase.error.appCode).toBe(testCase.code);
      expect(JSON.stringify(testCase.error)).not.toContain("Bearer abc");
      void result;
    }
  });
});
