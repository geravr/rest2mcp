/**
 * Shared OpenAPI-import and tool-group contracts.
 *
 * The API importer, the Studio import UI, and the Studio group filter all need
 * the same bounded limits and the same stable diagnostic codes. Keeping them
 * here prevents the client and the server from drifting apart on either.
 */

/** Bounded limits for owner-managed Studio tool groups. */
export const MCP_TOOL_GROUP_LIMITS = {
  /** Maximum groups one server may hold. */
  maxGroupsPerServer: 50,
  /** Maximum group display-name length. */
  name: 80,
} as const;

/** Bounded limits for OpenAPI document ingestion and import selection. */
export const MCP_OPENAPI_LIMITS = {
  /** Maximum accepted UTF-8 document size, measured after decompression. */
  maxDocumentBytes: 5 * 1024 * 1024,
  /** Total deadline for one document URL retrieval, in milliseconds. */
  fetchDeadlineMs: 10_000,
  /** Maximum same-origin redirects followed while retrieving a document URL. */
  maxRedirects: 3,
  /** Maximum operations inventoried from one document. */
  maxOperations: 200,
  /** Maximum local `$ref` hops resolved for a single node. */
  maxRefDepth: 24,
  /** Maximum local `$ref` resolutions per document. */
  maxRefResolutions: 2_000,
  /**
   * Maximum object/array nesting depth accepted in a submitted document.
   * Recursive readers overflow the call stack on deeply nested JSON, so the
   * whole document is rejected before any recursive walk instead.
   */
  maxDocumentDepth: 64,
} as const;

/** OpenAPI versions this build can import. */
export const MCP_OPENAPI_VERSIONS = ["3.0", "3.1"] as const;

export type McpOpenApiVersion = (typeof MCP_OPENAPI_VERSIONS)[number];

/**
 * Stable per-operation diagnostic codes for OpenAPI import.
 *
 * These are attached to individual operations as blockers or warnings, never
 * thrown. They stay separate from `APP_ERROR_CODES` because they describe a
 * candidate rather than a failed request; clients localize them by code.
 */
export const MCP_OPENAPI_ISSUE_CODES = {
  /** The operation uses an HTTP method the canonical model cannot execute. */
  METHOD_UNSUPPORTED: "OPENAPI_METHOD_UNSUPPORTED",
  /** A `$ref` target lives outside the submitted document. */
  EXTERNAL_REFERENCE: "OPENAPI_EXTERNAL_REFERENCE",
  /** Local `$ref` resolution re-entered a node already being resolved. */
  CYCLIC_REFERENCE: "OPENAPI_CYCLIC_REFERENCE",
  /** The operation declares cookie parameters. */
  COOKIE_PARAMETER: "OPENAPI_COOKIE_PARAMETER",
  /** The request body requires multipart or file upload. */
  MULTIPART_BODY: "OPENAPI_MULTIPART_BODY",
  /** A parameter or header uses a serialization style the executor cannot reproduce. */
  UNSUPPORTED_SERIALIZATION: "OPENAPI_UNSUPPORTED_SERIALIZATION",
  /** Server precedence cannot be resolved unambiguously against the selected server. */
  AMBIGUOUS_SERVER: "OPENAPI_AMBIGUOUS_SERVER",
  /** A schema construct cannot be represented faithfully in the canonical model. */
  UNSUPPORTED_SCHEMA: "OPENAPI_UNSUPPORTED_SCHEMA",
  /** Parameters, bodies, or media types are declared ambiguously. */
  AMBIGUOUS_PARAMETER: "OPENAPI_AMBIGUOUS_PARAMETER",
  /** The request shape has no faithful canonical representation. */
  UNREPRESENTABLE_REQUEST: "OPENAPI_UNREPRESENTABLE_REQUEST",
  /** The operation's effective origin falls outside the selected server boundary. */
  FOREIGN_ORIGIN: "OPENAPI_FOREIGN_ORIGIN",
  /** A bound on document size, operations, or reference resolution was exceeded. */
  LIMIT_EXCEEDED: "OPENAPI_LIMIT_EXCEEDED",
  /** Two selected operations resolve to the same tool name. */
  DUPLICATE_NAME: "OPENAPI_DUPLICATE_NAME",
  /** A selected tool name collides with an existing tool on the server. */
  NAME_CONFLICT: "OPENAPI_NAME_CONFLICT",
  /** The operation is marked deprecated but otherwise representable. */
  DEPRECATED: "OPENAPI_DEPRECATED",
  /** Metadata was safely ignored rather than mapped. */
  METADATA_IGNORED: "OPENAPI_METADATA_IGNORED",
  /** Schema composition branches assign incompatible types or constraints. */
  COMPOSITION_CONFLICT: "OPENAPI_COMPOSITION_CONFLICT",
  /**
   * The complete JSON value can be transported faithfully, but branch
   * constraints cannot be represented so structural validation is reduced.
   */
  REDUCED_VALIDATION: "OPENAPI_REDUCED_VALIDATION",
} as const;

