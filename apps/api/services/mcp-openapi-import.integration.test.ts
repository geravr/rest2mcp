/**
 * @file OpenAPI import confirmation against a real PostgreSQL database: atomic
 * insert of tools plus groups, rollback on a locked-aggregate compile failure,
 * the database name-uniqueness constraints, optimistic revision conflicts,
 * publication isolation, configuration preservation, and the tool cap.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type TransactionSql } from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import { generateAuthId, generateId, schema, user } from "@repo/db";
import { AppError } from "../lib/app-error.js";
import { MCP_MAX_TOOLS_PER_SERVER } from "../lib/mcp-redact.js";
import { parseOpenApiDocument } from "../lib/openapi-document.js";
import { parseOpenApiSourceProvenance } from "../lib/openapi-import-contracts.js";
import { loadExecutionSnapshot } from "./mcp-executor-service.js";
import {
  confirmOpenApiImport,
  previewOpenApiImport,
} from "./mcp-openapi-import-service.js";
import { previewPublish, publishServer } from "./mcp-publishing-service.js";
import { createToolGroup } from "./mcp-tool-group-service.js";

const connectionString = process.env.DATABASE_URL;

/**
 * `waitFor` polls catalog queries, so its budget is wall-clock bounded and
 * spent per call: one call's worst case is `LOCK_WAIT_BUDGET_MS` plus the final
 * poll's query and interval. `confirmWhileAggregateHeld` awaits the helper
 * twice — once for the holder's lock, once for the confirmation's — so the real
 * worst case is roughly twice that. `SUITE_TIMEOUT_MS` must exceed
 * `2 * LOCK_WAIT_BUDGET_MS` plus `LOCK_WAIT_INTERVAL_MS` and the polls' query
 * latency (2 * 10_000 + 10 plus latency here), so a wait that never resolves
 * fails with the helper's own diagnostic instead of the runner killing the test
 * with its generic "Test timed out". Re-derive the relationship when either
 * wait constant changes: a 20_000 budget, for example, needs a suite timeout
 * above ~40 s.
 */
const LOCK_WAIT_BUDGET_MS = 10_000;
const LOCK_WAIT_INTERVAL_MS = 10;
const SUITE_TIMEOUT_MS = 60_000;

function describeIntegration(name: string, factory: () => void): void {
  if (!connectionString) {
    describe.skip(name, factory);
    return;
  }
  describe(name, { timeout: SUITE_TIMEOUT_MS }, factory);
}

const CREDENTIAL_SECRET = "s".repeat(32);

const userId = generateAuthId("user");
/** Isolates this suite's own connections in `pg_stat_activity`. */
const APPLICATION_NAME = `mcp-openapi-import-it-${userId}`;

type ImportDb = Parameters<typeof confirmOpenApiImport>[0];
type PublishDb = Parameters<typeof previewPublish>[0];
type GroupDb = Parameters<typeof createToolGroup>[0];
type SnapshotDb = Parameters<typeof loadExecutionSnapshot>[0];

const OPERATIONS_DOC = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Import Integration API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com/v1" }],
  paths: {
    "/customers": {
      get: {
        operationId: "listCustomers",
        summary: "List customers",
        tags: ["customers"],
      },
      post: {
        operationId: "createCustomer",
        summary: "Create customer",
        tags: ["customers"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
            },
          },
        },
      },
    },
    "/invoices": {
      get: {
        operationId: "listInvoices",
        summary: "List invoices",
        tags: ["invoices"],
      },
    },
  },
});

function fingerprintOf(text: string): string {
  return parseOpenApiDocument(text).document.fingerprint;
}

function contentSource(text: string = OPERATIONS_DOC) {
  return { kind: "content" as const, content: text, label: "paste" as const };
}

/** A common header the canonical compiler rejects for every tool. */
const FORBIDDEN_COMMON_ENTRIES = {
  headers: [
    {
      id: "common_host",
      name: "host",
      value: { kind: "literal", value: "api.example.com" },
    },
  ],
  query: [],
};

