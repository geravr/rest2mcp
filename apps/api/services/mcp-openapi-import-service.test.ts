import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_ERROR_CODES,
  MCP_OPENAPI_ISSUE_CODES,
  MCP_OPENAPI_LIMITS,
  MCP_TOOL_GROUP_LIMITS,
} from "@repo/core";
import { AppError } from "../lib/app-error.js";
import { getMcpMaxToolsPerServer } from "../lib/mcp-limits.js";
import { mcpOpenApiSourceProvenanceSchema } from "../lib/openapi-import-contracts.js";
import { parseOpenApiDocument } from "../lib/openapi-document.js";
import { sanitizeOpenApiSourceLabel } from "../lib/openapi-fetch.js";

/** The deployment's effective cap, so fixtures track configuration. */
const toolLimit = getMcpMaxToolsPerServer();

const tables = vi.hoisted(() => ({
  generateId: vi.fn((prefix: string) => `${prefix}_test`),
  mcpServer: {
    id: "mcp_server.id",
    userId: "mcp_server.user_id",
    configRevision: "mcp_server.config_revision",
    draftRevision: "mcp_server.draft_revision",
  },
  mcpTool: {
    id: "mcp_tool.id",
    serverId: "mcp_tool.server_id",
    name: "mcp_tool.name",
    groupId: "mcp_tool.group_id",
  },
  mcpToolGroup: {
    id: "mcp_tool_group.id",
    serverId: "mcp_tool_group.server_id",
    name: "mcp_tool_group.name",
    normalizedName: "mcp_tool_group.normalized_name",
  },
  mcpServerVariable: {
    id: "mcp_server_variable.id",
    serverId: "mcp_server_variable.server_id",
    name: "mcp_server_variable.name",
    kind: "mcp_server_variable.kind",
    owner: "mcp_server_variable.owner",
  },
}));

const telemetry = vi.hoisted(() => ({ capture: vi.fn() }));
const fetchOpenApiDocument = vi.hoisted(() => vi.fn());

vi.mock("@repo/db", () => tables);
vi.mock("../lib/mcp-telemetry.js", () => ({
  captureMcpTelemetry: telemetry.capture,
  MCP_TELEMETRY_EVENTS: {
    openapiImportPreviewed: "mcp_openapi_import_previewed",
    openapiImportConfirmed: "mcp_openapi_import_confirmed",
    aggregateWrite: "mcp_aggregate_write",
    aggregateConflict: "mcp_aggregate_conflict",
    aggregateRetry: "mcp_aggregate_retry",
  },
}));
vi.mock("../lib/openapi-fetch.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/openapi-fetch.js")>();
  return { ...actual, fetchOpenApiDocument };
});
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ kind: "and", args })),
  asc: vi.fn((value: unknown) => ({ kind: "asc", value })),
  count: vi.fn(() => ({ kind: "count" })),
  eq: vi.fn((left: unknown, right: unknown) => ({ kind: "eq", left, right })),
  inArray: vi.fn((left: unknown, right: unknown) => ({
    kind: "inArray",
    left,
    right,
  })),
}));

import { mcpTool, mcpToolGroup } from "@repo/db";
import {
  confirmOpenApiImport,
  previewOpenApiImport,
} from "./mcp-openapi-import-service.js";

const SERVER_ID = "mcs_1";
const USER_ID = "user-a";

const serverRow = {
  id: SERVER_ID,
  userId: USER_ID,
  baseUrl: "https://api.example.com/v1",
  allowedHosts: ["api.example.com"],
  commonEntries: null,
  authConfiguration: null,
  configRevision: 1,
  draftRevision: 5,
  status: "draft",
  publishedRevisionId: null,
};

/** Sentinel strings that must never reach telemetry or provenance. */
const SENTINEL_EXAMPLE = "sentinel-example-9f3a";
const SENTINEL_SOURCE_URL = `https://docs.example.com/openapi.json?token=${SENTINEL_EXAMPLE}`;

