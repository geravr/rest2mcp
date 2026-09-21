import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  generateAuthId,
  schema,
  user,
  type NewMcpTool,
  type NewMcpToolGroup,
} from "@repo/db";
import {
  parseOpenApiSourceProvenance,
  type McpOpenApiSourceProvenance,
} from "../lib/openapi-import-contracts.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

/** Walks the Drizzle/postgres-js cause chain down to the driver's SQLSTATE. */
function databaseErrorOf(error: unknown): {
  code?: string;
  constraint?: string;
} {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null; depth += 1) {
    if (typeof current !== "object") break;
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code,
        constraint:
          typeof candidate.constraint_name === "string"
            ? candidate.constraint_name
            : undefined,
      };
    }
    current = candidate.cause;
  }
  return {};
}

async function captureError(
  run: () => Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await run();
  } catch (error) {
    return databaseErrorOf(error);
  }
  throw new Error("Expected the statement to be rejected.");
}

const provenance: McpOpenApiSourceProvenance = {
  version: 1,
  batchId: "oai_schema_test_batch",
  openApiVersion: "3.1",
  operationKey: "listContacts",
  documentFingerprint:
    "sha256:0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9",
  definitionHash:
    "sha256:f9e8d7c6b5a4938271605f4e3d2c1b0a9f8e7d6c5b4a39281706f5e4d3c2b1a0",
  tags: ["Contacts", "Read"],
  sourceLabel: "https://docs.example.com/openapi.json",
};

