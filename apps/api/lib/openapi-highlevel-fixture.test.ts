/**
 * Minimized HighLevel-derived OpenAPI fixture: body arrays, query arrays,
 * optional structured fields, composition, collisions, reduced-validation
 * unions, and genuinely unsupported operations.
 */
import { describe, expect, it } from "vitest";
import { MCP_OPENAPI_ISSUE_CODES } from "@repo/core";
import { compileToolDefinition } from "./mcp-compiler.js";
import {
  parseOpenApiDocument,
  suggestMcpToolName,
} from "./openapi-document.js";
import { mapInventoryOperation } from "./openapi-mapper.js";

const HIGHLEVEL_LIKE_DOCUMENT = {
  openapi: "3.1.0",
  info: { title: "HighLevel-like Campaigns", version: "1.0.0" },
  servers: [{ url: "https://api.example.com/v1" }],
  paths: {
    "/campaigns/{campaign-id}": {
      get: {
        operationId: "getCampaign",
        parameters: [
          {
            name: "campaign-id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "campaign.id",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "tags",
            in: "query",
            style: "form",
            explode: true,
            schema: {
              type: "array",
              items: { type: "string" },
              maxItems: 20,
            },
          },
        ],
      },
    },
    "/campaigns": {
      post: {
        operationId: "createCampaign",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                allOf: [
                  {
                    type: "object",
                    required: ["name"],
                    properties: { name: { type: "string" } },
                  },
                  {
                    type: "object",
                    properties: {
                      tags: { type: "array", items: { type: "string" } },
                      meta: {
                        type: "object",
                        properties: { source: { type: "string" } },
                      },
                      channel: {
                        oneOf: [
                          { type: "string" },
                          {
                            type: "object",
                            properties: { id: { type: "string" } },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
    "/assets": {
      post: {
        operationId: "uploadAsset",
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
      },
    },
    "/search": {
      get: {
        operationId: "pipeFilter",
        parameters: [
          {
            name: "ids",
            in: "query",
            style: "pipeDelimited",
            schema: { type: "array", items: { type: "string" } },
          },
        ],
      },
    },
  },
};

const SERVER_BASE_URL = "https://api.example.com/v1";

function mapAll() {
  const inventory = parseOpenApiDocument(
    JSON.stringify(HIGHLEVEL_LIKE_DOCUMENT),
  );
  return inventory.operations.map((operation) =>
    mapInventoryOperation({
      operation,
      document: inventory.document,
      serverBaseUrl: SERVER_BASE_URL,
      suggestedName: suggestMcpToolName(operation),
      existingToolNames: [],
    }),
  );
}

describe("HighLevel-derived OpenAPI fixture", () => {
  it("makes newly supported operations selectable and keeps unsupported ones blocked", () => {
    const mapped = mapAll();
    const byKey = new Map(mapped.map((entry) => [entry.operationKey, entry]));

    const getCampaign = byKey.get("getCampaign");
    expect(getCampaign?.selectable).toBe(true);
    expect(getCampaign?.path).toBe("/campaigns/{campaign-id}");
    expect(getCampaign?.method).toBe("GET");
    expect(
      getCampaign?.requestDefinition?.agentInputs.map((input) => input.name),
    ).toEqual(["path_campaign_id", "query_campaign_id", "tags"]);
    expect(
      getCampaign?.requestDefinition?.agentInputs.find(
        (input) => input.name === "tags",
      ),
    ).toMatchObject({
      type: "array",
      maxItems: 20,
      items: { type: "string" },
    });
    expect(
      getCampaign?.requestDefinition?.query.find(
        (entry) => entry.name === "tags",
      ),
    ).toMatchObject({
      serialization: { style: "form", explode: true },
    });
    expect(
      compileToolDefinition({
        method: "GET",
        definition: getCampaign!.requestDefinition!,
        common: { headers: [], query: [] },
        auth: null,
        serverValues: [],
        basePath: "/v1",
        allowMutation: false,
      }).ok,
    ).toBe(true);

    const createCampaign = byKey.get("createCampaign");
    expect(createCampaign?.selectable).toBe(true);
    expect(createCampaign?.issues.map((issue) => issue.code)).toContain(
      MCP_OPENAPI_ISSUE_CODES.REDUCED_VALIDATION,
    );
    const inputs = createCampaign?.requestDefinition?.agentInputs ?? [];
    expect(inputs.find((input) => input.name === "name")).toMatchObject({
      type: "string",
      required: true,
    });
    expect(inputs.find((input) => input.name === "tags")).toMatchObject({
      type: "array",
      required: false,
    });
    expect(inputs.find((input) => input.name === "meta")).toMatchObject({
      type: "json",
      required: false,
    });
    expect(inputs.find((input) => input.name === "channel")).toMatchObject({
      type: "json",
      required: false,
    });
    expect(
      compileToolDefinition({
        method: "POST",
        definition: createCampaign!.requestDefinition!,
        common: { headers: [], query: [] },
        auth: null,
        serverValues: [],
        basePath: "/v1",
        allowMutation: false,
      }).ok,
    ).toBe(true);

    expect(byKey.get("uploadAsset")?.selectable).toBe(false);
    expect(
      byKey.get("uploadAsset")?.issues.map((issue) => issue.code),
    ).toContain(MCP_OPENAPI_ISSUE_CODES.MULTIPART_BODY);
    expect(byKey.get("pipeFilter")?.selectable).toBe(false);
    expect(
      byKey.get("pipeFilter")?.issues.map((issue) => issue.code),
    ).toContain(MCP_OPENAPI_ISSUE_CODES.UNSUPPORTED_SERIALIZATION);
  });
});