const OPERATIONS_DOC = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Test API", version: "1.0.0" },
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

const BLOCKED_DOC = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Blocked API", version: "1" },
  paths: {
    "/uploads": {
      post: {
        operationId: "uploadFile",
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { type: "object" } } },
        },
      },
    },
    "/probe": { options: { operationId: "probeOptions" } },
  },
});

const TELEMETRY_DOC = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Telemetry API", version: "1" },
  paths: {
    "/things": {
      get: {
        operationId: "listThings",
        parameters: [
          {
            name: "filter",
            in: "query",
            example: SENTINEL_EXAMPLE,
            schema: { type: "string", default: SENTINEL_EXAMPLE },
          },
        ],
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

const ungrouped = { kind: "ungrouped" as const };
const firstTag = { kind: "firstTag" as const };

function groupRow(id: string, name: string) {
  return { id, name, normalizedName: name.toLowerCase() };
}

function toolNameRows(count: number): Array<{ name: string }> {
  return Array.from({ length: count }, (_, index) => ({
    name: `existing_tool_${index}`,
  }));
}

type Recorded = { table: unknown; values: unknown };

function makeChain<T>(result: T) {
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

function makeRejectingChain(error: unknown) {
  const handler: ProxyHandler<object> = {
    get(_, prop: string | symbol) {
      if (prop === "then") {
        return (_resolve: unknown, reject?: (reason: unknown) => unknown) =>
          Promise.reject(error).then(undefined, reject);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

/**
 * Ordered-result database double. Inserts and non-boundary updates are staged
 * while a transaction is open and merged into the committed lists only when the
 * transaction resolves, so a rolled-back command leaves them observable but
 * uncommitted.
 */
function makeDb(results: unknown[]) {
  let index = 0;
  let depth = 0;
  const committed: { inserted: Recorded[]; updated: Recorded[] } = {
    inserted: [],
    updated: [],
  };
  const staged: { inserted: Recorded[]; updated: Recorded[] } = {
    inserted: [],
    updated: [],
  };
  const boundaryUpdates: Array<Record<string, unknown>> = [];
  let telemetryCallsAtFirstLockedInsert: number | null = null;

  const take = () => {
    const value = results[index] ?? [];
    index += 1;
    return value instanceof Error
      ? makeRejectingChain(value)
      : makeChain(value);
  };

  const record = (target: Recorded[], table: unknown, values: unknown) => {
    target.push({ table, values });
  };

  const db = {
    // The projection argument is captured so tests can assert exactly which
    // columns a read is allowed to touch.
    select: vi.fn((projection?: unknown) => {
      void projection;
      return take();
    }),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        if (depth > 0) {
          if (telemetryCallsAtFirstLockedInsert === null) {
            telemetryCallsAtFirstLockedInsert =
              telemetry.capture.mock.calls.length;
          }
          record(staged.inserted, table, values);
        } else {
          record(committed.inserted, table, values);
        }
        return take();
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (payload: Record<string, unknown>) => {
        const isBoundary =
          payload && typeof payload === "object" && "configRevision" in payload;
        if (isBoundary) {
          boundaryUpdates.push(payload);
          const chain = makeChain([
            {
              configRevision: payload.configRevision,
              draftRevision: payload.draftRevision,
            },
          ]);
          return { where: () => ({ returning: () => chain }) };
        }
        if (depth > 0) record(staged.updated, table, payload);
        else record(committed.updated, table, payload);
        const chain = take();
        return { where: () => chain, returning: () => chain };
      },
    })),
    delete: vi.fn(() => take()),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      depth += 1;
      try {
        const result = await fn(db);
        committed.inserted.push(...staged.inserted);
        committed.updated.push(...staged.updated);
        staged.inserted.length = 0;
        staged.updated.length = 0;
        return result;
      } finally {
        depth -= 1;
      }
    }),
    committed,
    staged,
    boundaryUpdates,
    get telemetryCallsAtFirstLockedInsert() {
      return telemetryCallsAtFirstLockedInsert;
    },
  };
  return db;
}

function isAppErrorWith(code: string) {
  return (error: unknown) =>
    error instanceof AppError && error.appCode === code;
}

function telemetryCallFor(event: string) {
  return telemetry.capture.mock.calls.find((call) => call[0] === event);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  fetchOpenApiDocument.mockReset();
});

describe("previewOpenApiImport", () => {
  it("returns a write-free preview with candidates, suggestions, and capacity", async () => {
    const db = makeDb([
      [serverRow],
      [{ name: "existing_tool" }],
      [groupRow("mtg_inv", "Invoices")],
      [{ id: "var_1", name: "api_key", kind: "secret", owner: "auth" }],
    ]);

    const result = await previewOpenApiImport(db as never, USER_ID, SERVER_ID, {
      source: contentSource(),
    });

    expect(result.document).toEqual({
      version: "3.1",
      title: "Test API",
      fingerprint: fingerprintOf(OPERATIONS_DOC),
      operationCount: 3,
      selectableCount: 3,
    });
    expect(result.capacity).toEqual({
      toolLimit,
      currentTools: 1,
      groupLimit: MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer,
      currentGroups: 1,
    });
    expect(result.configRevision).toBe(1);
    expect(result.sourceLabel).toBe("pasted JSON");
    expect(result.documentIssues).toEqual([]);

    const byKey = new Map(
      result.operations.map((operation) => [operation.operationKey, operation]),
    );
    expect(byKey.get("listCustomers")).toMatchObject({
      method: "GET",
      path: "/customers",
      suggestedName: "listcustomers",
      title: "List customers",
      tags: ["customers"],
      selectable: true,
      deprecated: false,
    });
    expect(byKey.get("listCustomers")?.requestDefinition).toBeDefined();
    expect(byKey.get("createCustomer")?.requestDefinition).toMatchObject({
      body: { bodyType: "json" },
    });
    expect(result.suggestedGroups).toEqual([
      { tag: "customers", normalizedName: "customers", willCreate: true },
      {
        tag: "invoices",
        normalizedName: "invoices",
        existingGroupId: "mtg_inv",
        willCreate: false,
      },
    ]);

    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns blocked candidates without a request definition and a supported placeholder method", async () => {
    const db = makeDb([[serverRow], [], [], []]);

    const result = await previewOpenApiImport(db as never, USER_ID, SERVER_ID, {
      source: contentSource(BLOCKED_DOC),
    });

    const byKey = new Map(
      result.operations.map((operation) => [operation.operationKey, operation]),
    );
    const upload = byKey.get("uploadFile");
    expect(upload?.selectable).toBe(false);
    expect(upload?.method).toBe("POST");
    expect(upload?.requestDefinition).toBeUndefined();
    expect(upload?.issues.map((issue) => issue.code)).toContain(
      "OPENAPI_MULTIPART_BODY",
    );

    const probe = byKey.get("probeOptions");
    expect(probe?.selectable).toBe(false);
    // A blocked candidate's method is a placeholder: the issue is the diagnostic.
    expect(probe?.method).toBe("GET");
    expect(probe?.requestDefinition).toBeUndefined();
    expect(probe?.issues.map((issue) => issue.code)).toContain(
      "OPENAPI_METHOD_UNSUPPORTED",
    );
    expect(result.document.selectableCount).toBe(0);
  });

  it("returns document-level blockers for an unreadable path item", async () => {
    const db = makeDb([[serverRow], [], [], []]);
    const text = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Unreadable API", version: "1" },
      paths: {
        "/external": { $ref: "./paths.yaml#/external" },
        "/ok": { get: { operationId: "okGet" } },
      },
    });

    const result = await previewOpenApiImport(db as never, USER_ID, SERVER_ID, {
      source: contentSource(text),
    });

    expect(result.documentIssues).toEqual([
      {
        code: MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
        severity: "error",
        message:
          'Reference "./paths.yaml#/external" is outside the submitted document.',
        path: "/paths/~1external",
      },
    ]);
    const byKey = new Map(
      result.operations.map((operation) => [operation.operationKey, operation]),
    );
    expect(byKey.get("* /external")).toMatchObject({
      path: "/external",
      selectable: false,
      method: "GET",
    });
    expect(byKey.get("okGet")?.selectable).toBe(true);
  });

  it("keeps the sanitized URL label and never returns the request URL", async () => {
    fetchOpenApiDocument.mockResolvedValue({
      text: OPERATIONS_DOC,
      finalUrl: SENTINEL_SOURCE_URL,
      sourceLabel: sanitizeOpenApiSourceLabel(SENTINEL_SOURCE_URL),
      contentType: "application/json",
    });
    const db = makeDb([[serverRow], [], [], []]);

    const result = await previewOpenApiImport(db as never, USER_ID, SERVER_ID, {
      source: { kind: "url", url: SENTINEL_SOURCE_URL },
    });

    expect(fetchOpenApiDocument).toHaveBeenCalledWith({
      url: SENTINEL_SOURCE_URL,
    });
    expect(result.sourceLabel).toBe("https://docs.example.com/openapi.json");

    const event = telemetryCallFor("mcp_openapi_import_previewed");
    const serialized = JSON.stringify(event?.[1]);
    expect(serialized).not.toContain(SENTINEL_EXAMPLE);
    expect(serialized).not.toContain("docs.example.com");
  });

  it("emits counts and stable codes only", async () => {
    const db = makeDb([[serverRow], [], [], []]);

    await previewOpenApiImport(db as never, USER_ID, SERVER_ID, {
      source: contentSource(TELEMETRY_DOC),
    });

    const event = telemetryCallFor("mcp_openapi_import_previewed");
    expect(event?.[1]).toMatchObject({
      userId: USER_ID,
      properties: {
        sourceKind: "content",
        openApiVersion: "3.1",
        operationCount: 1,
        selectableCount: 1,
        blockedCount: 0,
        warningCount: 0,
        suggestedGroupCount: 0,
      },
    });
    const properties = (event?.[1] as { properties: Record<string, unknown> })
      .properties;
    expect(typeof properties.durationMs).toBe("number");
    const serialized = JSON.stringify(properties);
    for (const secret of [
      SENTINEL_EXAMPLE,
      "listThings",
      "/things",
      "openapi",
      OPERATIONS_DOC,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("reads only server-value identity columns and never a stored value", async () => {
    const db = makeDb([
      [serverRow],
      [],
      [],
      [{ id: "var_1", name: "api_key", kind: "secret", owner: "auth" }],
    ]);

    await previewOpenApiImport(db as never, USER_ID, SERVER_ID, {
      source: contentSource(),
    });

    const projections = db.select.mock.calls
      .map((call) => call[0])
      .filter(
        (projection): projection is Record<string, unknown> =>
          projection !== undefined,
      );
    expect(projections.find((projection) => "kind" in projection)).toEqual({
      id: tables.mcpServerVariable.id,
      name: tables.mcpServerVariable.name,
      kind: tables.mcpServerVariable.kind,
      owner: tables.mcpServerVariable.owner,
    });
    for (const projection of projections) {
      expect(Object.keys(projection)).not.toContain("value");
      expect(Object.keys(projection)).not.toContain("ciphertext");
    }
  });

  it("conceals another user's server as not found without fetching", async () => {
    const db = makeDb([[]]);

    await expect(
      previewOpenApiImport(db as never, "user-b", SERVER_ID, {
        source: { kind: "url", url: "https://docs.example.com/openapi.json" },
      }),
    ).rejects.toSatisfy(isAppErrorWith(APP_ERROR_CODES.MCP_SERVER_NOT_FOUND));
    expect(fetchOpenApiDocument).not.toHaveBeenCalled();
  });
});

describe("confirmOpenApiImport", () => {
  it("commits disabled tools with validated provenance in one revision", async () => {
    const db = makeDb([
      [serverRow],
      [{ name: "existing_tool" }],
      [],
      [],
      [serverRow],
      [{ count: 0 }],
      [],
      [],
      [{ id: "mct_new", name: "listcustomers" }],
    ]);

    const result = await confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
      expectedRevision: 1,
      source: contentSource(),
      fingerprint: fingerprintOf(OPERATIONS_DOC),
      selection: [{ operationKey: "listCustomers" }],
      groupStrategy: ungrouped,
    });

    expect(result).toEqual({
      revision: 2,
      draftRevision: 6,
      batchId: "oib_test",
      tools: [
        {
          id: "mct_new",
          name: "listcustomers",
          method: "GET",
          path: "/customers",
        },
      ],
      groups: [],
    });
    expect(db.boundaryUpdates).toHaveLength(1);
    expect(db.boundaryUpdates[0]).toMatchObject({
      configRevision: 2,
      draftRevision: 6,
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);

    const insertedTools = db.committed.inserted.filter(
      (record) => record.table === mcpTool,
    );
    expect(insertedTools).toHaveLength(1);
    const values = insertedTools[0]?.values as Record<string, unknown>;
    expect(values).toMatchObject({
      serverId: SERVER_ID,
      name: "listcustomers",
      title: "List customers",
      description: null,
      method: "GET",
      compileStatus: "valid",
      allowMutation: false,
      enabled: false,
      source: "openapi",
      groupId: null,
    });
    expect(
      (values.compiledPlan as Record<string, unknown>).definitionHash,
    ).toEqual(expect.any(String));

    const provenance = mcpOpenApiSourceProvenanceSchema.parse(
      values.sourceProvenance,
    );
    expect(provenance).toEqual({
      version: 1,
      batchId: "oib_test",
      openApiVersion: "3.1",
      operationKey: "listCustomers",
      documentFingerprint: fingerprintOf(OPERATIONS_DOC),
      definitionHash: (values.compiledPlan as Record<string, unknown>)
        .definitionHash,
      tags: ["customers"],
      sourceLabel: "pasted JSON",
    });

    // Telemetry is buffered until commit, never emitted under the server lock.
    expect(db.telemetryCallsAtFirstLockedInsert).toBe(0);
    expect(telemetryCallFor("mcp_openapi_import_confirmed")?.[1]).toMatchObject(
      {
        userId: USER_ID,
        properties: {
          sourceKind: "content",
          openApiVersion: "3.1",
          selectedCount: 1,
          createdToolCount: 1,
          createdGroupCount: 0,
        },
      },
    );
  });

  it("honors an owner-supplied name override", async () => {
    const db = makeDb([
      [serverRow],
      [],
      [],
      [],
      [serverRow],
      [{ count: 0 }],
      [],
      [],
      [{ id: "mct_renamed", name: "customers_list" }],
    ]);

    const result = await confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
      expectedRevision: 1,
      source: contentSource(),
      fingerprint: fingerprintOf(OPERATIONS_DOC),
      selection: [{ operationKey: "listCustomers", name: "customers_list" }],
      groupStrategy: ungrouped,
    });

    expect(result.tools.map((tool) => tool.name)).toEqual(["customers_list"]);
  });

  // Imports two operations, so it needs room for two tool slots.
  it.skipIf(toolLimit < 2)(
    "creates one shared first-tag group for operations with the same tag",
    async () => {
      const db = makeDb([
        [serverRow],
        [],
        [],
        [],
        [serverRow],
        [{ count: 0 }],
        [],
        [{ id: "mtg_new", name: "customers" }],
        [],
        [{ id: "mct_1", name: "listcustomers" }],
        [{ id: "mct_2", name: "createcustomer" }],
      ]);

      const result = await confirmOpenApiImport(
        db as never,
        USER_ID,
        SERVER_ID,
        {
          expectedRevision: 1,
          source: contentSource(),
          fingerprint: fingerprintOf(OPERATIONS_DOC),
          selection: [
            { operationKey: "listCustomers" },
            { operationKey: "createCustomer" },
          ],
          groupStrategy: firstTag,
        },
      );

      const groupInserts = db.committed.inserted.filter(
        (record) => record.table === mcpToolGroup,
      );
      expect(groupInserts).toEqual([
        {
          table: mcpToolGroup,
          values: {
            serverId: SERVER_ID,
            name: "customers",
            normalizedName: "customers",
          },
        },
      ]);
      expect(result.groups).toEqual([
        { id: "mtg_new", name: "customers", created: true },
      ]);
      for (const record of db.committed.inserted.filter(
        (item) => item.table === mcpTool,
      )) {
        expect((record.values as Record<string, unknown>).groupId).toBe(
          "mtg_new",
        );
      }
    },
  );

  it("reuses an existing group by normalized first tag without creating one", async () => {
    const db = makeDb([
      [serverRow],
      [],
      [groupRow("mtg_inv", "Invoices")],
      [],
      [serverRow],
      [{ count: 0 }],
      [groupRow("mtg_inv", "Invoices")],
      [],
      [{ id: "mct_inv", name: "listinvoices" }],
    ]);

    const result = await confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
      expectedRevision: 1,
      source: contentSource(),
      fingerprint: fingerprintOf(OPERATIONS_DOC),
      selection: [{ operationKey: "listInvoices" }],
      groupStrategy: firstTag,
    });

    expect(
      db.committed.inserted.filter((record) => record.table === mcpToolGroup),
    ).toEqual([]);
    expect(result.groups).toEqual([
      { id: "mtg_inv", name: "Invoices", created: false },
    ]);
    const toolValues = db.committed.inserted[0]?.values as Record<
      string,
      unknown
    >;
    expect(toolValues.groupId).toBe("mtg_inv");
    expect(toolValues.enabled).toBe(false);
    expect(toolValues.allowMutation).toBe(false);
  });

  // Imports two operations, so it needs room for two tool slots.
  it.skipIf(toolLimit < 2)(
    "lets a new common group override tags and create exactly one group",
    async () => {
      const db = makeDb([
        [serverRow],
        [],
        [],
        [],
        [serverRow],
        [{ count: 0 }],
        [],
        [{ id: "mtg_imp", name: "Imported" }],
        [],
        [{ id: "mct_1", name: "listcustomers" }],
        [{ id: "mct_2", name: "listinvoices" }],
      ]);

      const result = await confirmOpenApiImport(
        db as never,
        USER_ID,
        SERVER_ID,
        {
          expectedRevision: 1,
          source: contentSource(),
          fingerprint: fingerprintOf(OPERATIONS_DOC),
          selection: [
            { operationKey: "listCustomers" },
            { operationKey: "listInvoices" },
          ],
          groupStrategy: { kind: "new", name: "Imported" },
        },
      );

      const groupInserts = db.committed.inserted.filter(
        (record) => record.table === mcpToolGroup,
      );
      expect(groupInserts).toEqual([
        {
          table: mcpToolGroup,
          values: {
            serverId: SERVER_ID,
            name: "Imported",
            normalizedName: "imported",
          },
        },
      ]);
      expect(result.groups).toEqual([
        { id: "mtg_imp", name: "Imported", created: true },
      ]);
      const toolGroupIds = db.committed.inserted
        .filter((record) => record.table === mcpTool)
        .map((record) => (record.values as Record<string, unknown>).groupId);
      expect(toolGroupIds).toEqual(["mtg_imp", "mtg_imp"]);
    },
  );

  it("uses the final sanitized label for URL provenance", async () => {
    fetchOpenApiDocument.mockResolvedValue({
      text: OPERATIONS_DOC,
      finalUrl: SENTINEL_SOURCE_URL,
      sourceLabel: sanitizeOpenApiSourceLabel(SENTINEL_SOURCE_URL),
      contentType: "application/json",
    });
    const db = makeDb([
      [serverRow],
      [],
      [],
      [],
      [serverRow],
      [{ count: 0 }],
      [],
      [],
      [{ id: "mct_new", name: "listcustomers" }],
    ]);

    await confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
      expectedRevision: 1,
      source: { kind: "url", url: SENTINEL_SOURCE_URL },
      fingerprint: fingerprintOf(OPERATIONS_DOC),
      selection: [{ operationKey: "listCustomers" }],
      groupStrategy: ungrouped,
    });

    const values = db.committed.inserted[0]?.values as Record<string, unknown>;
    const provenance = mcpOpenApiSourceProvenanceSchema.parse(
      values.sourceProvenance,
    );
    expect(provenance.sourceLabel).toBe(
      "https://docs.example.com/openapi.json",
    );
    expect(JSON.stringify(provenance)).not.toContain(SENTINEL_EXAMPLE);
  });

  it("rejects a changed document fingerprint before locking", async () => {
    const db = makeDb([[serverRow]]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: "stale-fingerprint",
        selection: [{ operationKey: "listCustomers" }],
        groupStrategy: ungrouped,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_OPENAPI_STALE_PREVIEW,
      status: 409,
      details: {
        serverId: SERVER_ID,
        documentFingerprint: fingerprintOf(OPERATIONS_DOC),
        refreshRequired: true,
      },
    });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects an empty selection", async () => {
    const db = makeDb([[serverRow]]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [],
        groupStrategy: ungrouped,
      }),
    ).rejects.toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION),
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects an oversized selection", async () => {
    const db = makeDb([[serverRow]]);
    const selection = Array.from(
      { length: MCP_OPENAPI_LIMITS.maxSelection + 1 },
      (_, index) => ({ operationKey: `op_${index}` }),
    );

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection,
        groupStrategy: ungrouped,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION,
      details: {
        limit: MCP_OPENAPI_LIMITS.maxSelection,
        observed: MCP_OPENAPI_LIMITS.maxSelection + 1,
      },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects a duplicated operation key", async () => {
    const db = makeDb([[serverRow]]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [
          { operationKey: "listCustomers" },
          { operationKey: "listCustomers" },
        ],
        groupStrategy: ungrouped,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION,
      details: { operationKeys: ["listCustomers"] },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects a selected blocked operation with its operation key", async () => {
    const db = makeDb([[serverRow], [], [], []]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(BLOCKED_DOC),
        fingerprint: fingerprintOf(BLOCKED_DOC),
        selection: [{ operationKey: "uploadFile" }],
        groupStrategy: ungrouped,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION,
      details: { operationKeys: ["uploadFile"] },
    });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects an unknown operation key", async () => {
    const db = makeDb([[serverRow], [], [], []]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [{ operationKey: "missingOperation" }],
        groupStrategy: ungrouped,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION,
      details: { operationKeys: ["missingOperation"] },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects a name override that is not MCP-safe", async () => {
    const db = makeDb([[serverRow]]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [{ operationKey: "listCustomers", name: "Not Safe" }],
        groupStrategy: ungrouped,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION,
      details: { operationKeys: ["listCustomers"] },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects two selected operations that resolve to the same name", async () => {
    const db = makeDb([[serverRow], [], [], []]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [
          { operationKey: "listCustomers", name: "shared_name" },
          { operationKey: "listInvoices", name: "shared_name" },
        ],
        groupStrategy: ungrouped,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_OPENAPI_INVALID_SELECTION,
      details: { operationKeys: ["listInvoices"] },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("conceals an unknown group id as not found", async () => {
    const db = makeDb([[serverRow], [], [], []]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [{ operationKey: "listCustomers" }],
        groupStrategy: { kind: "existing", groupId: "mtg_missing" },
      }),
    ).rejects.toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND),
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects the tool cap under the lock with the observed count", async () => {
    const db = makeDb([
      [serverRow],
      toolNameRows(toolLimit),
      [],
      [],
      [serverRow],
      [{ count: toolLimit }],
    ]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [{ operationKey: "listCustomers" }],
        groupStrategy: ungrouped,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_TOOL_LIMIT_REACHED,
      details: { serverId: SERVER_ID, limit: toolLimit, observed: toolLimit },
    });
    expect(db.committed.inserted).toEqual([]);
  });

  it("reads the tool cap from configuration under the lock", async () => {
    vi.stubEnv("MCP_MAX_TOOLS_PER_SERVER", "3");
    const db = makeDb([
      [serverRow],
      toolNameRows(3),
      [],
      [],
      [serverRow],
      [{ count: 3 }],
    ]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [{ operationKey: "listCustomers" }],
        groupStrategy: ungrouped,
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_TOOL_LIMIT_REACHED,
      details: { serverId: SERVER_ID, limit: 3, observed: 3 },
    });
    expect(db.committed.inserted).toEqual([]);
  });

  it("rejects the group cap before locking", async () => {
    const groups = Array.from({ length: 50 }, (_, index) =>
      groupRow(`mtg_${index}`, `Group ${index}`),
    );
    const db = makeDb([[serverRow], [], groups, []]);

    await expect(
      confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [{ operationKey: "listCustomers" }],
        groupStrategy: { kind: "new", name: "Overflow" },
      }),
    ).rejects.toMatchObject({
      appCode: APP_ERROR_CODES.MCP_TOOL_GROUP_LIMIT_REACHED,
      details: {
        serverId: SERVER_ID,
        limit: MCP_TOOL_GROUP_LIMITS.maxGroupsPerServer,
        observed: 50,
      },
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rolls back created groups and tools when a selected definition fails to compile", async () => {
    const lockedServer = {
      ...serverRow,
      // A forbidden transport header makes the locked compile fail after the
      // group insert, proving the rollback covers every write.
      commonEntries: {
        headers: [
          {
            id: "common_1",
            name: "host",
            value: { kind: "literal", value: "api.example.com" },
          },
        ],
        query: [],
      },
    };
    const db = makeDb([
      [serverRow],
      [],
      [],
      [],
      [lockedServer],
      [{ count: 0 }],
      [],
      [{ id: "mtg_new", name: "customers" }],
      [],
    ]);

    const thrown = await confirmOpenApiImport(db as never, USER_ID, SERVER_ID, {
      expectedRevision: 1,
      source: contentSource(),
      fingerprint: fingerprintOf(OPERATIONS_DOC),
      selection: [{ operationKey: "listCustomers" }],
      groupStrategy: firstTag,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toSatisfy(
      isAppErrorWith(APP_ERROR_CODES.MCP_COMPILE_INVALID),
    );
    expect((thrown as AppError).status).toBe(409);
    expect((thrown as AppError).details).toMatchObject({
      issueCode: APP_ERROR_CODES.MCP_COMPILE_INVALID,
    });
    expect(db.staged.inserted.length).toBeGreaterThan(0);
    expect(db.committed.inserted).toEqual([]);
    expect(db.boundaryUpdates).toEqual([]);
    expect(telemetryCallFor("mcp_openapi_import_confirmed")).toBeUndefined();
  });

  it("conceals a foreign server as not found", async () => {
    const db = makeDb([[]]);

    await expect(
      confirmOpenApiImport(db as never, "user-b", SERVER_ID, {
        expectedRevision: 1,
        source: contentSource(),
        fingerprint: fingerprintOf(OPERATIONS_DOC),
        selection: [{ operationKey: "listCustomers" }],
        groupStrategy: ungrouped,
      }),
    ).rejects.toSatisfy(isAppErrorWith(APP_ERROR_CODES.MCP_SERVER_NOT_FOUND));
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
