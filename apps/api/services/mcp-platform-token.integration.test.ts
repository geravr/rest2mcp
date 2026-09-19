import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES, MCP_MAX_ACTIVE_PLATFORM_TOKENS } from "@repo/core";
import { generateAuthId, schema, user } from "@repo/db";
import {
  authenticatePlatformPat,
  createPlatformPat,
  listPlatformPats,
  revokePlatformPat,
  rotatePlatformPat,
} from "./mcp-platform-token-service.js";
import {
  consumePlatformStepUpGrant,
  createPlatformStepUpGrant,
  verifyPlatformStepUpOtp,
} from "./mcp-platform-step-up-service.js";
import { validatePlatformGrantRequest } from "../lib/mcp-platform-principal.js";
import { createServerToken } from "./mcp-studio-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const SESSION_ID = "ses_integration";

describeIntegration("Platform PAT lifecycle", () => {
  const userId = generateAuthId("user");
  const serverId = `mcs_pat_${userId}`;
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 4 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "PAT Integration",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: "PAT Server",
      slug: serverId,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  function readOnlySelected() {
    return {
      name: "Inspect agent",
      scopes: ["read"],
      resourceMode: "selected" as const,
      serverIds: [serverId],
      sessionId: SESSION_ID,
    };
  }

  it("creates a read-only selected PAT and authenticates a principal", async () => {
    const created = await createPlatformPat(db as never, userId, {
      ...readOnlySelected(),
      sessionId: SESSION_ID,
    });
    expect(created.scopes).toEqual(["read"]);
    expect(created.resourceMode).toBe("selected");
    expect(typeof created.token).toBe("string");

    const principal = await authenticatePlatformPat(db as never, created.token);
    expect(principal.tokenId).toBe(created.id);
    expect(principal.allowedServerIds).toEqual([serverId]);
    expect(principal.scopes).toEqual(["read"]);

    await revokePlatformPat(db as never, userId, created.id);
  });

  it("issues independent PATs without revoking existing agents", async () => {
    const first = await createPlatformPat(db as never, userId, {
      ...readOnlySelected(),
      name: "Agent A",
    });
    const second = await createPlatformPat(db as never, userId, {
      ...readOnlySelected(),
      name: "Agent B",
    });

    const page = await listPlatformPats(db as never, userId, {
      page: 1,
      pageSize: 50,
    });
    const activeNames = page.items
      .filter((item) => item.revokedAt === null)
      .map((item) => item.name);
    expect(activeNames).toContain("Agent A");
    expect(activeNames).toContain("Agent B");

    await revokePlatformPat(db as never, userId, first.id);
    const after = await listPlatformPats(db as never, userId, {
      page: 1,
      pageSize: 50,
    });
    expect(
      after.items.find((item) => item.id === second.id)?.revokedAt,
    ).toBeNull();
  });

  it("lets only one concurrent rotation of the same token win", async () => {
    const observed = await createPlatformPat(db as never, userId, {
      ...readOnlySelected(),
      name: "Primary",
    });

    const outcomes = await Promise.allSettled([
      rotatePlatformPat(db as never, userId, {
        ...readOnlySelected(),
        name: "Successor A",
        tokenId: observed.id,
      }),
      rotatePlatformPat(db as never, userId, {
        ...readOnlySelected(),
        name: "Successor B",
        tokenId: observed.id,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
    });

    const active = await listPlatformPats(db as never, userId, {
      page: 1,
      pageSize: 50,
    });
    const successors = active.items.filter(
      (item) =>
        item.revokedAt === null &&
        (item.name === "Successor A" || item.name === "Successor B"),
    );
    expect(successors).toHaveLength(1);
  });

  it("requires a matching step-up grant for account-wide PATs", async () => {
    const grant = validatePlatformGrantRequest({
      scopes: ["read"],
      resourceMode: "account",
      serverIds: [],
    });

    await expect(
      createPlatformPat(db as never, userId, {
        name: "No step-up",
        scopes: ["read"],
        resourceMode: "account",
        sessionId: SESSION_ID,
      }),
    ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_STEP_UP_REQUIRED });

    await createPlatformStepUpGrant(db as never, {
      userId,
      sessionId: SESSION_ID,
      fingerprint: grant.fingerprint,
    });

    const created = await createPlatformPat(db as never, userId, {
      name: "Account-wide",
      scopes: ["read"],
      resourceMode: "account",
      sessionId: SESSION_ID,
    });
    expect(created.resourceMode).toBe("account");
  });

  it("allows multiple default-named server tokens (free-form names)", async () => {
    const first = await createServerToken(db as never, userId, serverId, 1);
    const second = await createServerToken(db as never, userId, serverId, 2);
    expect(first.name).toBe("Agent token");
    expect(second.name).toBe("Agent token");
    expect(first.id).not.toBe(second.id);
  });
});

describeIntegration(
  "Platform PAT concurrency and raw-token non-leakage",
  () => {
    const userId = generateAuthId("user");
    const serverId = `mcs_pat_conc_${userId}`;
    const sessionId = "ses_integration_concurrency";
    let client: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle<typeof schema>>;

    beforeAll(async () => {
      client = postgres(connectionString!, { max: 12 });
      db = drizzle(client, { schema, casing: "snake_case" });
      await db.insert(user).values({
        id: userId,
        name: "PAT Concurrency",
        email: `${userId}@example.com`,
        emailVerified: true,
      });
      await db.insert(schema.mcpServer).values({
        id: serverId,
        userId,
        name: "PAT Concurrency Server",
        slug: serverId,
        baseUrl: "https://api.example.com",
        allowedHosts: ["api.example.com"],
        status: "draft",
      });
    });

    beforeEach(async () => {
      await db
        .delete(schema.mcpPlatformSecurityEvent)
        .where(eq(schema.mcpPlatformSecurityEvent.userId, userId));
      await db
        .delete(schema.mcpPlatformStepUpGrant)
        .where(eq(schema.mcpPlatformStepUpGrant.userId, userId));
      await db
        .delete(schema.mcpAgentToken)
        .where(eq(schema.mcpAgentToken.userId, userId));
    });

    afterAll(async () => {
      await db.delete(user).where(eq(user.id, userId));
      await client.end();
    });

    function selectedInput(name: string) {
      return {
        name,
        scopes: ["read"],
        resourceMode: "selected" as const,
        serverIds: [serverId],
        sessionId,
      };
    }

    function accountInput(name: string) {
      return {
        name,
        scopes: ["read"],
        resourceMode: "account" as const,
        sessionId,
      };
    }

    it("enforces the active-token limit under concurrent issuance", async () => {
      const results = await Promise.allSettled(
        Array.from({ length: MCP_MAX_ACTIVE_PLATFORM_TOKENS + 2 }, (_, index) =>
          createPlatformPat(
            db as never,
            userId,
            selectedInput(`limit-${index}`),
          ),
        ),
      );

      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(MCP_MAX_ACTIVE_PLATFORM_TOKENS);
      expect(rejected).toHaveLength(2);
      for (const result of rejected) {
        expect(result.reason).toMatchObject({
          appCode: APP_ERROR_CODES.MCP_PAT_LIMIT_REACHED,
        });
      }

      const page = await listPlatformPats(db as never, userId, {
        page: 1,
        pageSize: 50,
      });
      expect(page.items.filter((item) => item.revokedAt === null)).toHaveLength(
        MCP_MAX_ACTIVE_PLATFORM_TOKENS,
      );
    });

    it("allows only one concurrent issuance for the same name", async () => {
      const results = await Promise.allSettled([
        createPlatformPat(db as never, userId, selectedInput("shared-name")),
        createPlatformPat(db as never, userId, selectedInput("shared-name")),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({
        appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
      });
    });

    it("consumes a step-up grant only once under concurrent high-risk issuance", async () => {
      const grant = validatePlatformGrantRequest({
        scopes: ["read"],
        resourceMode: "account",
        serverIds: [],
      });
      await createPlatformStepUpGrant(db as never, {
        userId,
        sessionId,
        fingerprint: grant.fingerprint,
      });

      const results = await Promise.allSettled([
        createPlatformPat(db as never, userId, accountInput("stepup-a")),
        createPlatformPat(db as never, userId, accountInput("stepup-b")),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({
        appCode: APP_ERROR_CODES.MCP_STEP_UP_EXPIRED,
      });
    });

    it("lets only one concurrent rotation of the same token succeed", async () => {
      const observed = await createPlatformPat(
        db as never,
        userId,
        selectedInput("rotation-origin"),
      );

      const results = await Promise.allSettled([
        rotatePlatformPat(db as never, userId, {
          ...selectedInput("rotation-a"),
          tokenId: observed.id,
        }),
        rotatePlatformPat(db as never, userId, {
          ...selectedInput("rotation-b"),
          tokenId: observed.id,
        }),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({
        appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
      });
    });

    it("serializes concurrent rotate and revoke on the same token", async () => {
      const observed = await createPlatformPat(
        db as never,
        userId,
        selectedInput("rotate-vs-revoke"),
      );

      const results = await Promise.allSettled([
        rotatePlatformPat(db as never, userId, {
          ...selectedInput("rotate-vs-revoke-successor"),
          tokenId: observed.id,
        }),
        revokePlatformPat(db as never, userId, observed.id),
      ]);

      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // Whichever loses the race reports a stable conflict: a lost rotation is
      // MCP_WRITE_CONFLICT, a lost revoke is MCP_AGENT_TOKEN_INVALID.
      expect([
        APP_ERROR_CODES.MCP_WRITE_CONFLICT,
        APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
      ]).toContain((rejected[0]!.reason as { appCode?: string }).appCode);

      // The losing operation must leave a fully consistent aggregate: either
      // the successor is active and the predecessor revoked, or the original
      // remains active and no successor exists.
      const page = await listPlatformPats(db as never, userId, {
        page: 1,
        pageSize: 50,
      });
      const observedRow = page.items.find((item) => item.id === observed.id);
      const successor = page.items.find(
        (item) => item.name === "rotate-vs-revoke-successor",
      );
      const active = page.items.filter((item) => item.revokedAt === null);
      // Either the rotation won (successor active + lineage) or the revoke won
      // (no successor, original revoked). Both leave a consistent aggregate.
      expect(observedRow!.revokedAt).not.toBeNull();
      if (successor) {
        expect(observedRow!.replacedByTokenId).toBe(successor.id);
        expect(active).toHaveLength(1);
        expect(active[0]!.id).toBe(successor.id);
      } else {
        expect(active).toHaveLength(0);
      }
    });

    it("rotates a token that keeps its own name", async () => {
      const observed = await createPlatformPat(
        db as never,
        userId,
        selectedInput("same-name"),
      );
      const successor = await rotatePlatformPat(db as never, userId, {
        ...selectedInput("same-name"),
        tokenId: observed.id,
      });
      expect(successor.name).toBe("same-name");

      const [predecessor] = await db
        .select()
        .from(schema.mcpAgentToken)
        .where(eq(schema.mcpAgentToken.id, observed.id));
      expect(predecessor!.revokedAt).not.toBeNull();
      expect(predecessor!.replacedByTokenId).toBe(successor.id);
    });

    it("does not count a rotated predecessor toward the active limit", async () => {
      const created = [] as { id: string }[];
      for (let index = 0; index < MCP_MAX_ACTIVE_PLATFORM_TOKENS; index += 1) {
        created.push(
          await createPlatformPat(
            db as never,
            userId,
            selectedInput(`fill-${index}`),
          ),
        );
      }

      const rotated = await rotatePlatformPat(db as never, userId, {
        ...selectedInput("fill-rotated"),
        tokenId: created[0]!.id,
      });
      expect(rotated.token).toMatch(/^rmcp_/);

      await expect(
        createPlatformPat(db as never, userId, selectedInput("overflow")),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_PAT_LIMIT_REACHED,
      });
    });

    it("persists only a hash and safe prefix, never the raw token", async () => {
      const created = await createPlatformPat(
        db as never,
        userId,
        selectedInput("no-leak"),
      );
      const principal = await authenticatePlatformPat(
        db as never,
        created.token,
      );
      expect(principal.tokenId).toBe(created.id);

      const [row] = await db
        .select()
        .from(schema.mcpAgentToken)
        .where(eq(schema.mcpAgentToken.id, created.id));
      expect(row).toBeDefined();
      expect(row!.tokenHash).not.toBe(created.token);
      expect(row!.tokenHash).not.toContain(created.token);
      expect(row!.prefix).toBe(created.token.slice(0, row!.prefix.length));

      const secretSuffix = created.token.slice(row!.prefix.length);
      expect(JSON.stringify(row)).not.toContain(created.token);
      expect(JSON.stringify(row)).not.toContain(secretSuffix);

      const events = await db
        .select()
        .from(schema.mcpPlatformSecurityEvent)
        .where(eq(schema.mcpPlatformSecurityEvent.tokenId, created.id));
      expect(JSON.stringify(events)).not.toContain(created.token);
      expect(JSON.stringify(events)).not.toContain(secretSuffix);
    });

    it("persists no raw rotation token in predecessor lineage rows", async () => {
      const created = await createPlatformPat(
        db as never,
        userId,
        selectedInput("lineage-origin"),
      );
      const rotated = await rotatePlatformPat(db as never, userId, {
        ...selectedInput("lineage-successor"),
        tokenId: created.id,
      });

      const [predecessor] = await db
        .select()
        .from(schema.mcpAgentToken)
        .where(eq(schema.mcpAgentToken.id, created.id));
      expect(predecessor!.replacedByTokenId).toBe(rotated.id);
      const secretSuffix = rotated.token.slice(predecessor!.prefix.length);
      expect(JSON.stringify(predecessor)).not.toContain(rotated.token);
      expect(JSON.stringify(predecessor)).not.toContain(secretSuffix);
    });
  },
);

describeIntegration(
  "Platform step-up, rotation isolation, and OTP lockout",
  () => {
    const userId = generateAuthId("user");
    const otherUserId = generateAuthId("user");
    const serverId = `mcs_stepup_${userId}`;
    const otherServerId = `mcs_stepup_${otherUserId}`;
    const stepUpSession = "ses_stepup_a";
    const otherSession = "ses_stepup_b";
    let client: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle<typeof schema>>;

    beforeAll(async () => {
      client = postgres(connectionString!, { max: 4 });
      db = drizzle(client, { schema, casing: "snake_case" });
      await db.insert(user).values([
        {
          id: userId,
          name: "Step-up Owner",
          email: `${userId}@example.com`,
          emailVerified: true,
        },
        {
          id: otherUserId,
          name: "Other Owner",
          email: `${otherUserId}@example.com`,
          emailVerified: true,
        },
      ]);
      await db.insert(schema.mcpServer).values([
        {
          id: serverId,
          userId,
          name: "Step-up Server",
          slug: serverId,
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
          status: "draft",
        },
        {
          id: otherServerId,
          userId: otherUserId,
          name: "Other Server",
          slug: otherServerId,
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
          status: "draft",
        },
      ]);
    });

    afterAll(async () => {
      await db.delete(user).where(eq(user.id, userId));
      await db.delete(user).where(eq(user.id, otherUserId));
      await client.end();
    });

    function fingerprintFor(
      resourceMode: "selected" | "account",
      ids: string[],
    ) {
      return validatePlatformGrantRequest({
        scopes: ["read"],
        resourceMode,
        serverIds: ids,
      }).fingerprint;
    }

    const otpIdentifier = () => `platform-stepup-otp-${userId}`;

    async function seedOtp(code: string) {
      await db
        .delete(schema.verification)
        .where(eq(schema.verification.identifier, otpIdentifier()));
      await db.insert(schema.verification).values({
        identifier: otpIdentifier(),
        value: `${code}:0`,
        expiresAt: new Date(Date.now() + 60_000),
      });
    }

    it("rejects a step-up grant for a different fingerprint or session", async () => {
      const fingerprintA = fingerprintFor("account", []);
      const fingerprintB = fingerprintFor("selected", [serverId]);
      await createPlatformStepUpGrant(db as never, {
        userId,
        sessionId: stepUpSession,
        fingerprint: fingerprintA,
      });

      // Different fingerprint (broader/narrower requested grant).
      await expect(
        db.transaction((tx) =>
          consumePlatformStepUpGrant(tx as never, {
            userId,
            sessionId: stepUpSession,
            fingerprint: fingerprintB,
          }),
        ),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_STEP_UP_REQUIRED,
      });

      // Same fingerprint but a different session must not reveal or consume it.
      await expect(
        db.transaction((tx) =>
          consumePlatformStepUpGrant(tx as never, {
            userId,
            sessionId: otherSession,
            fingerprint: fingerprintA,
          }),
        ),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_STEP_UP_REQUIRED,
      });

      // The matching grant consumes exactly once.
      await db.transaction((tx) =>
        consumePlatformStepUpGrant(tx as never, {
          userId,
          sessionId: stepUpSession,
          fingerprint: fingerprintA,
        }),
      );
      await expect(
        db.transaction((tx) =>
          consumePlatformStepUpGrant(tx as never, {
            userId,
            sessionId: stepUpSession,
            fingerprint: fingerprintA,
          }),
        ),
      ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_STEP_UP_EXPIRED });
    });

    it("locks out after three wrong step-up OTP attempts", async () => {
      await seedOtp("123456");
      expect(
        await verifyPlatformStepUpOtp(db as never, { userId, otp: "000000" }),
      ).toBe(false);
      expect(
        await verifyPlatformStepUpOtp(db as never, { userId, otp: "000000" }),
      ).toBe(false);
      expect(
        await verifyPlatformStepUpOtp(db as never, { userId, otp: "000000" }),
      ).toBe(false);
      // Attempts exhausted: even the correct code is rejected and the row is gone.
      expect(
        await verifyPlatformStepUpOtp(db as never, { userId, otp: "123456" }),
      ).toBe(false);
      const rows = await db
        .select()
        .from(schema.verification)
        .where(eq(schema.verification.identifier, otpIdentifier()));
      expect(rows).toHaveLength(0);
    });

    it("accepts the correct step-up OTP once and clears it", async () => {
      await seedOtp("654321");
      expect(
        await verifyPlatformStepUpOtp(db as never, { userId, otp: "654321" }),
      ).toBe(true);
      expect(
        await verifyPlatformStepUpOtp(db as never, { userId, otp: "654321" }),
      ).toBe(false);
    });

    it("rejects rotating or revoking another owner's token", async () => {
      const foreign = await createPlatformPat(db as never, otherUserId, {
        name: "Foreign",
        scopes: ["read"],
        resourceMode: "selected",
        serverIds: [otherServerId],
        sessionId: otherSession,
      });

      await expect(
        rotatePlatformPat(db as never, userId, {
          name: "Stolen",
          scopes: ["read"],
          resourceMode: "selected",
          serverIds: [serverId],
          sessionId: stepUpSession,
          tokenId: foreign.id,
        }),
      ).rejects.toMatchObject({ appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT });

      await expect(
        revokePlatformPat(db as never, userId, foreign.id),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_AGENT_TOKEN_INVALID,
      });

      // The foreign token is untouched by either attempt.
      const principal = await authenticatePlatformPat(
        db as never,
        foreign.token,
      );
      expect(principal.userId).toBe(otherUserId);
    });
  },
);
