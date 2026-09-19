import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";

const h = vi.hoisted(() => {
  const rawToken = "rmcp_UNIT_RAW_TOKEN_secret_material_0123456789";
  const tokenHash =
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const tables = {
    mcpAgentToken: { __table: "mcpAgentToken" },
    mcpPlatformTokenScope: { __table: "mcpPlatformTokenScope" },
    mcpPlatformTokenServerGrant: { __table: "mcpPlatformTokenServerGrant" },
    mcpPlatformStepUpGrant: { __table: "mcpPlatformStepUpGrant" },
    mcpPlatformSecurityEvent: { __table: "mcpPlatformSecurityEvent" },
    mcpServer: { __table: "mcpServer" },
    user: { __table: "user" },
  };
  return {
    rawToken,
    rawPrefix: rawToken.slice(0, 12),
    secretSuffix: rawToken.slice(12),
    tokenHash,
    tables,
    generateAgentToken: vi.fn(() => ({
      raw: rawToken,
      hash: tokenHash,
      prefix: rawToken.slice(0, 12),
    })),
    hashAgentToken: vi.fn<(raw: string) => string>(() => tokenHash),
    consumePlatformStepUpGrant: vi.fn<
      (tx: unknown, input: unknown) => Promise<void>
    >(async () => {}),
    recordPlatformSecurityEvent: vi.fn<
      (tx: unknown, input: unknown) => Promise<void>
    >(async () => {}),
    captureMcpTelemetry: vi.fn<(event: string, input: unknown) => void>(
      () => {},
    ),
    clearPlatformRateLimitState: vi.fn<(tokenId: string) => void>(() => {}),
    isUserBanned: vi.fn<(db: unknown, userId: string) => Promise<boolean>>(
      async () => false,
    ),
  };
});