type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function definitionFor(path: string, name: string): Record<string, JsonValue> {
  return {
    version: 1,
    pathSegments: [
      { id: `path_${name}`, value: { kind: "literal", value: path } },
    ],
    query: [],
    headers: [],
    body: { bodyType: "none" },
    agentInputs: [],
  };
}

type Settled<T> =
  { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value): Settled<T> => ({ status: "fulfilled", value }),
    (reason: unknown): Settled<T> => ({ status: "rejected", reason }),
  );
}

function rejectionOf<T>(outcome: Settled<T>): unknown {
  if (outcome.status === "fulfilled") {
    throw new Error("Expected the operation to reject, but it resolved.");
  }
  return outcome.reason;
}

function appErrorWith(reason: unknown, appCode: string): AppError {
  expect(reason).toBeInstanceOf(AppError);
  const error = reason as AppError;
  expect(error.appCode).toBe(appCode);
  return error;
}

describeIntegration("OpenAPI import confirmation against PostgreSQL", () => {
  let client: ReturnType<typeof postgres>;
  let holderClient: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let counter = 0;

  beforeAll(async () => {
    const options = { connection: { application_name: APPLICATION_NAME } };
    client = postgres(connectionString!, { max: 8, ...options });
    holderClient = postgres(connectionString!, { max: 2, ...options });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "OpenAPI Import Integration",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await holderClient.end();
    await client.end();
  });

  function importDb(): ImportDb {
    return db as unknown as ImportDb;
  }

  function publishDb(): PublishDb {
    return db as unknown as PublishDb;
  }

  function nextServerId(label: string): string {
    counter += 1;
    return `mcs_oai_${label}_${counter}_${userId}`;
  }

  async function seedServer(
    label: string,
    values: Partial<typeof schema.mcpServer.$inferInsert> = {},
  ): Promise<string> {
    const serverId = nextServerId(label);
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: `Import ${label}`,
      slug: serverId,
      baseUrl: "https://api.example.com/v1",
      allowedHosts: ["api.example.com"],
      status: "draft",
      ...values,
    });
    return serverId;
  }

  async function countHeldServerLocks(): Promise<number> {
    const [row] = await client`
      select count(*)::int as value
      from pg_locks l
      join pg_stat_activity a on a.pid = l.pid
      where l.relation = 'mcp_server'::regclass
        and l.granted
        and a.application_name = ${APPLICATION_NAME}
    `;
    return Number(row?.value ?? 0);
  }

  async function countWaitingLockers(): Promise<number> {
    const [row] = await client`
      select count(*)::int as value
      from pg_stat_activity
      where application_name = ${APPLICATION_NAME}
        and wait_event_type = 'Lock'
    `;
    return Number(row?.value ?? 0);
  }

  async function waitFor(
    check: () => Promise<boolean>,
    label: string,
  ): Promise<void> {
    const deadline = Date.now() + LOCK_WAIT_BUDGET_MS;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((resolve) =>
        setTimeout(resolve, LOCK_WAIT_INTERVAL_MS),
      );
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  /**
   * Starts a holder transaction that locks the server row and applies
   * `hold`'s writes without committing, then runs `confirm` only once that lock
   * is held and releases the holder once the confirmation is observed waiting
   * on the lock. The confirmation therefore reads the pre-holder aggregate
   * before its transaction and the mutated one after acquiring the lock.
   */
  async function confirmWhileAggregateHeld<T>(input: {
    serverId: string;
    hold: (tx: TransactionSql) => Promise<void>;
    confirm: () => Promise<T>;
  }): Promise<Settled<T>> {
    let releaseHolder = (): void => {};
    const holderGate = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holderDone = holderClient
      .begin(async (tx) => {
        await tx`select id from mcp_server where id = ${input.serverId} for update`;
        await input.hold(tx);
        await holderGate;
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    let observed: Settled<T> | undefined;
    let pending: Promise<Settled<T>> | undefined;
    let waitError: unknown;
    try {
      await waitFor(
        async () => (await countHeldServerLocks()) > 0,
        "the holder transaction to lock the server row",
      );
      pending = settle(input.confirm()).then((value) => {
        observed = value;
        return value;
      });
      await waitFor(
        async () => (await countWaitingLockers()) > 0,
        "the confirmation to wait on the server row lock",
      );
    } catch (error) {
      waitError = error;
    } finally {
      releaseHolder();
    }
    const holderError = await holderDone;
    if (holderError !== null) throw holderError;
    if (observed !== undefined) return observed;
    if (waitError !== undefined) throw waitError;
    if (pending === undefined) {
      throw new Error("The confirmation was never started.");
    }
    return pending;
  }

  async function readServer(serverId: string) {
    const [server] = await db
      .select()
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    if (!server) throw new Error(`server ${serverId} missing`);
    return server;
  }

  async function countTools(serverId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId));
    return row?.value ?? 0;
  }

  async function countGroups(serverId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(schema.mcpToolGroup)
      .where(eq(schema.mcpToolGroup.serverId, serverId));
    return row?.value ?? 0;
  }

  async function readRevisionRows(serverId: string) {
    const revisions = await db
      .select()
      .from(schema.mcpServerRevision)
      .where(eq(schema.mcpServerRevision.serverId, serverId))
      .orderBy(asc(schema.mcpServerRevision.id));
    const tools = await db
      .select()
      .from(schema.mcpServerRevisionTool)
      .where(eq(schema.mcpServerRevisionTool.serverId, serverId))
      .orderBy(asc(schema.mcpServerRevisionTool.id));
    return { revisions, tools };
  }

  /** Runtime-visible tool projection; excludes the mutable draft rows. */
  async function snapshotToolList(serverId: string) {
    const snapshot = await loadExecutionSnapshot(db as unknown as SnapshotDb, {
      serverId,
      credentialSecret: CREDENTIAL_SECRET,
    });
    return {
      publishedRevisionId: snapshot?.publishedRevisionId ?? null,
      revisionNumber: snapshot?.revisionNumber ?? null,
      tools: (snapshot?.tools ?? []).map((entry) => ({
        id: entry.tool.id,
        name: entry.tool.name,
        title: entry.tool.title,
        enabled: entry.tool.enabled,
        allowMutation: entry.tool.allowMutation,
        contractFingerprint: entry.contractFingerprint,
        definitionHash: entry.plan?.definitionHash ?? null,
        groupId: entry.tool.groupId,
        sourceProvenance: entry.tool.sourceProvenance,
      })),
    };
  }

  it("commits two imported tools and their first-tag group in exactly one revision", async () => {
    const serverId = await seedServer("atomic");
    const preview = await previewOpenApiImport(importDb(), userId, serverId, {
      source: contentSource(),
    });
    expect(preview.configRevision).toBe(1);
    expect(preview.document.fingerprint).toBe(fingerprintOf(OPERATIONS_DOC));

    const result = await confirmOpenApiImport(importDb(), userId, serverId, {
      expectedRevision: preview.configRevision,
      source: contentSource(),
      fingerprint: preview.document.fingerprint,
      selection: [
        { operationKey: "listCustomers" },
        { operationKey: "createCustomer" },
      ],
      groupStrategy: { kind: "firstTag" },
    });

    expect(result.revision).toBe(2);
    expect(result.draftRevision).toBe(2);
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "createcustomer",
      "listcustomers",
    ]);
    expect(result.groups).toEqual([
      { id: expect.any(String), name: "customers", created: true },
    ]);
    const groupId = result.groups[0]?.id as string;

    const storedGroups = await db
      .select()
      .from(schema.mcpToolGroup)
      .where(eq(schema.mcpToolGroup.serverId, serverId));
    expect(storedGroups).toEqual([
      expect.objectContaining({
        id: groupId,
        serverId,
        name: "customers",
        normalizedName: "customers",
      }),
    ]);

    const storedTools = await db
      .select()
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId))
      .orderBy(asc(schema.mcpTool.name));
    expect(storedTools).toHaveLength(2);
    const expectedByKey = new Map([
      ["listcustomers", "listCustomers"],
      ["createcustomer", "createCustomer"],
    ]);
    for (const tool of storedTools) {
      expect(tool).toMatchObject({
        source: "openapi",
        enabled: false,
        allowMutation: false,
        groupId,
      });
      const provenance = parseOpenApiSourceProvenance(tool.sourceProvenance);
      expect(provenance).toEqual({
        version: 1,
        batchId: result.batchId,
        openApiVersion: "3.1",
        operationKey: expectedByKey.get(tool.name),
        documentFingerprint: preview.document.fingerprint,
        definitionHash: expect.any(String),
        tags: ["customers"],
        sourceLabel: "pasted JSON",
      });
      expect(tool.compiledPlan).not.toBeNull();
      expect(tool.compileStatus).toBe("valid");
    }

    const serverAfter = await readServer(serverId);
    expect(serverAfter.configRevision).toBe(2);
    expect(serverAfter.draftRevision).toBe(2);
  });

  it("rolls back every staged write when a selected operation fails to compile against the locked aggregate", async () => {
    const serverId = await seedServer("rollback");
    const preview = await previewOpenApiImport(importDb(), userId, serverId, {
      source: contentSource(),
    });

    const outcome = await confirmWhileAggregateHeld({
      serverId,
      hold: async (tx) => {
        await tx`
          update mcp_server
          set common_entries = ${tx.json(FORBIDDEN_COMMON_ENTRIES)}
          where id = ${serverId}
        `;
      },
      confirm: () =>
        confirmOpenApiImport(importDb(), userId, serverId, {
          expectedRevision: preview.configRevision,
          source: contentSource(),
          fingerprint: preview.document.fingerprint,
          selection: [
            { operationKey: "listCustomers" },
            { operationKey: "createCustomer" },
          ],
          groupStrategy: { kind: "firstTag" },
        }),
    });

    const error = appErrorWith(
      rejectionOf(outcome),
      APP_ERROR_CODES.MCP_COMPILE_INVALID,
    );
    expect(error.status).toBe(409);
    expect(error.details).toMatchObject({
      issueCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
      nodeId: "common_host",
    });

    expect(await countTools(serverId)).toBe(0);
    expect(await countGroups(serverId)).toBe(0);
    const serverAfter = await readServer(serverId);
    expect(serverAfter.configRevision).toBe(1);
    expect(serverAfter.draftRevision).toBe(1);
  });

  it("rejects a tool name claimed after the preview with MCP_TOOL_NAME_CONFLICT and persists nothing", async () => {
    const serverId = await seedServer("tool_conflict");
    const preview = await previewOpenApiImport(importDb(), userId, serverId, {
      source: contentSource(),
    });
    const conflictToolId = generateId("mct");

    const outcome = await confirmWhileAggregateHeld({
      serverId,
      hold: async (tx) => {
        await tx`
          insert into mcp_tool
            (id, server_id, name, method, request_definition, allow_mutation, enabled, source)
          values
            (${conflictToolId}, ${serverId}, ${"listcustomers"}, ${"GET"},
             ${tx.json(definitionFor("/contacts", "conflict"))}, ${false}, ${false},
             ${"manual"})
        `;
      },
      confirm: () =>
        confirmOpenApiImport(importDb(), userId, serverId, {
          expectedRevision: preview.configRevision,
          source: contentSource(),
          fingerprint: preview.document.fingerprint,
          selection: [
            { operationKey: "listInvoices" },
            { operationKey: "listCustomers" },
          ],
          groupStrategy: { kind: "firstTag" },
        }),
    });

    const error = appErrorWith(
      rejectionOf(outcome),
      APP_ERROR_CODES.MCP_TOOL_NAME_CONFLICT,
    );
    expect(error.status).toBe(409);
    expect(error.details).toMatchObject({
      serverId,
      toolNames: ["listcustomers"],
    });

    // The first selected tool and both planned groups were already written when
    // the unique index rejected the second one, so the rollback removed them.
    const storedTools = await db
      .select({ id: schema.mcpTool.id, name: schema.mcpTool.name })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId));
    expect(storedTools).toEqual([
      { id: conflictToolId, name: "listcustomers" },
    ]);
    expect(await countGroups(serverId)).toBe(0);
    const serverAfter = await readServer(serverId);
    expect(serverAfter.configRevision).toBe(1);
    expect(serverAfter.draftRevision).toBe(1);
  });

  it("rejects a group name claimed after the preview with MCP_TOOL_GROUP_NAME_CONFLICT and persists nothing", async () => {
    const serverId = await seedServer("group_conflict");
    const preview = await previewOpenApiImport(importDb(), userId, serverId, {
      source: contentSource(),
    });
    const conflictGroupId = generateId("mtg");

    const outcome = await confirmWhileAggregateHeld({
      serverId,
      hold: async (tx) => {
        await tx`
          insert into mcp_tool_group (id, server_id, name, normalized_name)
          values (${conflictGroupId}, ${serverId}, ${"Customers"}, ${"customers"})
        `;
      },
      confirm: () =>
        confirmOpenApiImport(importDb(), userId, serverId, {
          expectedRevision: preview.configRevision,
          source: contentSource(),
          fingerprint: preview.document.fingerprint,
          selection: [
            { operationKey: "listCustomers" },
            { operationKey: "createCustomer" },
          ],
          groupStrategy: { kind: "firstTag" },
        }),
    });

    const error = appErrorWith(
      rejectionOf(outcome),
      APP_ERROR_CODES.MCP_TOOL_GROUP_NAME_CONFLICT,
    );
    expect(error.status).toBe(409);
    expect(error.details).toMatchObject({ serverId, groupName: "customers" });

    expect(await countTools(serverId)).toBe(0);
    const storedGroups = await db
      .select({ id: schema.mcpToolGroup.id })
      .from(schema.mcpToolGroup)
      .where(eq(schema.mcpToolGroup.serverId, serverId));
    expect(storedGroups).toEqual([{ id: conflictGroupId }]);
    const serverAfter = await readServer(serverId);
    expect(serverAfter.configRevision).toBe(1);
    expect(serverAfter.draftRevision).toBe(1);
  });

  it("rejects a stale expected revision with the current revision in details", async () => {
    const serverId = await seedServer("stale");
    const preview = await previewOpenApiImport(importDb(), userId, serverId, {
      source: contentSource(),
    });

    const advanced = await createToolGroup(
      db as unknown as GroupDb,
      userId,
      serverId,
      { expectedRevision: preview.configRevision, name: "Unrelated" },
    );
    expect(advanced.revision).toBe(preview.configRevision + 1);

    const failure = await confirmOpenApiImport(importDb(), userId, serverId, {
      expectedRevision: preview.configRevision,
      source: contentSource(),
      fingerprint: preview.document.fingerprint,
      selection: [{ operationKey: "listCustomers" }],
      groupStrategy: { kind: "ungrouped" },
    }).then(
      () => null,
      (error: unknown) => error,
    );

    const error = appErrorWith(failure, APP_ERROR_CODES.MCP_WRITE_CONFLICT);
    expect(error.status).toBe(409);
    expect(error.details).toEqual({
      serverId,
      currentRevision: advanced.revision,
    });

    expect(await countTools(serverId)).toBe(0);
    expect(await countGroups(serverId)).toBe(1);
    const serverAfter = await readServer(serverId);
    expect(serverAfter.configRevision).toBe(advanced.revision);
    expect(serverAfter.draftRevision).toBe(1);
  });

  it("leaves the active published revision, its rows, and the execution snapshot untouched", async () => {
    const serverId = await seedServer("isolation");
    const toolId = generateId("mct");
    await db.insert(schema.mcpTool).values({
      id: toolId,
      serverId,
      name: "list_contacts",
      title: "List contacts",
      description: "List contacts.",
      method: "GET",
      requestDefinition: definitionFor("/contacts", "contacts"),
      allowMutation: false,
      enabled: true,
      source: "manual",
    });

    const preview = await previewPublish(publishDb(), userId, serverId);
    expect(preview.ready).toBe(true);
    const publication = await publishServer(publishDb(), {
      userId,
      serverId,
      expectedDraftRevision: preview.draftRevision,
      expectedPublishedRevisionId: preview.publishedRevisionId,
      publishRequestId: `${serverId}_req_1`,
      candidateFingerprint: preview.candidateFingerprint,
      acknowledgedWarningCodes: preview.warningCodes,
      actorSource: "studio",
      note: null,
    });

    const serverBefore = await readServer(serverId);
    const revisionsBefore = await readRevisionRows(serverId);
    const snapshotBefore = await snapshotToolList(serverId);
    expect(serverBefore.publishedRevisionId).toBe(publication.revisionId);
    expect(revisionsBefore.revisions).toHaveLength(1);
    expect(snapshotBefore.tools).toHaveLength(1);

    const importPreview = await previewOpenApiImport(
      importDb(),
      userId,
      serverId,
      { source: contentSource() },
    );
    const result = await confirmOpenApiImport(importDb(), userId, serverId, {
      expectedRevision: importPreview.configRevision,
      source: contentSource(),
      fingerprint: importPreview.document.fingerprint,
      selection: [
        { operationKey: "listCustomers" },
        { operationKey: "listInvoices" },
      ],
      groupStrategy: { kind: "ungrouped" },
    });
    expect(result.tools).toHaveLength(2);

    const serverAfter = await readServer(serverId);
    expect(serverAfter.publishedRevisionId).toBe(publication.revisionId);
    expect(serverAfter.status).toBe("live");
    expect(serverAfter.configRevision).toBe(serverBefore.configRevision + 1);
    expect(serverAfter.draftRevision).toBe(serverBefore.draftRevision + 1);
    expect(await readRevisionRows(serverId)).toEqual(revisionsBefore);
    expect(await snapshotToolList(serverId)).toEqual(snapshotBefore);

    const draftTools = await db
      .select({
        id: schema.mcpTool.id,
        source: schema.mcpTool.source,
        enabled: schema.mcpTool.enabled,
      })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId))
      .orderBy(asc(schema.mcpTool.id));
    expect(draftTools).toHaveLength(3);
    expect(draftTools.filter((tool) => tool.source === "openapi")).toHaveLength(
      2,
    );
    for (const tool of draftTools.filter(
      (entry) => entry.source === "openapi",
    )) {
      expect(tool.enabled).toBe(false);
    }
  });

  it("preserves authentication, common entries, and server values byte-for-byte", async () => {
    const secretId = generateId("msv");
    const configId = generateId("msv");
    const serverId = await seedServer("config", {
      authConfiguration: {
        kind: "bearer",
        bindings: [
          {
            location: "header",
            key: "Authorization",
            serverValueId: secretId,
          },
        ],
      },
      commonEntries: {
        headers: [
          {
            id: "hdr_version",
            name: "Version",
            value: { kind: "literal", value: "2024-01" },
          },
        ],
        query: [
          {
            id: "q_lang",
            name: "lang",
            value: { kind: "literal", value: "en" },
          },
        ],
      },
    });
    await db.insert(schema.mcpServerVariable).values([
      {
        id: secretId,
        serverId,
        name: "api_token",
        kind: "secret",
        owner: "auth",
        ciphertext:
          "v1:00000000000000000000000000000000:11111111111111111111111111111111",
      },
      {
        id: configId,
        serverId,
        name: "api_version",
        kind: "config",
        owner: "manual",
        value: "2024-01",
      },
    ]);

    const [serverBefore] = await db
      .select({
        authConfiguration: schema.mcpServer.authConfiguration,
        commonEntries: schema.mcpServer.commonEntries,
      })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    const variablesBefore = await db
      .select()
      .from(schema.mcpServerVariable)
      .where(eq(schema.mcpServerVariable.serverId, serverId))
      .orderBy(asc(schema.mcpServerVariable.id));

    const preview = await previewOpenApiImport(importDb(), userId, serverId, {
      source: contentSource(),
    });
    const result = await confirmOpenApiImport(importDb(), userId, serverId, {
      expectedRevision: preview.configRevision,
      source: contentSource(),
      fingerprint: preview.document.fingerprint,
      selection: [{ operationKey: "listCustomers" }],
      groupStrategy: { kind: "ungrouped" },
    });
    expect(result.tools).toHaveLength(1);

    const [serverAfter] = await db
      .select({
        authConfiguration: schema.mcpServer.authConfiguration,
        commonEntries: schema.mcpServer.commonEntries,
      })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    const variablesAfter = await db
      .select()
      .from(schema.mcpServerVariable)
      .where(eq(schema.mcpServerVariable.serverId, serverId))
      .orderBy(asc(schema.mcpServerVariable.id));
    expect(JSON.stringify(serverAfter)).toBe(JSON.stringify(serverBefore));
    expect(JSON.stringify(variablesAfter)).toBe(
      JSON.stringify(variablesBefore),
    );
  });

  it("rejects a selection that overflows the tool cap when the overflowing tools are only visible under the lock", async () => {
    const serverId = await seedServer("capacity");
    // Held rows raise the server to the boundary (`MCP_MAX_TOOLS_PER_SERVER - 1`)
    // only once they are visible, and the stale pre-holder count plus the
    // selection still fits the cap, so no pre-lock read can reject this confirm.
    const heldToolCount = 2;
    const seededToolCount = MCP_MAX_TOOLS_PER_SERVER - 1 - heldToolCount;
    const selection = [
      { operationKey: "listCustomers" },
      { operationKey: "createCustomer" },
      { operationKey: "listInvoices" },
    ];
    const seeded = Array.from({ length: seededToolCount }, (_, index) => ({
      serverId,
      name: `seed_tool_${index}`,
      method: "GET",
      requestDefinition: definitionFor(`/seed/${index}`, `seed_${index}`),
      allowMutation: false,
      enabled: false,
      source: "manual",
    }));
    await db.insert(schema.mcpTool).values(seeded);

    const preview = await previewOpenApiImport(importDb(), userId, serverId, {
      source: contentSource(),
    });
    expect(preview.capacity.currentTools).toBe(seededToolCount);
    expect(
      preview.capacity.currentTools + selection.length,
    ).toBeLessThanOrEqual(MCP_MAX_TOOLS_PER_SERVER);

    const heldToolIds = Array.from({ length: heldToolCount }, () =>
      generateId("mct"),
    );
    const outcome = await confirmWhileAggregateHeld({
      serverId,
      hold: async (tx) => {
        for (const [index, toolId] of heldToolIds.entries()) {
          await tx`
            insert into mcp_tool
              (id, server_id, name, method, request_definition, allow_mutation, enabled, source)
            values
              (${toolId}, ${serverId}, ${`held_tool_${index}`}, ${"GET"},
               ${tx.json(definitionFor(`/held/${index}`, `held_${index}`))},
               ${false}, ${false}, ${"manual"})
          `;
        }
      },
      confirm: () =>
        confirmOpenApiImport(importDb(), userId, serverId, {
          expectedRevision: preview.configRevision,
          source: contentSource(),
          fingerprint: preview.document.fingerprint,
          selection,
          groupStrategy: { kind: "ungrouped" },
        }),
    });

    const error = appErrorWith(
      rejectionOf(outcome),
      APP_ERROR_CODES.MCP_TOOL_LIMIT_REACHED,
    );
    expect(error.status).toBe(400);
    // `observed` is the locked re-read's count, which the pre-lock reads that
    // ran before the holder released could not see.
    expect(error.details).toMatchObject({
      serverId,
      limit: MCP_MAX_TOOLS_PER_SERVER,
      observed: MCP_MAX_TOOLS_PER_SERVER - 1,
    });

    // The rejected confirmation left only the holder's now-committed rows.
    expect(await countTools(serverId)).toBe(MCP_MAX_TOOLS_PER_SERVER - 1);
    expect(await countGroups(serverId)).toBe(0);
    const serverAfter = await readServer(serverId);
    expect(serverAfter.configRevision).toBe(1);
    expect(serverAfter.draftRevision).toBe(1);
  });
});
