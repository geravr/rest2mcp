import { describe, expect, it } from "vitest";
import { APP_ERROR_CODES } from "@repo/core";
import { AppError } from "./app-error.js";
import {
  buildCurlImportDraft,
  detectCurlCredentials,
  previewCurlImport,
} from "./mcp-curl-import.js";

describe("previewCurlImport", () => {
  it("returns a sanitized draft shape without the credential value", () => {
    const preview = previewCurlImport(
      "https://api.example.com",
      `curl -H 'Authorization: Bearer tok_secret' -H 'Accept: application/json' 'https://api.example.com/v1/items?limit=10'`,
    );

    expect(preview.method).toBe("GET");
    expect(preview.relativePath).toBe("/v1/items");
    expect(preview.query).toEqual([{ key: "limit", value: "10" }]);
    expect(preview.headers).toEqual([
      { name: "Accept", value: "application/json" },
    ]);
    expect(preview.excludedCredentials).toEqual([
      { kind: "bearer", headerName: "Authorization" },
    ]);
    expect(JSON.stringify(preview)).not.toContain("tok_secret");
  });

  it("respects the base-path boundary instead of stripping a text prefix", () => {
    expect(() =>
      previewCurlImport(
        "https://api.example.com/v1",
        "curl https://api.example.com/v10/items",
      ),
    ).toThrow(AppError);
  });

  it("resolves the relative path beneath a non-root base path", () => {
    const preview = previewCurlImport(
      "https://api.example.com/v2",
      "curl https://api.example.com/v2/items",
    );
    expect(preview.relativePath).toBe("/items");
  });

  it("rejects a foreign origin", () => {
    try {
      previewCurlImport(
        "https://api.example.com",
        "curl https://evil.example.com/items",
      );
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).appCode).toBe(
        APP_ERROR_CODES.MCP_CURL_INVALID,
      );
    }
  });

  it("preserves ordered repeated query entries", () => {
    const preview = previewCurlImport(
      "https://api.example.com",
      "curl 'https://api.example.com/items?tag=a&tag=b'",
    );
    expect(preview.query).toEqual([
      { key: "tag", value: "a" },
      { key: "tag", value: "b" },
    ]);
    expect(preview.occurrences).toContainEqual({
      occurrenceId: "query:tag:0",
      location: "query",
      key: "tag",
      value: "a",
    });
    expect(preview.occurrences).toContainEqual({
      occurrenceId: "query:tag:1",
      location: "query",
      key: "tag",
      value: "b",
    });
  });

  it("lists JSON body leaves as markable occurrences", () => {
    const preview = previewCurlImport(
      "https://api.example.com",
      `curl -X POST -H 'Content-Type: application/json' -d '{"name":"John","age":30}' https://api.example.com/contacts`,
    );
    expect(preview.body?.bodyType).toBe("json");
    expect(preview.occurrences).toContainEqual({
      occurrenceId: "json:name",
      location: "json",
      jsonPath: "name",
      value: "John",
    });
    expect(preview.occurrences).toContainEqual({
      occurrenceId: "json:age",
      location: "json",
      jsonPath: "age",
      value: "30",
    });
  });
});

describe("detectCurlCredentials", () => {
  it("reports every credential parsed from the curl command", () => {
    const credentials = detectCurlCredentials(
      `curl -H 'Authorization: Bearer tok' -b 'session=x' https://api.example.com`,
    );
    expect(credentials.map((c) => c.kind).sort()).toEqual(["bearer", "cookie"]);
  });

  it("returns an empty list for credential-free curl", () => {
    expect(detectCurlCredentials("curl https://api.example.com/x")).toEqual([]);
  });
});

