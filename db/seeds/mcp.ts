import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../schema";
import {
  mcpServer,
  mcpServerVariable,
  mcpTool,
  user,
  type NewMcpServer,
  type NewMcpServerVariable,
  type NewMcpTool,
} from "../schema";

const SEED_OWNER_ID = "usr_mcp_seed_owner";
const SEED_OWNER_EMAIL = "mcp-seed@example.com";

/**
 * Development-only canonical MCP fixture. It creates owner-scoped servers as
 * UNPUBLISHED drafts (`publishedRevisionId` null, `draftRevision` 1,
 * `status` "draft") so the gateway advertises no tools until the owner runs the
 * normal Studio review/publish flow. No secret material is seeded; the fixture
 * uses non-secret config values only. Re-running is idempotent.
 */
export async function seedMcp(db: PostgresJsDatabase<typeof schema>) {
  console.log("Seeding MCP servers...");

  await db
    .insert(user)
    .values({
      id: SEED_OWNER_ID,
      name: "MCP Seed Owner",
      email: SEED_OWNER_EMAIL,
      emailVerified: true,
    })
    .onConflictDoNothing();

  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, SEED_OWNER_EMAIL))
    .limit(1);
  if (!owner) {
    throw new Error("MCP seed owner could not be resolved.");
  }

  const servers: NewMcpServer[] = [
    {
      id: "mcs_seed_echo",
      userId: owner.id,
      name: "Echo API",
      slug: "echo-api",
      description:
        "Draft fixture that echoes a query value. Publish from Studio before agents can call it.",
      baseUrl: "https://echo.example.com",
      allowedHosts: ["echo.example.com"],
      status: "draft",
      draftRevision: 1,
      publishedRevisionId: null,
      commonEntries: {
        headers: [
          {
            id: "seed_hdr_client",
            name: "X-Client",
            value: {
              kind: "serverValue",
              serverValueId: "msv_seed_echo_client",
            },
          },
        ],
        query: [],
      },
    },
    {
      id: "mcs_seed_contacts",
      userId: owner.id,
      name: "Contacts Demo",
      slug: "contacts-demo",
      description:
        "Draft fixture with read tools over a contacts API. Publish from Studio before agents can call it.",
      baseUrl: "https://contacts.example.com",
      allowedHosts: ["contacts.example.com"],
      status: "draft",
      draftRevision: 1,
      publishedRevisionId: null,
    },
  ];

  for (const server of servers) {
    await db.insert(mcpServer).values(server).onConflictDoNothing();
  }

  const values: NewMcpServerVariable[] = [
    {
      id: "msv_seed_echo_client",
      serverId: "mcs_seed_echo",
      name: "client_name",
      kind: "config",
      owner: "manual",
      description: "Non-secret client identifier sent as X-Client.",
      isSecret: false,
      value: "mcp-seed",
    },
  ];
  for (const value of values) {
    await db.insert(mcpServerVariable).values(value).onConflictDoNothing();
  }

  const tools: NewMcpTool[] = [
    {
      id: "mct_seed_echo",
      serverId: "mcs_seed_echo",
      name: "echo",
      title: "Echo",
      description: "Echo a value back through a query parameter.",
      method: "GET",
      pathTemplate: "/echo",
      source: "manual",
      allowMutation: false,
      enabled: true,
      requestDefinition: {
        version: 1,
        pathSegments: [
          { id: "seed_path_echo", value: { kind: "literal", value: "/echo" } },
        ],
        query: [
          {
            id: "seed_query_q",
            name: "q",
            value: { kind: "agentInput", agentInputId: "seed_input_q" },
            omitWhenAbsent: true,
          },
        ],
        headers: [],
        body: { bodyType: "none" },
        agentInputs: [
          {
            id: "seed_input_q",
            name: "q",
            description: "Optional value to echo.",
            required: false,
            sensitive: false,
            type: "string",
          },
        ],
      },
    },
    {
      id: "mct_seed_get_contact",
      serverId: "mcs_seed_contacts",
      name: "get_contact",
      title: "Get contact",
      description: "Fetch a single contact by id.",
      method: "GET",
      pathTemplate: "/contacts/{id}",
      source: "manual",
      allowMutation: false,
      enabled: true,
      requestDefinition: {
        version: 1,
        pathSegments: [
          {
            id: "seed_path_contacts",
            value: { kind: "literal", value: "/contacts/" },
          },
          {
            id: "seed_path_id",
            value: { kind: "agentInput", agentInputId: "seed_input_id" },
          },
        ],
        query: [],
        headers: [],
        body: { bodyType: "none" },
        agentInputs: [
          {
            id: "seed_input_id",
            name: "id",
            description: "Contact id.",
            required: true,
            sensitive: false,
            type: "string",
          },
        ],
      },
    },
    {
      id: "mct_seed_search_contacts",
      serverId: "mcs_seed_contacts",
      name: "search_contacts",
      title: "Search contacts",
      description: "Search contacts by free-text query.",
      method: "GET",
      pathTemplate: "/contacts",
      source: "manual",
      allowMutation: false,
      enabled: true,
      requestDefinition: {
        version: 1,
        pathSegments: [
          {
            id: "seed_path_search",
            value: { kind: "literal", value: "/contacts" },
          },
        ],
        query: [
          {
            id: "seed_query_search",
            name: "q",
            value: { kind: "agentInput", agentInputId: "seed_input_query" },
            omitWhenAbsent: true,
          },
        ],
        headers: [],
        body: { bodyType: "none" },
        agentInputs: [
          {
            id: "seed_input_query",
            name: "q",
            description: "Optional search text.",
            required: false,
            sensitive: false,
            type: "string",
          },
        ],
      },
    },
  ];
  for (const tool of tools) {
    await db.insert(mcpTool).values(tool).onConflictDoNothing();
  }

  console.log(
    `✅ Seeded ${servers.length} unpublished MCP draft servers (review and publish from Studio)`,
  );
}
