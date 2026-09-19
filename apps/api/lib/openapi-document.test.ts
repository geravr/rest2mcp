import { describe, expect, it, vi } from "vitest";
import {
  APP_ERROR_CODES,
  MCP_OPENAPI_ISSUE_CODES,
  MCP_OPENAPI_LIMITS,
} from "@repo/core";
import { AppError } from "./app-error.js";
import { mapInventoryOperation } from "./openapi-mapper.js";
import {
  canonicalDocumentFingerprint,
  parseOpenApiDocument,
  suggestMcpToolName,
} from "./openapi-document.js";
import type {
  McpOpenApiDocumentMetadata,
  McpOpenApiInventoryOperation,
} from "./openapi-import-contracts.js";
import {
  OPENAPI_31_DOCUMENT,
  MALFORMED_JSON_TEXT,
  YAML_DOCUMENT_TEXT,
  cyclicReferenceDocument,
  documentText,
  externalReferenceDocument,
  missingReferenceDocument,
  openApi30Document,
  oversizedDocumentText,
  referenceChainDocument,
  securityDocument,
  serverPrecedenceDocument,
  swaggerDocument,
  tooManyOperationsDocument,
  undeclaredSecurityDocument,
  unsupportedVersionDocument,
} from "./openapi-fixtures.js";

function captureAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected function to throw");
}

function expectAppCode(fn: () => unknown, appCode: string): AppError {
  const error = captureAppError(fn);
  expect(error.appCode).toBe(appCode);
  return error;
}

function operationByKey(
  operations: McpOpenApiInventoryOperation[],
  operationKey: string,
): McpOpenApiInventoryOperation {
  const operation = operations.find(
    (candidate) => candidate.operationKey === operationKey,
  );
  if (!operation) throw new Error(`missing operation "${operationKey}"`);
  return operation;
}

function issueCodes(operation: McpOpenApiInventoryOperation): string[] {
  return operation.issues.map((issue) => issue.code);
}

function documentIssueCodes(text: string): string[] {
  return parseOpenApiDocument(text).documentIssues.map((issue) => issue.code);
}

/**
 * Runs one inventoried operation through the pure mapper, which is what
 * decides whether the owner may select it.
 */
function mapOperation(
  operation: McpOpenApiInventoryOperation,
  document: McpOpenApiDocumentMetadata,
) {
  return mapInventoryOperation({
    operation,
    document,
    serverBaseUrl: "https://api.example.com",
    suggestedName: suggestMcpToolName(operation),
    existingToolNames: [],
  });
}

/**
 * Builds a document nested `depth` object levels below the root. Iterative on
 * purpose: the fixture must not overflow while producing the input it tests.
 */
function deeplyNestedDocumentText(depth: number): string {
  let nested: unknown = { leaf: true };
  for (let index = 0; index < depth; index += 1) {
    nested = { child: nested };
  }
  return documentText({
    openapi: "3.1.0",
    info: { title: "Deep API", version: "1.0.0" },
    paths: {},
    "x-deep": nested,
  });
}

/**
 * Nesting level used by the depth-bound test: deep enough that an unbounded
 * recursive walk over the same document overflows the call stack, shallow
 * enough that building and parsing the fixture itself does not.
 */
const DEEP_NESTING_LEVELS = 30_000;

function reverseKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => reverseKeyOrder(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, child]) => [key, reverseKeyOrder(child)]),
    );
  }
  return value;
}

