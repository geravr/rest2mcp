import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../schema";
import {
  mcpServer,
  mcpServerVariable,
  mcpTool,
  mcpToolGroup,
  user,
  type NewMcpServer,
  type NewMcpServerVariable,
  type NewMcpTool,
  type NewMcpToolGroup,
} from "../schema";

const SEED_OWNER_ID = "usr_mcp_seed_owner";
const SEED_OWNER_EMAIL = "mcp-seed@example.com";

/**
 * Development-only canonical MCP fixture. It creates owner-scoped servers as
 * UNPUBLISHED drafts (`publishedRevisionId` null, `draftRevision` 1,
 * `status` "draft") so the gateway advertises no tools until the owner runs the
 * normal Studio review/publish flow. No secret material is seeded; the fixture
 * uses non-secret config values only. It also covers the Studio-only tool group
 * projection and one imported OpenAPI tool carrying versioned provenance.
 * Re-running is idempotent.
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
      value: "mcp-seed",
    },
  ];
  for (const value of values) {
    await db.insert(mcpServerVariable).values(value).onConflictDoNothing();
  }

  const groups: NewMcpToolGroup[] = [
    {
      id: "mtg_seed_contacts",
      serverId: "mcs_seed_contacts",
      name: "Contacts",
      normalizedName: "contacts",
    },
  ];
  for (const group of groups) {
    await db.insert(mcpToolGroup).values(group).onConflictDoNothing();
  }

  const tools: NewMcpTool[] = [
    {
      id: "mct_seed_echo",
      serverId: "mcs_seed_echo",
      name: "echo",
      title: "Echo",
      description: "Echo a value back through a query parameter.",
      method: "GET",
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
    {
      id: "mct_seed_list_contact_tags",
      serverId: "mcs_seed_contacts",
      groupId: "mtg_seed_contacts",
      name: "list_contact_tags",
      title: "List contact tags",
      description: "List the tags assigned to one contact.",
      method: "GET",
      source: "manual",
      allowMutation: false,
      enabled: true,
      requestDefinition: {
        version: 1,
        pathSegments: [
          {
            id: "seed_path_tags",
            value: { kind: "literal", value: "/contacts/" },
          },
          {
            id: "seed_path_tags_id",
            value: { kind: "agentInput", agentInputId: "seed_input_tags_id" },
          },
          {
            id: "seed_path_tags_suffix",
            value: { kind: "literal", value: "/tags" },
          },
        ],
        query: [],
        headers: [],
        body: { bodyType: "none" },
        agentInputs: [
          {
            id: "seed_input_tags_id",
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
      id: "mct_seed_echo_headers",
      serverId: "mcs_seed_echo",
      name: "echo_headers",
      title: "Echo headers",
      description: "Echo the request headers back through a curl-derived tool.",
      method: "GET",
      source: "curl",
      allowMutation: false,
      enabled: true,
      requestDefinition: {
        version: 1,
        pathSegments: [
          {
            id: "seed_path_headers",
            value: { kind: "literal", value: "/echo/headers" },
          },
        ],
        query: [],
        headers: [],
        body: { bodyType: "none" },
        agentInputs: [],
      },
    },
    {
      id: "mct_seed_echo_history",
      serverId: "mcs_seed_echo",
      name: "echo_history",
      title: "Echo history",
      description:
        "Imported from an OpenAPI document; arrives disabled until the owner reviews it.",
      method: "GET",
      source: "openapi",
      allowMutation: false,
      enabled: false,
      sourceProvenance: {
        version: 1,
        batchId: "oai_seed_echo_import",
        openApiVersion: "3.1",
        operationKey: "getEchoHistory",
        documentFingerprint:
          "sha256:5f0d3f5a1c9b7e2d4a6c8b0e3f1a7d9c2b4e6f8a0c1d3e5f7a9b1c3d5e7f9a0b",
        definitionHash:
          "sha256:b1c3d5e7f9a0b2d4f6a8c0e2f4a6b8d0c2e4f6a8b0d2e4f6a8c0b2d4e6f8a0c1",
        tags: ["Echo", "History"],
        sourceLabel: "https://echo.example.com/openapi.json",
      },
      requestDefinition: {
        version: 1,
        pathSegments: [
          {
            id: "seed_path_history",
            value: { kind: "literal", value: "/echo/history" },
          },
        ],
        query: [
          {
            id: "seed_query_limit",
            name: "limit",
            value: { kind: "agentInput", agentInputId: "seed_input_limit" },
            omitWhenAbsent: true,
          },
        ],
        headers: [],
        body: { bodyType: "none" },
        agentInputs: [
          {
            id: "seed_input_limit",
            name: "limit",
            description: "Maximum number of history entries to return.",
            required: false,
            sensitive: false,
            type: "integer",
          },
        ],
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
    },
  ];
  for (const tool of tools) {
    await db.insert(mcpTool).values(tool).onConflictDoNothing();
  }

  console.log(
    `✅ Seeded ${servers.length} unpublished MCP draft servers with ${groups.length} Studio tool group(s) (review and publish from Studio)`,
  );
}