export type McpOpenApiIssueCode =
  (typeof MCP_OPENAPI_ISSUE_CODES)[keyof typeof MCP_OPENAPI_ISSUE_CODES];

const mcpOpenApiIssueCodeValues = Object.values(MCP_OPENAPI_ISSUE_CODES);

export function isMcpOpenApiIssueCode(
  value: unknown,
): value is McpOpenApiIssueCode {
  return (
    typeof value === "string" &&
    (mcpOpenApiIssueCodeValues as readonly string[]).includes(value)
  );
}

/** Issue codes that block confirmation for the affected operation. */
export const MCP_OPENAPI_BLOCKING_ISSUE_CODES = [
  MCP_OPENAPI_ISSUE_CODES.METHOD_UNSUPPORTED,
  MCP_OPENAPI_ISSUE_CODES.EXTERNAL_REFERENCE,
  MCP_OPENAPI_ISSUE_CODES.CYCLIC_REFERENCE,
  MCP_OPENAPI_ISSUE_CODES.COOKIE_PARAMETER,
  MCP_OPENAPI_ISSUE_CODES.MULTIPART_BODY,
  MCP_OPENAPI_ISSUE_CODES.UNSUPPORTED_SERIALIZATION,
  MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_SERVER,
  MCP_OPENAPI_ISSUE_CODES.UNSUPPORTED_SCHEMA,
  MCP_OPENAPI_ISSUE_CODES.AMBIGUOUS_PARAMETER,
  MCP_OPENAPI_ISSUE_CODES.UNREPRESENTABLE_REQUEST,
  MCP_OPENAPI_ISSUE_CODES.FOREIGN_ORIGIN,
  MCP_OPENAPI_ISSUE_CODES.LIMIT_EXCEEDED,
  MCP_OPENAPI_ISSUE_CODES.DUPLICATE_NAME,
  MCP_OPENAPI_ISSUE_CODES.NAME_CONFLICT,
  MCP_OPENAPI_ISSUE_CODES.COMPOSITION_CONFLICT,
] as const satisfies readonly McpOpenApiIssueCode[];

const blockingIssueCodes = new Set<string>(MCP_OPENAPI_BLOCKING_ISSUE_CODES);

/** Whether an issue code blocks confirmation for its operation. */
export function isMcpOpenApiBlockingIssueCode(
  code: McpOpenApiIssueCode,
): boolean {
  return blockingIssueCodes.has(code);
}

export function assertUniqueMcpOpenApiIssueCodes(): void {
  const seen = new Set<string>();
  for (const value of mcpOpenApiIssueCodeValues) {
    if (seen.has(value)) {
      throw new Error(`Duplicate McpOpenApiIssueCode value: ${value}`);
    }
    seen.add(value);
  }
}