describe("parseOpenApiDocument: strict bounded parsing", () => {
  it("inventories a valid 3.1 document with document metadata", () => {
    const inventory = parseOpenApiDocument(documentText(OPENAPI_31_DOCUMENT));

    expect(inventory.document.version).toBe("3.1");
    expect(inventory.document.title).toBe("Widget API");
    expect(inventory.document.description).toBe("Widget inventory service.");
    expect(inventory.document.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(inventory.document.servers.map((server) => server.url)).toEqual([
      "https://root.example.com/api",
    ]);
    expect(inventory.operations).toHaveLength(5);
    expect(inventory.documentIssues).toEqual([]);
  });

  it("accepts OpenAPI 3.0 documents", () => {
    const inventory = parseOpenApiDocument(documentText(openApi30Document()));

    expect(inventory.document.version).toBe("3.0");
    expect(inventory.operations).toHaveLength(1);
    expect(inventory.operations[0]!.operationKey).toBe("getLegacy");
  });

  it("walks path keys lexicographically and methods in the fixed order", () => {
    const inventory = parseOpenApiDocument(documentText(OPENAPI_31_DOCUMENT));

    expect(
      inventory.operations.map((operation) => operation.operationKey),
    ).toEqual([
      "listWidgets",
      "createWidget",
      "OPTIONS /widgets",
      "TRACE /widgets",
      "GET /widgets/{widgetId}",
    ]);
    expect(inventory.operations.map((operation) => operation.method)).toEqual([
      "GET",
      "POST",
      "OPTIONS",
      "TRACE",
      "GET",
    ]);
    expect(
      inventory.operations.find((operation) => operation.method === "TRACE")
        ?.issues,
    ).toEqual([]);
  });

  it("rejects Swagger 2.0 and OpenAPI 3.2 as unsupported versions", () => {
    const swagger = expectAppCode(
      () => parseOpenApiDocument(documentText(swaggerDocument())),
      APP_ERROR_CODES.MCP_OPENAPI_VERSION_UNSUPPORTED,
    );
    expect(swagger.details?.path).toBe("openapi");

    expectAppCode(
      () =>
        parseOpenApiDocument(documentText(unsupportedVersionDocument("3.2.0"))),
      APP_ERROR_CODES.MCP_OPENAPI_VERSION_UNSUPPORTED,
    );
    expectAppCode(
      () => parseOpenApiDocument(documentText({ info: {}, paths: {} })),
      APP_ERROR_CODES.MCP_OPENAPI_VERSION_UNSUPPORTED,
    );
    expectAppCode(
      () => parseOpenApiDocument(documentText({ openapi: 3.1, paths: {} })),
      APP_ERROR_CODES.MCP_OPENAPI_VERSION_UNSUPPORTED,
    );
  });

  it("rejects malformed JSON and YAML input", () => {
    expectAppCode(
      () => parseOpenApiDocument(MALFORMED_JSON_TEXT),
      APP_ERROR_CODES.MCP_OPENAPI_INVALID,
    );
    expectAppCode(
      () => parseOpenApiDocument(YAML_DOCUMENT_TEXT),
      APP_ERROR_CODES.MCP_OPENAPI_INVALID,
    );
  });

  it("rejects a non-object root, info, or paths", () => {
    expectAppCode(
      () => parseOpenApiDocument("[]"),
      APP_ERROR_CODES.MCP_OPENAPI_INVALID,
    );
    expectAppCode(
      () =>
        parseOpenApiDocument(
          documentText({ openapi: "3.1.0", info: "nope", paths: {} }),
        ),
      APP_ERROR_CODES.MCP_OPENAPI_INVALID,
    );
    expectAppCode(
      () =>
        parseOpenApiDocument(
          documentText({ openapi: "3.1.0", info: { title: "x" }, paths: [] }),
        ),
      APP_ERROR_CODES.MCP_OPENAPI_INVALID,
    );
  });

  it("measures the document limit in UTF-8 bytes", () => {
    const error = expectAppCode(
      () => parseOpenApiDocument(oversizedDocumentText()),
      APP_ERROR_CODES.MCP_OPENAPI_LIMIT_EXCEEDED,
    );
    expect(error.details?.limit).toBe(MCP_OPENAPI_LIMITS.maxDocumentBytes);

    const multibyte = "é".repeat(MCP_OPENAPI_LIMITS.maxDocumentBytes / 2 + 1);
    expectAppCode(
      () => parseOpenApiDocument(`"${multibyte}"`),
      APP_ERROR_CODES.MCP_OPENAPI_LIMIT_EXCEEDED,
    );
  });

  it("rejects documents declaring more operations than the limit", () => {
    const error = expectAppCode(
      () =>
        parseOpenApiDocument(
          documentText(
            tooManyOperationsDocument(MCP_OPENAPI_LIMITS.maxOperations + 1),
          ),
        ),
      APP_ERROR_CODES.MCP_OPENAPI_LIMIT_EXCEEDED,
    );
    expect(error.details?.limit).toBe(MCP_OPENAPI_LIMITS.maxOperations);

    const atLimit = parseOpenApiDocument(
      documentText(tooManyOperationsDocument(MCP_OPENAPI_LIMITS.maxOperations)),
    );
    expect(atLimit.operations).toHaveLength(MCP_OPENAPI_LIMITS.maxOperations);
  });

  it("keeps the operation budget for declared operations only", () => {
    const document = tooManyOperationsDocument(
      MCP_OPENAPI_LIMITS.maxOperations,
    );
    const paths = document["paths"] as Record<string, unknown>;
    paths["/broken"] = { $ref: "#/components/pathItems/Absent" };

    const inventory = parseOpenApiDocument(documentText(document));

    expect(inventory.operations).toHaveLength(
      MCP_OPENAPI_LIMITS.maxOperations + 1,
    );
    expect(
      inventory.operations.filter((operation) => operation.method !== ""),
    ).toHaveLength(MCP_OPENAPI_LIMITS.maxOperations);

    const placeholder = operationByKey(inventory.operations, "* /broken");
    expect(placeholder.method).toBe("");
    expect(placeholder.pointer).toBe("/paths/~1broken");
    expect(inventory.documentIssues).toHaveLength(1);
  });

  it("still rejects documents whose declared operations exceed the limit", () => {
    // The pre-scan cannot see methods declared behind a path-item `$ref`, so
    // the inventory's own budget check is what rejects this document.
    const paths: Record<string, unknown> = {};
    for (let index = 0; index <= MCP_OPENAPI_LIMITS.maxOperations; index += 1) {
      paths[`/shared/${index}`] = { $ref: "#/components/pathItems/Shared" };
    }

    const error = expectAppCode(
      () =>
        parseOpenApiDocument(
          documentText({
            openapi: "3.1.0",
            info: { title: "Ref-heavy API", version: "1.0.0" },
            paths,
            components: {
              pathItems: { Shared: { get: { operationId: "sharedGet" } } },
            },
          }),
        ),
      APP_ERROR_CODES.MCP_OPENAPI_LIMIT_EXCEEDED,
    );
    expect(error.details?.limit).toBe(MCP_OPENAPI_LIMITS.maxOperations);
  });

  it("bounds document nesting with a bounded error instead of a RangeError", () => {
    const text = deeplyNestedDocumentText(DEEP_NESTING_LEVELS);
    // Proof the fixture is hostile: the recursive canonical walk over the very
    // same document overflows, which is what the depth bound converts into a
    // bounded 400 before any recursive reader sees it.
    expect(() => canonicalDocumentFingerprint(JSON.parse(text))).toThrow(
      RangeError,
    );

    let thrown: unknown;
    try {
      parseOpenApiDocument(text);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).not.toBeInstanceOf(RangeError);
    const error = thrown as AppError;
    expect(error.appCode).toBe(APP_ERROR_CODES.MCP_OPENAPI_LIMIT_EXCEEDED);
    expect(error.details?.limit).toBe(MCP_OPENAPI_LIMITS.maxDocumentDepth);
    expect(typeof error.details?.path).toBe("string");

    const shallow = parseOpenApiDocument(deeplyNestedDocumentText(8));
    expect(shallow.operations).toEqual([]);
  });
});

describe("canonicalDocumentFingerprint", () => {
  it("is stable across key order and changes with content", () => {
    const first = parseOpenApiDocument(documentText(OPENAPI_31_DOCUMENT));
    const reordered = parseOpenApiDocument(
      documentText(reverseKeyOrder(OPENAPI_31_DOCUMENT)),
    );

    expect(reordered.document.fingerprint).toBe(first.document.fingerprint);

    const changed = parseOpenApiDocument(
      documentText({
        ...OPENAPI_31_DOCUMENT,
        info: { title: "Other API", version: "1.0.0" },
      }),
    );
    expect(changed.document.fingerprint).not.toBe(first.document.fingerprint);
  });

  it("sorts object keys but preserves array order", () => {
    expect(canonicalDocumentFingerprint({ a: 1, b: [1, 2] })).toBe(
      canonicalDocumentFingerprint({ b: [1, 2], a: 1 }),
    );
    expect(canonicalDocumentFingerprint([1, 2])).not.toBe(
      canonicalDocumentFingerprint([2, 1]),
    );
  });
});

describe("parseOpenApiDocument: local reference resolution", () => {
  it("resolves parameter, request body, and nested schema references", () => {
    const inventory = parseOpenApiDocument(documentText(OPENAPI_31_DOCUMENT));
    const operation = operationByKey(inventory.operations, "listWidgets");

    const limit = operation.parameters.find(
      (parameter) => parameter.name === "limit",
    );
    expect(limit?.in).toBe("query");
    expect(limit?.schema).toEqual({ type: "integer" });
    expect(limit?.examples).toEqual([10, 50]);
    expect(limit?.pointer).toBe("/components/parameters/PageLimit");

    const create = operationByKey(inventory.operations, "createWidget");
    const body = create.requestBody;
    expect(body?.required).toBe(true);
    expect(body?.mediaTypes.map((media) => media.mediaType)).toEqual([
      "application/json",
      "multipart/form-data",
    ]);
    const mediaPointer = body?.mediaTypes[0]?.pointer;
    expect(mediaPointer).toBe(
      "/paths/~1widgets/post/requestBody/content/application~1json",
    );
    const widgetSchema = body?.mediaTypes[0]?.schema;
    expect(widgetSchema?.required).toEqual(["id"]);
    expect(widgetSchema?.properties).toMatchObject({
      owner: { type: "object", properties: { name: { type: "string" } } },
    });
  });

  it("merges path-level parameters with operation-level overrides", () => {
    const inventory = parseOpenApiDocument(documentText(OPENAPI_31_DOCUMENT));
    const operation = operationByKey(inventory.operations, "listWidgets");

    expect(operation.parameters.map((parameter) => parameter.name)).toEqual([
      "tenant",
      "limit",
    ]);
    expect(operation.parameters[0]).toMatchObject({
      name: "tenant",
      in: "query",
      required: true,
    });

    const pathOperation = operationByKey(
      inventory.operations,
      "GET /widgets/{widgetId}",
    );
    expect(pathOperation.parameters[0]).toMatchObject({
      name: "widgetId",
      in: "path",
      required: true,
    });
  });

  it("rejects external references without any side effect", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const inventory = parseOpenApiDocument(
        documentText(externalReferenceDocument()),
      );
      expect(fetchSpy).not.toHaveBeenCalled();

      const external = operationByKey(inventory.operations, "externalRef");
      expect(issueCodes(external)).toEqual([
        MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
        MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
      ]);
      expect(external.parameters).toEqual([]);
      expect(external.issues[0]?.path).toBe(
        "/paths/~1external/get/parameters/0",
      );

      const unaffected = operationByKey(inventory.operations, "stillValid");
      expect(unaffected.issues).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("resolves a path-item reference before reading its operations", () => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Path API", version: "1.0.0" },
        paths: { "/aliased": { $ref: "#/components/pathItems/Shared" } },
        components: {
          pathItems: {
            Shared: { get: { operationId: "sharedGet", parameters: [] } },
          },
        },
      }),
    );
    const operation = operationByKey(inventory.operations, "sharedGet");

    expect(operation.issues).toEqual([]);
    expect(operation.pointer).toBe("/components/pathItems/Shared/get");
  });

  it("reports an unresolvable path-item reference and keeps the path visible", () => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Path refs", version: "1.0.0" },
        paths: {
          "/y": { $ref: "./paths.yaml#/y" },
          "/ok": { get: { operationId: "okGet", parameters: [] } },
        },
      }),
    );

    expect(inventory.documentIssues).toHaveLength(1);
    const issue = inventory.documentIssues[0];
    expect(issue?.code).toBe(MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE);
    expect(issue?.severity).toBe("error");
    expect(issue?.path).toBe("/paths/~1y");

    const placeholder = operationByKey(inventory.operations, "* /y");
    expect(placeholder.method).toBe("");
    expect(placeholder.path).toBe("/y");
    expect(placeholder.pointer).toBe("/paths/~1y");
    expect(placeholder.tags).toEqual([]);
    expect(placeholder.parameters).toEqual([]);
    expect(issueCodes(placeholder)).toEqual([
      MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
    ]);
    expect(mapOperation(placeholder, inventory.document).selectable).toBe(
      false,
    );

    const unaffected = operationByKey(inventory.operations, "okGet");
    expect(unaffected.issues).toEqual([]);
  });

  it("keeps declared sibling methods when a path-item reference cannot resolve", () => {
    const text = documentText({
      openapi: "3.1.0",
      info: { title: "Mixed paths", version: "1.0.0" },
      paths: {
        "/mixed": {
          $ref: "#/components/pathItems/Absent",
          get: { operationId: "mixedGet", parameters: [] },
        },
      },
    });

    expect(documentIssueCodes(text)).toEqual([
      MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
    ]);
    const inventory = parseOpenApiDocument(text);
    const fallback = operationByKey(inventory.operations, "mixedGet");
    expect(fallback.issues).toEqual([]);
    expect(fallback.pointer).toBe("/paths/~1mixed/get");
    expect(fallback.method).toBe("GET");
  });

  it("blocks a path item whose reference resolves to a non-Path-Item object", () => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Mistyped pointer", version: "1.0.0" },
        paths: { "/pets": { $ref: "#/components/schemas/Pet" } },
        components: {
          schemas: {
            Pet: {
              type: "object",
              description: "A pet.",
              properties: { name: { type: "string" } },
            },
          },
        },
      }),
    );

    expect(inventory.documentIssues).toHaveLength(1);
    const issue = inventory.documentIssues[0];
    expect(issue?.code).toBe(MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE);
    expect(issue?.severity).toBe("error");
    expect(issue?.path).toBe("/paths/~1pets");
    expect(issue?.message).toBe(
      'Reference "#/components/schemas/Pet" does not resolve to a Path Item object.',
    );

    const placeholder = operationByKey(inventory.operations, "* /pets");
    expect(placeholder.method).toBe("");
    expect(placeholder.pointer).toBe("/paths/~1pets");
    expect(issueCodes(placeholder)).toEqual([
      MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
    ]);
    expect(mapOperation(placeholder, inventory.document).selectable).toBe(
      false,
    );
  });

  it.each([
    ["description", { description: "A pet." }],
    ["summary", { summary: "A pet." }],
    ["servers", { servers: [{ url: "https://api.example.com" }] }],
    ["extension", { "x-internal": true }],
  ])("blocks a reference resolving to a %s-only object", (_kind, target) => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Schema target", version: "1.0.0" },
        paths: { "/pets": { $ref: "#/components/schemas/Pet" } },
        components: { schemas: { Pet: target } },
      }),
    );

    expect(inventory.documentIssues).toHaveLength(1);
    const issue = inventory.documentIssues[0];
    expect(issue?.code).toBe(MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE);
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toBe(
      'Reference "#/components/schemas/Pet" does not resolve to a Path Item object.',
    );
    expect(issue?.path).toBe("/paths/~1pets");

    expect(
      inventory.operations.map((operation) => operation.operationKey),
    ).toEqual(["* /pets"]);
    expect(
      mapOperation(inventory.operations[0]!, inventory.document).selectable,
    ).toBe(false);
  });

  it("accepts a resolved path item that declares only parameters", () => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Shared path parameters", version: "1.0.0" },
        paths: { "/shared": { $ref: "#/components/pathItems/SharedParams" } },
        components: {
          pathItems: {
            SharedParams: {
              parameters: [
                { name: "tenant", in: "query", schema: { type: "string" } },
              ],
            },
          },
        },
      }),
    );

    expect(inventory.documentIssues).toEqual([]);
    expect(
      inventory.operations.map((operation) => operation.operationKey),
    ).toEqual([]);
  });

  it("accepts a resolved path item that declares a single method", () => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Single method", version: "1.0.0" },
        paths: { "/things": { $ref: "#/components/pathItems/Shared" } },
        components: {
          pathItems: { Shared: { get: { operationId: "sharedThingGet" } } },
        },
      }),
    );

    expect(inventory.documentIssues).toEqual([]);
    expect(
      inventory.operations.map((operation) => operation.operationKey),
    ).toEqual(["sharedThingGet"]);
    expect(inventory.operations.map((operation) => operation.method)).toEqual([
      "GET",
    ]);
  });

  it.each([
    ["an empty path item", {}],
    ["an extensions-only path item", { "x-internal": true }],
  ])("skips %s without a reference or an operation", (_kind, pathItem) => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Ping API", version: "1.0.0" },
        paths: { "/ping": pathItem },
      }),
    );

    expect(inventory.documentIssues).toEqual([]);
    // The preview's operationCount and blocked count derive from this list,
    // so an empty list is what keeps those counters at zero.
    expect(
      inventory.operations.map((operation) => operation.operationKey),
    ).toEqual([]);
  });

  it("emits no placeholder when a broken reference still yields operations", () => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Mixed API", version: "1.0.0" },
        paths: {
          "/x": {
            $ref: "./external.json#/paths/~1x",
            get: { operationId: "realGet", parameters: [] },
          },
        },
      }),
    );

    expect(
      inventory.operations.map((operation) => operation.operationKey),
    ).toEqual(["realGet"]);
    expect(inventory.operations.map((operation) => operation.method)).toEqual([
      "GET",
    ]);
    expect(inventory.documentIssues).toHaveLength(1);
    expect(inventory.documentIssues[0]?.path).toBe("/paths/~1x");
  });

  it("emits exactly one blocked placeholder when a path item has no readable methods", () => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Unreadable API", version: "1.0.0" },
        paths: { "/ghost": { $ref: "#/components/pathItems/Absent" } },
      }),
    );

    expect(inventory.documentIssues).toHaveLength(1);
    expect(
      inventory.operations.map((operation) => operation.operationKey),
    ).toEqual(["* /ghost"]);
    const placeholder = inventory.operations[0]!;
    expect(placeholder.method).toBe("");
    expect(placeholder.path).toBe("/ghost");
    expect(placeholder.pointer).toBe("/paths/~1ghost");
    expect(mapOperation(placeholder, inventory.document).selectable).toBe(
      false,
    );
  });

  it("reports a cyclic path-item reference at document level", () => {
    const text = documentText({
      openapi: "3.1.0",
      info: { title: "Cyclic paths", version: "1.0.0" },
      paths: { "/cycle": { $ref: "#/components/pathItems/A" } },
      components: {
        pathItems: {
          A: { $ref: "#/components/pathItems/B" },
          B: { $ref: "#/components/pathItems/A" },
        },
      },
    });

    expect(documentIssueCodes(text)).toEqual([
      MCP_OPENAPI_ISSUE_CODES.CYCLIC_REFERENCE,
    ]);
    const inventory = parseOpenApiDocument(text);
    const placeholder = operationByKey(inventory.operations, "* /cycle");
    expect(placeholder.method).toBe("");
    expect(placeholder.path).toBe("/cycle");
    expect(issueCodes(placeholder)).toEqual([
      MCP_OPENAPI_ISSUE_CODES.CYCLIC_REFERENCE,
    ]);
  });

  it("reports unresolvable internal pointers as reference issues", () => {
    const inventory = parseOpenApiDocument(
      documentText(missingReferenceDocument()),
    );
    const operation = operationByKey(inventory.operations, "missingRef");

    expect(issueCodes(operation)).toEqual([
      MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
    ]);
    expect(operation.parameters).toEqual([]);
  });

  it("detects cyclic references", () => {
    const inventory = parseOpenApiDocument(
      documentText(cyclicReferenceDocument()),
    );
    const operation = operationByKey(inventory.operations, "cyclicRef");

    expect(issueCodes(operation)).toEqual([
      MCP_OPENAPI_ISSUE_CODES.CYCLIC_REFERENCE,
    ]);
    expect(operation.parameters).toEqual([]);
  });

  it("bounds reference depth per chain", () => {
    const resolved = parseOpenApiDocument(
      documentText(referenceChainDocument(MCP_OPENAPI_LIMITS.maxRefDepth)),
    );
    const resolvedOperation = operationByKey(resolved.operations, "chain");
    expect(resolvedOperation.issues).toEqual([]);
    expect(resolvedOperation.parameters[0]?.name).toBe("chain");

    const overLimit = parseOpenApiDocument(
      documentText(referenceChainDocument(MCP_OPENAPI_LIMITS.maxRefDepth + 1)),
    );
    const limitedOperation = operationByKey(overLimit.operations, "chain");
    expect(issueCodes(limitedOperation)).toEqual([
      MCP_OPENAPI_ISSUE_CODES.LIMIT_EXCEEDED,
    ]);
  });

  it("percent-decodes and unescapes pointer segments", () => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Pointer API", version: "1.0.0" },
        paths: {
          "/pointers": {
            get: {
              operationId: "pointerRef",
              parameters: [{ $ref: "#/components/parameters/a~1b%20c" }],
            },
          },
        },
        components: {
          parameters: {
            "a/b c": {
              name: "decoded",
              in: "query",
              schema: { type: "string" },
            },
          },
        },
      }),
    );
    const operation = operationByKey(inventory.operations, "pointerRef");

    expect(operation.issues).toEqual([]);
    expect(operation.parameters[0]?.name).toBe("decoded");
  });
});

