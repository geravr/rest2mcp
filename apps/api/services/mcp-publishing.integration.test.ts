import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import {
  generateAuthId,
  mcpServerRevision,
  mcpServerRevisionTool,
  schema,
  user,
} from "@repo/db";
import { encryptCredential } from "../lib/mcp-crypto.js";
import { loadExecutionSnapshot } from "./mcp-executor-service.js";
import {
  cleanupSupersededRevisions,
  getPublishedToolIdentity,
  getRevisionDetail,
  listRevisionHistory,
  previewPublish,
  publishServer,
  restoreRevisionToDraft,
} from "./mcp-publishing-service.js";
import { deleteVariable, updateVariable } from "./mcp-studio-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const CREDENTIAL_SECRET = "s".repeat(32);
const DAY_MS = 24 * 60 * 60 * 1000;

const plainDefinition = {
  version: 1 as const,
  pathSegments: [
    { id: "path_1", value: { kind: "literal" as const, value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" as const },
  agentInputs: [],
};

function secretDefinition(secretId: string, configId: string) {
  return {
    ...plainDefinition,
    query: [
      {
        id: "q_region",
        name: "region",
        value: {
          kind: "serverValue" as const,
          serverValueId: configId,
        },
      },
    ],
    headers: [
      {
        id: "hdr_auth",
        name: "Authorization",
        value: {
          kind: "serverValue" as const,
          serverValueId: secretId,
          prefix: "Bearer ",
        },
      },
    ],
  };
}

describeIntegration("mcp publishing service", () => {
  const userId = generateAuthId("user");
  const otherUserId = generateAuthId("user");
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let asDb: Parameters<typeof previewPublish>[0];

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 6 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values([
      {
        id: userId,
        name: "Publishing Integration",
        email: `${userId}@example.com`,
        emailVerified: true,
      },
      {
        id: otherUserId,
        name: "Other User",
        email: `${otherUserId}@example.com`,
        emailVerified: true,
      },
    ]);
    asDb = db as unknown as Parameters<typeof previewPublish>[0];
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await db.delete(user).where(eq(user.id, otherUserId));
    await client.end();
  });

  async function seedServer(serverId: string): Promise<{ toolId: string }> {
    const secretId = `${serverId}_secret`;
    const toolId = `${serverId}_tool`;
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: "Publishing",
      slug: serverId,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
    await db.insert(schema.mcpServerVariable).values([
      {
        id: `${serverId}_config`,
        serverId,
        name: "region",
        kind: "config",
        owner: "manual",
        isSecret: false,
        value: "mx",
      },
      {
        id: secretId,
        serverId,
        name: "api_token",
        kind: "secret",
        owner: "manual",
        isSecret: true,
        ciphertext: encryptCredential("token-v1", CREDENTIAL_SECRET),
      },
    ]);
    await db.insert(schema.mcpTool).values({
      id: toolId,
      serverId,
      name: "list_contacts",
      title: "List contacts",
      description: "List contacts.",
      method: "GET",
      pathTemplate: "/contacts",
      requestDefinition: secretDefinition(secretId, `${serverId}_config`),
      allowMutation: false,
      enabled: true,
      source: "manual",
    });
    return { toolId };
  }

  function publishInput(serverId: string, publishRequestId: string) {
    return (async () => {
      const preview = await previewPublish(asDb, userId, serverId);
      return {
        preview,
        input: {
          userId,
          serverId,
          expectedDraftRevision: preview.draftRevision,
          expectedPublishedRevisionId: preview.publishedRevisionId,
          publishRequestId,
          candidateFingerprint: preview.candidateFingerprint,
          acknowledgedWarningCodes: preview.warningCodes,
          actorSource: "studio" as const,
          note: null,
        },
      };
    })();
  }

  async function publishOnce(serverId: string, publishRequestId: string) {
    const { preview, input } = await publishInput(serverId, publishRequestId);
    const result = await publishServer(asDb, input);
    return { preview, result };
  }

  async function readServer(serverId: string) {
    const [server] = await db
      .select()
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    return server;
  }

  async function revisionCount(serverId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(schema.mcpServerRevision)
      .where(eq(schema.mcpServerRevision.serverId, serverId));
    return row?.value ?? 0;
  }

  describe("publish transactions", () => {
    it("lets only one of two concurrent publishers win from the same revisions", async () => {
      const serverId = "mcs_pub_concurrent";
      await seedServer(serverId);
      const { input } = await publishInput(serverId, "req_concurrent_a");

      const outcomes = await Promise.allSettled([
        publishServer(asDb, input),
        publishServer(asDb, { ...input, publishRequestId: "req_concurrent_b" }),
      ]);
      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter(
        (outcome) => outcome.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = (rejected[0] as PromiseRejectedResult).reason as {
        appCode?: string;
      };
      expect([
        APP_ERROR_CODES.MCP_PUBLISH_STALE_REVISION,
        APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT,
        APP_ERROR_CODES.MCP_PUBLISH_NO_CHANGES,
      ]).toContain(reason.appCode);
      expect(await revisionCount(serverId)).toBe(1);
    });

    it("rejects a publish when the candidate changed after preview", async () => {
      const serverId = "mcs_pub_candidate_changed";
      const { toolId } = await seedServer(serverId);
      const { input } = await publishInput(serverId, "req_candidate_changed");
      await db
        .update(schema.mcpTool)
        .set({ description: "Changed after preview." })
        .where(eq(schema.mcpTool.id, toolId));

      await expect(publishServer(asDb, input)).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_CANDIDATE_CHANGED,
      });
      const server = await readServer(serverId);
      expect(server?.publishedRevisionId).toBeNull();
      expect(await revisionCount(serverId)).toBe(0);
    });

    it("rejects a no-op publish identical to the active revision", async () => {
      const serverId = "mcs_pub_no_changes";
      await seedServer(serverId);
      const { result } = await publishOnce(serverId, "req_noop_1");
      const { preview, input } = await publishInput(serverId, "req_noop_2");
      expect(preview.dirty).toBe(false);
      await expect(
        publishServer(asDb, {
          ...input,
          expectedPublishedRevisionId: result.revisionId,
        }),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_NO_CHANGES,
      });
      expect(await revisionCount(serverId)).toBe(1);
    });

    it("returns the committed revision for an idempotent retry", async () => {
      const serverId = "mcs_pub_idempotent";
      await seedServer(serverId);
      const { input } = await publishInput(serverId, "req_idempotent");
      const first = await publishServer(asDb, input);
      const retry = await publishServer(asDb, input);
      expect(retry.idempotent).toBe(true);
      expect(retry.revisionId).toBe(first.revisionId);
      expect(retry.revisionNumber).toBe(first.revisionNumber);
      expect(await revisionCount(serverId)).toBe(1);
    });

    it("rejects a reused request id with different content", async () => {
      const serverId = "mcs_pub_request_conflict";
      await seedServer(serverId);
      const { input } = await publishInput(serverId, "req_conflict");
      await publishServer(asDb, input);
      await expect(
        publishServer(asDb, {
          ...input,
          candidateFingerprint: "sha256:different-content",
        }),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_IDEMPOTENCY_CONFLICT,
      });
      expect(await revisionCount(serverId)).toBe(1);
    });

    it("binds warning acknowledgement to the candidate fingerprint", async () => {
      const serverId = "mcs_pub_warnings";
      const { toolId } = await seedServer(serverId);
      const { input } = await publishInput(serverId, "req_warnings");

      await expect(
        publishServer(asDb, { ...input, acknowledgedWarningCodes: [] }),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_WARNINGS_UNACKNOWLEDGED,
      });

      await db
        .update(schema.mcpTool)
        .set({ description: "Changed after acknowledgement." })
        .where(eq(schema.mcpTool.id, toolId));
      await expect(publishServer(asDb, input)).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_CANDIDATE_CHANGED,
      });

      const fresh = await publishInput(serverId, "req_warnings_fresh");
      const result = await publishServer(asDb, fresh.input);
      expect(result.idempotent).toBe(false);
      expect(await revisionCount(serverId)).toBe(1);
    });

    it("rolls back the transaction on a partial insert failure", async () => {
      const serverId = "mcs_pub_rollback";
      await seedServer(serverId);
      const { input } = await publishInput(serverId, "req_rollback");

      type PublishingDb = Parameters<typeof publishServer>[0];
      const failingDb = new Proxy(asDb, {
        get(object, property, receiver) {
          if (property === "transaction") {
            const transaction = Reflect.get(object, property, receiver) as (
              callback: (tx: unknown) => unknown,
              options?: unknown,
            ) => unknown;
            return (callback: (tx: unknown) => unknown, options?: unknown) =>
              transaction.call(
                object,
                (tx: unknown) => callback(txThatFailsOnToolInsert(tx)),
                options,
              );
          }
          return Reflect.get(object, property, receiver);
        },
      }) as PublishingDb;

      await expect(publishServer(failingDb, input)).rejects.toThrow(
        "injected publish failure",
      );
      const server = await readServer(serverId);
      expect(server?.publishedRevisionId).toBeNull();
      expect(server?.draftRevision).toBe(1);
      expect(await revisionCount(serverId)).toBe(0);
    });
  });

  describe("secret semantics", () => {
    it("applies secret rotation immediately without changing revision identity", async () => {
      const serverId = "mcs_secret_rotation";
      await seedServer(serverId);
      const { result } = await publishOnce(serverId, "req_secret_rotation");
      const secretId = `${serverId}_secret`;

      const before = await loadExecutionSnapshot(asDb, {
        serverId,
        credentialSecret: CREDENTIAL_SECRET,
      });
      expect(before?.serverValues.get(secretId)?.value).toBe("token-v1");

      await db
        .update(schema.mcpServerVariable)
        .set({ ciphertext: encryptCredential("token-v2", CREDENTIAL_SECRET) })
        .where(eq(schema.mcpServerVariable.id, secretId));

      const after = await loadExecutionSnapshot(asDb, {
        serverId,
        credentialSecret: CREDENTIAL_SECRET,
      });
      expect(after?.publishedRevisionId).toBe(result.revisionId);
      expect(after?.revisionNumber).toBe(result.revisionNumber);
      expect(after?.serverValues.get(secretId)?.value).toBe("token-v2");

      const preview = await previewPublish(asDb, userId, serverId);
      expect(preview.dirty).toBe(false);
      expect(preview.publishedRevisionId).toBe(result.revisionId);
    });

    it("blocks deleting a secret referenced by the active revision", async () => {
      const serverId = "mcs_secret_delete";
      await seedServer(serverId);
      await publishOnce(serverId, "req_secret_delete");
      const server = await readServer(serverId);

      await expect(
        deleteVariable(
          db as unknown as Parameters<typeof deleteVariable>[0],
          userId,
          serverId,
          "api_token",
          server!.configRevision,
        ),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_VALUE_IN_USE,
      });
    });

    it("flags a historical revision whose secret slot was removed", async () => {
      const serverId = "mcs_secret_historical";
      const { toolId } = await seedServer(serverId);
      const { result: revision } = await publishOnce(
        serverId,
        "req_secret_historical_1",
      );

      await db
        .update(schema.mcpTool)
        .set({ requestDefinition: plainDefinition })
        .where(eq(schema.mcpTool.id, toolId));

      // The draft no longer references the secret, but the active revision
      // still does: deletion must be blocked until a new revision supersedes it.
      const beforeDelete = await readServer(serverId);
      await expect(
        deleteVariable(
          db as unknown as Parameters<typeof deleteVariable>[0],
          userId,
          serverId,
          "api_token",
          beforeDelete!.configRevision,
        ),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_ACTIVE_SECRET_IN_USE,
      });

      await publishOnce(serverId, "req_secret_historical_2");

      const afterPublish = await readServer(serverId);
      await deleteVariable(
        db as unknown as Parameters<typeof deleteVariable>[0],
        userId,
        serverId,
        "api_token",
        afterPublish!.configRevision,
      );

      const beforeRestore = await readServer(serverId);
      const restored = await restoreRevisionToDraft(asDb, {
        userId,
        serverId,
        revisionId: revision.revisionId,
        expectedRevision: beforeRestore!.configRevision,
        expectedDraftRevision: beforeRestore!.draftRevision,
      });
      expect(restored.missingSecretCount).toBe(1);

      const detail = await getRevisionDetail(
        asDb,
        userId,
        serverId,
        revision.revisionId,
      );
      expect(detail.missingSecretCount).toBe(1);
      expect(detail.configs.find((config) => config.isSecret)?.available).toBe(
        false,
      );

      const secretRows = await db
        .select()
        .from(schema.mcpServerVariable)
        .where(
          and(
            eq(schema.mcpServerVariable.serverId, serverId),
            eq(schema.mcpServerVariable.name, "api_token"),
          ),
        );
      expect(secretRows).toHaveLength(0);

      const preview = await previewPublish(asDb, userId, serverId);
      expect(preview.ready).toBe(false);
      const blocking = preview.errors.find(
        (issue) => issue.toolName === "list_contacts",
      );
      expect(blocking).toBeDefined();
      expect(blocking?.message).toMatch(/no longer exists/);
    });

    it("resolves published config values from the revision snapshot", async () => {
      const serverId = "mcs_config_snapshot";
      await seedServer(serverId);
      await publishOnce(serverId, "req_config_snapshot");
      const configId = `${serverId}_config`;

      await db
        .update(schema.mcpServerVariable)
        .set({ value: "draft-mutated" })
        .where(eq(schema.mcpServerVariable.id, configId));

      const snapshot = await loadExecutionSnapshot(asDb, {
        serverId,
        credentialSecret: CREDENTIAL_SECRET,
      });
      expect(snapshot?.serverValues.get(configId)?.value).toBe("mx");
    });

    it("blocks converting a secret referenced by the active revision to a config", async () => {
      const serverId = "mcs_secret_convert";
      await seedServer(serverId);
      await publishOnce(serverId, "req_secret_convert");
      const server = await readServer(serverId);

      await expect(
        updateVariable(
          db as unknown as Parameters<typeof updateVariable>[0],
          userId,
          serverId,
          "api_token",
          {
            expectedRevision: server!.configRevision,
            isSecret: false,
            value: "plaintext",
          },
          CREDENTIAL_SECRET,
        ),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_ACTIVE_SECRET_IN_USE,
      });
    });

    it("classifies platform invocation identity from the active revision, not the draft", async () => {
      const serverId = "mcs_published_identity";
      const { toolId } = await seedServer(serverId);
      await publishOnce(serverId, "req_published_identity");

      // A destructive draft edit must not change published authority.
      await db
        .update(schema.mcpTool)
        .set({ method: "DELETE", allowMutation: true })
        .where(eq(schema.mcpTool.id, toolId));

      await expect(
        getPublishedToolIdentity(
          asDb,
          userId,
          serverId,
          toolId,
          CREDENTIAL_SECRET,
        ),
      ).resolves.toMatchObject({ name: "list_contacts", method: "GET" });
    });
  });

  describe("history and restore", () => {
    async function publishRevisions(
      serverId: string,
      toolId: string,
      count: number,
    ): Promise<void> {
      await seedServer(serverId);
      for (let index = 1; index <= count; index += 1) {
        if (index > 1) {
          await db
            .update(schema.mcpTool)
            .set({ description: `Revision ${index}.` })
            .where(eq(schema.mcpTool.id, toolId));
        }
        await publishOnce(serverId, `req_history_${index}`);
      }
    }

    it("paginates history with descending order and owner scoping", async () => {
      const serverId = "mcs_history_paging";
      await publishRevisions(serverId, `${serverId}_tool`, 12);

      const page1 = await listRevisionHistory(asDb, userId, serverId, {
        page: 1,
        pageSize: 10,
      });
      expect(page1.total).toBe(12);
      expect(page1.items).toHaveLength(10);
      expect(page1.items.map((item) => item.revisionNumber)).toEqual([
        12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
      ]);
      expect(page1.items[0]?.isActive).toBe(true);
      expect(page1.items[1]?.isActive).toBe(false);

      const page2 = await listRevisionHistory(asDb, userId, serverId, {
        page: 2,
        pageSize: 10,
      });
      expect(page2.items.map((item) => item.revisionNumber)).toEqual([2, 1]);

      await expect(
        listRevisionHistory(asDb, otherUserId, serverId, {
          page: 1,
          pageSize: 20,
        }),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_SERVER_NOT_FOUND,
      });
    });

    it("restores to the draft without changing the active pointer or secrets", async () => {
      const serverId = "mcs_history_restore";
      const { toolId } = await seedServer(serverId);
      const first = await publishOnce(serverId, "req_restore_1");
      await db
        .update(schema.mcpTool)
        .set({ description: "Second revision." })
        .where(eq(schema.mcpTool.id, toolId));
      const second = await publishOnce(serverId, "req_restore_2");

      const tokenId = `${serverId}_token`;
      await db.insert(schema.mcpAgentToken).values({
        id: tokenId,
        userId,
        serverId,
        kind: "server",
        name: "primary",
        tokenHash: `${serverId}_hash`,
        prefix: "mtk_test",
      });
      const before = await readServer(serverId);
      const [secretBefore] = await db
        .select()
        .from(schema.mcpServerVariable)
        .where(eq(schema.mcpServerVariable.id, `${serverId}_secret`));

      const restored = await restoreRevisionToDraft(asDb, {
        userId,
        serverId,
        revisionId: first.result.revisionId,
        expectedRevision: before!.configRevision,
        expectedDraftRevision: before!.draftRevision,
      });

      const after = await readServer(serverId);
      expect(after?.publishedRevisionId).toBe(second.result.revisionId);
      expect(after?.status).toBe(before?.status);
      expect(after?.draftRevision).toBe(before!.draftRevision + 1);
      expect(after?.configRevision).toBe(before!.configRevision + 1);
      expect(restored.draftRevision).toBe(before!.draftRevision + 1);

      const [secretAfter] = await db
        .select()
        .from(schema.mcpServerVariable)
        .where(eq(schema.mcpServerVariable.id, `${serverId}_secret`));
      expect(secretAfter?.ciphertext).toBe(secretBefore?.ciphertext);

      const [token] = await db
        .select()
        .from(schema.mcpAgentToken)
        .where(eq(schema.mcpAgentToken.id, tokenId));
      expect(token?.revokedAt).toBeNull();

      const [restoredTool] = await db
        .select()
        .from(schema.mcpTool)
        .where(
          and(
            eq(schema.mcpTool.serverId, serverId),
            eq(schema.mcpTool.id, toolId),
          ),
        );
      expect(restoredTool).toBeDefined();
    });

    it("rejects a stale restore", async () => {
      const serverId = "mcs_history_stale";
      const { toolId } = await seedServer(serverId);
      const first = await publishOnce(serverId, "req_stale_1");
      await db
        .update(schema.mcpTool)
        .set({ description: "Second revision." })
        .where(eq(schema.mcpTool.id, toolId));
      await publishOnce(serverId, "req_stale_2");
      const server = await readServer(serverId);

      await expect(
        restoreRevisionToDraft(asDb, {
          userId,
          serverId,
          revisionId: first.result.revisionId,
          expectedRevision: server!.configRevision,
          expectedDraftRevision: server!.draftRevision + 5,
        }),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_PUBLISH_STALE_DRAFT,
      });

      await expect(
        restoreRevisionToDraft(asDb, {
          userId,
          serverId,
          revisionId: first.result.revisionId,
          expectedRevision: server!.configRevision + 5,
          expectedDraftRevision: server!.draftRevision,
        }),
      ).rejects.toMatchObject({
        appCode: APP_ERROR_CODES.MCP_WRITE_CONFLICT,
      });
    });

    it("retains the active revision plus the 20 newest and deletes only old superseded ones", async () => {
      const serverId = "mcs_retention";
      const now = new Date();
      await db.insert(schema.mcpServer).values({
        id: serverId,
        userId,
        name: "Retention",
        slug: serverId,
        baseUrl: "https://api.example.com",
        allowedHosts: ["api.example.com"],
        status: "live",
      });

      const revisionIds: string[] = [];
      for (let index = 1; index <= 25; index += 1) {
        const id = `${serverId}_rev_${index}`;
        revisionIds.push(id);
        const createdAt = new Date(
          index <= 5
            ? now.getTime() - 200 * DAY_MS
            : now.getTime() - 10 * DAY_MS,
        );
        await db.insert(schema.mcpServerRevision).values({
          id,
          serverId,
          revisionNumber: index,
          sourceDraftRevision: 1,
          candidateFingerprint: `cand_${index}`,
          contractFingerprint: `contract_${index}`,
          schemaVersion: 1,
          compilerVersion: "1",
          name: "Retention",
          baseUrl: "https://api.example.com",
          allowedHosts: ["api.example.com"],
          publishRequestId: `req_retention_${index}`,
          actorSource: "studio",
          createdAt,
        });
      }
      await db
        .update(schema.mcpServer)
        .set({ publishedRevisionId: revisionIds[0]! })
        .where(eq(schema.mcpServer.id, serverId));
      await db.insert(schema.mcpServerRevisionTool).values({
        revisionId: `${serverId}_rev_3`,
        serverId,
        sourceToolId: `${serverId}_rev_3_tool`,
        name: "old_tool",
        method: "GET",
        pathTemplate: "/old",
        allowMutation: false,
        enabled: true,
        source: "manual",
        toolOrder: 0,
      });
      await db.insert(schema.mcpServerRevisionTool).values({
        revisionId: `${serverId}_rev_10`,
        serverId,
        sourceToolId: `${serverId}_rev_10_tool`,
        name: "kept_tool",
        method: "GET",
        pathTemplate: "/kept",
        allowMutation: false,
        enabled: true,
        source: "manual",
        toolOrder: 0,
      });

      const dryRun = await cleanupSupersededRevisions(asDb, {
        now,
        retentionDays: 90,
        minimumRetained: 20,
        dryRun: true,
      });
      expect(dryRun.deletedRevisions).toBeGreaterThanOrEqual(4);

      const result = await cleanupSupersededRevisions(asDb, {
        now,
        retentionDays: 90,
        minimumRetained: 20,
      });
      expect(result.deletedRevisions).toBeGreaterThanOrEqual(4);

      const remaining = await db
        .select({ id: mcpServerRevision.id })
        .from(mcpServerRevision)
        .where(eq(mcpServerRevision.serverId, serverId))
        .orderBy(desc(mcpServerRevision.revisionNumber));
      expect(remaining).toHaveLength(21);
      expect(remaining.map((row) => row.id)).toContain(`${serverId}_rev_1`);
      expect(remaining.map((row) => row.id)).toContain(`${serverId}_rev_25`);
      for (const index of [2, 3, 4, 5]) {
        expect(remaining.map((row) => row.id)).not.toContain(
          `${serverId}_rev_${index}`,
        );
      }

      const orphanChildren = await db
        .select({ id: mcpServerRevisionTool.id })
        .from(mcpServerRevisionTool)
        .where(eq(mcpServerRevisionTool.revisionId, `${serverId}_rev_3`));
      expect(orphanChildren).toHaveLength(0);
      const keptChildren = await db
        .select({ id: mcpServerRevisionTool.id })
        .from(mcpServerRevisionTool)
        .where(eq(mcpServerRevisionTool.revisionId, `${serverId}_rev_10`));
      expect(keptChildren).toHaveLength(1);
    });
  });

  describe("revision persistence constraints", () => {
    async function insertRevision(
      serverId: string,
      revisionNumber: number,
      publishRequestId: string,
    ) {
      await db.insert(schema.mcpServerRevision).values({
        id: `${serverId}_rev_${revisionNumber}`,
        serverId,
        revisionNumber,
        sourceDraftRevision: 1,
        candidateFingerprint: `cand_${revisionNumber}`,
        contractFingerprint: `contract_${revisionNumber}`,
        schemaVersion: 1,
        compilerVersion: "1",
        name: "Constraints",
        baseUrl: "https://api.example.com",
        allowedHosts: ["api.example.com"],
        publishRequestId,
        actorSource: "studio",
      });
    }

    it("gives retained servers a null active pointer and draft revision 1", async () => {
      const serverId = "mcs_constraints_defaults";
      await db.insert(schema.mcpServer).values({
        id: serverId,
        userId,
        name: "Defaults",
        slug: serverId,
        baseUrl: "https://api.example.com",
        allowedHosts: ["api.example.com"],
        status: "draft",
      });
      const server = await readServer(serverId);
      expect(server?.publishedRevisionId).toBeNull();
      expect(server?.draftRevision).toBe(1);
    });

    it("cascades revisions and children when the owning server is deleted", async () => {
      const serverId = "mcs_constraints_cascade";
      await seedServer(serverId);
      await insertRevision(serverId, 1, "req_cascade_1");
      await db.insert(schema.mcpServerRevisionTool).values({
        revisionId: `${serverId}_rev_1`,
        serverId,
        sourceToolId: `${serverId}_snapshot_tool`,
        name: "snapshot_tool",
        method: "GET",
        pathTemplate: "/snapshot",
        allowMutation: false,
        enabled: true,
        source: "manual",
        toolOrder: 0,
      });

      await db
        .delete(schema.mcpServer)
        .where(eq(schema.mcpServer.id, serverId));

      const revisions = await db
        .select({ id: mcpServerRevision.id })
        .from(mcpServerRevision)
        .where(eq(mcpServerRevision.serverId, serverId));
      expect(revisions).toHaveLength(0);
      const tools = await db
        .select({ id: mcpServerRevisionTool.id })
        .from(mcpServerRevisionTool)
        .where(eq(mcpServerRevisionTool.serverId, serverId));
      expect(tools).toHaveLength(0);
    });

    it("enforces monotonic per-server revision numbers", async () => {
      const serverId = "mcs_constraints_numbering";
      await seedServer(serverId);
      await insertRevision(serverId, 1, "req_numbering_1");
      await expect(
        insertRevision(serverId, 1, "req_numbering_duplicate"),
      ).rejects.toThrow();

      const otherServerId = "mcs_constraints_numbering_other";
      await seedServer(otherServerId);
      await expect(
        insertRevision(otherServerId, 1, "req_numbering_other"),
      ).resolves.toBeUndefined();
    });

    it("enforces per-server publish request id uniqueness", async () => {
      const serverId = "mcs_constraints_request";
      await seedServer(serverId);
      await insertRevision(serverId, 1, "req_request_shared");
      await expect(
        insertRevision(serverId, 2, "req_request_shared"),
      ).rejects.toThrow();

      const otherServerId = "mcs_constraints_request_other";
      await seedServer(otherServerId);
      await expect(
        insertRevision(otherServerId, 1, "req_request_shared"),
      ).resolves.toBeUndefined();
    });

    it("rejects revisions for a server that does not exist", async () => {
      await expect(
        insertRevision("mcs_constraints_missing", 1, "req_missing"),
      ).rejects.toThrow();
    });
  });
});

function txThatFailsOnToolInsert(tx: unknown): unknown {
  return new Proxy(tx as object, {
    get(object, property, receiver) {
      if (property === "insert") {
        return (table: unknown) => {
          if (table === mcpServerRevisionTool) {
            throw new Error("injected publish failure");
          }
          const insert = Reflect.get(object, property, receiver) as (
            value: unknown,
          ) => unknown;
          return insert.call(object, table);
        };
      }
      return Reflect.get(object, property, receiver);
    },
  });
}