const plainDefinition = {
  version: 2 as const,
  pathSegments: [
    { id: "path_1", value: { kind: "literal" as const, value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" as const },
  agentInputs: [],
};

describeIntegration("mcp tool group schema", () => {
  const userId = generateAuthId("user");
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 6 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "Tool Group Schema",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  async function seedServer(label: string): Promise<string> {
    const serverId = `mcs_schema_${userId}_${label}`;
    await db.insert(schema.mcpServer).values({
      id: serverId,
      userId,
      name: `Schema ${label}`,
      slug: serverId,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
    return serverId;
  }

  async function insertGroup(values: NewMcpToolGroup): Promise<void> {
    await db.insert(schema.mcpToolGroup).values(values);
  }

  async function insertTool(values: NewMcpTool): Promise<void> {
    await db.insert(schema.mcpTool).values(values);
  }

  function manualTool(
    serverId: string,
    name: string,
    overrides: Partial<NewMcpTool> = {},
  ): NewMcpTool {
    return {
      id: `mct_${serverId}_${name}`,
      serverId,
      name,
      method: "GET",
      source: "manual",
      enabled: true,
      allowMutation: false,
      requestDefinition: plainDefinition,
      ...overrides,
    };
  }

  describe("normalized group names", () => {
    it("rejects a duplicate normalized name per server and accepts it across servers", async () => {
      const serverA = await seedServer("normalized_a");
      const serverB = await seedServer("normalized_b");
      await insertGroup({
        id: `${serverA}_primary`,
        serverId: serverA,
        name: "Contacts",
        normalizedName: "contacts",
      });

      const failure = await captureError(() =>
        insertGroup({
          id: `${serverA}_duplicate`,
          serverId: serverA,
          name: "CONTACTS",
          normalizedName: "contacts",
        }),
      );
      expect(failure).toEqual({
        code: "23505",
        constraint: "mcp_tool_group_server_normalized_name_unique",
      });

      await expect(
        insertGroup({
          id: `${serverB}_primary`,
          serverId: serverB,
          name: "Contacts",
          normalizedName: "contacts",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("group membership", () => {
    it("rejects a group owned by another server", async () => {
      const serverA = await seedServer("membership_a");
      const serverB = await seedServer("membership_b");
      await insertGroup({
        id: `${serverA}_group`,
        serverId: serverA,
        name: "Contacts",
        normalizedName: "contacts",
      });

      const failure = await captureError(() =>
        insertTool(
          manualTool(serverB, "foreign_group", { groupId: `${serverA}_group` }),
        ),
      );
      expect(failure).toEqual({
        code: "23503",
        constraint: "mcp_tool_group_same_server_fk",
      });
    });

    it("accepts a null group id and a group owned by the same server", async () => {
      const serverId = await seedServer("membership_ok");
      await insertGroup({
        id: `${serverId}_group`,
        serverId,
        name: "Contacts",
        normalizedName: "contacts",
      });

      await expect(
        insertTool(manualTool(serverId, "ungrouped_tool", { groupId: null })),
      ).resolves.toBeUndefined();
      await expect(
        insertTool(
          manualTool(serverId, "grouped_tool", {
            groupId: `${serverId}_group`,
          }),
        ),
      ).resolves.toBeUndefined();
    });

    it("rejects a group id that does not exist", async () => {
      const serverId = await seedServer("membership_missing");

      const failure = await captureError(() =>
        insertTool(
          manualTool(serverId, "missing_group", { groupId: "mtg_absent" }),
        ),
      );
      expect(failure).toEqual({
        code: "23503",
        constraint: "mcp_tool_group_id_mcp_tool_group_id_fk",
      });
    });
  });

  describe("group deletion and server cascade", () => {
    it("un-groups member tools on group deletion without deleting or disabling them", async () => {
      const serverId = await seedServer("ungroup");
      await insertGroup({
        id: `${serverId}_group`,
        serverId,
        name: "Contacts",
        normalizedName: "contacts",
      });
      const toolId = `mct_${serverId}_list_contacts`;
      await insertTool(
        manualTool(serverId, "list_contacts", {
          id: toolId,
          groupId: `${serverId}_group`,
        }),
      );

      await db
        .delete(schema.mcpToolGroup)
        .where(eq(schema.mcpToolGroup.id, `${serverId}_group`));

      const [tool] = await db
        .select()
        .from(schema.mcpTool)
        .where(eq(schema.mcpTool.id, toolId));
      expect(tool).toBeDefined();
      expect(tool?.groupId).toBeNull();
      expect(tool?.name).toBe("list_contacts");
      expect(tool?.method).toBe("GET");
      expect(tool?.enabled).toBe(true);
      expect(tool?.allowMutation).toBe(false);
    });

    it("cascades tools and groups when the server is deleted", async () => {
      const serverId = await seedServer("cascade");
      await insertGroup({
        id: `${serverId}_group`,
        serverId,
        name: "Contacts",
        normalizedName: "contacts",
      });
      await insertTool(
        manualTool(serverId, "list_contacts", { groupId: `${serverId}_group` }),
      );

      await expect(
        db.delete(schema.mcpServer).where(eq(schema.mcpServer.id, serverId)),
      ).resolves.toBeDefined();

      const tools = await db
        .select({ id: schema.mcpTool.id })
        .from(schema.mcpTool)
        .where(eq(schema.mcpTool.serverId, serverId));
      const groups = await db
        .select({ id: schema.mcpToolGroup.id })
        .from(schema.mcpToolGroup)
        .where(eq(schema.mcpToolGroup.serverId, serverId));
      expect(tools).toHaveLength(0);
      expect(groups).toHaveLength(0);
    });
  });

  describe("provenance persistence", () => {
    it("round-trips valid OpenAPI provenance on a tool row", async () => {
      const serverId = await seedServer("provenance");
      const toolId = `mct_${serverId}_openapi_tool`;
      await insertTool(
        manualTool(serverId, "list_contacts", {
          id: toolId,
          source: "openapi",
          enabled: false,
          sourceProvenance: provenance,
        }),
      );

      const [tool] = await db
        .select()
        .from(schema.mcpTool)
        .where(eq(schema.mcpTool.id, toolId));
      expect(parseOpenApiSourceProvenance(tool?.sourceProvenance)).toEqual(
        provenance,
      );
      expect(tool?.enabled).toBe(false);
      expect(tool?.allowMutation).toBe(false);
    });

    it("returns null for absent or unknown provenance payloads", async () => {
      const serverId = await seedServer("provenance_rejected");
      const manualToolId = `mct_${serverId}_manual_tool`;
      const wrongVersionToolId = `mct_${serverId}_wrong_version`;
      const missingFieldToolId = `mct_${serverId}_missing_field`;

      await insertTool(
        manualTool(serverId, "manual_tool", { id: manualToolId }),
      );
      await insertTool(
        manualTool(serverId, "wrong_version", {
          id: wrongVersionToolId,
          source: "openapi",
          enabled: false,
          sourceProvenance: { ...provenance, version: 2 as never },
        }),
      );
      const withoutTags = { ...provenance };
      delete (withoutTags as { tags?: unknown }).tags;
      await insertTool(
        manualTool(serverId, "missing_field", {
          id: missingFieldToolId,
          source: "openapi",
          enabled: false,
          sourceProvenance: { ...withoutTags },
        }),
      );

      const rows = await db
        .select()
        .from(schema.mcpTool)
        .where(eq(schema.mcpTool.serverId, serverId));
      const byId = new Map(rows.map((row) => [row.id, row]));

      expect(
        parseOpenApiSourceProvenance(byId.get(manualToolId)?.sourceProvenance),
      ).toBeNull();
      expect(
        parseOpenApiSourceProvenance(
          byId.get(wrongVersionToolId)?.sourceProvenance,
        ),
      ).toBeNull();
      expect(
        parseOpenApiSourceProvenance(
          byId.get(missingFieldToolId)?.sourceProvenance,
        ),
      ).toBeNull();
    });

    it("round-trips provenance on a revision tool snapshot", async () => {
      const serverId = await seedServer("revision_provenance");
      const revisionId = `${serverId}_rev_1`;
      await db.insert(schema.mcpServerRevision).values({
        id: revisionId,
        serverId,
        revisionNumber: 1,
        sourceDraftRevision: 1,
        candidateFingerprint: "cand_revision_provenance",
        contractFingerprint: "contract_revision_provenance",
        schemaVersion: 1,
        compilerVersion: "2",
        name: "Revision provenance",
        baseUrl: "https://api.example.com",
        allowedHosts: ["api.example.com"],
        publishRequestId: `${serverId}_req_1`,
        actorSource: "studio",
      });
      await db.insert(schema.mcpServerRevisionTool).values({
        id: `${revisionId}_tool`,
        revisionId,
        serverId,
        sourceToolId: `${serverId}_tool`,
        name: "list_contacts",
        method: "GET",
        requestDefinition: plainDefinition,
        compileStatus: "valid",
        allowMutation: false,
        enabled: true,
        source: "openapi",
        sourceProvenance: provenance,
        toolOrder: 0,
      });

      const [snapshot] = await db
        .select()
        .from(schema.mcpServerRevisionTool)
        .where(eq(schema.mcpServerRevisionTool.revisionId, revisionId));
      expect(snapshot?.sourceProvenance).toEqual(provenance);
      expect(parseOpenApiSourceProvenance(snapshot?.sourceProvenance)).toEqual(
        provenance,
      );
    });
  });
});