describe("parseOpenApiDocument: ambiguous declared parameters", () => {
  function ambiguousParameterDocument(): Record<string, unknown> {
    return {
      openapi: "3.1.0",
      info: { title: "Params API", version: "1.0.0" },
      paths: {
        "/params": {
          get: {
            operationId: "ambiguousParams",
            parameters: [
              { name: "noLocation", schema: { type: "string" } },
              { $ref: "#/components/parameters/Scalar" },
            ],
          },
        },
      },
      components: { parameters: { Scalar: "not-a-parameter" } },
    };
  }

  it("blocks the operation when a declared parameter cannot be read", () => {
    const inventory = parseOpenApiDocument(
      documentText(ambiguousParameterDocument()),
    );
    const operation = operationByKey(inventory.operations, "ambiguousParams");

    expect(operation.parameters).toEqual([]);
    expect(issueCodes(operation)).toEqual([
      MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_PARAMETER,
      MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_PARAMETER,
    ]);
    expect(operation.issues.every((issue) => issue.severity === "error")).toBe(
      true,
    );
    expect(operation.issues[0]?.path).toBe("/paths/~1params/get/parameters/0");
    expect(operation.issues[0]?.message).toContain(
      "/paths/~1params/get/parameters/0",
    );
    expect(operation.issues[1]?.path).toBe("/components/parameters/Scalar");

    const mapped = mapOperation(operation, inventory.document);
    expect(mapped.selectable).toBe(false);
    expect(mapped.issues.map((issue) => issue.code)).toContain(
      MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_PARAMETER,
    );
  });

  it("reports a path-level parameter failure on every operation under the path", () => {
    const inventory = parseOpenApiDocument(
      documentText({
        openapi: "3.1.0",
        info: { title: "Shared params API", version: "1.0.0" },
        paths: {
          "/shared": {
            parameters: [{ name: "broken", schema: { type: "string" } }],
            get: { operationId: "sharedGet", parameters: [] },
            post: { operationId: "sharedPost" },
          },
        },
      }),
    );

    for (const operationKey of ["sharedGet", "sharedPost"]) {
      const operation = operationByKey(inventory.operations, operationKey);
      expect(operation.parameters).toEqual([]);
      expect(issueCodes(operation)).toEqual([
        MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_PARAMETER,
      ]);
      expect(operation.issues[0]?.path).toBe("/paths/~1shared/parameters/0");
      expect(mapOperation(operation, inventory.document).selectable).toBe(
        false,
      );
    }
  });
});