vi.mock("@repo/db", () => h.tables);
vi.mock("../lib/mcp-agent-token.js", () => ({
  generateAgentToken: h.generateAgentToken,
  hashAgentToken: h.hashAgentToken,
}));
vi.mock("../lib/user-access.js", () => ({ isUserBanned: h.isUserBanned }));
vi.mock("../lib/mcp-rate-limit.js", () => ({
  clearPlatformRateLimitState: h.clearPlatformRateLimitState,
}));
vi.mock("../lib/mcp-telemetry.js", () => ({
  captureMcpTelemetry: h.captureMcpTelemetry,
  MCP_TELEMETRY_EVENTS: {
    platformHighRiskGrant: "mcp_platform_high_risk_grant",
    platformTokenInventory: "mcp_platform_token_inventory",
    aggregateWrite: "mcp_aggregate_write",
    aggregateConflict: "mcp_aggregate_conflict",
    aggregateRetry: "mcp_aggregate_retry",
  },
}));
vi.mock("./mcp-platform-step-up-service.js", () => ({
  consumePlatformStepUpGrant: h.consumePlatformStepUpGrant,
}));
vi.mock("./mcp-platform-security-event-service.js", () => ({
  recordPlatformSecurityEvent: h.recordPlatformSecurityEvent,
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: "and", args })),
  count: vi.fn(() => ({ kind: "count" })),
  desc: vi.fn((value: unknown) => ({ kind: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
  gt: vi.fn((left: unknown, right: unknown) => ({ kind: "gt", left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({
    kind: "inArray",
    left,
    right,
  })),
  isNull: vi.fn((value: unknown) => ({ kind: "isNull", value })),
  lt: vi.fn((left: unknown, right: unknown) => ({ kind: "lt", left, right })),
  or: vi.fn((...args: unknown[]) => ({ kind: "or", args })),
}));

import { appError } from "../lib/app-error.js";
import { validatePlatformGrantRequest } from "../lib/mcp-platform-principal.js";
import {
  authenticatePlatformPat,
  createPlatformPat,
  listPlatformPats,
  revokePlatformPat,
  rotatePlatformPat,
} from "./mcp-platform-token-service.js";

const USER_ID = "usr_unit_pat";
const SERVER_ID = "mcs_unit_pat";
const SESSION_ID = "ses_unit_pat";

type OpType =
  | "select"
  | "insert"
  | "update"
  | "delete"
  | "transaction"
  | "commit"
  | "rollback";

type Op = {
  type: OpType;
  table: string;
  payload?: unknown;
  index: number;
};

type RecordedWrite = { table: string; payload: unknown };

function makeChain<T>(result: T): unknown {
  const handler: ProxyHandler<object> = {
    get(_, prop: string | symbol) {
      if (prop === "then") {
        return (
          resolve: (value: T) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

function makeTokenDb(
  options: {
    results?: unknown[];
    failOn?: (op: Op) => Error | undefined;
  } = {},
) {
  const results = options.results ?? [];
  let resultIndex = 0;
  const ops: Op[] = [];
  const inserted: RecordedWrite[] = [];
  const updated: RecordedWrite[] = [];

  const nextResult = () => {
    const value = results[resultIndex] ?? [];
    resultIndex += 1;
    return value;
  };

  const record = (type: OpType, table: string, payload?: unknown) => {
    const op: Op = { type, table, payload, index: ops.length };
    ops.push(op);
    const failure = options.failOn?.(op);
    if (failure) throw failure;
  };

  const db = {
    select: vi.fn(() => ({
      from: (table: { __table: string }) => {
        record("select", table.__table);
        return makeChain(nextResult());
      },
    })),
    insert: vi.fn((table: { __table: string }) => ({
      values: (payload: unknown) => {
        inserted.push({ table: table.__table, payload });
        record("insert", table.__table, payload);
        return makeChain(nextResult());
      },
    })),
    update: vi.fn((table: { __table: string }) => ({
      set: (payload: unknown) => {
        updated.push({ table: table.__table, payload });
        record("update", table.__table, payload);
        return makeChain(nextResult());
      },
    })),
    delete: vi.fn((table: { __table: string }) => {
      record("delete", table.__table);
      return makeChain(nextResult());
    }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      record("transaction", "-");
      try {
        const value = await fn(db);
        record("commit", "-");
        return value;
      } catch (error) {
        record("rollback", "-");
        throw error;
      }
    }),
    ops,
    inserted,
    updated,
  };
  return db;
}

function hasOp(
  db: ReturnType<typeof makeTokenDb>,
  type: OpType,
  table: string,
): boolean {
  return db.ops.some((op) => op.type === type && op.table === table);
}

function lastOpType(db: ReturnType<typeof makeTokenDb>): OpType | undefined {
  return db.ops.at(-1)?.type;
}

function tokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mtk_unit",
    userId: USER_ID,
    serverId: null,
    kind: "platform",
    name: "Inspect",
    tokenHash: h.tokenHash,
    prefix: h.rawPrefix,
    policyVersion: 1,
    resourceMode: "selected",
    replacesTokenId: null,
    replacedByTokenId: null,
    rotationMeta: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function selectedInput(name = "Inspect") {
  return {
    name,
    scopes: ["read"],
    resourceMode: "selected" as const,
    serverIds: [SERVER_ID],
    sessionId: SESSION_ID,
  };
}

function accountInput(name = "Account") {
  return {
    name,
    scopes: ["read"],
    resourceMode: "account" as const,
    sessionId: SESSION_ID,
  };
}

function sanitizeMocks() {
  vi.clearAllMocks();
  h.consumePlatformStepUpGrant.mockResolvedValue(undefined);
  h.recordPlatformSecurityEvent.mockResolvedValue(undefined);
  h.isUserBanned.mockResolvedValue(false);
  h.generateAgentToken.mockImplementation(() => ({
    raw: h.rawToken,
    hash: h.tokenHash,
    prefix: h.rawPrefix,
  }));
}

describe("Platform PAT transaction failure injection", () => {
  beforeEach(sanitizeMocks);

  it("rolls back creation when the scope-row insert fails", async () => {
    const db = makeTokenDb({
      results: [[], [], [], [{ id: SERVER_ID }], [tokenRow()]],
      failOn: (op) =>
        op.type === "insert" && op.table === "mcpPlatformTokenScope"
          ? new Error("injected scope insert failure")
          : undefined,
    });

    await expect(
      createPlatformPat(db as never, USER_ID, selectedInput()),
    ).rejects.toThrow(/injected scope insert failure/);

    expect(hasOp(db, "insert", "mcpAgentToken")).toBe(true);
    expect(hasOp(db, "insert", "mcpPlatformTokenScope")).toBe(true);
    expect(hasOp(db, "insert", "mcpPlatformTokenServerGrant")).toBe(false);
    expect(lastOpType(db)).toBe("rollback");
    expect(h.recordPlatformSecurityEvent).not.toHaveBeenCalled();
  });

  it("rolls back creation when the selected-server grant insert fails", async () => {
    const db = makeTokenDb({
      results: [[], [], [], [{ id: SERVER_ID }], [tokenRow()], []],
      failOn: (op) =>
        op.type === "insert" && op.table === "mcpPlatformTokenServerGrant"
          ? new Error("injected server-grant insert failure")
          : undefined,
    });

    await expect(
      createPlatformPat(db as never, USER_ID, selectedInput()),
    ).rejects.toThrow(/injected server-grant insert failure/);

    expect(hasOp(db, "insert", "mcpPlatformTokenScope")).toBe(true);
    expect(hasOp(db, "insert", "mcpPlatformTokenServerGrant")).toBe(true);
    expect(lastOpType(db)).toBe("rollback");
    expect(h.recordPlatformSecurityEvent).not.toHaveBeenCalled();
  });

  it("does not issue a token when the high-risk step-up consumption fails", async () => {
    h.consumePlatformStepUpGrant.mockRejectedValueOnce(
      appError({
        appCode: APP_ERROR_CODES.MCP_STEP_UP_REQUIRED,
        message: "step-up required",
        status: 403,
      }),
    );
    const db = makeTokenDb({ results: [[], [], []] });
    const expected = validatePlatformGrantRequest({
      scopes: ["read"],
      resourceMode: "account",
      serverIds: [],
    });

    await expect(
      createPlatformPat(db as never, USER_ID, accountInput()),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_STEP_UP_REQUIRED });

    expect(hasOp(db, "insert", "mcpAgentToken")).toBe(false);
    expect(lastOpType(db)).toBe("rollback");
    expect(h.consumePlatformStepUpGrant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER_ID,
        sessionId: SESSION_ID,
        fingerprint: expected.fingerprint,
      }),
    );
    expect(h.recordPlatformSecurityEvent).not.toHaveBeenCalled();
  });

  it("rolls back the whole creation when the security event insert fails", async () => {
    h.recordPlatformSecurityEvent.mockRejectedValueOnce(
      new Error("injected event insert failure"),
    );
    const db = makeTokenDb({
      results: [[], [], [], [{ id: SERVER_ID }], [tokenRow()], [], []],
    });

    await expect(
      createPlatformPat(db as never, USER_ID, selectedInput()),
    ).rejects.toThrow(/injected event insert failure/);

    expect(hasOp(db, "insert", "mcpAgentToken")).toBe(true);
    expect(hasOp(db, "insert", "mcpPlatformTokenScope")).toBe(true);
    expect(hasOp(db, "insert", "mcpPlatformTokenServerGrant")).toBe(true);
    expect(lastOpType(db)).toBe("rollback");
  });

  it("translates a unique violation during issuance into MCP_WRITE_CONFLICT", async () => {
    const uniqueViolation = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });
    const db = makeTokenDb({
      results: [[], [], [], [{ id: SERVER_ID }]],
      failOn: (op) =>
        op.type === "insert" && op.table === "mcpAgentToken"
          ? uniqueViolation
          : undefined,
    });

    await expect(
      createPlatformPat(db as never, USER_ID, selectedInput()),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
    });
  });

  it("rolls back a rotation when the predecessor revoke update fails", async () => {
    const predecessor = tokenRow({ id: "mtk_pred", name: "Primary" });
    const successor = tokenRow({ id: "mtk_succ", name: "Successor" });
    const db = makeTokenDb({
      results: [
        [],
        [],
        [predecessor],
        [],
        [{ id: SERVER_ID }],
        [], // predecessor revoke update (runs before the successor insert)
        [successor],
        [],
        [],
      ],
      failOn: (op) =>
        op.type === "update" &&
        op.table === "mcpAgentToken" &&
        (op.payload as Record<string, unknown> | undefined)
          ?.replacedByTokenId === "mtk_succ"
          ? new Error("injected predecessor revoke failure")
          : undefined,
    });

    await expect(
      rotatePlatformPat(db as never, USER_ID, {
        ...selectedInput("Successor"),
        tokenId: "mtk_pred",
      }),
    ).rejects.toThrow(/injected predecessor revoke failure/);

    expect(hasOp(db, "insert", "mcpAgentToken")).toBe(true);
    expect(lastOpType(db)).toBe("rollback");
    expect(h.recordPlatformSecurityEvent).not.toHaveBeenCalled();
  });

  it("rolls back a revocation when the security event insert fails", async () => {
    h.recordPlatformSecurityEvent.mockRejectedValueOnce(
      new Error("injected event insert failure"),
    );
    const db = makeTokenDb({
      results: [[], [{ id: "mtk_pred", prefix: h.rawPrefix }]],
    });

    await expect(
      revokePlatformPat(db as never, USER_ID, "mtk_pred"),
    ).rejects.toThrow(/injected event insert failure/);

    expect(hasOp(db, "update", "mcpAgentToken")).toBe(true);
    expect(lastOpType(db)).toBe("rollback");
    expect(h.clearPlatformRateLimitState).not.toHaveBeenCalled();
  });

  it("fails a revocation of a missing or foreign token without an event", async () => {
    const db = makeTokenDb({ results: [[], []] });

    await expect(
      revokePlatformPat(db as never, USER_ID, "mtk_missing"),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
    });

    expect(lastOpType(db)).toBe("rollback");
    expect(h.recordPlatformSecurityEvent).not.toHaveBeenCalled();
    expect(h.clearPlatformRateLimitState).not.toHaveBeenCalled();
  });
});

