import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { APP_ERROR_CODES } from "@repo/core";
import { appError } from "../lib/app-error.js";
import { createCallerFactory } from "../lib/trpc.js";
import type { TRPCContext } from "../lib/context.js";
import { mcpRouter } from "./mcp.js";

const createTool = vi.hoisted(() => vi.fn());
const updateTool = vi.hoisted(() => vi.fn());
const updateServer = vi.hoisted(() => vi.fn());
const previewPublish = vi.hoisted(() => vi.fn());
const publishServer = vi.hoisted(() => vi.fn());
const listRevisionHistory = vi.hoisted(() => vi.fn());
const getRevisionDetail = vi.hoisted(() => vi.fn());
const restoreRevisionToDraft = vi.hoisted(() => vi.fn());

vi.mock("../services/mcp-studio-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-studio-service.js")
  >("../services/mcp-studio-service.js");
  return { ...actual, createTool, updateTool, updateServer };
});

vi.mock("../services/mcp-publishing-service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../services/mcp-publishing-service.js")
  >("../services/mcp-publishing-service.js");
  return {
    ...actual,
    previewPublish,
    publishServer,
    listRevisionHistory,
    getRevisionDetail,
    restoreRevisionToDraft,
  };
});

vi.mock("../lib/user-access.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/user-access.js")>(
    "../lib/user-access.js",
  );
  return { ...actual, isUserBanned: vi.fn(async () => false) };
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
  version: 2 as const,
  pathSegments: [
    { id: "path_1", value: { kind: "literal" as const, value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" as const },
  agentInputs: [],
};

function causeOf(error: unknown): Record<string, unknown> {
  return ((error as TRPCError).cause ?? {}) as Record<string, unknown>;
}

describe("mcp router revision contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects createTool without an expectedRevision", async () => {
    const caller = makeCaller();
    await expect(
      caller.createTool({
        serverId: "mcs_1",
        name: "get_contact",
        method: "GET",
        requestDefinition: typedDefinition,
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(createTool).not.toHaveBeenCalled();
  });

  it("rejects updateServer without an expectedRevision", async () => {
    const caller = makeCaller();
    await expect(
      caller.updateServer({ serverId: "mcs_1", status: "live" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updateServer).not.toHaveBeenCalled();
  });

  it("rejects missing revisions across existing-server mutations", async () => {
    const caller = makeCaller();
    await expect(
      caller.updateTool({
        serverId: "mcs_1",
        toolId: "mct_1",
        name: "renamed",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.deleteServer({ serverId: "mcs_1" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.createVariable({
        serverId: "mcs_1",
        name: "region",
        isSecret: false,
        value: "mx",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.deleteVariable({ serverId: "mcs_1", name: "region" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects the superseded icon URL input shape", async () => {
    const caller = makeCaller();
    await expect(
      caller.updateServer({
        serverId: "mcs_1",
        expectedRevision: 1,
        iconImage:
          "https://app.example.com/api/storage/object?key=users/x/i.png",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updateServer).not.toHaveBeenCalled();
  });

  it("forwards the current revision to the service on createTool", async () => {
    createTool.mockResolvedValue({ id: "mct_1", revision: 2 });
    const caller = makeCaller();
    await caller.createTool({
      serverId: "mcs_1",
      expectedRevision: 4,
      name: "get_contact",
      method: "GET",
      requestDefinition: typedDefinition,
    });
    expect(createTool).toHaveBeenCalledWith(
      expect.anything(),
      "usr_1",
      "mcs_1",
      expect.objectContaining({ expectedRevision: 4 }),
    );
  });

  it("surfaces a stale revision as a secret-safe conflict", async () => {
    updateServer.mockRejectedValue(
      appError({
        appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
        message:
          "The server configuration changed elsewhere. Reload before retrying.",
        status: 409,
        details: { currentRevision: 5, serverId: "mcs_1" },
      }),
    );
    const caller = makeCaller();
    let caught: unknown;
    try {
      await caller.updateServer({
        serverId: "mcs_1",
        expectedRevision: 2,
        name: "CRM",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = causeOf(caught);
    expect(cause.appCode).toBe(APP_ERROR_CODES.MCP_WRITE_CONFLICT);
    expect(cause.details).toMatchObject({
      currentRevision: 5,
      serverId: "mcs_1",
    });
    // Conflict metadata must never carry secret material.
    const serialized = JSON.stringify(caught);
    expect(serialized).not.toContain("sk_live");
    expect(serialized).not.toContain("ciphertext");
  });
});

describe("mcp router publication contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects publishServer without an expectedDraftRevision", async () => {
    const caller = makeCaller();
    await expect(
      caller.publishServer({
        serverId: "mcs_1",
        expectedPublishedRevisionId: null,
        publishRequestId: "req_1",
        candidateFingerprint: "cand_1",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(publishServer).not.toHaveBeenCalled();
  });

  it("rejects restoreRevision without an expectedDraftRevision", async () => {
    const caller = makeCaller();
    await expect(
      caller.restoreRevision({
        serverId: "mcs_1",
        revisionId: "msr_1",
        expectedRevision: 1,
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(restoreRevisionToDraft).not.toHaveBeenCalled();
  });

  it("previews a publication for the session user", async () => {
    previewPublish.mockResolvedValue({ serverId: "mcs_1" });
    const caller = makeCaller();
    await caller.publishPreview({ serverId: "mcs_1" });
    expect(previewPublish).toHaveBeenCalledWith(
      expect.anything(),
      "usr_1",
      "mcs_1",
    );
  });

  it("publishes with studio attribution and the session user", async () => {
    publishServer.mockResolvedValue({ revisionNumber: 1 });
    const caller = makeCaller();
    await caller.publishServer({
      serverId: "mcs_1",
      expectedDraftRevision: 2,
      expectedPublishedRevisionId: null,
      publishRequestId: "req_1",
      candidateFingerprint: "cand_1",
      acknowledgedWarningCodes: ["contract_changed"],
      note: "First release",
    });
    expect(publishServer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "usr_1",
        actorSource: "studio",
        expectedDraftRevision: 2,
        expectedPublishedRevisionId: null,
        publishRequestId: "req_1",
        candidateFingerprint: "cand_1",
        acknowledgedWarningCodes: ["contract_changed"],
        note: "First release",
      }),
    );
  });

  it("passes pagination through revision history", async () => {
    listRevisionHistory.mockResolvedValue({
      items: [],
      page: 2,
      pageSize: 20,
      total: 0,
    });
    const caller = makeCaller();
    await caller.revisionHistory({
      serverId: "mcs_1",
      page: 2,
      pageSize: 20,
    });
    expect(listRevisionHistory).toHaveBeenCalledWith(
      expect.anything(),
      "usr_1",
      "mcs_1",
      { page: 2, pageSize: 20 },
    );
  });

  it("reads revision detail with the session user", async () => {
    getRevisionDetail.mockResolvedValue({ id: "msr_1" });
    const caller = makeCaller();
    await caller.revisionDetail({ serverId: "mcs_1", revisionId: "msr_1" });
    expect(getRevisionDetail).toHaveBeenCalledWith(
      expect.anything(),
      "usr_1",
      "mcs_1",
      "msr_1",
    );
  });

  it("restores a revision to the draft with the session user", async () => {
    restoreRevisionToDraft.mockResolvedValue({ draftRevision: 3 });
    const caller = makeCaller();
    await caller.restoreRevision({
      serverId: "mcs_1",
      revisionId: "msr_1",
      expectedRevision: 4,
      expectedDraftRevision: 2,
    });
    expect(restoreRevisionToDraft).toHaveBeenCalledWith(expect.anything(), {
      userId: "usr_1",
      serverId: "mcs_1",
      revisionId: "msr_1",
      expectedRevision: 4,
      expectedDraftRevision: 2,
    });
  });

  it("surfaces a stale publish as a secret-safe conflict", async () => {
    publishServer.mockRejectedValue(
      appError({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT,
        message:
          "The draft changed after preview; re-preview before publishing.",
        status: 409,
        details: { serverId: "mcs_1", draftRevision: 9, refreshRequired: true },
      }),
    );
    const caller = makeCaller();
    let caught: unknown;
    try {
      await caller.publishServer({
        serverId: "mcs_1",
        expectedDraftRevision: 2,
        expectedPublishedRevisionId: null,
        publishRequestId: "req_1",
        candidateFingerprint: "cand_1",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = causeOf(caught);
    expect(cause.appCode).toBe(APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT);
    expect(cause.details).toMatchObject({
      serverId: "mcs_1",
      draftRevision: 9,
      refreshRequired: true,
    });
    const serialized = JSON.stringify(caught);
    expect(serialized).not.toContain("sk_live");
    expect(serialized).not.toContain("ciphertext");
  });
});
