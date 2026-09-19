import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "../lib/app-error.js";

const tables = vi.hoisted(() => ({
  mcpAgentToken: {
    id: "mcp_agent_token.id",
    userId: "mcp_agent_token.user_id",
    serverId: "mcp_agent_token.server_id",
    kind: "mcp_agent_token.kind",
    name: "mcp_agent_token.name",
    tokenHash: "mcp_agent_token.token_hash",
    prefix: "mcp_agent_token.prefix",
    policyVersion: "mcp_agent_token.policy_version",
    resourceMode: "mcp_agent_token.resource_mode",
    expiresAt: "mcp_agent_token.expires_at",
    revokedAt: "mcp_agent_token.revoked_at",
    lastUsedAt: "mcp_agent_token.last_used_at",
  },
  mcpPlatformTokenScope: {
    tokenId: "mcp_platform_token_scope.token_id",
    scope: "mcp_platform_token_scope.scope",
  },
  mcpPlatformTokenServerGrant: {
    tokenId: "mcp_platform_token_server_grant.token_id",
    serverId: "mcp_platform_token_server_grant.server_id",
  },
  mcpPlatformSecurityEvent: {
    id: "mcp_platform_security_event.id",
  },
  mcpServer: {
    id: "mcp_server.id",
  },
  user: {
    id: "user.id",
    bannedAt: "user.banned_at",
  },
}));

const isUserBanned = vi.hoisted(() => vi.fn(async () => false));

vi.mock("@repo/db", () => tables);
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
vi.mock("../lib/user-access.js", () => ({ isUserBanned }));
vi.mock("./mcp-platform-step-up-service.js", () => ({
  consumePlatformStepUpGrant: vi.fn(),
}));
vi.mock("./mcp-platform-security-event-service.js", () => ({
  recordPlatformSecurityEvent: vi.fn(),
}));

import { authenticatePlatformPat } from "./mcp-platform-token-service.js";

type TokenRow = {
  id: string;
  userId: string;
  serverId: string | null;
  kind: string;
  name: string;
  tokenHash: string;
  prefix: string;
  policyVersion: number | null;
  resourceMode: string | null;
  replacesTokenId: string | null;
  replacedByTokenId: string | null;
  rotationMeta: Record<string, unknown> | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const TOKEN_ID = "mtk_platform";
const USER_ID = "usr_owner";

function platformToken(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    id: TOKEN_ID,
    userId: USER_ID,
    serverId: null,
    kind: "platform",
    name: "Agent",
    tokenHash: "stored-hash",
    prefix: "rmcp_abc",
    policyVersion: 1,
    resourceMode: "selected",
    replacesTokenId: null,
    replacedByTokenId: null,
    rotationMeta: null,
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function createChain(value: unknown, tables: unknown[]) {
  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol) {
      if (prop === "then") {
        return (
          resolve: (input: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(value).then(resolve, reject);
      }
      return (...args: unknown[]) => {
        if (prop === "from") tables.push(args[0]);
        return new Proxy({}, handler);
      };
    },
  };
  return new Proxy({}, handler);
}

function makeDb(selectResults: unknown[][]) {
  let index = 0;
  const selectedTables: unknown[] = [];
  const updatedValues: Array<Record<string, unknown>> = [];
  const take = () => createChain(selectResults[index++] ?? [], selectedTables);
  return {
    select: vi.fn(() => take()),
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updatedValues.push(payload);
        return createChain([], selectedTables);
      },
    })),
    selectedTables,
    updatedValues,
  };
}

function isInvalidToken(error: unknown): boolean {
  return (
    error instanceof AppError &&
    error.appCode === APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID
  );
}

async function expectInvalid(db: ReturnType<typeof makeDb>): Promise<void> {
  await expect(
    authenticatePlatformPat(db as never, "rmcp_raw_secret"),
  ).rejects.toSatisfy(isInvalidToken);
}