describe("parseOpenApiDocument: operations, servers, and security", () => {
  it("records tags and deprecation state", () => {
    const inventory = parseOpenApiDocument(documentText(OPENAPI_31_DOCUMENT));

    const list = operationByKey(inventory.operations, "listWidgets");
    expect(list.tags).toEqual(["widgets", "inventory"]);
    expect(list.deprecated).toBe(false);
    expect(list.summary).toBe("List widgets");
    expect(list.description).toBe("Lists every widget.");

    const create = operationByKey(inventory.operations, "createWidget");
    expect(create.deprecated).toBe(true);
  });

  it("resolves server precedence nearest first", () => {
    const inventory = parseOpenApiDocument(
      documentText(serverPrecedenceDocument()),
    );
    const operation = operationByKey(inventory.operations, "serverPrecedence");

    expect(operation.servers.map((server) => server.url)).toEqual([
      "https://{region}.operation.example.com/v3",
      "https://path.example.com/v2",
      "https://root.example.com/v1",
    ]);
    expect(operation.servers[0]?.variables).toEqual([
      { name: "region", default: "eu", values: ["eu", "us"] },
    ]);
    expect(operation.servers[0]?.pointer).toBe(
      "/paths/~1precedence/get/servers/0",
    );
    expect(operation.servers[1]?.pointer).toBe("/paths/~1precedence/servers/0");
    expect(operation.servers[2]?.pointer).toBe("/servers/0");
  });

  it("leaves the effective servers empty when no level declares one", () => {
    const inventory = parseOpenApiDocument(documentText(openApi30Document()));

    expect(inventory.operations[0]?.servers).toEqual([]);
  });

  it("applies document security with operation-level replacement", () => {
    const inventory = parseOpenApiDocument(documentText(securityDocument()));

    expect(inventory.document.security).toEqual([
      { name: "bearerAuth", type: "http", scheme: "bearer" },
    ]);
    expect(
      operationByKey(inventory.operations, "inheritedSecurity").security,
    ).toEqual([{ name: "bearerAuth", type: "http", scheme: "bearer" }]);
    expect(
      operationByKey(inventory.operations, "overrideSecurity").security,
    ).toEqual([{ name: "apiKeyAuth", type: "apiKey", in: "header" }]);
    expect(
      operationByKey(inventory.operations, "anonymousSecurity").security,
    ).toEqual([]);
  });

  it("keeps security schemes secret-safe", () => {
    const inventory = parseOpenApiDocument(documentText(securityDocument()));

    expect(inventory.document.securitySchemes["oauthAuth"]).toEqual({
      name: "oauthAuth",
      type: "oauth2",
    });
    expect(inventory.document.securitySchemes["mutualTlsAuth"]).toEqual({
      name: "mutualTlsAuth",
      type: "mutualTLS",
    });
    expect(inventory.document.securitySchemes["legacyAuth"]).toEqual({
      name: "legacyAuth",
      type: "unknown",
    });
    for (const requirement of Object.values(
      inventory.document.securitySchemes,
    )) {
      expect(
        Object.keys(requirement).every((key) =>
          ["name", "type", "in", "scheme"].includes(key),
        ),
      ).toBe(true);
    }
    expect(JSON.stringify(inventory)).not.toContain("authorizationUrl");
    expect(JSON.stringify(inventory)).not.toContain("Owner-issued");
  });

  it("reports undeclared security schemes by name only", () => {
    const inventory = parseOpenApiDocument(
      documentText(undeclaredSecurityDocument()),
    );

    expect(inventory.document.security).toEqual([
      { name: "missingScheme", type: "unknown" },
    ]);
  });
});