describe("Platform PAT raw-token non-leakage", () => {
  beforeEach(sanitizeMocks);

  it("returns the raw token while persisting only a hash and safe prefix", async () => {
    const db = makeTokenDb({
      results: [[], [], [], [{ id: SERVER_ID }], [tokenRow()], [], []],
    });

    const created = await createPlatformPat(
      db as never,
      USER_ID,
      selectedInput(),
    );
    expect(created.token).toBe(h.rawToken);

    const insertedJson = JSON.stringify(db.inserted);
    expect(insertedJson).not.toContain(h.rawToken);
    expect(insertedJson).not.toContain(h.secretSuffix);

    const tokenPayload = db.inserted.find(
      (write) => write.table === "mcpAgentToken",
    )?.payload as Record<string, unknown>;
    expect(tokenPayload.tokenHash).toBe(h.tokenHash);
    expect(tokenPayload.prefix).toBe(h.rawPrefix);
  });

  it("keeps high-risk telemetry and event metadata free of raw tokens", async () => {
    const db = makeTokenDb({
      results: [[], [], [], [tokenRow({ resourceMode: "account" })], []],
    });

    const created = await createPlatformPat(
      db as never,
      USER_ID,
      accountInput(),
    );
    expect(created.token).toBe(h.rawToken);

    expect(JSON.stringify(h.captureMcpTelemetry.mock.calls)).not.toContain(
      h.rawToken,
    );
    expect(
      JSON.stringify(h.recordPlatformSecurityEvent.mock.calls),
    ).not.toContain(h.rawToken);
    expect(
      JSON.stringify(h.recordPlatformSecurityEvent.mock.calls),
    ).not.toContain(h.secretSuffix);
    const eventInput = h.recordPlatformSecurityEvent.mock.calls[0]?.[1];
    expect(eventInput).toMatchObject({ tokenPrefix: h.rawPrefix });
  });

  it("never includes the raw token in the error when a later step fails", async () => {
    h.recordPlatformSecurityEvent.mockRejectedValueOnce(
      new Error("injected event insert failure"),
    );
    const db = makeTokenDb({
      results: [[], [], [], [{ id: SERVER_ID }], [tokenRow()], [], []],
    });

    let caught: unknown;
    try {
      await createPlatformPat(db as never, USER_ID, selectedInput());
    } catch (error) {
      caught = error;
    }

    const serialized = JSON.stringify({
      message: (caught as Error | undefined)?.message ?? null,
      stack: (caught as Error | undefined)?.stack ?? null,
      details: (caught as { details?: unknown } | undefined)?.details ?? null,
      cause: (caught as { cause?: unknown } | undefined)?.cause ?? null,
    });
    expect(serialized).not.toContain(h.rawToken);
    expect(serialized).not.toContain(h.secretSuffix);
  });

  it("keeps rotation lineage and event metadata free of raw tokens", async () => {
    const predecessor = tokenRow({ id: "mtk_pred", name: "Primary" });
    const successor = tokenRow({ id: "mtk_succ", name: "Successor" });
    const db = makeTokenDb({
      results: [
        [],
        [],
        [predecessor],
        [],
        [{ id: SERVER_ID }],
        [], // predecessor revoke update (runs before the successor insert)
        [successor],
        [],
        [],
      ],
    });

    const rotated = await rotatePlatformPat(db as never, USER_ID, {
      ...selectedInput("Successor"),
      tokenId: "mtk_pred",
    });
    expect(rotated.token).toBe(h.rawToken);

    const revokeUpdate = db.updated.find(
      (write) =>
        write.table === "mcpAgentToken" &&
        (write.payload as Record<string, unknown> | undefined)
          ?.replacedByTokenId === "mtk_succ",
    );
    expect(JSON.stringify(revokeUpdate?.payload)).not.toContain(h.rawToken);
    expect(
      JSON.stringify(h.recordPlatformSecurityEvent.mock.calls),
    ).not.toContain(h.rawToken);
  });

  it("returns an authentication principal without the raw token", async () => {
    const db = makeTokenDb({
      results: [
        [tokenRow()],
        [{ scope: "read" }],
        [{ serverId: SERVER_ID }],
        [],
      ],
    });

    const principal = await authenticatePlatformPat(db as never, h.rawToken);
    expect(principal.tokenPrefix).toBe(h.rawPrefix);
    const serialized = JSON.stringify(principal);
    expect(serialized).not.toContain(h.rawToken);
    expect(serialized).not.toContain(h.secretSuffix);
  });

  it("lists only safe prefixes, never raw tokens", async () => {
    const db = makeTokenDb({
      results: [
        [tokenRow()],
        [{ count: 1 }],
        [{ tokenId: "mtk_unit", scope: "read" }],
        [{ tokenId: "mtk_unit", serverId: SERVER_ID }],
      ],
    });

    const page = await listPlatformPats(db as never, USER_ID, {
      page: 1,
      pageSize: 20,
    });
    expect(page.items[0]?.prefix).toBe(h.rawPrefix);
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain(h.rawToken);
    expect(serialized).not.toContain(h.secretSuffix);
  });
});