describe("authenticatePlatformPat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isUserBanned.mockResolvedValue(false);
  });

  const rejectionCases: Array<{
    label: string;
    results: unknown[][];
  }> = [
    { label: "an unknown token hash", results: [[]] },
    {
      label: "a server-audience token at the Platform boundary",
      results: [[platformToken({ kind: "server" })]],
    },
    {
      label: "a revoked Platform token",
      results: [
        [platformToken({ revokedAt: new Date("2026-01-02T00:00:00Z") })],
      ],
    },
    {
      label: "an expired Platform token",
      results: [[platformToken({ expiresAt: new Date(Date.now() - 60_000) })]],
    },
    {
      label: "a missing policy version",
      results: [[platformToken({ policyVersion: null })]],
    },
    {
      label: "an unsupported policy version",
      results: [[platformToken({ policyVersion: 2 })]],
    },
    {
      label: "a missing resource mode",
      results: [[platformToken({ resourceMode: null })]],
    },
    {
      label: "an unknown resource mode",
      results: [[platformToken({ resourceMode: "workspace" })]],
    },
    {
      label: "missing normalized scope rows",
      results: [[platformToken()], []],
    },
    {
      label: "duplicate normalized scope rows",
      results: [[platformToken()], [{ scope: "read" }, { scope: "read" }]],
    },
    {
      label: "an unknown normalized scope row",
      results: [[platformToken()], [{ scope: "admin" }]],
    },
    {
      label: "a dependency-invalid normalized scope row",
      results: [[platformToken()], [{ scope: "publish" }]],
    },
    {
      label: "a selected token with zero server grants",
      results: [
        [platformToken({ resourceMode: "selected" })],
        [{ scope: "read" }],
        [],
      ],
    },
    {
      label: "an account token that carries server grants",
      results: [
        [platformToken({ resourceMode: "account" })],
        [{ scope: "read" }],
        [{ serverId: "mcs_a" }],
      ],
    },
  ];

  it.each(rejectionCases)(
    "rejects $label as MCP_AGENT_TOKEN_INVALID without writing lastUsedAt",
    async ({ results }) => {
      const db = makeDb(results);
      await expectInvalid(db);
      expect(db.updatedValues).toHaveLength(0);
    },
  );

  it("does not consult normalized grant storage for malformed scopes", async () => {
    const db = makeDb([
      [platformToken()],
      [{ scope: "read" }, { scope: "read" }],
    ]);
    await expectInvalid(db);
    expect(db.selectedTables).toEqual([
      tables.mcpAgentToken,
      tables.mcpPlatformTokenScope,
    ]);
    expect(db.updatedValues).toHaveLength(0);
  });

  it("never broadens a selected token with zero grants into account-wide access", async () => {
    const db = makeDb([
      [platformToken({ resourceMode: "selected" })],
      [{ scope: "read" }],
      [],
    ]);
    await expectInvalid(db);
    expect(isUserBanned).not.toHaveBeenCalled();
    expect(db.updatedValues).toHaveLength(0);
  });

  it("rejects an account token that carries grants instead of treating it as selected", async () => {
    const db = makeDb([
      [platformToken({ resourceMode: "account" })],
      [{ scope: "read" }],
      [{ serverId: "mcs_a" }],
    ]);
    await expectInvalid(db);
    expect(isUserBanned).not.toHaveBeenCalled();
    expect(db.updatedValues).toHaveLength(0);
  });

  it("rejects a banned owner with ACCOUNT_SUSPENDED and still writes nothing", async () => {
    isUserBanned.mockResolvedValueOnce(true);
    const db = makeDb([
      [platformToken({ resourceMode: "selected" })],
      [{ scope: "read" }],
      [{ serverId: "mcs_a" }],
    ]);
    await expect(
      authenticatePlatformPat(db as never, "rmcp_raw_secret"),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AppError &&
        error.appCode === APP_ERROR_CODES.ACCOUNT_SUSPENDED,
    );
    expect(db.updatedValues).toHaveLength(0);
  });

  it("authenticates a valid selected token and touches only normalized storage", async () => {
    const db = makeDb([
      [platformToken({ resourceMode: "selected" })],
      [{ scope: "read" }],
      [{ serverId: "mcs_a" }, { serverId: "mcs_b" }],
    ]);

    const principal = await authenticatePlatformPat(
      db as never,
      "rmcp_raw_secret",
    );

    expect(principal).toMatchObject({
      tokenId: TOKEN_ID,
      userId: USER_ID,
      tokenName: "Agent",
      tokenPrefix: "rmcp_abc",
      policyVersion: 1,
      scopes: ["read"],
      resourceMode: "selected",
      allowedServerIds: ["mcs_a", "mcs_b"],
      expiresAt: null,
    });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(db.selectedTables).toEqual([
      tables.mcpAgentToken,
      tables.mcpPlatformTokenScope,
      tables.mcpPlatformTokenServerGrant,
    ]);
    expect(db.updatedValues).toEqual([{ lastUsedAt: expect.any(Date) }]);
  });

  it("authenticates a valid account token with no selected servers", async () => {
    const db = makeDb([
      [platformToken({ resourceMode: "account" })],
      [{ scope: "read" }],
      [],
    ]);

    const principal = await authenticatePlatformPat(
      db as never,
      "rmcp_raw_secret",
    );

    expect(principal.resourceMode).toBe("account");
    expect(principal.allowedServerIds).toEqual([]);
    expect(db.updatedValues).toHaveLength(1);
  });

  it("canonically sorts normalized scopes and never adds scopes", async () => {
    const db = makeDb([
      [platformToken({ resourceMode: "selected" })],
      [{ scope: "invoke" }, { scope: "read" }],
      [{ serverId: "mcs_a" }],
    ]);

    const principal = await authenticatePlatformPat(
      db as never,
      "rmcp_raw_secret",
    );

    expect(principal.scopes).toEqual(["read", "invoke"]);
    expect(principal.scopes).not.toContain("author");
    expect(principal.scopes).not.toContain("publish");
  });
});
