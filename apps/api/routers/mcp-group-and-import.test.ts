import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MCP_TOOL_GROUP_LIMITS } from "@repo/core";
import {
  assignToolGroupCommandSchema,
  createToolCommandSchema,
  createToolGroupCommandSchema,
  curlConfirmCommandSchema,
  deleteToolGroupCommandSchema,
  renameToolGroupCommandSchema,
  toolGroupFilterSchema,
  updateToolCommandSchema,
} from "../lib/mcp-domain-commands.js";
import {
  openApiImportConfirmCommandSchema,
  openApiImportPreviewCommandSchema,
} from "../lib/openapi-import-commands.js";
import {
  studioCreateToolCommandSchema,
  studioCurlConfirmCommandSchema,
  studioUpdateToolCommandSchema,
} from "../lib/mcp-studio-commands.js";

type Parseable = { safeParse: (value: unknown) => { success: boolean } };

const SERVER_ID = "mcs_router_test";
const GROUP_ID = "mtg_router_test";

const requestDefinition = {
  version: 2,
  pathSegments: [
    { id: "seg0", value: { kind: "literal", value: "/contacts" } },
  ],
  query: [],
  headers: [],
  body: { bodyType: "none" },
  agentInputs: [],
};

const validCreateTool = {
  serverId: SERVER_ID,
  expectedRevision: 1,
  name: "list_contacts",
  method: "GET",
  requestDefinition,
};

const validCurl = {
  serverId: SERVER_ID,
  expectedRevision: 1,
  curl: "curl https://api.example.com/contacts",
};

const validOpenApiSource = {
  kind: "content",
  content: '{"openapi":"3.1.0","info":{"title":"t","version":"1"},"paths":{}}',
};