describe("buildCurlImportDraft", () => {
  const serverBaseUrl = "https://api.example.com";

  it("builds a fully literal definition with no markings", () => {
    const draft = buildCurlImportDraft({
      serverBaseUrl,
      curl: "curl 'https://api.example.com/v1/items?limit=10'",
      markings: [],
      serverValues: [],
    });

    expect(draft.method).toBe("GET");
    expect(draft.requestDefinition.pathSegments).toEqual([
      { id: "path_0", value: { kind: "literal", value: "v1" } },
      { id: "path_1", value: { kind: "literal", value: "items" } },
    ]);
    expect(draft.requestDefinition.query).toEqual([
      {
        id: "query_limit_0",
        name: "limit",
        value: { kind: "literal", value: "10" },
      },
    ]);
    expect(draft.requestDefinition.agentInputs).toEqual([]);
  });

  it("marks only the selected occurrence as an agent input", () => {
    const draft = buildCurlImportDraft({
      serverBaseUrl,
      curl: "curl 'https://api.example.com/v1/items?locationId=loc_9'",
      markings: [
        {
          location: "query",
          key: "locationId",
          occurrenceId: "query:locationId:0",
          as: "agentInput",
          agentInput: {
            id: "location_id",
            name: "location_id",
            required: true,
            sensitive: false,
            type: "string",
          },
        },
      ],
      serverValues: [],
    });

    expect(draft.requestDefinition.query).toEqual([
      {
        id: "query_locationId_0",
        name: "locationId",
        value: { kind: "agentInput", agentInputId: "location_id" },
      },
    ]);
    expect(draft.requestDefinition.agentInputs).toHaveLength(1);
  });

  it("marks a repeated literal at only its own occurrence", () => {
    const draft = buildCurlImportDraft({
      serverBaseUrl,
      curl: 'curl -X POST -d \'{"id":"42"}\' https://api.example.com/42/items',
      markings: [
        {
          location: "json",
          jsonPath: "id",
          occurrenceId: "json:id",
          as: "agentInput",
          agentInput: {
            id: "record_id",
            name: "record_id",
            required: true,
            sensitive: false,
            type: "string",
          },
        },
      ],
      serverValues: [],
    });

    // The path segment "42" is untouched even though the body shares that literal.
    expect(draft.requestDefinition.pathSegments[0]).toEqual({
      id: "path_0",
      value: { kind: "literal", value: "42" },
    });
    expect(draft.requestDefinition.body).toMatchObject({ bodyType: "json" });
    if (draft.requestDefinition.body.bodyType === "json") {
      const root = draft.requestDefinition.body.root;
      expect(root).toMatchObject({
        kind: "object",
        fields: [
          {
            key: "id",
            value: {
              kind: "binding",
              binding: { kind: "agentInput", agentInputId: "record_id" },
            },
          },
        ],
      });
    }
  });

  it("resolves a serverValue marking to an existing server value only", () => {
    const draft = buildCurlImportDraft({
      serverBaseUrl,
      curl: "curl -H 'X-Api-Version: v2' https://api.example.com/items",
      markings: [
        {
          location: "header",
          key: "X-Api-Version",
          occurrenceId: "header:x-api-version:0",
          as: "serverValue",
          name: "api_version",
        },
      ],
      serverValues: [{ id: "msv_1", name: "api_version" }],
    });

    expect(draft.requestDefinition.headers).toEqual([
      {
        id: "header_x-api-version_0",
        name: "X-Api-Version",
        value: { kind: "serverValue", serverValueId: "msv_1" },
      },
    ]);
  });

  it("rejects a serverValue marking that does not resolve to an existing value", () => {
    expect(() =>
      buildCurlImportDraft({
        serverBaseUrl,
        curl: "curl -H 'X-Api-Version: v2' https://api.example.com/items",
        markings: [
          {
            location: "header",
            key: "X-Api-Version",
            occurrenceId: "header:x-api-version:0",
            as: "serverValue",
            name: "does_not_exist",
          },
        ],
        serverValues: [],
      }),
    ).toThrow(AppError);
  });

  it("excludes credentials from the draft and reports kind + header name only", () => {
    const draft = buildCurlImportDraft({
      serverBaseUrl,
      curl: `curl -H 'Authorization: Bearer super-secret' https://api.example.com/contacts`,
      markings: [],
      serverValues: [],
    });

    expect(draft.credentials).toEqual([
      { kind: "bearer", headerName: "Authorization" },
    ]);
    expect(draft.requestDefinition.headers).toEqual([]);
    expect(JSON.stringify(draft)).not.toContain("super-secret");
  });
});
