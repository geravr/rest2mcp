import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { APP_ERROR_CODES } from "@repo/core";
import { generateAuthId, schema, user } from "@repo/db";
import { AppError } from "../lib/app-error.js";
import { deleteToolGroup } from "./mcp-tool-group-service.js";
import { confirmCurlImport, createTool } from "./mcp-studio-service.js";

const connectionString = process.env.DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

const definition = {
  version: 1 as const,
  pathSegments: [
    { id: "seg0", value: { kind: "literal" as const, value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" as const },
  agentInputs: [],
};

/** Walks the Drizzle/postgres-js cause chain down to the driver's SQLSTATE. */
function pgCodeOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null; depth += 1) {
    if (typeof current !== "object") break;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

describeIntegration("manual and curl tool group placement", () => {
  const userId = generateAuthId("user");
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let counter = 0;

  async function createServer(): Promise<string> {
    counter += 1;
    const id = `${userId}_srv_${counter}`;
    await db.insert(schema.mcpServer).values({
      id,
      userId,
      name: `Grouping ${counter}`,
      slug: id,
      baseUrl: "https://api.example.com",
      allowedHosts: ["api.example.com"],
      status: "draft",
    });
    return id;
  }

  async function createGroup(serverId: string, name: string): Promise<string> {
    counter += 1;
    const id = `${serverId}_grp_${counter}`;
    await db.insert(schema.mcpToolGroup).values({
      id,
      serverId,
      name,
      normalizedName: name.toLowerCase(),
    });
    return id;
  }

  async function readServerRevision(serverId: string) {
    const [row] = await db
      .select({
        configRevision: schema.mcpServer.configRevision,
        draftRevision: schema.mcpServer.draftRevision,
      })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    return row;
  }

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 6 });
    db = drizzle(client, { schema, casing: "snake_case" });
    await db.insert(user).values({
      id: userId,
      name: "Tool Grouping",
      email: `${userId}@example.com`,
      emailVerified: true,
    });
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.id, userId));
    await client.end();
  });

  it("assigns a same-server group on manual create", async () => {
    const serverId = await createServer();
    const groupId = await createGroup(serverId, "Contacts");

    const created = await createTool(db as never, userId, serverId, {
      expectedRevision: 1,
      name: "list_contacts",
      method: "GET",
      requestDefinition: definition,
      enabled: false,
      groupId,
    });

    expect(created.groupId).toBe(groupId);
    const [stored] = await db
      .select()
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.id, created.id));
    expect(stored?.groupId).toBe(groupId);
  });

  it("rejects a cross-server group without creating the tool", async () => {
    const ownerServerId = await createServer();
    const otherServerId = await createServer();
    const foreignGroupId = await createGroup(ownerServerId, "Foreign");

    const failure = await createTool(db as never, userId, otherServerId, {
      expectedRevision: 1,
      name: "foreign_group_tool",
      method: "GET",
      requestDefinition: definition,
      enabled: false,
      groupId: foreignGroupId,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).appCode).toBe(
      APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
    );
    expect(pgCodeOf(failure)).toBeUndefined();
    const [tools] = await db
      .select({ count: count() })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, otherServerId));
    expect(tools?.count).toBe(0);
    // The concealed group itself is untouched on its own server.
    const [group] = await db
      .select({ id: schema.mcpToolGroup.id })
      .from(schema.mcpToolGroup)
      .where(eq(schema.mcpToolGroup.id, foreignGroupId));
    expect(group?.id).toBe(foreignGroupId);
  });

  it("leaves authentication, common entries, and server values unchanged on grouped curl import", async () => {
    const serverId = await createServer();
    const groupId = await createGroup(serverId, "Curl imports");
    await db
      .update(schema.mcpServer)
      .set({
        authConfiguration: {
          kind: "bearer",
          bindings: [
            {
              location: "header",
              key: "Authorization",
              serverValueId: `${serverId}_token`,
            },
          ],
        },
        commonEntries: {
          headers: [
            {
              id: "hdr_1",
              name: "Version",
              value: { kind: "literal", value: "2024-01" },
            },
          ],
          query: [],
        },
      })
      .where(eq(schema.mcpServer.id, serverId));
    await db.insert(schema.mcpServerVariable).values([
      {
        id: `${serverId}_token`,
        serverId,
        name: "api_token",
        kind: "secret",
        owner: "auth",
        ciphertext:
          "v1:00000000000000000000000000000000:11111111111111111111111111111111",
      },
      {
        id: `${serverId}_version`,
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
    const valuesBefore = await db
      .select()
      .from(schema.mcpServerVariable)
      .where(eq(schema.mcpServerVariable.serverId, serverId))
      .orderBy(schema.mcpServerVariable.id);

    const result = await confirmCurlImport(db as never, userId, serverId, {
      expectedRevision: 1,
      curl: `curl -H 'Authorization: Bearer super-secret' https://api.example.com/contacts`,
      groupId,
    });

    expect(result.groupId).toBe(groupId);
    expect(result.excludedCredentials).toEqual([
      { kind: "bearer", headerName: "Authorization" },
    ]);

    const [serverAfter] = await db
      .select({
        authConfiguration: schema.mcpServer.authConfiguration,
        commonEntries: schema.mcpServer.commonEntries,
      })
      .from(schema.mcpServer)
      .where(eq(schema.mcpServer.id, serverId));
    const valuesAfter = await db
      .select()
      .from(schema.mcpServerVariable)
      .where(eq(schema.mcpServerVariable.serverId, serverId))
      .orderBy(schema.mcpServerVariable.id);
    expect(JSON.stringify(serverAfter)).toBe(JSON.stringify(serverBefore));
    expect(JSON.stringify(valuesAfter)).toBe(JSON.stringify(valuesBefore));

    const tools = await db
      .select()
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, serverId));
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      source: "curl",
      enabled: false,
      allowMutation: false,
      groupId,
    });
    expect(JSON.stringify(tools)).not.toContain("super-secret");
  });

  it("rolls back a curl import that targets a foreign group", async () => {
    const ownerServerId = await createServer();
    const otherServerId = await createServer();
    const foreignGroupId = await createGroup(ownerServerId, "Foreign curl");

    const failure = await confirmCurlImport(
      db as never,
      userId,
      otherServerId,
      {
        expectedRevision: 1,
        curl: `curl https://api.example.com/contacts`,
        groupId: foreignGroupId,
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).appCode).toBe(
      APP_ERROR_CODES.MCP_TOOL_GROUP_NOT_FOUND,
    );
    // The service must conceal the foreign group instead of letting the
    // composite membership foreign key raise a raw SQLSTATE 23503.
    expect(pgCodeOf(failure)).toBeUndefined();

    const [tools] = await db
      .select({ count: count() })
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.serverId, otherServerId));
    expect(tools?.count).toBe(0);
    const [variables] = await db
      .select({ count: count() })
      .from(schema.mcpServerVariable)
      .where(eq(schema.mcpServerVariable.serverId, otherServerId));
    expect(variables?.count).toBe(0);
    await expect(readServerRevision(otherServerId)).resolves.toEqual({
      configRevision: 1,
      draftRevision: 1,
    });
  });

  it("keeps the tool and ungroups it when its group is deleted", async () => {
    const serverId = await createServer();
    const groupId = await createGroup(serverId, "Temporary");
    const created = await createTool(db as never, userId, serverId, {
      expectedRevision: 1,
      name: "grouped_tool",
      method: "GET",
      requestDefinition: definition,
      enabled: false,
      groupId,
    });

    const deleted = await deleteToolGroup(db as never, userId, serverId, {
      expectedRevision: 2,
      groupId,
    });
    expect(deleted.ungroupedToolCount).toBe(1);

    const [tool] = await db
      .select()
      .from(schema.mcpTool)
      .where(eq(schema.mcpTool.id, created.id));
    expect(tool).toBeDefined();
    expect(tool?.groupId).toBeNull();
    expect(tool?.name).toBe("grouped_tool");
    expect(tool?.method).toBe("GET");
    expect(tool?.enabled).toBe(false);
    expect(tool?.allowMutation).toBe(false);

    const groups = await db
      .select({ id: schema.mcpToolGroup.id })
      .from(schema.mcpToolGroup)
      .where(eq(schema.mcpToolGroup.serverId, serverId));
    expect(groups).toHaveLength(0);
  });
});