describe("mcp router group and OpenAPI import procedures", () => {
  const source = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");

  function procedureBody(name: string): string {
    const marker = `${name}: protectedProcedure`;
    const start = source.indexOf(marker);
    expect(start, `${name} must be a protectedProcedure`).toBeGreaterThan(-1);
    const next = source.indexOf(": protectedProcedure", start + marker.length);
    return next === -1 ? source.slice(start) : source.slice(start, next);
  }

  it("exposes every group and import procedure as a protected procedure", () => {
    const procedures = [
      "toolGroups",
      "createToolGroup",
      "renameToolGroup",
      "deleteToolGroup",
      "assignToolGroup",
      "previewOpenApiImport",
      "confirmOpenApiImport",
    ];
    for (const name of procedures) {
      expect(procedureBody(name).length, name).toBeGreaterThan(0);
    }
  });

  it("wires each procedure to its service and the strict command schema", () => {
    expect(procedureBody("toolGroups")).toContain("listToolGroups(");
    expect(procedureBody("createToolGroup")).toContain(
      "createToolGroupCommandSchema",
    );
    expect(procedureBody("renameToolGroup")).toContain(
      "renameToolGroupCommandSchema",
    );
    expect(procedureBody("deleteToolGroup")).toContain(
      "deleteToolGroupCommandSchema",
    );
    expect(procedureBody("assignToolGroup")).toContain(
      "assignToolGroupCommandSchema",
    );
    expect(procedureBody("previewOpenApiImport")).toContain(
      "openApiImportPreviewCommandSchema",
    );
    expect(procedureBody("confirmOpenApiImport")).toContain(
      "openApiImportConfirmCommandSchema",
    );
  });

  it("filters the tool query with the shared optional group filter", () => {
    const body = procedureBody("tools");
    expect(body).toContain("toolGroupFilterSchema");
    expect(body).toContain("listTools(");
  });

  it("rejects unknown keys on every group and import command", () => {
    const commands: Array<[string, Parseable, Record<string, unknown>]> = [
      [
        "createToolGroupCommandSchema",
        createToolGroupCommandSchema,
        { serverId: SERVER_ID, expectedRevision: 1, name: "Customers" },
      ],
      [
        "renameToolGroupCommandSchema",
        renameToolGroupCommandSchema,
        {
          serverId: SERVER_ID,
          expectedRevision: 1,
          groupId: GROUP_ID,
          name: "Customers",
        },
      ],
      [
        "deleteToolGroupCommandSchema",
        deleteToolGroupCommandSchema,
        { serverId: SERVER_ID, expectedRevision: 1, groupId: GROUP_ID },
      ],
      [
        "assignToolGroupCommandSchema",
        assignToolGroupCommandSchema,
        {
          serverId: SERVER_ID,
          expectedRevision: 1,
          toolIds: ["mct_1"],
          groupId: GROUP_ID,
        },
      ],
      [
        "openApiImportPreviewCommandSchema",
        openApiImportPreviewCommandSchema,
        { serverId: SERVER_ID, source: validOpenApiSource },
      ],
      [
        "openApiImportConfirmCommandSchema",
        openApiImportConfirmCommandSchema,
        {
          serverId: SERVER_ID,
          expectedRevision: 1,
          source: validOpenApiSource,
          fingerprint: "abc123",
          selection: [{ operationKey: "GET /contacts" }],
          groupStrategy: { kind: "ungrouped" },
        },
      ],
    ];
    for (const [label, schema, payload] of commands) {
      expect(schema.safeParse(payload).success, label).toBe(true);
      expect(
        schema.safeParse({ ...payload, unknownKey: true }).success,
        label,
      ).toBe(false);
    }
  });

  it("bounds group names and rejects empty or oversized values", () => {
    const create = {
      serverId: SERVER_ID,
      expectedRevision: 1,
      name: "Customers",
    };
    const rename = { ...create, groupId: GROUP_ID };
    for (const [label, schema, payload] of [
      ["create", createToolGroupCommandSchema, create],
      ["rename", renameToolGroupCommandSchema, rename],
    ] as Array<[string, Parseable, Record<string, unknown>]>) {
      expect(schema.safeParse(payload).success, label).toBe(true);
      expect(
        schema.safeParse({ ...payload, name: "" }).success,
        `${label} empty`,
      ).toBe(false);
      expect(
        schema.safeParse({ ...payload, name: "   " }).success,
        `${label} blank`,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...payload,
          name: "x".repeat(MCP_TOOL_GROUP_LIMITS.name + 1),
        }).success,
        `${label} oversized`,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...payload,
          name: "x".repeat(MCP_TOOL_GROUP_LIMITS.name),
        }).success,
        `${label} at limit`,
      ).toBe(true);
    }
  });

  it("requires a non-empty tool selection and accepts a group or null", () => {
    const payload = {
      serverId: SERVER_ID,
      expectedRevision: 1,
      toolIds: ["mct_1"],
      groupId: GROUP_ID,
    };
    expect(assignToolGroupCommandSchema.safeParse(payload).success).toBe(true);
    expect(
      assignToolGroupCommandSchema.safeParse({ ...payload, groupId: null })
        .success,
    ).toBe(true);
    expect(
      assignToolGroupCommandSchema.safeParse({ ...payload, toolIds: [] })
        .success,
    ).toBe(false);
    expect(
      assignToolGroupCommandSchema.safeParse({ ...payload, toolIds: [""] })
        .success,
    ).toBe(false);
  });

  it("keeps Studio group placement out of the shared Platform tool schemas", () => {
    expect(
      studioCreateToolCommandSchema.safeParse({
        ...validCreateTool,
        groupId: GROUP_ID,
      }).success,
    ).toBe(true);
    expect(
      studioCreateToolCommandSchema.safeParse({
        ...validCreateTool,
        groupId: null,
      }).success,
    ).toBe(true);
    expect(
      createToolCommandSchema.safeParse({
        ...validCreateTool,
        groupId: GROUP_ID,
      }).success,
    ).toBe(false);

    expect(
      studioUpdateToolCommandSchema.safeParse({
        serverId: SERVER_ID,
        toolId: "mct_1",
        expectedRevision: 1,
        groupId: GROUP_ID,
      }).success,
    ).toBe(true);
    expect(
      updateToolCommandSchema.safeParse({
        serverId: SERVER_ID,
        toolId: "mct_1",
        expectedRevision: 1,
        groupId: GROUP_ID,
      }).success,
    ).toBe(false);

    expect(
      studioCurlConfirmCommandSchema.safeParse({
        ...validCurl,
        groupId: GROUP_ID,
      }).success,
    ).toBe(true);
    expect(
      curlConfirmCommandSchema.safeParse({
        ...validCurl,
        groupId: GROUP_ID,
      }).success,
    ).toBe(false);
  });

  it("binds OpenAPI confirmation to a fingerprint and a non-empty selection", () => {
    const payload = {
      serverId: SERVER_ID,
      expectedRevision: 1,
      source: validOpenApiSource,
      fingerprint: "abc123",
      selection: [{ operationKey: "GET /contacts" }],
      groupStrategy: { kind: "ungrouped" },
    };
    expect(openApiImportConfirmCommandSchema.safeParse(payload).success).toBe(
      true,
    );
    expect(
      openApiImportConfirmCommandSchema.safeParse({
        ...payload,
        fingerprint: undefined,
      }).success,
    ).toBe(false);
    expect(
      openApiImportConfirmCommandSchema.safeParse({
        ...payload,
        fingerprint: "",
      }).success,
    ).toBe(false);
    expect(
      openApiImportConfirmCommandSchema.safeParse({ ...payload, selection: [] })
        .success,
    ).toBe(false);
    expect(
      openApiImportConfirmCommandSchema.safeParse({
        ...payload,
        groupStrategy: { kind: "bogus" },
      }).success,
    ).toBe(false);
    expect(
      openApiImportConfirmCommandSchema.safeParse({
        ...payload,
        groupStrategy: { kind: "existing", groupId: GROUP_ID },
      }).success,
    ).toBe(true);
  });

  it("accepts every tool group filter form and rejects an empty string", () => {
    expect(toolGroupFilterSchema.safeParse(undefined).success).toBe(true);
    expect(toolGroupFilterSchema.safeParse("all").success).toBe(true);
    expect(toolGroupFilterSchema.safeParse("ungrouped").success).toBe(true);
    expect(toolGroupFilterSchema.safeParse(GROUP_ID).success).toBe(true);
    expect(toolGroupFilterSchema.safeParse("").success).toBe(false);
    expect(
      toolGroupFilterSchema.safeParse("x".repeat(65)).success,
      "over-long filter",
    ).toBe(false);
  });
});
