import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { APP_ERROR_CODES } from "@repo/core";
import { appError } from "../lib/app-error.js";
import { createCallerFactory } from "../lib/trpc.js";
import type { TRPCContext } from "../lib/context.js";
import { mcpRouter } from "./mcp.js";

const createTool = vi.hoisted(() => vi.fn());
const updateTool = vi.hoisted(() => vi.fn());
const duplicateTool = vi.hoisted(() => vi.fn());
const previewToolCompile = vi.hoisted(() => vi.fn());
const updateServerCommon = vi.hoisted(() => vi.fn());
const executeMappedTool = vi.hoisted(() => vi.fn());
const isUserBanned = vi.hoisted(() => vi.fn(async () => false));

vi.mock("../services/mcp-studio-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-studio-service.js")
  >("../services/mcp-studio-service.js");
  return {
    ...actual,
    createTool,
    updateTool,
    duplicateTool,
    previewToolCompile,
    updateServerCommon,
  };
});

vi.mock("../services/mcp-executor-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-executor-service.js")
  >("../services/mcp-executor-service.js");
  return { ...actual, executeMappedTool };
});

vi.mock("../lib/user-access.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/user-access.js")>(
    "../lib/user-access.js",
  );
  return { ...actual, isUserBanned };
});

const createCaller = createCallerFactory(mcpRouter);

function makeCaller() {
  const ctx = {
    req: new Request("http://test.local/api/trpc"),
    info: {} as never,
    db: {} as never,
    dbDirect: {} as never,
    session: { id: "sess_1" } as never,
    user: { id: "usr_1", role: "user" } as never,
    auth: {} as never,
    env: {
      APP_ORIGIN: "http://test.local",
      API_ORIGIN: "http://test.local",
      MCP_CREDENTIAL_SECRET: "s".repeat(32),
    } as never,
  } satisfies TRPCContext;
  return createCaller(ctx);
}

const typedDefinition = {
  version: 1 as const,
  pathSegments: [
    { id: "path_1", value: { kind: "literal" as const, value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" as const },
  agentInputs: [],
};

const createInput = {
  serverId: "mcs_1",
  name: "get_contact",
  method: "GET" as const,
  requestDefinition: typedDefinition,
};

function causeOf(error: unknown): Record<string, unknown> {
  return ((error as TRPCError).cause ?? {}) as Record<string, unknown>;
}

describe("mcp router typed contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isUserBanned.mockResolvedValue(false);
  });

  it("routes a typed create to the service", async () => {
    createTool.mockResolvedValue({
      id: "mct_1",
      name: "get_contact",
      requestDefinition: typedDefinition,
      compileIssues: [],
    });
    const caller = makeCaller();

    const result = await caller.createTool(createInput);

    expect(createTool).toHaveBeenCalledWith(
      expect.anything(),
      "usr_1",
      "mcs_1",
      expect.objectContaining({ requestDefinition: typedDefinition }),
    );
    expect(result).toMatchObject({ id: "mct_1" });
  });

  it("rejects mixed typed and legacy payloads before the service", async () => {
    const caller = makeCaller();

    await expect(
      caller.createTool({
        ...createInput,
        pathTemplate: "/contacts/{{id}}",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createTool).not.toHaveBeenCalled();
  });

  it("surfaces structured compile-issue locations", async () => {
    createTool.mockRejectedValue(
      appError({
        appCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
        message: "The typed request definition failed to compile.",
        status: 400,
        details: {
          path: "query[0]",
          nodeId: "query_1",
          issueCode: APP_ERROR_CODES.MCP_TEMPLATE_UNRESOLVED,
        },
      }),
    );
    const caller = makeCaller();

    await expect(caller.createTool(createInput)).rejects.toSatisfy(
      (error: unknown) => {
        const cause = causeOf(error);
        return (
          cause.appCode === APP_ERROR_CODES.MCP_COMPILE_INVALID &&
          (cause.details as { nodeId?: string }).nodeId === "query_1"
        );
      },
    );
  });

  it("maps missing ownership to not-found semantics", async () => {
    createTool.mockRejectedValue(
      appError({
        appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
        message: "MCP server not found.",
        status: 404,
      }),
    );
    const caller = makeCaller();

    await expect(caller.createTool(createInput)).rejects.toSatisfy(
      (error: unknown) =>
        (error as TRPCError).code === "NOT_FOUND" &&
        causeOf(error).appCode === APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
    );
  });

  it("never returns resolved secret values in typed responses", async () => {
    createTool.mockResolvedValue({
      id: "mct_1",
      name: "secure_get",
      requestDefinition: {
        ...typedDefinition,
        headers: [
          {
            id: "hdr_1",
            name: "Authorization",
            value: { kind: "serverValue", serverValueId: "msv_secret" },
          },
        ],
      },
      compileIssues: [],
      compileStatus: "valid",
      enabled: true,
      allowMutation: false,
      source: "manual",
    });
    const caller = makeCaller();

    const result = await caller.createTool(createInput);

    const serialized = JSON.stringify(result);
    expect(serialized).toContain("msv_secret");
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("ciphertext");
  });
});
