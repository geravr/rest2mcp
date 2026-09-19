/**
 * @file Test-only OpenAPI source fixtures for `openapi-document.test.ts`.
 */
import { MCP_OPENAPI_LIMITS } from "@repo/core";

export function documentText(document: unknown): string {
  return JSON.stringify(document);
}

/**
 * OpenAPI 3.1 document exercising parameter merging, nested schema `$ref`s,
 * repeated tags, deprecation, security inheritance, unsupported methods, and
 * all three server levels.
 */
export const OPENAPI_31_DOCUMENT: Record<string, unknown> = {
  openapi: "3.1.0",
  info: {
    title: "Widget API",
    version: "2.4.0",
    description: "Widget inventory service.",
  },
  servers: [{ url: "https://root.example.com/api" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/widgets": {
      parameters: [{ name: "tenant", in: "query", schema: { type: "string" } }],
      get: {
        operationId: "listWidgets",
        summary: "List widgets",
        description: "Lists every widget.",
        tags: ["widgets", "inventory", "widgets"],
        servers: [{ url: "https://widgets.example.com/v2" }],
        parameters: [
          { $ref: "#/components/parameters/PageLimit" },
          {
            name: "tenant",
            in: "query",
            required: true,
            schema: { type: "string" },
          },
        ],
      },
      post: {
        operationId: "createWidget",
        tags: ["widgets"],
        deprecated: true,
        security: [{ apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Widget" },
            },
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: { file: { type: "string" } },
              },
            },
          },
        },
      },
      options: { responses: {} },
      trace: { responses: {} },
    },
    "/widgets/{widgetId}": {
      parameters: [
        { name: "widgetId", in: "path", schema: { type: "string" } },
      ],
      get: { responses: {} },
    },
  },
  components: {
    parameters: {
      PageLimit: {
        name: "limit",
        in: "query",
        schema: { type: "integer" },
        examples: { small: { value: 10 }, large: { value: 50 } },
      },
    },
    schemas: {
      Widget: {
        type: "object",
        properties: {
          id: { type: "string" },
          owner: { $ref: "#/components/schemas/Owner" },
        },
        required: ["id"],
      },
      Owner: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    },
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      apiKeyAuth: { type: "apiKey", in: "header", name: "X-Api-Key" },
    },
  },
};

export function openApi30Document(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: { title: "Legacy API", version: "1.0.0" },
    paths: {
      "/legacy": {
        get: {
          operationId: "getLegacy",
          parameters: [{ name: "id", in: "query", schema: { type: "string" } }],
        },
      },
    },
  };
}

export function unsupportedVersionDocument(
  version: string,
): Record<string, unknown> {
  return {
    openapi: version,
    info: { title: "Future API", version: "1.0.0" },
    paths: {},
  };
}

export function swaggerDocument(): Record<string, unknown> {
  return {
    swagger: "2.0",
    info: { title: "Swagger API", version: "1.0.0" },
    paths: {
      "/ping": { get: { responses: { "200": { description: "ok" } } } },
    },
  };
}

export const MALFORMED_JSON_TEXT = '{"openapi": "3.1.0", "info": ';

export const YAML_DOCUMENT_TEXT =
  'openapi: "3.1.0"\ninfo:\n  title: Widgets\n  version: "1.0.0"\npaths: {}\n';

export function oversizedDocumentText(): string {
  return documentText({
    openapi: "3.1.0",
    info: { title: "Huge API", version: "1.0.0" },
    paths: {},
    description: "a".repeat(MCP_OPENAPI_LIMITS.maxDocumentBytes),
  });
}

export function tooManyOperationsDocument(
  count: number,
): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (let index = 0; index < count; index += 1) {
    paths[`/items/${index}`] = {
      get: { operationId: `getItem${index}` },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Many API", version: "1.0.0" },
    paths,
  };
}

/** A local `$ref` chain of the requested length, ending in an inline parameter. */
export function referenceChainDocument(depth: number): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (let index = 0; index < depth; index += 1) {
    parameters[`P${index}`] =
      index + 1 < depth
        ? { $ref: `#/components/parameters/P${index + 1}` }
        : { name: "chain", in: "query", schema: { type: "string" } };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Chain API", version: "1.0.0" },
    paths: {
      "/chain": {
        get: {
          operationId: "chain",
          parameters: [{ $ref: "#/components/parameters/P0" }],
        },
      },
    },
    components: { parameters },
  };
}

export function externalReferenceDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "External API", version: "1.0.0" },
    paths: {
      "/external": {
        get: {
          operationId: "externalRef",
          parameters: [
            { $ref: "https://evil.example/parameters.json#/Filter" },
            { $ref: "./shared/parameters.json#/Page" },
          ],
        },
      },
      "/still-valid": {
        get: { operationId: "stillValid", parameters: [] },
      },
    },
  };
}

export function cyclicReferenceDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Cyclic API", version: "1.0.0" },
    paths: {
      "/cyclic": {
        get: {
          operationId: "cyclicRef",
          parameters: [{ $ref: "#/components/parameters/A" }],
        },
      },
    },
    components: {
      parameters: {
        A: { $ref: "#/components/parameters/B" },
        B: { $ref: "#/components/parameters/A" },
      },
    },
  };
}

export function missingReferenceDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Missing API", version: "1.0.0" },
    paths: {
      "/missing": {
        get: {
          operationId: "missingRef",
          parameters: [{ $ref: "#/components/parameters/Absent" }],
        },
      },
    },
  };
}

export function serverPrecedenceDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Servers API", version: "1.0.0" },
    servers: [{ url: "https://root.example.com/v1" }],
    paths: {
      "/precedence": {
        servers: [{ url: "https://path.example.com/v2" }],
        get: {
          operationId: "serverPrecedence",
          servers: [
            {
              url: "https://{region}.operation.example.com/v3",
              variables: {
                region: { default: "eu", enum: ["eu", "us"] },
              },
            },
          ],
        },
      },
    },
  };
}

export function securityDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Secure API", version: "1.0.0" },
    security: [{ bearerAuth: [] }],
    paths: {
      "/inherited": { get: { operationId: "inheritedSecurity" } },
      "/override": {
        get: {
          operationId: "overrideSecurity",
          security: [{ apiKeyAuth: [] }],
        },
      },
      "/anonymous": {
        get: { operationId: "anonymousSecurity", security: [] },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Owner-issued bearer token.",
        },
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-Api-Key",
          description: "Owner-issued API key.",
        },
        oauthAuth: {
          type: "oauth2",
          flows: {
            implicit: {
              authorizationUrl: "https://auth.example.com/authorize",
              scopes: { read: "Read access" },
            },
          },
        },
        mutualTlsAuth: { type: "mutualTLS" },
        legacyAuth: { type: "somethingElse" },
      },
    },
  };
}

export function undeclaredSecurityDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Undeclared API", version: "1.0.0" },
    security: [{ missingScheme: [] }],
    paths: { "/x": { get: { operationId: "undeclared" } } },
  };
}