describe("suggestMcpToolName", () => {
  const namePattern = /^[a-z][a-z0-9_]*$/;

  it("prefers operationId and falls back to method plus path", () => {
    expect(
      suggestMcpToolName({
        method: "GET",
        path: "/pets/{petId}",
        operationId: "getPetById",
      }),
    ).toBe("getpetbyid");
    expect(suggestMcpToolName({ method: "GET", path: "/pets/{petId}" })).toBe(
      "get_pets_petid",
    );
    expect(
      suggestMcpToolName({ method: "DELETE", path: "/v1/users/{user-id}" }),
    ).toBe("delete_v1_users_user_id");
  });

  it("is deterministic and never suffixes collisions", () => {
    const first = suggestMcpToolName({
      method: "POST",
      path: "/a",
      operationId: "createThing",
    });
    const second = suggestMcpToolName({
      method: "POST",
      path: "/b",
      operationId: "createThing",
    });

    expect(first).toBe("createThing".toLowerCase());
    expect(second).toBe(first);
  });

  it("produces bounded MCP-safe names for awkward inputs", () => {
    const operations = [
      { method: "GET", path: "/", operationId: "2fa-verify" },
      { method: "GET", path: "/", operationId: "12345" },
      { method: "GET", path: "/", operationId: "///" },
      { method: "GET", path: "/", operationId: "  " },
      { method: "GET", path: "/", operationId: "" },
      { method: "GET", path: "/", operationId: "Ünïcode Ñame" },
      { method: "GET", path: "/", operationId: "a".repeat(120) },
      { method: "GET", path: "/", operationId: `${"a".repeat(79)}_b` },
      { method: "OPTIONS", path: "/", operationId: undefined },
    ];

    for (const operation of operations) {
      const name = suggestMcpToolName(operation);
      expect(name).toMatch(namePattern);
      expect(name.length).toBeLessThanOrEqual(80);
      expect(suggestMcpToolName(operation)).toBe(name);
    }
    expect(
      suggestMcpToolName({
        method: "GET",
        path: "/",
        operationId: "2fa-verify",
      }),
    ).toBe("fa_verify");
    expect(
      suggestMcpToolName({ method: "GET", path: "/", operationId: "12345" }),
    ).toBe("op_12345");
    expect(
      suggestMcpToolName({ method: "GET", path: "/", operationId: "///" }),
    ).toBe("op_operation");
    expect(
      suggestMcpToolName({
        method: "GET",
        path: "/",
        operationId: `${"a".repeat(79)}_b`,
      }),
    ).toBe("a".repeat(79));
  });
});
